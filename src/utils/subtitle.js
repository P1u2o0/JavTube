/**
 * @file subtitle.js
 * @module src/utils/subtitle
 * @description 外挂字幕解析（2026-11-19）。
 *
 * 为什么不用内核自带的字幕渲染：
 *   · mpv 的 `sub-pos` / 水平居中都是按**整个窗口**计算的（实测），而播放画面被缩进到一个
 *     较小的矩形里 —— 结果字幕偏右、字号偏大，且只有全屏才"看着正常"；
 *   · Chromium（ArtPlayer）倒是基于视频区域，但两套内核的字幕样式/位置无法统一。
 * 因此统一改成「页面自绘字幕层」：主进程只提供原始字节，渲染层解析成 cue 列表，
 * 由播放页把当前时间对应的文本画进视频区域内的覆盖层 —— 位置、字号、行高全部自适应。
 *
 * 支持 srt / vtt / ass / ssa：
 *   · srt/vtt：标准时间轴 `00:00:01,000 --> 00:00:03,000`
 *   · ass/ssa：读 [Events] 的 Format 行定位 Start/End/Text，去掉 `{\...}` 特效标签、
 *     `\N`/`\n` 换行；只取对白（Dialogue），不处理定位/特效（外挂中文字幕基本不用）。
 *
 * @keyAPI parseCues(), findActiveText()
 */

/** `hh:mm:ss[,.]ms` → 秒 */
function toSeconds(t) {
  const m = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(String(t || ''))
  if (!m) return NaN
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + Number('0.' + m[4])
}

/** 去掉 ASS 的覆写标签与换行转义 */
function cleanAssText(s) {
  return String(s || '')
    .replace(/\{[^}]*\}/g, '')          // {\pos(..)} 之类的特效标签
    .replace(/\\N/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\h/g, ' ')
    .trim()
}

/**
 * 解析 ASS/SSA 的 [Events] 段。
 * @param {string} text
 * @returns {Array<{start:number,end:number,text:string}>}
 */
function parseAss(text) {
  const lines = String(text).split(/\r?\n/)
  let inEvents = false
  let fmt = null
  const cues = []
  for (const raw of lines) {
    const line = raw.trim()
    if (/^\[Events\]/i.test(line)) { inEvents = true; continue }
    if (/^\[/.test(line)) { inEvents = false; continue }
    if (!inEvents) continue
    if (/^Format\s*:/i.test(line)) {
      fmt = line.replace(/^Format\s*:/i, '').split(',').map(s => s.trim().toLowerCase())
      continue
    }
    if (!/^Dialogue\s*:/i.test(line)) continue
    const body = line.replace(/^Dialogue\s*:/i, '')
    // 按 Format 的列数切分（Text 是最后一列，内部可能含逗号 → 只切前 n-1 个）
    const cols = fmt || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
    const parts = []
    let rest = body
    for (let i = 0; i < cols.length - 1; i++) {
      const idx = rest.indexOf(',')
      if (idx < 0) { parts.push(rest); rest = ''; break }
      parts.push(rest.slice(0, idx))
      rest = rest.slice(idx + 1)
    }
    parts.push(rest)
    const get = (key) => {
      const i = cols.indexOf(key)
      return i >= 0 ? parts[i] : ''
    }
    const start = toSeconds(get('start'))
    const end = toSeconds(get('end'))
    const text2 = cleanAssText(get('text'))
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text2) {
      cues.push({ start, end, text: text2 })
    }
  }
  return cues
}

/**
 * 解析 SRT / VTT。
 * @param {string} text
 * @returns {Array<{start:number,end:number,text:string}>}
 */
function parseSrtVtt(text) {
  const cues = []
  const body = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  // 用「时间轴行」分段：每段后面到下一个空行都是文本
  const blocks = body.split(/\n{2,}/)
  for (const b of blocks) {
    const lines = b.split('\n').filter(l => l.trim() !== '')
    if (!lines.length) continue
    const ti = lines.findIndex(l => l.includes('-->'))
    if (ti < 0) continue
    const m = /(\d+:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d+:\d{2}:\d{2}[,.]\d{1,3})/.exec(lines[ti])
    if (!m) continue
    const start = toSeconds(m[1])
    const end = toSeconds(m[2])
    const txt = lines.slice(ti + 1).join('\n')
      .replace(/<[^>]+>/g, '')          // vtt 的内联标签
      .replace(/\{\\[^}]*\}/g, '')      // 偶见 srt 里混 ASS 标签
      .trim()
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && txt) {
      cues.push({ start, end, text: txt })
    }
  }
  return cues.sort((a, b) => a.start - b.start)
}

/**
 * 解析任意字幕文本为 cue 列表。
 * @param {string} text - 已解码的字幕文本
 * @param {string} [type] - 扩展名（srt/ass/ssa/vtt），大小写不敏感
 * @returns {Array<{start:number,end:number,text:string}>}
 */
export function parseCues(text, type = '') {
  const t = String(type || '').toLowerCase()
  if (t === 'ass' || t === 'ssa') return parseAss(text).sort((a, b) => a.start - b.start)
  if (t === 'vtt' || t === 'srt') return parseSrtVtt(text)
  // 未给类型：按内容猜（有 [Events] 就是 ass，否则当 srt/vtt）
  return /\[Events\]/i.test(text) ? parseAss(text).sort((a, b) => a.start - b.start) : parseSrtVtt(text)
}

/**
 * 取当前时间点应显示的字幕文本（多条同时命中时按行拼接）。
 * @param {Array<{start:number,end:number,text:string}>} cues
 * @param {number} t - 当前播放时间（秒）
 * @returns {string} 空串表示这一时刻没有字幕
 */
export function findActiveText(cues, t) {
  if (!cues || !cues.length) return ''
  const hit = cues.filter(c => t >= c.start && t <= c.end)
  if (!hit.length) return ''
  return hit.map(c => c.text).join('\n')
}
