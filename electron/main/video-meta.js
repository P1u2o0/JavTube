/**
 * @file video-meta.js
 * @module electron/main/video-meta
 * @description 视频文件元数据解析（纯 Node 实现，零依赖）。
 *              2026-09-09：解析 MP4/M4V/MOV（ISO-BMFF 容器）的时长（分钟），
 *              用于详情页「时长」在无刮削数据时的文件时长兜底。
 *              实现方式：顺序遍历顶层 box 定位 moov，再在 moov 子 box 中
 *              定位 mvhd，按版本读取 timescale 与 duration。
 *              2026-10-04 新增 readVideoSize：解析视频分辨率（宽×高），支持
 *              MP4 家族（moov→trak→tkhd，16.16 定点）与 MKV（EBML：Tracks→
 *              TrackEntry→Video→PixelWidth/Height），用于播放页「4K」标签
 *              （文件名没写 4K 但实际是 4K 的影片靠它识别）。
 *              ⚠️ readVideoSize **全异步**（fs.promises）：影片在 NAS/SMB 上，实测
 *              NAS 离线时同步 openSync 会把主进程事件循环卡住 ~40s；异步阻塞的是
 *              libuv 线程池，主进程照常响应。不要改回同步读。
 *              AVI 等其他容器不支持，返回 null（调用方视为未知）。
 */

const fs = require('fs')
const fsp = fs.promises

// ====== 视频文件读取的「存储根失败冷却」（2026-10-04）======
// 背景：影片都在 NAS/SMB 上，离线/掉线时一次 openSync/open 会挂 ~40s。主进程的
// libuv 线程池（默认 4 线程）是封面协议、媒体协议、本模块共用 —— 多个对 NAS 的挂起
// 读取会把线程池占满，**本地的封面/预览图读取被迫排队**：界面表现为「图片空白 →
// 整体发卡 → 超时释放后一起恢复」。所以：某个存储根刚失败过，就在冷却期内直接
// 快速失败（不发起真实 I/O），避免挂起线程堆积；过期后自动重试（NAS 恢复即恢复）。
const READ_FAIL_TTL = 60 * 1000
const readFailAt = new Map()   // 存储根 -> 最近失败时间戳

/** 路径的「存储根」：UNC → //主机/共享；盘符 → C:；其它 → 原样前缀 */
function storageRoot(p) {
  const s = String(p || '').replace(/\\/g, '/')
  if (s.startsWith('//')) {
    const seg = s.slice(2).split('/')
    return `//${(seg[0] || '').toLowerCase()}/${seg[1] || ''}`
  }
  const m = s.match(/^([A-Za-z]:)/)
  return m ? m[1].toLowerCase() : (s.startsWith('/') ? '/' : '')
}

/** 该路径所在的存储根是否处于「刚失败」的冷却期 */
function isVideoReadCooling(p) {
  const t = readFailAt.get(storageRoot(p))
  return !!t && Date.now() - t < READ_FAIL_TTL
}

/** 记录一次真实 I/O 的结果（成功清除冷却；失败开始冷却）。
 *  只对网络存储（UNC）生效 —— 本机磁盘的失败本身是毫秒级，不需要也不应该冷却。 */
function noteVideoReadResult(p, ok) {
  const k = storageRoot(p)
  if (!k || !k.startsWith('//')) return
  if (ok) readFailAt.delete(k)
  else readFailAt.set(k, Date.now())
}

/** 异步读指定位置的一段（libuv 线程池执行 —— SMB 超时不会卡住主进程事件循环） */
async function readAt(fh, length, position) {
  const b = Buffer.alloc(length)
  await fh.read(b, 0, length, position)
  return b
}

/**
 * 解析视频文件的分辨率（宽×高）。
 * @param {string} filePath - 视频文件绝对路径
 * @returns {Promise<{width:number, height:number}|null>} 解析失败 / 不支持的容器返回 null
 */
async function readVideoSize(filePath) {
  if (isVideoReadCooling(filePath)) return null   // 存储根刚失败：快速失败，不占用线程池
  let fh = null
  try {
    fh = await fsp.open(filePath, 'r')
    noteVideoReadResult(filePath, true)           // 打开成功 = 存储可用，解除冷却
    const st = await fh.stat()
    const size = st.size
    if (size < 16) return null
    const head = await readAt(fh, 4, 0)
    if (head.readUInt32BE(0) === 0x1a45dfa3) {   // EBML 魔数 → MKV/WebM
      const cap = Math.min(size, 4 * 1024 * 1024)
      return parseMkvSize(await readAt(fh, cap, 0))
    }
    return await readMp4Size(fh, size)
  } catch {
    noteVideoReadResult(filePath, false)
    return null
  } finally {
    try { if (fh) await fh.close() } catch {}
  }
}

