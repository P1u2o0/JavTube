/**
 * 视频分辨率解析单测（readVideoSize，2026-10-04 新增）：手工构造最小 MP4 / MKV 文件验证解析。
 *
 * 覆盖：MP4 tkhd v0/v1、音频轨在前（取面积最大的视频轨）、moov 在 mdat 之后；
 *       MKV Tracks→TrackEntry→Video 下钻；非视频文件与不存在的文件返回 null。
 * 为什么要有这个单测：播放页「4K」标签依赖它（文件名没写 4K 的影片靠真实分辨率识别），
 * 解析器一旦出错不会报错、只会静默丢标签 —— 必须能脱离真实库快速回归。
 *
 * 用法：npm run test:vsize
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { readVideoSize } = require('../electron/main/video-meta')

// ---------- MP4 构造 ----------
function box(type, payload) {
  const b = Buffer.alloc(8 + payload.length)
  b.writeUInt32BE(8 + payload.length, 0)
  b.write(type, 4, 'ascii')
  payload.copy(b, 8)
  return b
}
function tkhd(w, h, version = 0) {
  const size = version === 1 ? 104 : 92
  const p = Buffer.alloc(size - 8)
  p[0] = version
  const wOff = (version === 1 ? 96 : 84) - 8
  p.writeUInt32BE(Math.round(w * 65536), wOff)
  p.writeUInt32BE(Math.round(h * 65536), wOff + 4)
  return box('tkhd', p)
}
const trak = (w, h, v = 0) => box('trak', tkhd(w, h, v))
const moov = (...traks) => box('moov', Buffer.concat(traks))
const ftyp = () => box('ftyp', Buffer.from('isomiso2avc1mp41'))
const mdat = (n) => box('mdat', Buffer.alloc(n, 0x11))
const mvhd = () => box('mvhd', Buffer.alloc(100))  // 时长无关，占位

// ---------- MKV 构造 ----------
function vintSize(n) {
  if (n < 0x7f) return Buffer.from([0x80 | n])
  if (n < 0x3fff) return Buffer.from([0x40 | (n >> 8), n & 0xff])
  if (n < 0x1fffff) return Buffer.from([0x20 | (n >> 16), (n >> 8) & 0xff, n & 0xff])
  return Buffer.from([0x10 | (n >> 24), (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff])
}
const el = (id, payload) => Buffer.concat([Buffer.from(id), vintSize(payload.length), payload])
function uintEl(id, value) {
  const size = value < 0x100 ? 1 : value < 0x10000 ? 2 : 3
  const b = Buffer.alloc(size)
  for (let i = size - 1; i >= 0; i--) { b[i] = value & 0xff; value >>= 8 }
  return el(id, b)
}
const mkvFile = (w, h) => Buffer.concat([
  el([0x1a, 0x45, 0xdf, 0xa3], Buffer.alloc(0)),                      // EBML 头
  el([0x18, 0x53, 0x80, 0x67], Buffer.concat([                        // Segment
    el([0x16, 0x54, 0xae, 0x6b], el([0xae], el([0xe0],               // Tracks → TrackEntry → Video
      Buffer.concat([uintEl([0xb0], w), uintEl([0xba], h)]))))
  ]))
])

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-vsize-'))
const cases = [
  ['mp4-v0-1080p.mp4', Buffer.concat([ftyp(), moov(mvhd(), trak(0, 0), trak(1920, 1080))]), { width: 1920, height: 1080 }],
  ['mp4-v1-4k.mp4', Buffer.concat([moov(trak(3840, 2160, 1))]), { width: 3840, height: 2160 }],
  ['mp4-moov-after-mdat.mp4', Buffer.concat([ftyp(), mdat(200 * 1024), moov(trak(1920, 1080))]), { width: 1920, height: 1080 }],
  ['mkv-4k.mkv', mkvFile(3840, 2160), { width: 3840, height: 2160 }],
  ['mkv-720p.mkv', mkvFile(1280, 720), { width: 1280, height: 720 }],
  ['not-video.mp4', Buffer.from('hello world, not a video at all!'), null]
]

;(async () => {
  let pass = 0, fail = 0
  for (const [name, content, expect] of cases) {
    const p = path.join(dir, name)
    fs.writeFileSync(p, content)
    const got = await readVideoSize(p)
    const ok = JSON.stringify(got) === JSON.stringify(expect)
    console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name.padEnd(26)} → ${JSON.stringify(got)}${ok ? '' : '  期望 ' + JSON.stringify(expect)}`)
    ok ? pass++ : fail++
  }
  const miss = await readVideoSize(path.join(dir, 'nope.mp4'))
  const okMiss = miss === null
  console.log(`${okMiss ? '[OK]  ' : '[FAIL]'} 文件不存在 → ${JSON.stringify(miss)}`)
  okMiss ? pass++ : fail++
  console.log(`\n结果: 通过 ${pass} / 失败 ${fail}`)
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  process.exit(fail ? 1 : 0)
})()