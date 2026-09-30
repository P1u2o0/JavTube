/**
 * @file cover-protocol.js
 * @module electron/main/cover-protocol
 * @description javtube-cover 自定义协议模块。把本地磁盘图片文件安全地暴露给渲染进程的 <img>。
 *              代码自原 index.js 原样迁出（纯移动，逻辑零变更）。
 *
 * 用途：让渲染进程的 <img> 能加载本地磁盘封面图。
 * 不能直接用 file:// 的原因：在 Electron 默认 CSP 下，<img src="file://..."> 会报
 * "Not allowed to load local resource"。注册成自定义协议后，CSP 只需放行 javtube-cover:，
 * 主进程按规则解析图片字节流返回即可，跨平台/跨目录/带空格路径都安全。
 *
 * 调用时序（重要）：
 *   1. registerSchemesAsPrivileged() 必须在 app ready 之前调用（Electron 硬性要求）；
 *   2. setupCoverProtocol(dataDir) 在 app.whenReady 内、创建窗口之前调用。
 *
 * 协议格式：javtube-cover://0/<base64url 编码后的绝对路径>
 * - 固定占位 host '0'：base64url 字符是合法 hostname 字符，不占位会被 Chromium 解析进
 *   host 段导致 pathname 为空（400）。
 * - base64url 兼容任意字符（空格、中文、Windows 反斜杠等），避免 URL 解析问题。
 * - 仅放行白名单扩展名（图片），且必须落在白名单根目录内，防止被利用读任意文件。
 * @dependencies electron (app, protocol, net), path, fs, os
 */

const { app, protocol, net } = require('electron')
const path = require('path')
const fs = require('fs')

// ===== 封面字节的内存缓存（2026-09-30 性能审计新增）=====
// 为什么需要：实测演员页每次进入/回访都会发起 **113 次**封面请求，而卡片重建后
// Chromium 的内存缓存对同批大图经常已淘汰 → 又走一遍「stat + 读文件 + 跨进程回传」。
// 实测单次固有成本仅 ~1ms（串行零排队），但 113 并发下 handler 内部耗时被拉到
// avg 86ms / p90 145ms（86× 放大，全是排队）。进程内缓存把这 113 次里**重复的那部分**
// 直接降为内存拷贝，不再碰磁盘与网络栈。
//
// 缓存键 = 「解析后的绝对路径」，并用 ETag（size-mtime）做值校验：
// 文件被覆盖写入（重新刮削 / 修复失效图都是**写回原路径**）时 mtime 变 → ETag 变 → 自动失效，
// 因此不会出现「换了封面还显示旧图」。这一点必须保住 —— 见下方 cache-control 的注释。
const CACHE_MAX_ENTRIES = 200
const CACHE_MAX_BYTES = 32 * 1024 * 1024      // 32MB 上限，避免占着内存不放
const CACHE_SINGLE_MAX = 4 * 1024 * 1024      // 单张超过 4MB 不入缓存（省得一张吃光额度）
/** 超过这个大小就直接走 net.fetch 流式回传，不整块读进内存 */
const STREAM_THRESHOLD = 6 * 1024 * 1024
const cache = new Map()                        // absPath -> { etag, contentType, buf }
let cacheBytes = 0

/** 命中即返回（并把该键移到队尾实现 LRU）；ETag 不匹配视为未命中 */
function cacheGet(key, etag) {
  const e = cache.get(key)
  if (!e || e.etag !== etag) return null
  cache.delete(key); cache.set(key, e)
  return e
}
function cacheSet(key, etag, contentType, buf) {
  if (buf.length > CACHE_SINGLE_MAX) return
  const old = cache.get(key)
  if (old) { cacheBytes -= old.buf.length; cache.delete(key) }
  cache.set(key, { etag, contentType, buf })
  cacheBytes += buf.length
  while (cache.size > CACHE_MAX_ENTRIES || cacheBytes > CACHE_MAX_BYTES) {
    const k = cache.keys().next().value
    if (k === undefined) break
    cacheBytes -= cache.get(k).buf.length
    cache.delete(k)
  }
}

/**
 * 将 javtube-cover 注册为 privileged scheme。
 * 必须在 app ready 之前调用（index.js 顶层），否则 protocol.handle 不生效。
 */
function registerCoverScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'javtube-cover',
      privileges: {
        standard: true,     // 走标准 URL 解析（host 段、pathToFileURL 等都正常）
        secure: true,        // 允许当 https 一样看待（web security 不挡）
        supportFetchAPI: true,
        stream: true         // 大图流式输出，避免一次性读进内存
      }
    }
  ])
}

/**
 * 注册 javtube-cover 协议处理器，把本地图片文件暴露给渲染进程的 <img>。
 * @param {string} dataDir - 应用数据目录（用于路径校验，限定在数据目录等白名单内）
 */
