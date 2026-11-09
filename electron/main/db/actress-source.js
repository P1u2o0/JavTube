/**
 * @file actress-source.js
 * @module electron/main/db/actress-source
 * @description 女优外部数据源（2026-11-09）：
 *              ① 本地资料库 —— 用户放入 <dataDir>/actress-db/*.db 的外部 SQLite
 *                 （Info/Names/Urls 三表，源自 MDCx 项目的演员数据库），用于
 *                 「演员编辑弹窗一键检索」与头像补齐的别名解析；
 *              ② gfriends 头像仓库 —— https://github.com/xinxin8816/gfriends
 *                 （约 19 万张女优头像），经 jsdelivr CDN 访问，索引为仓库根的
 *                 Filetree.json：{ Content: { <分片目录>: { <女优名>.jpg: <实际文件名>.jpg } } }。
 *
 *              背景：原资料检索走 theidolbase.com，其站内搜索后端（xunsearch，
 *              localhost:8384）已损坏 —— 搜索页恒返回空结果（2026-11-09 实测），
 *              故改为本地资料库；头像补齐原走 JAVDB（需 Cookie + 逐条搜站），
 *              现改为 gfriends 优先（一次下载索引后按名直查，快且全），JAVDB 兜底。
 *
 * @dependencies fs, path, net-curl, db/init(getSQL)
 * @keyAPI getSourceDb(), lookupInfo(), resolveNameCandidates(), fetchGfriendsAvatar()
 */

const fs = require('fs')
const path = require('path')
const { curlGet } = require('../net-curl')
const { getSQL } = require('./init')

/** 本地资料库所在子目录名（位于数据目录下） */
const SRC_DIRNAME = 'actress-db'

// ============ ① 本地资料库 ============

// 会话级缓存：{ file, mtime, db }。按 mtime 失效 —— 用户替换 .db 文件后无需重启。
let srcCache = null

/**
 * 找到本地资料库文件（actress-db/ 下第一个 .db）。
 * @param {string} dataDir - 数据目录
 * @returns {string} 文件绝对路径，没有则空串
 */
function findSourceDb(dataDir) {
  if (!dataDir) return ''
  const dir = path.join(dataDir, SRC_DIRNAME)
  let names = []
  try { names = fs.readdirSync(dir) } catch { return '' }
  const hit = names.find(n => n.toLowerCase().endsWith('.db'))
  return hit ? path.join(dir, hit) : ''
}

/**
 * 打开（并缓存）本地资料库。文件不存在返回 null；打开失败抛错（调用方决定如何提示）。
 * 只读使用：本模块绝不向该库写入任何内容。
 * @param {string} dataDir - 数据目录
 * @returns {Promise<Object|null>} sql.js 数据库实例
 */
async function getSourceDb(dataDir) {
  const file = findSourceDb(dataDir)
  if (!file) return null
  let mtime = 0
  try { mtime = fs.statSync(file).mtimeMs } catch { return null }
  if (srcCache && srcCache.file === file && srcCache.mtime === mtime) return srcCache.db
  const SQL = await getSQL()
  const db = new SQL.Database(fs.readFileSync(file))
  if (srcCache) { try { srcCache.db.close() } catch {} }
  srcCache = { file, mtime, db }
  return db
}

/**
 * 带参数查询 → 对象数组。
 * sql.js 的 exec() 不支持绑定参数，这里用 prepare + getAsObject。
 * @returns {Object[]} 查询结果（列名为键），空结果返回 []
 */
function queryAll(db, sql, params = []) {
  const out = []
  let stmt = null
  try {
    stmt = db.prepare(sql)
    stmt.bind(params)
    while (stmt.step()) out.push(stmt.getAsObject())
  } catch (e) {
    throw new Error('资料库查询失败: ' + e.message)
  } finally {
    if (stmt) { try { stmt.free() } catch {} }
  }
  return out
}