/**
 * MP4 家族：顶层 box 顺序扫描找 moov，再在 moov 的 trak 里找 tkhd 取宽高。
 * 只读 moov 前 512KB —— tkhd 是每个 trak 的首个子 box（在前部），没必要把整个 moov
 * （可能几 MB）拖过网络；极端情况下找不到就按未知处理。
 */
async function readMp4Size(fh, size) {
  let offset = 0
  while (offset + 8 <= size) {
    const head = await readAt(fh, 8, offset)
    let boxSize = head.readUInt32BE(0)
    const type = head.toString('ascii', 4, 8)
    let headerLen = 8
    if (boxSize === 1) {
      boxSize = Number((await readAt(fh, 8, offset + 8)).readBigUInt64BE(0))
      headerLen = 16
    } else if (boxSize === 0) {
      boxSize = size - offset
    }
    if (boxSize < headerLen) break
    if (type === 'moov') {
      const bodyLen = Math.min(boxSize - headerLen, 512 * 1024)
      return parseMp4Size(await readAt(fh, bodyLen, offset + headerLen))
    }
    offset += boxSize
  }
  return null
}

/** 在内存中的 moov 体里遍历 trak → tkhd，取面积最大的轨（音频轨宽高为 0，自然被排除） */
function parseMp4Size(body) {
  const len = body.length
  let off = 0
  let best = null
  while (off + 8 <= len) {
    const subSize = body.readUInt32BE(off)
    const subType = body.toString('ascii', off + 4, off + 8)
    if (subSize < 8 || off + subSize > len) break
    if (subType === 'trak') {
      const r = readTkhd(body, off + 8, off + subSize)
      if (r && r.width > 0 && (!best || r.width * r.height > best.width * best.height)) best = r
    }
    off += subSize
  }
  return best
}

/** 在 trak 子 box 里找 tkhd，按版本取宽高（v0 起点+84 / v1 起点+96，均为 16.16 定点） */
function readTkhd(body, start, end) {
  let off = start
  while (off + 8 <= end) {
    const subSize = body.readUInt32BE(off)
    const subType = body.toString('ascii', off + 4, off + 8)
    if (subSize < 8 || off + subSize > end) break
    if (subType === 'tkhd') {
      const base = off + (body[off + 8] === 1 ? 96 : 84)
      if (base + 8 > off + subSize) return null
      return { width: Math.round(body.readUInt32BE(base) / 65536), height: Math.round(body.readUInt32BE(base + 4) / 65536) }
    }
    off += subSize
  }
  return null
}

// ====== MKV（EBML）======

/** EBML 元素 ID：首字节前导零位数决定长度（1-4 字节），保留长度标记位 */
function readEbmlId(buf, off) {
  if (off >= buf.length) return null
  const first = buf[off]
  let len = 0
  if (first & 0x80) len = 1
  else if (first & 0x40) len = 2
  else if (first & 0x20) len = 3
  else if (first & 0x10) len = 4
  else return null
  if (off + len > buf.length) return null
  let value = 0
  for (let i = 0; i < len; i++) value = value * 256 + buf[off + i]
  return { value, len }
}

/** EBML 数据大小 vint：去掉长度标记位；全 1 表示「未知大小」 */
function readEbmlVint(buf, off) {
  if (off >= buf.length) return null
  const first = buf[off]
  let len = 1, mask = 0x80
  while (len <= 8 && !(first & mask)) { mask >>= 1; len++ }
  if (len > 8 || off + len > buf.length) return null
  let value = first & (mask - 1)
  let unknown = value === mask - 1
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[off + i]
    if (buf[off + i] !== 0xff) unknown = false
  }
  if (len === 8) unknown = true   // 8 字节大小超出安全整数范围，一律按未知处理
  return { value, len, unknown }
}

/** 读无符号整数元素的值（宽高最多 4 字节） */
function readEbmlUint(buf, start, end) {
  let v = 0
  for (let i = start; i < end && i < start + 4; i++) v = v * 256 + buf[i]
  return v
}

/** 在 [start,end) 内按 EBML 逐元素遍历，把每个元素交给 visit(id, bodyStart, bodyEnd)，返回 false 终止 */
function walkEbml(buf, start, end, visit) {
  let off = start
  while (off + 2 <= end) {
    const id = readEbmlId(buf, off)
    if (!id) return
    const sz = readEbmlVint(buf, off + id.len)
    if (!sz) return
    const bodyStart = off + id.len + sz.len
    const bodyEnd = sz.unknown ? end : Math.min(bodyStart + sz.value, end)
    if (visit(id.value, bodyStart, bodyEnd) === false) return
    if (bodyEnd <= off) return
    off = bodyEnd
  }
}