function setupCoverProtocol(dataDir) {
  // 白名单扩展名：仅图片可走该协议，避免被滥用来加载本地视频或文档
  const IMG_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.bmp'])
  const isImg = (p) => IMG_EXTS.has(path.extname(p).toLowerCase())

  // 路径白名单：必须在这些目录之一，才允许读取
  //   1. 数据目录（封面、上传图等都存在这里）
  //   2. 系统临时目录（兼容旧版刮削缓存）
  //   3. EXE 同级目录（兼容用户把数据放在 exe 旁的场景）
  const allowedRoots = [
    path.resolve(dataDir),
    path.resolve(process.cwd()),
    path.resolve(path.dirname(app.getPath('exe'))),
    path.resolve(require('os').tmpdir())
  ]

  protocol.handle('javtube-cover', async (request) => {
    try {
      const u = new URL(request.url)
      // 占位 host = "0"，编码段在 pathname 的第一段（如 javtube-cover://0/QzxhelBh...）
      // 解码前缀 /，去掉可能的尾部 /（浏览器偶尔会加）
      const segs = u.pathname.split('/').filter(s => s.length > 0)
      const enc = segs[0] || ''
      if (!enc) return new Response('bad request', { status: 400 })
      // base64url 解码为文件绝对路径
      const abs = Buffer.from(enc, 'base64').toString('utf-8')
      // 解析为标准绝对路径
      const resolved = path.resolve(abs)
      // 白名单校验：必须落在允许的根目录之一
      const ok = allowedRoots.some(root => {
        const rel = path.relative(root, resolved)
        return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
      })
      if (!ok) return new Response('forbidden', { status: 403 })
      // 必须是图片扩展名
      if (!isImg(resolved)) return new Response('not an image', { status: 415 })
      // 文件必须存在且是文件（一次异步 stat，同时拿 mtime/size 给 ETag 用）
      let stat
      try {
        stat = await fs.promises.stat(resolved)
        if (!stat.isFile()) return new Response('not found', { status: 404 })
      } catch {
        return new Response('not found', { status: 404 })
      }

      // 缓存策略（2026-09-28 审计修正）：
      // 原来是「无条件 max-age=1年 + immutable」+ 前端内存里的 ?v= 版本号。
      // 问题：版本号只存在于渲染进程内存，**重启后 URL 就退回不带 ?v= 的旧地址**，
      // Chromium 直接从磁盘缓存取图 —— 于是「重新刮削换封面」「检查并修复失效图片
      // （写回同一路径）」在重启后看到的还是修之前那张。
      // 改成 ETag 条件请求：文件没动 → 304（只 stat 一次，不读文件、不解码）；
      // 文件变了 → 200 新内容。既保留翻页命中缓存的收益，又不会再返旧图。
      //
      // ★ 2026-09-30 性能审计：**故意不改用 max-age**（审计报告曾建议 private, max-age=300）。
      //   否决理由：max-age 会让 Chromium 在窗口期内**完全跳过回源校验**，而上一条注释描述的
      //   「版本号只在内存里、重启后退回旧 URL」这个前提依然成立 —— 一旦用户在重启后 5 分钟内
      //   查看刚修好的封面，看到的仍是旧图，等于把 2026-09-28 特意修好的问题重新引入。
      //   收益侧也不需要它：重复请求已由上面的进程内缓存吸收（内存拷贝 <0.1ms），
      //   且请求总数本身由前端「按需加载」压掉（见 MovieCard.vue）。
      //   结论：保留 no-cache + ETag —— 每次使用前回源校验，但校验本身很便宜（一次 stat）。
      const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`
      const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' }
      const contentType = MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream'
      const inm = request.headers.get('if-none-match')
      if (inm && inm === etag) {
        return new Response(null, { status: 304, headers: { etag, 'cache-control': 'no-cache' } })
      }
      // 进程内缓存命中：直接回内存字节，不再碰磁盘与网络栈（见文件顶部的缓存说明）
      const hit = cacheGet(resolved, etag)
      if (hit) {
        return new Response(hit.buf, {
          status: 200,
          headers: { 'content-type': hit.contentType, 'content-length': String(hit.buf.length), etag, 'cache-control': 'no-cache' }
        })
      }
      const baseHeaders = { 'content-type': contentType, etag, 'cache-control': 'no-cache' }
      // 超大图仍走 net.fetch 流式回传（Electron 的 network 栈本身也是流式的，避免整块进内存）
      if (stat.size > STREAM_THRESHOLD) {
        const fileUrl = require('url').pathToFileURL(resolved).href
        const res = await net.fetch(fileUrl)
        const headers = new Headers(res.headers)
        for (const [k, v] of Object.entries(baseHeaders)) headers.set(k, v)
        return new Response(res.body, { status: res.status, headers })
      }
      // 常规图片：直接读盘（原来是 await net.fetch(file://)，要跨进程走一遍网络栈，
      // 网络栈自己又 stat+open 一次 —— 每张图 2 次 stat/open）。这里已经 stat 过了，直接读即可。
      let buf
      try {
        buf = await fs.promises.readFile(resolved)
      } catch (e) {
        // stat 与 read 之间文件被删除/替换（刮削、清理孤儿图都可能发生）——
        // 按「不存在」回 404，而不是掉进外层 catch 回 500（语义更准，也少一条误导性日志）
        if (e && (e.code === 'ENOENT' || e.code === 'EISDIR')) {
          return new Response('not found', { status: 404 })
        }
        throw e
      }
      cacheSet(resolved, etag, contentType, buf)
      return new Response(buf, {
        status: 200,
        headers: { ...baseHeaders, 'content-length': String(buf.length) }
      })
    } catch (e) {
      console.warn('[cover-protocol] err:', e.message)
      return new Response('error: ' + e.message, { status: 500 })
    }
  })
  console.log('[main] javtube-cover protocol registered')
}

module.exports = { registerCoverScheme, setupCoverProtocol }