/**
 * 按名字查本地资料库的 Info 行。匹配顺序（先命中先返回）：
 *   ① Info.Name（日文名，库内主键口径）
 *   ② Info.NameCN（中文名）
 *   ③ Info.Roma（罗马字，不区分大小写）
 *   ④ Names.Alias（别名表，含片假名/罗马字变体）→ 回到 ①
 * @param {Object} db - 本地资料库实例
 * @param {string} name - 应用内显示的演员名
 * @returns {Object|null} Info 行（原始列），未命中返回 null
 */
function findInfoRow(db, name) {
  const q = String(name || '').trim()
  if (!q) return null
  const byName = queryAll(db, 'SELECT * FROM Info WHERE Name = ? LIMIT 1', [q])
  if (byName.length) return byName[0]
  const byCn = queryAll(db, 'SELECT * FROM Info WHERE NameCN = ? LIMIT 1', [q])
  if (byCn.length) return byCn[0]
  const byRoma = queryAll(db, "SELECT * FROM Info WHERE Roma = ? COLLATE NOCASE LIMIT 1", [q])
  if (byRoma.length) return byRoma[0]
  const byAlias = queryAll(db, 'SELECT Name FROM Names WHERE Alias = ? LIMIT 1', [q])
  if (byAlias.length) {
    const hit = queryAll(db, 'SELECT * FROM Info WHERE Name = ? LIMIT 1', [byAlias[0].Name])
    if (hit.length) return hit[0]
  }
  return null
}

/**
 * 把本地资料库的 Info 行映射为应用 actress 表的字段口径。
 * Cup → zb（罩杯）、CareerPeriod → debut（出道/活跃期）。
 * @param {Object} row - Info 行
 * @returns {Object} { height,bust,waist,hip,zb,birthday,debut,matchedName }
 */
function mapInfoRow(row) {
  const num = v => (v === null || v === undefined || v === '') ? null : (Number(v) || null)
  return {
    height: num(row.Height),
    bust: num(row.Bust),
    waist: num(row.Waist),
    hip: num(row.Hip),
    zb: row.Cup ? String(row.Cup).trim().toUpperCase() : null,
    birthday: row.Birthday ? String(row.Birthday).slice(0, 10) : null,
    debut: row.CareerPeriod ? String(row.CareerPeriod).trim() : null,
    matchedName: row.Roma ? `${row.Name}（${row.Roma}）` : String(row.Name)
  }
}

/**
 * 名字 → 资料字段（供演员编辑弹窗「一键检索」直接填表）。
 * @param {Object} db - 本地资料库实例
 * @param {string} name - 演员名
 * @returns {Object|null} 映射后的字段对象，未命中返回 null
 */
function lookupInfo(db, name) {
  const row = findInfoRow(db, name)
  return row ? mapInfoRow(row) : null
}

/**
 * 名字 → gfriends 匹配候选名列表（去重、去掉与原名相同的项）。
 * gfriends 索引键以日文名为主（少量罗马字/中文名），应用内名字可能是
 * 中文名或罗马字 —— 这里借本地资料库把名字展开成同一个人的所有写法：
 *   Info.Name（日文 canonical）> Info.NameCN（中文）> Info.Roma（罗马字）
 * @param {Object} db - 本地资料库实例（可为 null，此时只返回原名）
 * @param {string} name - 应用内显示的演员名
 * @returns {string[]} 候选名列表（不含原名本身）
 */
function resolveNameCandidates(db, name) {
  const out = []
  const add = v => {
    const s = String(v || '').trim()
    if (s && s !== name && !out.includes(s)) out.push(s)
  }
  try {
    const row = findInfoRow(db, name)
    if (row) { add(row.Name); add(row.NameCN); add(row.Roma) }
  } catch { /* 资料库异常不阻断头像补齐 */ }
  return out
}

// ============ ② gfriends 头像仓库（jsdelivr CDN） ============

/** jsdelivr 上的 gfriends 仓库根（用户提供的国内可用的镜像调用地址） */
const GFRIENDS_BASE = 'https://cdn.jsdelivr.net/gh/xinxin8816/gfriends/'

