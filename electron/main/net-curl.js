/**
 * @file net-curl.js
 * @module electron/main/net-curl
 * @description 基于系统 curl 的 HTTP 客户端（2026-09-13 新增）。
 *
 * 背景（实测结论）：Cloudflare / 图床按客户端 TLS 指纹区分放行——
 *   同一代理、同一 Cookie、同一时刻下：
 *     curl（OpenSSL 传统指纹）          → JAVDB 200 ✓ / DMM 图片 200 ✓
 *     Electron net.fetch（Chromium 栈） → JAVDB 403 ✗ / DMM ERR_CONNECTION_CLOSED ✗
 *     Node https（Node 默认 OpenSSL）   → JAVDB 403 ✗
 *   因此刮削的页面请求与图片下载统一改由系统 curl 执行（Windows 10 1803+ 内置）。
 *
 * 约定：
 *   - 页面请求：按需带代理（JAVDB/JAVBUS 需科学上网）与 Cookie，并补浏览器式请求头（见 PAGE_HEADERS）
 *   - 图片下载：不带代理（DMM 等图床直连可达，经代理连接失败），用图片专用请求头
 *   - **不加 `-L`**：JAVBUS 对非浏览器请求 302 到年龄门（/doc/driver-verify）；
 *     带浏览器头后可稳定拿到 200 详情页，但一旦再被重定向，跟随只会拿到验证页而非目标内容
 *   - 403/429/503 做阶梯重试（2s、5s），见 curlGet 尾部注释
 *   - 参数一律以数组传递（execFile），无 shell 注入风险
 *
 * @dependencies child_process, fs, os, path
 * @keyAPI curlGet(), curlDownload(), curlAvailable()
 */

const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

// 模拟浏览器请求的 User-Agent
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

/**
 * 浏览器式请求头（2026-11-18 实测新增）。
 *
 * 起因：JAVBUS 现在会对「不像浏览器」的请求一律 302 到 /doc/driver-verify 年龄门，
 * 而该响应体只有 2 字节 —— 解析必然拿不到番号，表现为「找不到番号」。
 * 实测（同代理、同时刻、无 Cookie）：
 *   仅 UA                    → 302（年龄门）
 *   UA + Accept-Language     → 200 详情页（3/3 稳定）
 *   再加 Sec-Fetch-* 等      → 同样 200
 * 也就是站点只按「是否带 Accept-Language」这类浏览器特征放行，与 Cookie 无关。
 * JAVDB 侧同理：请求头越像浏览器，Cloudflare 的 Bot 打分越好（403 概率越低）。
 * 故页面请求统一补上这套头；图片下载另用一套（见 buildCommonArgs 的 kind）。
 */
const PAGE_HEADERS = [
  '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  '-H', 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
  '-H', 'Upgrade-Insecure-Requests: 1',
  '-H', 'Sec-Fetch-Dest: document',
  '-H', 'Sec-Fetch-Mode: navigate',
  '-H', 'Sec-Fetch-Site: none',
  '-H', 'Sec-Fetch-User: ?1',
  '-H', 'sec-ch-ua: "Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
  '-H', 'sec-ch-ua-mobile: ?0',
  '-H', 'sec-ch-ua-platform: "Windows"'
]
const IMAGE_HEADERS = [
  '-H', 'Accept: image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  '-H', 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
  '-H', 'Sec-Fetch-Dest: image',
  '-H', 'Sec-Fetch-Mode: no-cors',
  '-H', 'Sec-Fetch-Site: cross-site'
]

// 系统 curl 可执行文件（Windows 10 1803+ 内置；非 Windows 平台依赖 PATH 中的 curl）
const CURL_BIN = process.platform === 'win32'
  ? (process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'curl.exe') : 'C:/Windows/System32/curl.exe')
  : 'curl'

let curlChecked = null
/**
 * 检查系统 curl 是否可用。
 * 只缓存**成功**结果（2026-09-30 审计）：原来连 false 也永久缓存 ——
 * 首次探测若因杀软扫描/系统忙碌而超时失败，整个会话就再也不会尝试 curl，
 * 表现为「刮削全部失败、图片全空」，而用户重启软件就好了（问题被掩盖成偶发）。
 * @returns {Promise<boolean>}
 */
