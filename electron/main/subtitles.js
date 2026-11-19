/**
 * @file subtitles.js
 * @module electron/main/subtitles
 * @description 外挂字幕支持（2026-11-19 新增）。
 *
 * 背景：很多视频没有内嵌字幕、文件名也不带 `-C`，但同目录下放着同名（或带语言后缀）
 * 的 .srt/.ass/.ssa/.vtt。用户要求：扫描时识别出来 → 番号旁显示「外挂字幕」；
 * 内置播放器直接把这些字幕挂上（两种内核都要支持）。
 *
 * 设计要点：
 *   · 识别只做一次 readdir（按目录缓存 20s）—— 影片多在 NAS 上，逐部 stat/枚举不可接受；
 *   · 匹配优先级：完全同名 > 同主干 + 语言后缀（.zh/.chs/.chi/.sc/.cn/中文…）>
 *     同目录下以同一番号开头的其他字幕（防止「ABC-123-C.mp4 配 ABC-123.chs.srt」漏掉）；
 *   · 读取走**库内闸门**：只允许「确实属于某部库内影片」的字幕（见 isLibrarySubtitle），
 *     与 video-gate 同一套路径归一化口径；
 *   · 编码不做假设：把原始字节 base64 交给渲染层，用 TextDecoder 依次试 utf-8 / gbk
 *     （中文库常见 GBK 编码的 srt，主进程没有 iconv，渲染层有 TextDecoder('gbk')）。
 *
 * @dependencies fs, path, ../constants, ./video-gate
 * @keyAPI findSubtitle(), registerSubtitleIpc()
 */

const fs = require('fs')
const path = require('path')
const IPC = require('../common/ipc-channels')
const { SUB_EXTS } = require('./constants')
const { normPath } = require('./video-gate')

/** 目录内容缓存 TTL（ms）：NAS 上一次 readdir 几百毫秒，不能每部影片都做 */
const DIR_CACHE_TTL = 20000
/** 单条字幕文件大小上限（字节）：正常字幕 <1MB，超过的当异常文件拒绝 */
const MAX_SUB_BYTES = 4 * 1024 * 1024

/** 语言后缀 → 权重（越小越优先；无后缀视为最高） */
const LANG_TOKENS = [
  ['chs', 1], ['sc', 1], ['cn', 1], ['zh', 1], ['chi', 1], ['cht', 2], ['tc', 2], ['chinese', 2],
  ['简体', 1], ['简中', 1], ['中文', 1], ['繁體', 2], ['繁体', 2], ['繁中', 2], ['eng', 9], ['en', 9]
]

/** normDir → { at: number, names: string[] } */
const dirCache = new Map()

/**
 * 读目录里的文件名（带缓存）。
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listDirCached(dir) {
  const key = normPath(dir)
  const hit = dirCache.get(key)
  if (hit && Date.now() - hit.at < DIR_CACHE_TTL) return hit.names
  let names = []
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    names = entries.filter(e => e.isFile()).map(e => e.name)
  } catch {
    names = []   // 目录不可读（NAS 离线/权限）→ 视为无字幕，不影响播放主流程
  }
  dirCache.set(key, { at: Date.now(), names })
  return names
}

/** 从文件名里取出「番号主干」：最多前两段（ABC-123-C → abc-123），用于宽松匹配 */
function codePrefix(stem) {
  const parts = String(stem).split(/[-_\s.]+/).filter(Boolean)
  if (!parts.length) return ''
  return (parts.length >= 2 ? parts[0] + '-' + parts[1] : parts[0]).toLowerCase()
}

/**
 * 找出某部视频对应的外挂字幕。
 * @param {string} videoPath - movies.py 的绝对路径
 * @returns {Promise<string>} 字幕绝对路径；找不到返回空串
 */
async function findSubtitle(videoPath) {
  const file = String(videoPath || '')
  if (!file) return ''
  const dir = path.dirname(file)
  const stem = path.basename(file, path.extname(file))
  if (!stem) return ''
  const names = await listDirCached(dir)
  if (!names.length) return ''
  const lowerStem = stem.toLowerCase()
  const code = codePrefix(stem)

  let best = ''
  let bestScore = -1
  for (const name of names) {
    const ext = path.extname(name).toLowerCase()
    if (!SUB_EXTS.includes(ext)) continue
    const base = name.slice(0, -ext.length)
    const lowerBase = base.toLowerCase()
    let score = -1
    if (lowerBase === lowerStem) score = 100
    else if (lowerBase.startsWith(lowerStem)) {
      // 同主干 + 语言/版本后缀：取语言权重当微调（简中优先于繁中、英文最后）
      const rest = lowerBase.slice(lowerStem.length)
      let lang = 5
      for (const [tok, w] of LANG_TOKENS) if (rest.includes(tok)) { lang = w; break }
      score = 90 - lang
    } else if (code && lowerBase.startsWith(code)) {
      // 同番号但主干写法不同（视频带 -C/-破解 等标记，字幕只写番号）
      score = 60
    }
    if (score > bestScore) { bestScore = score; best = name }
  }
  return best ? path.join(dir, best) : ''
}