// 索引缓存：成功缓存 6 小时；失败也缓存 60 秒（避免批量补齐时每次都重试 9MB 下载）
const gfIndex = { at: 0, map: null, errAt: 0, err: '' }

/**
 * 下载并展平 gfriends 的 Filetree.json → Map<女优名, 图片完整 URL>。
 * 展平规则：{ Content: { dir: { '名字.jpg': '实际文件.jpg' } } } →
 *           Map('名字' → GFRIENDS_BASE + 'Content/' + dir + '/' + 实际文件.jpg)
 * 同名出现在多个分片目录时取第一个（同人同图，取哪个都行）。
 * 网络顺序：用户代理优先（jsdelivr 国内直连常被重置，实测 HTTP 000），直连兜底。
 * @param {string} [proxy] - 用户设置的代理地址（空串=未启用）
 * @returns {Promise<Map<string,string>>}
 */
async function gfriendsIndex(proxy = '') {
  const now = Date.now()
  if (gfIndex.map && now - gfIndex.at < 6 * 3600 * 1000) return gfIndex.map
  if (!gfIndex.map && gfIndex.err && now - gfIndex.errAt < 60000) {
    throw new Error(gfIndex.err)
  }
  const tries = [...new Set([proxy || '', ''])]
  let lastErr = ''
  for (const px of tries) {
    let r = null
    try { r = await curlGet(GFRIENDS_BASE + 'Filetree.json', { proxy: px || undefined, timeout: 90000 }) }
    catch (e) { lastErr = e.message; continue }
    if (!r.ok) { lastErr = r.error || `HTTP ${r.status}`; continue }
    try {
      const j = JSON.parse(r.html)
      const content = j && j.Content
      if (!content || typeof content !== 'object') throw new Error('索引结构异常（无 Content 字段）')
      const map = new Map()
      for (const [dir, files] of Object.entries(content)) {
        if (!files || typeof files !== 'object') continue
        for (const [key, file] of Object.entries(files)) {
          const nm = key.replace(/\.jpe?g$/i, '')
          if (nm && !map.has(nm)) map.set(nm, encodeURI(`${GFRIENDS_BASE}Content/${dir}/${file}`))
        }
      }
      if (!map.size) throw new Error('索引为空')
      gfIndex.map = map
      gfIndex.at = now
      gfIndex.err = ''
      return map
    } catch (e) {
      lastErr = 'gfriends 索引解析失败: ' + e.message
    }
  }
  gfIndex.err = `gfriends 索引下载失败（jsdelivr 需代理）: ${lastErr}`
  gfIndex.errAt = now
  throw new Error(gfIndex.err)
}

/**
 * 从 gfriends 索引中按名字找头像 URL。
 * 依次尝试：原名 → 候选名列表（本地资料库解析出的别名/罗马字/中文名）。
 * @param {string} name - 应用内显示的演员名
 * @param {Object} [opts] - { proxy, candidates }（candidates 见 resolveNameCandidates）
 * @returns {Promise<{ok:boolean, url?:string, matched?:string, note?:string, error?:string}>}
 */
async function fetchGfriendsAvatar(name, { proxy = '', candidates = [] } = {}) {
  const nm = String(name || '').trim()
  if (!nm) return { ok: false, error: '演员名为空' }
  const map = await gfriendsIndex(proxy)
  for (const cand of [nm, ...candidates]) {
    const c = String(cand || '').trim()
    if (!c) continue
    if (map.has(c)) {
      return {
        ok: true,
        url: map.get(c),
        matched: c,
        // 与 JAVDB 路径同口径：实际匹配名 ≠ 原名时回报，前端据此提示
        note: c !== nm ? `按「${c}」匹配` : ''
      }
    }
  }
  return { ok: false, error: 'gfriends 索引中无此演员' }
}

module.exports = {
  SRC_DIRNAME,
  getSourceDb,
  lookupInfo,
  resolveNameCandidates,
  fetchGfriendsAvatar,
  GFRIENDS_BASE
}
