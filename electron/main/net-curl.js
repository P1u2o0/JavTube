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
 *   - 页面请求：按需带代理（JAVDB/JAVBUS 需科学上网）与 Cookie
 *   - 图片下载：不带代理（DMM 等图床直连可达，经代理连接失败）
 *   - **不加 `-L`**：JAVBUS 会 302 到反爬验证页（/doc/driver-verify），
 *     此时响应体仍是有效详情页——跟随重定向反而拿到无效验证页
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
 * 按 host 限速：距上次请求不足 MIN_REQ_INTERVAL 则等待补足。
 * 「同步占位」而非「读-等-写」：并发调用在同步段里各自拿到递增 400ms 的槽位，
 * 真正拉开间隔（批量刮削并发的正是这种情况）。
 * @param {string} url - 即将请求的地址
 */
async function throttleByHost(url) {
  let host = ''
  try { host = new URL(url).host } catch { return }
  const now = Date.now()
  const slot = Math.max(now, (lastReqAt.get(host) || 0) + MIN_REQ_INTERVAL)
  lastReqAt.set(host, slot)
  const wait = slot - now
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
}

/**
 * 构造 curl 公共参数。
 * @param {Object} opts - 选项 { proxy, cookie, referer, timeout, follow }
 *   follow：跟随重定向（-L）——「检查更新」用 /releases/latest 的跳转目标取版本号，
 *   不走 api.github.com（匿名 API 在共享出口 IP 下会被限流 403，实测）。
 * @returns {string[]} 参数数组
 */
function buildCommonArgs({ proxy, cookie, referer, timeout = 30000, follow = false } = {}) {
  const args = ['-s', '-A', USER_AGENT, '--max-time', String(Math.ceil(timeout / 1000)), '--compressed']
  if (follow) args.push('-L')                // 跟随重定向
  if (proxy) args.push('-x', proxy)          // 代理（页面请求需要，图片不传）
  if (cookie) args.push('-b', cookie)        // Cookie（curl 的 -b 支持 "k=v; k2=v2" 形式）
  if (referer) args.push('-e', referer)      // 来源页
  return args
}

/**
 * 用 curl GET 一个页面，返回文本内容与状态码。
 * @param {string} url - 目标地址
 * @param {Object} [opts] - { proxy, cookie, referer, timeout }
 * @returns {Promise<{ ok: boolean, status?: number, html?: string, error?: string }>}
 */
function curlGet(url, opts = {}) {
  return throttleByHost(url).then(() => new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `javtube-curl-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
    // withUrl：额外回报最终 URL（%{url_effective}，配合 follow 用；检查更新靠它拿 releases/tag/vX.Y.Z）
    const args = [...buildCommonArgs(opts), '-o', tmp,
      '-w', opts.withUrl ? '%{http_code}\\n%{url_effective}' : '%{http_code}', url]
    execFile(CURL_BIN, args, { maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', timeout: (opts.timeout || 30000) + 5000 }, async (err, stdout) => {
      if (err) {
        try { fs.unlinkSync(tmp) } catch {}
        return resolve({ ok: false, error: err.message })
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
        return resolve({ ok: false, error: '读取响应失败: ' + e.message })
      }
      try { fs.unlinkSync(tmp) } catch {}
      // withUrl 时 stdout 是「状态码\n最终URL」两行（\\n 由 curl 自行展开为换行）
      const lines = String(stdout).trim().split('\n')
      const status = Number(String(lines[0] || '').trim()) || 0
      const effectiveUrl = opts.withUrl ? String(lines[1] || '').trim() : ''
      // 注意：JAVBUS 在反爬触发时返回 302 但响应体仍是有效详情页，
      // 因此只要拿到响应体就交由上层判断内容是否有效（由 assertJavdbNotBlocked 等负责）
      if (status < 200 || status >= 400) {
        return resolve({ ok: false, status, error: `HTTP ${status}` })
      }
      resolve({ ok: true, status, html, ...(opts.withUrl ? { url: effectiveUrl } : {}) })
    })
  }))
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
    const args = [...buildCommonArgs(opts), '-o', savePath, '-w', '%{http_code}', url]
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

module.exports = { curlGet, curlDownload, curlAvailable, throttleByHost, CURL_BIN, USER_AGENT }