async function curlAvailable() {
  if (curlChecked === true) return true
  const okv = await new Promise((resolve) => {
    execFile(CURL_BIN, ['--version'], { timeout: 5000 }, (err) => resolve(!err))
  })
  if (okv) curlChecked = true
  return okv
}

// 同 host 请求限速（2026-09-13 引入，2026-09-29 审计从 scraper.js 下沉到网络层）：
// 同一 host 的连续请求保持最小间隔——突发请求极易触发站点反爬（JAVDB 的 Cloudflare 会直接 403）。
// 原先只在 fetchHtml（页面请求）里限速，图片下载走 curlDownload 完全没限速 ——
// 批量刮削时预览图/封面/头像会瞬间打出几十个并发请求。下沉到本层后，
// curlGet 与 curlDownload 都按 URL host 自动限速，覆盖面完整。
const lastReqAt = new Map()   // host → 上次请求时间戳
const MIN_REQ_INTERVAL = 400  // 同 host 最小请求间隔（毫秒，约 2.5 req/s）
/**
 * 按 host 覆盖最小间隔（2026-11-18）。
 * JAVDB 的 /search 对突发请求极敏感：实测 400ms 间隔连发数次后整个搜索接口返回 403
 * （首页同时仍 200，`redirect_to` Cookie 可佐证是站点自身限流而非 Cookie 失效），
 * 冷却数十秒才恢复。搜索是刮削的主路径，放慢到 1.2s；其余站点保持原节奏。
 */
const HOST_MIN_INTERVAL = {
  'javdb.com': 1200,
  'www.javbus.com': 600
}
/**
 * 按 host 后缀覆盖（2026-11-20 提速）。
 * 预览图/封面在 JAVDB 的 CDN（c0.jdbstatic.com、c1.… 等）上，是纯静态文件、无风控逻辑；
 * 400ms/张 对它是过度保守 —— 20 张预览图光排队就要 8s，占「刮削一部片」的一半。
 * 实测（10 张 65~99KB、并发 6）把间隔降到 220ms 后仍全部 200，单部预览图耗时减半。
 */
const HOST_MIN_INTERVAL_SUFFIX = [
  ['jdbstatic.com', 220]
]
// 动态回退（2026-11-20）：一旦 CDN 真回 429/403，说明放得太快 —— 立刻把该 host 的
// 间隔改回保守值（本次会话生效），避免后续图片全部被拒。
const hostIntervalOverride = new Map()

/**
 * 可重试的 HTTP 状态：403（含限流/风控）、429（明确限流）、503（边缘临时不可用）。
 * 重试等待时间按次数递增 —— JAVDB 的 403 实测等 2s 后常可恢复。
 */
const RETRY_STATUS = new Set([403, 429, 503])
const RETRY_WAITS = [2000, 5000]

/**
 * 按 host 限速：距上次请求不足 MIN_REQ_INTERVAL 则等待补足。
 * 「同步占位」而非「读-等-写」：并发调用在同步段里各自拿到递增 400ms 的槽位，
 * 真正拉开间隔（批量刮削并发的正是这种情况）。
 * @param {string} url - 即将请求的地址
 */
async function throttleByHost(url) {
  let host = ''
  try { host = new URL(url).host } catch { return }
  let interval = hostIntervalOverride.get(host) || HOST_MIN_INTERVAL[host] || MIN_REQ_INTERVAL
  if (!hostIntervalOverride.has(host) && !HOST_MIN_INTERVAL[host]) {
    const hit = HOST_MIN_INTERVAL_SUFFIX.find(([sfx]) => host.endsWith(sfx))
    if (hit) interval = hit[1]
  }
  const now = Date.now()
  const slot = Math.max(now, (lastReqAt.get(host) || 0) + interval)
  lastReqAt.set(host, slot)
  const wait = slot - now
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
}

