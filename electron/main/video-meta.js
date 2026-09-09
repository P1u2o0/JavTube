/**
 * @file video-meta.js
 * @module electron/main/video-meta
 * @description 视频文件元数据解析（纯 Node 实现，零依赖）。
 *              2026-09-09 新增：解析 MP4/M4V/MOV（ISO-BMFF 容器）的时长（分钟），
 *              用于详情页「时长」在无刮削数据时的文件时长兜底。
 *              实现方式：顺序遍历顶层 box 定位 moov，再在 moov 子 box 中
 *              定位 mvhd，按版本读取 timescale 与 duration。
 *              AVI/MKV 等其他容器不支持，返回 null（调用方显示为未知）。
 */

const fs = require('fs')

/**
 * 解析 MP4 家族视频文件的时长。
 * @param {string} filePath - 视频文件绝对路径
 * @returns {number|null} 时长（分钟，四舍五入）；解析失败或非 MP4 容器返回 null
 */
function readMp4DurationMinutes(filePath) {
  let fd
  try {
    fd = fs.openSync(filePath, 'r')
    const size = fs.fstatSync(fd).size
    let offset = 0
    // 顺序遍历顶层 box（每个 box：4 字节 size + 4 字节 type [+ 8 字节扩展 size]）
    while (offset + 8 <= size) {
      const head = Buffer.alloc(8)
      fs.readSync(fd, head, 0, 8, offset)
      let boxSize = head.readUInt32BE(0)
      const type = head.toString('ascii', 4, 8)
      let headerLen = 8
      if (boxSize === 1) {
        // size=1 表示实际大小在随后的 8 字节（64 位）
        const ext = Buffer.alloc(8)
        fs.readSync(fd, ext, 0, 8, offset + 8)
        boxSize = Number(ext.readBigUInt64BE(0))
        headerLen = 16
      } else if (boxSize === 0) {
        // size=0 表示该 box 一直延伸到文件末尾
        boxSize = size - offset
      }
      if (boxSize < headerLen) break
      if (type === 'moov') {
        // 定位到 moov：在它的子 box 中查找 mvhd（Movie Header）
        const bodyLen = Math.min(boxSize - headerLen, 8 * 1024 * 1024)
        const body = Buffer.alloc(bodyLen)
        fs.readSync(fd, body, 0, bodyLen, offset + headerLen)
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
    return null
  } finally {
    try { if (fd !== undefined) fs.closeSync(fd) } catch {}
  }
}

module.exports = { readMp4DurationMinutes }
