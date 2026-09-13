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
 * 检查系统 curl 是否可用（结果缓存）。
 * @returns {Promise<boolean>}
 */
async function curlAvailable() {
  if (curlChecked !== null) return curlChecked
  curlChecked = await new Promise((resolve) => {
    execFile(CURL_BIN, ['--version'], { timeout: 5000 }, (err) => resolve(!err))
  })
  return curlChecked
}

/**
 * 构造 curl 公共参数。
 * @param {Object} opts - 选项 { proxy, cookie, referer, timeout }
 * @returns {string[]} 参数数组
 */
function buildCommonArgs({ proxy, cookie, referer, timeout = 30000 } = {}) {
  const args = ['-s', '-A', USER_AGENT, '--max-time', String(Math.ceil(timeout / 1000)), '--compressed']
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
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `javtube-curl-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
    const args = [...buildCommonArgs(opts), '-o', tmp, '-w', '%{http_code}', url]
    execFile(CURL_BIN, args, { maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', timeout: (opts.timeout || 30000) + 5000 }, (err, stdout) => {
      if (err) {
        try { fs.unlinkSync(tmp) } catch {}
        return resolve({ ok: false, error: err.message })
      }
      let html = ''
      try {
        html = fs.readFileSync(tmp, 'utf8')
        fs.unlinkSync(tmp)
      } catch (e) {
        return resolve({ ok: false, error: '读取响应失败: ' + e.message })
      }
      const status = Number(String(stdout).trim()) || 0
      // 注意：JAVBUS 在反爬触发时返回 302 但响应体仍是有效详情页，
      // 因此只要拿到响应体就交由上层判断内容是否有效（由 assertJavdbNotBlocked 等负责）
      if (status < 200 || status >= 400) {
        return resolve({ ok: false, status, error: `HTTP ${status}` })
      }
      resolve({ ok: true, status, html })
    })
  })
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
  return new Promise((resolve) => {
    const args = [...buildCommonArgs(opts), '-o', savePath, '-w', '%{http_code}', url]
    execFile(CURL_BIN, args, { encoding: 'utf8', timeout: (opts.timeout || 30000) + 5000 }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: err.message })
      const status = Number(String(stdout).trim()) || 0
      const size = fs.existsSync(savePath) ? fs.statSync(savePath).size : 0
      if (status < 200 || status >= 400 || size === 0) {
        try { fs.unlinkSync(savePath) } catch {}
        return resolve({ ok: false, status, size, error: `HTTP ${status} / ${size} 字节` })
      }
      resolve({ ok: true, status, size })
    })
  })
}

module.exports = { curlGet, curlDownload, curlAvailable, CURL_BIN, USER_AGENT }