/**
 * 构造 curl 公共参数。
 * @param {Object} opts - 选项 { proxy, cookie, referer, timeout, follow, kind }
 *   follow：跟随重定向（-L）——「检查更新」用 /releases/latest 的跳转目标取版本号，
 *   不走 api.github.com（匿名 API 在共享出口 IP 下会被限流 403，实测）。
 *   kind：'page'（默认，补浏览器式请求头，见 PAGE_HEADERS）/ 'image'（图片专用头）
 * @returns {string[]} 参数数组
 */
function buildCommonArgs({ proxy, cookie, referer, timeout = 30000, follow = false, kind = 'page' } = {}) {
  const args = ['-s', '-A', USER_AGENT, '--max-time', String(Math.ceil(timeout / 1000)),
    // 连接超时（2026-11-20）：只设 --max-time 时，DNS/握手卡住的域名要耗满 30s 才失败。
    // 实测 pics.dmm.co.jp 在当前网络下就是「连不上」—— 每张预览图白等 11~30s，
    // 一部片 10 张预览图能拖掉 2~5 分钟（这是「刮削很慢」的主因）。
    // 连接阶段最多 5s，传输阶段仍由 --max-time 兜底。
    '--connect-timeout', String(Math.min(kind === 'image' ? 3 : 5, Math.ceil(timeout / 1000))),
    '--compressed',
    ...(kind === 'image' ? IMAGE_HEADERS : PAGE_HEADERS)]
  if (follow) args.push('-L')                // 跟随重定向
  if (proxy) args.push('-x', proxy)          // 代理（页面请求需要，图片不传）
  if (cookie) args.push('-b', cookie)        // Cookie（curl 的 -b 支持 "k=v; k2=v2" 形式）
  if (referer) args.push('-e', referer)      // 来源页
  return args
}

// ===== 图床健康度（2026-11-20 熔断）=====
// 背景：DMM 图床（pics.dmm.co.jp / awsimgsrc.dmm.co.jp）在部分地区/网络下彻底不可达，
// 而下载逻辑是「直连失败→再走代理」串行两遍，单张图要耗 11~30s。批量刮削时每部片都要
// 把 10 张预览图各等一遍，之后才换 JAVDB 图源重下 —— 用户看到的就是「刮削非常慢」。
// 这里按 host 记连续失败次数：同一 host 连续失败 3 次即「熔断」10 分钟，
// 期间对该 host 的图片请求直接快速失败（不再起 curl），让上层立刻改用备用图源。
const hostFails = new Map()        // host → 连续失败次数
const hostDeadUntil = new Map()    // host → 熔断截止时间戳
// 计数单位是「一张图片」（scraper.downloadImage 在两种方式都失败后才记账），不是每次 curl 尝试 ——
// 否则同一张图的「直连 + 代理」两次失败会被算成两次，正常图床偶发失败几次就被误熔断（实测过）。
const HOST_DEAD_AFTER = 2
const HOST_DEAD_MS = 10 * 60 * 1000

// 熔断状态落盘（2026-11-20）：只存内存的话，每次重启软件都要重新「发现」一次死图床 ——
// 首批预览图仍要白等十几秒。这里把截止时间写进数据目录，重启后直接生效。
let healthFile = ''
let healthSaveTimer = null
/**
 * 指定熔断状态的落盘文件（主进程拿到 dataDir 后调用一次）。
 * 读取失败/内容损坏一律忽略：健康度只是优化提示，不能影响刮削主流程。
 * @param {string} file - 形如 <dataDir>/host-health.json
 */
function configureHostHealth(file) {
  healthFile = String(file || '')
  if (!healthFile) return
  try {
    const raw = JSON.parse(fs.readFileSync(healthFile, 'utf8'))
    const now = Date.now()
    for (const [h, t] of Object.entries(raw || {})) {
      if (Number(t) > now) hostDeadUntil.set(h, Number(t))
    }
  } catch { /* 首次运行没有该文件，正常 */ }
}
/** 去抖写盘（批量刮削时失败是成串发生的） */
function saveHostHealth() {
  if (!healthFile || healthSaveTimer) return
  healthSaveTimer = setTimeout(() => {
    healthSaveTimer = null
    try {
      const now = Date.now()
      const obj = {}
      for (const [h, t] of hostDeadUntil) if (t > now) obj[h] = t
      fs.writeFileSync(healthFile, JSON.stringify(obj), 'utf8')
    } catch { /* 写不进去就算了 */ }
  }, 300)
}

