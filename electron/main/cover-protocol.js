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
      // 文件必须存在且是文件
      // 原实现 existsSync + statSync 是两次同步磁盘调用（一屏 20 张封面即 40 次），
      // 合并为一次异步 stat。
      try {
        if (!(await fs.promises.stat(resolved)).isFile()) {
          return new Response('not found', { status: 404 })
        }
      } catch {
        return new Response('not found', { status: 404 })
      }
      // 用 net.fetch 走本地文件协议交给 Electron 处理，返回标准 Response
      // URL 用 pathToFileURL 来正确编码（处理中文、空格、# 等字符）
      const fileUrl = require('url').pathToFileURL(resolved).href
      return await net.fetch(fileUrl)
    } catch (e) {
      console.warn('[cover-protocol] err:', e.message)
      return new Response('error: ' + e.message, { status: 500 })
    }
  })
  console.log('[main] javtube-cover protocol registered')
}

module.exports = { registerCoverScheme, setupCoverProtocol }
