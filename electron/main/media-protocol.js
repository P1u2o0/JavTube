/**
 * @file media-protocol.js
 * @module electron/main/media-protocol
 * @description javtube-media 自定义协议模块。把本地视频文件以支持 Range 分段请求的
 *              方式暴露给渲染进程的 <video>（内置播放页用，2026-09-29 新增）。
 *
 * 为什么不直接 <video src="file://...">：与封面同理，严格 CSP + Privileged 上下文下
 * Electron 拒绝渲染进程加载 file:// 资源；且 file:// 在 <video> 里 seek 不可靠。
 * 自定义协议 + 手写 Range 处理后，拖进度条 / 缓冲都走 HTTP 语义（206 Partial Content）。
 *
 * 协议格式：javtube-media://0/<base64url(绝对路径)>
 * （与 javtube-cover 完全同构：占位 host '0' + base64url 兼容中文/空格/反斜杠）
 *
 * 安全模型（与 cover 协议的差异必须知道）：
 *   cover 协议把路径限制在数据目录白名单内；视频做不到 —— 影片库可以在用户磁盘的
 *   任意位置（settings.video_paths 之外的存量导入无法枚举根目录）。因此这里的防护是
 *   「扩展名白名单」：只有视频扩展名可读，任何其他文件一律 415。渲染进程只能拿到
 *   用户库里已有影片的路径（py 字段），不存在注入面。
 *
 * 调用时序（与 cover 一致）：
 *   registerMediaScheme() 必须在 app ready 之前调用；
 *   setupMediaProtocol() 在 app.whenReady 内调用。
 * @dependencies electron (protocol), path, fs, stream
 */

const { protocol } = require('electron')
const path = require('path')
const fs = require('fs')
const { Readable } = require('stream')
// 视频读取的存储根冷却（NAS 离线时快速 404，避免重试把线程池塞满；见 video-meta.js）
const { isVideoReadCooling, noteVideoReadResult } = require('./video-meta')

// 允许播放的容器扩展名。注意 Chromium 解码能力有限：
//   mp4/m4v/webm/mov 稳定；mkv 视内部编码（H.264/AAC 通常可以）；avi/wmv/flv/rmvb 放不了。
// 放不了的格式由播放页给「外部播放」兜底（media-protocol 只管把字节流出去）。
const VIDEO_EXTS = new Set([
  '.mp4', '.m4v', '.webm', '.mkv', '.mov', '.ts', '.mts', '.m2ts', '.3gp', '.ogv'
])

const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.ts': 'video/mp2t',
  '.mts': 'video/mp2t', '.m2ts': 'video/mp2t', '.3gp': 'video/3gpp', '.ogv': 'video/ogg'
}

// 读块大小：默认 64KB 对本地盘足够，但影片库常在 NAS/SMB 共享上 —— 小块高频读
// 会被网络往返拖慢，表现为高码率影片「一卡一卡」。放大到 1MB 明显减少往返次数。
const READ_CHUNK = 1024 * 1024

/** 把 javtube-media 注册为 privileged scheme（app ready 之前调用）。 */
function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'javtube-media',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    }
  ])
}

/**
 * 注册 javtube-media 协议处理器。
 * 支持 Range 单区间请求（Chromium 的 <video> seek 全靠它）：
 *   bytes=start-end / bytes=start- / bytes=-suffix 三种形态都处理；
 *   多区间（bytes=0-1,5-6）直接回 200 全量（规范允许，<video> 不会发这种）。
 */
function setupMediaProtocol() {
  protocol.handle('javtube-media', async (request) => {
    try {
      const u = new URL(request.url)
      const segs = u.pathname.split('/').filter(s => s.length > 0)
      const enc = segs[0] || ''
      if (!enc) return new Response('bad request', { status: 400 })
      const abs = Buffer.from(enc, 'base64').toString('utf-8')
      const resolved = path.resolve(abs)
      // 扩展名白名单：非视频容器一律拒绝（本协议的安全边界，见文件头注释）
      if (!VIDEO_EXTS.has(path.extname(resolved).toLowerCase())) {
        return new Response('unsupported media type', { status: 415 })
      }
      // 存储根刚失败过（如 NAS 离线）：快速 404 —— ArtPlayer 会重试多次，
      // 不拦的话每次重试都会往 libuv 线程池塞一个挂 ~40s 的 stat（2026-10-04）
      if (isVideoReadCooling(resolved)) return new Response('not found', { status: 404 })
      let stat
      try {
        stat = await fs.promises.stat(resolved)
        if (!stat.isFile()) return new Response('not found', { status: 404 })
        noteVideoReadResult(resolved, true)
      } catch {
        noteVideoReadResult(resolved, false)
        return new Response('not found', { status: 404 })
      }

      const contentType = MIME[path.extname(resolved).toLowerCase()] || 'video/mp4'
      const common = {
        'content-type': contentType,
        'accept-ranges': 'bytes',
        'cache-control': 'no-store'   // 视频不进磁盘缓存，避免占双倍空间
      }

      const rangeHeader = request.headers.get('range')
      if (!rangeHeader) {
        const stream = fs.createReadStream(resolved, { highWaterMark: READ_CHUNK })
        return new Response(Readable.toWeb(stream), {
          status: 200,
          headers: { ...common, 'content-length': String(stat.size) }
        })
      }

      const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
      if (!m) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${stat.size}` } })
      let start, end
      if (m[1] === '' && m[2] !== '') {
        // 后缀形态 bytes=-N：取最后 N 字节
        start = Math.max(0, stat.size - parseInt(m[2], 10))
        end = stat.size - 1
      } else {
        start = m[1] === '' ? 0 : parseInt(m[1], 10)
        end = m[2] === '' ? stat.size - 1 : parseInt(m[2], 10)
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
        return new Response(null, { status: 416, headers: { 'content-range': `bytes */${stat.size}` } })
      }
      end = Math.min(end, stat.size - 1)
      const stream = fs.createReadStream(resolved, { start, end, highWaterMark: READ_CHUNK })
      return new Response(Readable.toWeb(stream), {
        status: 206,
        headers: {
          ...common,
          'content-range': `bytes ${start}-${end}/${stat.size}`,
          'content-length': String(end - start + 1)
        }
      })
    } catch (e) {
      console.warn('[media-protocol] err:', e.message)
      return new Response('error: ' + e.message, { status: 500 })
    }
  })
  console.log('[main] javtube-media protocol registered')
}

module.exports = { registerMediaScheme, setupMediaProtocol }