/** 从 URL 取 host（失败返回空串） */
function hostOf(url) {
  try { return new URL(String(url)).host } catch { return '' }
}

/**
 * 该 URL 的 host 是否处于熔断期（图片请求前先查，命中就不要再发请求了）。
 * @param {string} url
 * @returns {boolean}
 */
function isHostDead(url) {
  const h = hostOf(url)
  if (!h) return false
  return (hostDeadUntil.get(h) || 0) > Date.now()
}

/** 记一次图片下载失败；连续失败达到阈值就熔断该 host 一段时间 */
function markHostFail(url) {
  const h = hostOf(url)
  if (!h) return
  const n = (hostFails.get(h) || 0) + 1
  hostFails.set(h, n)
  if (n >= HOST_DEAD_AFTER && !isHostDead(url)) {
    hostDeadUntil.set(h, Date.now() + HOST_DEAD_MS)
    console.warn(`[net-curl] 图床 ${h} 连续失败 ${n} 次 → 熔断 ${HOST_DEAD_MS / 60000} 分钟（图片改用备用源）`)
    saveHostHealth()
  }
}

/** 记一次图片下载成功：清零该 host 的失败计数并解除熔断 */
function markHostOk(url) {
  const h = hostOf(url)
  if (!h) return
  hostFails.delete(h)
  hostDeadUntil.delete(h)
  saveHostHealth()
}

/**
 * 用 curl GET 一个页面，返回文本内容与状态码。
 * @param {string} url - 目标地址
 * @param {Object} [opts] - { proxy, cookie, referer, timeout }
 * @returns {Promise<{ ok: boolean, status?: number, html?: string, error?: string }>}
 */