/**
 * 字幕读取闸门：只允许读「库内影片同目录、且文件名以该影片主干开头」的字幕。
 * 与 video-gate 的「库内视频」思路一致 —— 渲染层能拿到的字幕路径都来自 findSubtitle，
 * 但 IPC 是公开面，必须自己再校验一次（防注入后读任意文件）。
 * ⚠️ 刻意做成**同步**：mpv 的 start/load 闸门是同步判空的写法，异步签名会逼调用方改结构。
 * @param {Object} db - sql.js 实例
 * @param {string} subPath - 待读字幕绝对路径
 * @returns {boolean}
 */
function isLibrarySubtitle(db, subPath) {
  const abs = String(subPath || '')
  if (!abs) return false
  const ext = path.extname(abs).toLowerCase()
  if (!SUB_EXTS.includes(ext)) return false
  const dir = path.dirname(abs)
  const base = path.basename(abs, path.extname(abs)).toLowerCase()
  let pys = []
  try {
    const r = db.exec('SELECT py FROM movies WHERE py IS NOT NULL AND py <> ""')[0]
    pys = r ? r.values.map(v => String(v[0] || '')) : []
  } catch { return false }
  const dirKey = normPath(dir)
  for (const py of pys) {
    if (normPath(path.dirname(py)) !== dirKey) continue
    const stem = path.basename(py, path.extname(py)).toLowerCase()
    if (base.startsWith(stem) || base.startsWith(codePrefix(stem))) return true
  }
  return false
}

/**
 * 全库字幕回填（2026-11-19）：给「有视频路径但 sub 为空」的老记录补上字幕路径。
 * 目录内容按目录缓存，因此整库通常只发生「目录数」次 readdir，可在启动后台跑。
 * @param {Object} db - sql.js 实例
 * @returns {Promise<number>} 回填条数
 */
async function backfillSubtitles(db) {
  let rows = []
  try {
    const r = db.exec("SELECT id, py FROM movies WHERE py IS NOT NULL AND py <> '' AND (sub IS NULL OR sub = '') LIMIT 5000")[0]
    rows = r ? r.values : []
  } catch { return 0 }
  let filled = 0
  for (const [id, py] of rows) {
    const found = await findSubtitle(String(py || ''))
    if (!found) continue
    try { db.run('UPDATE movies SET sub=? WHERE id=?', [found, id]); filled++ } catch { /* 单条失败不影响其它 */ }
  }
  if (filled) { try { persistSoon(db) } catch {} }
  return filled
}

/**
 * 注册字幕相关 IPC。
 * @param {Object} ipcMain - Electron ipcMain
 * @param {Object} db - sql.js 实例
 * @param {(msg:string)=>void} [persist] - 落盘函数（写库后调用；缺省用 persistSoon）
 */
function registerSubtitleIpc(ipcMain, db) {
  // 按影片查字幕。命中且库里 sub 为空时顺手回填 —— 老库无需重新导入即可显示徽章。
  ipcMain.handle(IPC.SUB_GET, async (_e, movieId) => {
    const id = Number(movieId)
    if (!Number.isFinite(id)) return { ok: false, error: 'id 无效' }
    try {
      const r = db.exec('SELECT py, sub FROM movies WHERE id=?', [id])[0]
      const row = r?.values?.[0]
      if (!row) return { ok: false, error: '影片不存在' }
      const py = String(row[0] || '')
      const stored = String(row[1] || '')
      // 已记录且文件还在 → 直接用（省一次 readdir）
      if (stored) {
        try { await fs.promises.access(stored); return { ok: true, path: stored, type: path.extname(stored).slice(1).toLowerCase() } } catch { /* 失效则重找 */ }
      }
      const found = await findSubtitle(py)
      if (!found) {
        if (stored) { try { db.run('UPDATE movies SET sub=? WHERE id=?', ['', id]) } catch {} }
        return { ok: true, path: '', type: '' }
      }
      try { db.run('UPDATE movies SET sub=? WHERE id=?', [found, id]); persistSoon(db) } catch {}
      return { ok: true, path: found, type: path.extname(found).slice(1).toLowerCase() }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // 读字幕原始字节（base64）—— 编码交给渲染层判断（utf-8 / gbk）
  ipcMain.handle(IPC.SUB_TEXT, async (_e, subPath) => {
    try {
      if (!isLibrarySubtitle(db, subPath)) return { ok: false, error: '不在影片库内' }
      const st = await fs.promises.stat(subPath)
      if (st.size > MAX_SUB_BYTES) return { ok: false, error: '字幕文件过大' }
      const buf = await fs.promises.readFile(subPath)
      return { ok: true, data: buf.toString('base64'), size: buf.length, type: path.extname(subPath).slice(1).toLowerCase() }
    } catch (e) { return { ok: false, error: e.message } }
  })
}

// persistSoon 与 db 模块同源（避免两套落盘节奏）；延迟 require 防循环引用
let _persistSoon = null
function persistSoon(db) {
  if (!_persistSoon) _persistSoon = require('./db/util').persistSoon
  return _persistSoon(db)
}

module.exports = { findSubtitle, isLibrarySubtitle, backfillSubtitles, registerSubtitleIpc }