/**
 * 在内存中的文件头部（≤4MB）里找 Tracks 元素（0x1654AE6B），逐层下钻
 * TrackEntry(0xAE) → Video(0xE0) → PixelWidth(0xB0)/PixelHeight(0xBA)。
 */
function parseMkvSize(buf) {
  const cap = buf.length
  const at = buf.indexOf(Buffer.from([0x16, 0x54, 0xae, 0x6b]))
  if (at < 0) return null
  const sz = readEbmlVint(buf, at + 4)
  if (!sz) return null
  const start = at + 4 + sz.len
  const end = sz.unknown ? cap : Math.min(start + sz.value, cap)
  let result = null
  walkEbml(buf, start, end, (id, s, e) => {
    if (id !== 0xae) return
    walkEbml(buf, s, e, (id2, s2, e2) => {
      if (id2 !== 0xe0) return
      let w = 0, h = 0
      walkEbml(buf, s2, e2, (id3, s3, e3) => {
        if (id3 === 0xb0) w = readEbmlUint(buf, s3, e3)
        else if (id3 === 0xba) h = readEbmlUint(buf, s3, e3)
      })
      if (w > 0 && h > 0) { result = { width: w, height: h }; return false }
    })
    if (result) return false
  })
  return result
}

// ====== 时长（详情页兜底，2026-09-09 起；2026-10-04 改异步）======

/**
 * 解析 MP4 家族视频文件的时长。**异步**（2026-10-04 改）：原同步版在 NAS 离线时
 * 会把主进程事件循环卡住 ~40s（详情页「时长兜底」打开即触发 → 整窗口未响应，实测踩到）。
 * ⚠️ 与 readVideoSize 同规矩：不要改回同步读。
 * @param {string} filePath - 视频文件绝对路径
 * @returns {Promise<number|null>} 时长（分钟，四舍五入）；解析失败或非 MP4 容器返回 null
 */
async function readMp4DurationMinutes(filePath) {
  if (isVideoReadCooling(filePath)) return null   // 存储根刚失败：快速失败，不占用线程池
  let fh = null
  try {
    fh = await fsp.open(filePath, 'r')
    noteVideoReadResult(filePath, true)           // 打开成功 = 存储可用，解除冷却
    const size = (await fh.stat()).size
    let offset = 0
    // 顺序遍历顶层 box（每个 box：4 字节 size + 4 字节 type [+ 8 字节扩展 size]）
    while (offset + 8 <= size) {
      const head = await readAt(fh, 8, offset)
      let boxSize = head.readUInt32BE(0)
      const type = head.toString('ascii', 4, 8)
      let headerLen = 8
      if (boxSize === 1) {
        // size=1 表示实际大小在随后的 8 字节（64 位）
        boxSize = Number((await readAt(fh, 8, offset + 8)).readBigUInt64BE(0))
        headerLen = 16
      } else if (boxSize === 0) {
        // size=0 表示该 box 一直延伸到文件末尾
        boxSize = size - offset
      }
      if (boxSize < headerLen) break
      if (type === 'moov') {
        // 定位到 moov：在它的子 box 中查找 mvhd（Movie Header）
        const bodyLen = Math.min(boxSize - headerLen, 8 * 1024 * 1024)
        const body = await readAt(fh, bodyLen, offset + headerLen)
        let off = 0
        while (off + 8 <= bodyLen) {
          const subSize = body.readUInt32BE(off)
          const subType = body.toString('ascii', off + 4, off + 8)
          if (subSize < 8) break
          if (subType === 'mvhd') {
            const version = body[off + 8]
            let timescale, duration
            if (version === 1) {
              // v1：version/flags(4) + ctime(8) + mtime(8) + timescale(4) + duration(8)
              timescale = body.readUInt32BE(off + 28)
              duration = Number(body.readBigUInt64BE(off + 32))
            } else {
              // v0：version/flags(4) + ctime(4) + mtime(4) + timescale(4) + duration(4)
              timescale = body.readUInt32BE(off + 20)
              duration = body.readUInt32BE(off + 24)
            }
            if (!timescale) return null
            return Math.round(duration / timescale / 60)
          }
          off += subSize
        }
        return null  // moov 内未找到 mvhd（异常文件）
      }
      offset += boxSize
    }
    return null  // 未找到 moov（可能 moov 在末尾之外被截断，或非 MP4 容器）
  } catch (e) {
    noteVideoReadResult(filePath, false)
    return null
  } finally {
    try { if (fh) await fh.close() } catch {}
  }
}

module.exports = { readMp4DurationMinutes, readVideoSize, isVideoReadCooling, noteVideoReadResult, storageRoot }