function curlGet(url, opts = {}) {
  // 单次请求（不含重试）：把「执行 curl → 读临时文件 → 解析状态码」收成 Promise
  const once = () => new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `javtube-curl-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
    // withUrl：额外回报最终 URL（%{url_effective}，配合 follow 用；检查更新靠它拿 releases/tag/vX.Y.Z）
    const args = [...buildCommonArgs(opts), '-o', tmp,
      '-w', opts.withUrl ? '%{http_code}\\n%{url_effective}' : '%{http_code}', url]
    execFile(CURL_BIN, args, { maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', timeout: (opts.timeout || 30000) + 5000 }, async (err, stdout) => {
      if (err) {
        try { fs.unlinkSync(tmp) } catch {}
        return resolve({ ok: false, error: err.message, status: 0 })
      }
      let html = ''
      try {
        // 异步读：原实现用 readFileSync 同步读整页（JAVDB/JAVBUS 详情页可达数百 KB），
        // 会在主进程上造成一次可见的同步阻塞（批量刮削时反复发生）。改用 promises 读。
        html = await fs.promises.readFile(tmp, 'utf8')
      } catch (e) {
        // 读失败也要清掉临时文件（2026-09-30 审计）：原实现只在读取成功的路径上 unlink，
        // 读失败（文件被占/权限/磁盘满）会把 curl 下好的整个响应体留在 tmp 目录里。
        try { fs.unlinkSync(tmp) } catch {}
        return resolve({ ok: false, error: '读取响应失败: ' + e.message, status: 0 })
      }
      try { fs.unlinkSync(tmp) } catch {}
      // withUrl 时 stdout 是「状态码\n最终URL」两行（\\n 由 curl 自行展开为换行）
      const lines = String(stdout).trim().split('\n')
      const status = Number(String(lines[0] || '').trim()) || 0
      const effectiveUrl = opts.withUrl ? String(lines[1] || '').trim() : ''
      // 3xx 一律当失败（2026-11-18 修正）：本函数**不带 -L**，3xx 的响应体是空的或验证页，
      // 返回 ok 只会让上层解析出「未匹配」，把「需要登录/被风控」误报成「找不到番号」。
      // 特例：调用方要跟随跳转时显式传 follow（如检查更新），那时 status 已是最终页的状态码。
      if (status < 200 || status >= 300) {
        return resolve({ ok: false, status, error: `HTTP ${status}` })
      }
      resolve({ ok: true, status, html, ...(opts.withUrl ? { url: effectiveUrl } : {}) })
    })
  })

  // 重试（2026-11-18）：JAVDB 的 /search 在突发访问后会 403 一段时间（首页仍 200），
  // 稍等即可恢复 —— 原来一次 403 直接把整部影片判为刮削失败，用户看到的就是「JAVDB 403」。
  // 这里对 403/429/503 做阶梯退避重试（2s、5s），最多 3 次；其它错误（DNS/超时/404）不重试。
  return (async () => {
    let last = null
    for (let attempt = 0; attempt <= RETRY_WAITS.length; attempt++) {
      await throttleByHost(url)
      last = await once()
      if (last.ok || !RETRY_STATUS.has(last.status)) return last
      if (attempt < RETRY_WAITS.length) {
        console.warn(`[net-curl] ${url.slice(0, 80)} → HTTP ${last.status}，${RETRY_WAITS[attempt]}ms 后重试（第 ${attempt + 1} 次）`)
        await new Promise(r => setTimeout(r, RETRY_WAITS[attempt]))
      }
    }
    return last
  })()
}

/**
 * 用 curl 下载文件（图片等二进制），直接写入目标路径。
 * 默认不带代理——DMM 等图床经代理连接失败、直连正常。
 * @param {string} url - 图片地址
 * @param {string} savePath - 保存路径
 * @param {Object} [opts] - { proxy, referer, timeout }
 * @returns {Promise<{ ok: boolean, status?: number, size?: number, error?: string }>}
 */
function curlDownload(url, savePath, opts = {}) {
  return throttleByHost(url).then(() => new Promise((resolve) => {
    const args = [...buildCommonArgs({ ...opts, kind: 'image' }), '-o', savePath, '-w', '%{http_code}', url]
    execFile(CURL_BIN, args, { encoding: 'utf8', timeout: (opts.timeout || 30000) + 5000 }, (err, stdout) => {
      // 异常路径也要清掉目标路径（2026-10-02）：curl 被超时杀掉时已写入的是半截文件，
      // 留着会被后续的存在性/有效性判断当成「下过的东西」（当前调用方用 .tmp 规避，
      // 但函数契约是「直接写入 savePath」，收尾不能只靠调用方）
      if (err) {
        try { fs.unlinkSync(savePath) } catch {}
        return resolve({ ok: false, error: err.message })
      }
      const status = Number(String(stdout).trim()) || 0
      const size = fs.existsSync(savePath) ? fs.statSync(savePath).size : 0
      // 429/403：该 host 被限速 → 间隔回退到 400ms（只影响本次会话）
      if (status === 429 || status === 403) {
        const h = hostOf(url)
        if (h && !hostIntervalOverride.has(h)) {
          hostIntervalOverride.set(h, 400)
          console.warn(`[net-curl] ${h} 返回 ${status}，图片请求间隔回退到 400ms`)
        }
      }
      // 3xx 也当失败（2026-09-28 审计）：图片请求不带 -L（跟随后可能被引到验证页），
      // 重定向响应体不是图片；若把 3xx 当成功，scraper 的两路网络兜底（直连/代理）
      // 就会在第一次「假成功」时停止，图片被静默丢弃。
      if (status < 200 || status >= 300 || size === 0) {
        try { fs.unlinkSync(savePath) } catch {}
        return resolve({ ok: false, status, size, error: `HTTP ${status} / ${size} 字节` })
      }
      resolve({ ok: true, status, size })
    })
  }))
}

module.exports = {
  curlGet, curlDownload, curlAvailable, throttleByHost,
  isHostDead, markHostFail, markHostOk, configureHostHealth,
  CURL_BIN, USER_AGENT
}
