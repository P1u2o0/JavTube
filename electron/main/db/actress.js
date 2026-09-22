/**
 * @file actress.js
 * @module electron/main/db/actress
 * @description 女优数据的 IPC 处理器注册模块。提供女优的列表查询、
 *              详情查询（含参演影片，通过 movies.yid 演员名匹配）、增删改。
 *              handler 代码自原 movies.js 原样移入（轮次 3 按领域拆分），
 *              IPC 通道名保持不变：actress:list / get / create / update / delete。
 * @dependencies electron (ipcMain), ./util
 * @keyAPI db.exec(), db.run(), persist()
 */

// db 层通用工具（查询结果转换 / 落盘收口）
const { rows, firstRow, firstScalar, persistSoon } = require('./util')
// IPC 通道名常量（preload 与 main 共享，定义于 common/ipc-channels.js）
const IPC = require('../../common/ipc-channels')

/**
 * 热度分档（演员页火焰配色）：按「前 X%」从热到冷。
 * 其余（超出前 60%）为 cyan —— 即用户定义的 61%~100% 区间。
 * key 为前端 CSS 类后缀，见 ActorFilms.vue 的 .idx-flame.t-*。
 */
const HEAT_TIERS = [
  { max: 10, key: 'purple' },   // 前 10%
  { max: 20, key: 'darkred' },  // 前 11%~20%
  { max: 30, key: 'lightred' }, // 前 21%~30%
  { max: 40, key: 'orange' },   // 前 31%~40%
  { max: 50, key: 'gold' },     // 前 41%~50%
  { max: 60, key: 'blue' }      // 前 51%~60%
]

/**
 * 名次 → 档位：`前 X%` 判定为「名次 ≤ ceil(总数 × X%)」。
 * 用 ceil 而非严格小于，小库（几个女优）也能分出档，不会全落进最低档。
 * @param {number} rank - 名次（从 1 开始，并列同名次）
 * @param {number} total - 参与排名的女优总数
 * @returns {string} 档位 key
 */
function tierOf(rank, total) {
  for (const t of HEAT_TIERS) {
    if (rank <= Math.ceil((total * t.max) / 100)) return t.key
  }
  return 'cyan'
}

/**
 * 计算全库女优的热度指数与排名（并列同名次 competition ranking）。
 * 热度定义与演员页一致：该女优「有想看/看过人数」的作品里，取 (想看 + 看过) 的平均值（四舍五入）。
 * 只统计女优：cast_json 里 gender === 'm' 的男优跳过；无 cast_json 的旧数据按 yid 拆分并计入。
 * @param {Object} db - sql.js 数据库实例
 * @returns {Map<string, {rank:number,total:number,tier:string}>} 女优名 → 排名信息
 */
function computeHeatRanks(db) {
  const res = db.exec('SELECT yid, cast_json, want, watched FROM movies')[0]
  const out = new Map()
  if (!res) return out
  const col = {}
  res.columns.forEach((c, i) => { col[c] = i })
  const acc = new Map() // 女优名 → { sum, n }
  for (const r of res.values) {
    const v = (Number(r[col.want]) || 0) + (Number(r[col.watched]) || 0)
    if (v <= 0) continue // 无人数数据的作品不参与（与页面口径一致）
    let names = []
    let parsed = false // 仅当 cast_json 确有演员条目才以它为准（纯男优→过滤后为空也不回退）；
    try {              // 空数组 / 空串 / 解析失败 → 回退拆 yid，否则这些影片会被整条漏掉
      const cast = JSON.parse(r[col.cast_json] || '[]')
      if (Array.isArray(cast) && cast.length) {
        parsed = true
        names = cast.filter(c => c && c.name && (c.gender || 'f') !== 'm').map(c => c.name)
      }
    } catch {}
    if (!parsed) names = String(r[col.yid] || '').split(/[，,]/).map(s => s.trim()).filter(Boolean)
    for (const nm of new Set(names)) {
      const e = acc.get(nm) || { sum: 0, n: 0 }
      e.sum += v
      e.n += 1
      acc.set(nm, e)
    }
  }
  const list = [...acc.entries()]
    .map(([nm, e]) => ({ name: nm, heat: Math.round(e.sum / e.n) }))
    .sort((a, b) => b.heat - a.heat)
  const total = list.length
  let rank = 0
  let prev = null
  list.forEach((it, i) => {
    if (it.heat !== prev) { rank = i + 1; prev = it.heat } // 同分并列
    out.set(it.name, { rank, total, tier: tierOf(rank, total), heat: it.heat })
  })
  return out
}

/** 影片集合指纹（条目数 + 最大 id）：任何增删都会变化，作为缓存键 */
function moviesKey(db) {
  try {
    const r = db.exec('SELECT COUNT(*), IFNULL(MAX(id),0) FROM movies')[0]
    return r ? r.values[0].join(':') : ''
  } catch { return '' }
}

// 排名结果缓存：一次扫描全库（大库上万条），避免每次进演员页都重算。
// 条目数或最大 id 变化即失效（新增/删除影片），另加 60s TTL 兜住「只改人数」的情况。
const heatCache = { key: '', at: 0, map: null }
function heatRanksCached(db) {
  const key = moviesKey(db)
  const now = Date.now()
  if (heatCache.map && heatCache.key === key && now - heatCache.at < 60000) return heatCache.map
  const map = computeHeatRanks(db)
  heatCache.key = key
  heatCache.at = now
  heatCache.map = map
  return map
}

/**
 * 聚合库内全部女优（「演员」页数据源，2026-09-22）：
 * count = 出演影片数；heat/rank/total/tier 复用热度排名；
 * top = 该女优「想看人数最多」的至多 3 部影片（want 为 0 的不进 top）。
 * 只收女优：cast_json 过滤 gender==='m'；旧数据无 cast_json 时回退按 yid 拆分（视为女优）。
 * 默认顺序 = 作品数降序（并列按热度降序）—— 头像墙的默认排序。
 */
function computeOverview(db) {
  const res = db.exec('SELECT id, ph, pm, cover, yid, cast_json, want, watched FROM movies')[0]
  if (!res) return []
  const col = {}
  res.columns.forEach((c, i) => { col[c] = i })
  const acc = new Map() // 女优名 → { avatar, count, movies }
  for (const r of res.values) {
    const want = Number(r[col.want]) || 0
    const v = want + (Number(r[col.watched]) || 0)
    let names = []
    let parsed = false // 与热度排名同口径：cast_json 确有演员条目才以它为准；空数组/空串/解析失败回退拆 yid
    try {
      const cast = JSON.parse(r[col.cast_json] || '[]')
      if (Array.isArray(cast) && cast.length) {
        parsed = true
        names = cast.filter(c => c && c.name && (c.gender || 'f') !== 'm')
      }
    } catch {}
    if (!parsed) names = String(r[col.yid] || '').split(/[，,]/).map(s => s.trim()).filter(Boolean).map(nm => ({ name: nm, avatar: '' }))
    for (const c of new Map(names.map(n => [n.name, n])).values()) {
      const e = acc.get(c.name) || { avatar: '', count: 0, movies: [] }
      if (!e.avatar && c.avatar) e.avatar = c.avatar
      e.count += 1
      e.movies.push({ id: r[col.id], ph: r[col.ph], pm: r[col.pm], cover: r[col.cover], want })
      acc.set(c.name, e)
    }
  }
  const ranks = heatRanksCached(db)
  const list = [...acc.entries()].map(([name, e]) => {
    const rk = ranks.get(name) || null // 全部作品都无人数数据时 rk 为 null
    return {
      name, avatar: e.avatar, count: e.count,
      heat: rk ? rk.heat : null, rank: rk ? rk.rank : null,
      total: rk ? rk.total : null, tier: rk ? rk.tier : null,
      top: e.movies.filter(m => m.want > 0).sort((a, b) => b.want - a.want).slice(0, 3)
    }
  })
  list.sort((a, b) => b.count - a.count || (b.heat || 0) - (a.heat || 0) || a.name.localeCompare(b.name, 'zh'))
  return list
}

// 总览缓存：与热度排名同策略（影片集合指纹 + 60s TTL）
const ovCache = { key: '', at: 0, list: null }
function overviewCached(db) {
  const key = moviesKey(db)
  const now = Date.now()
  if (ovCache.list && ovCache.key === key && now - ovCache.at < 60000) return ovCache.list
  const list = computeOverview(db)
  ovCache.key = key
  ovCache.at = now
  ovCache.list = list
  return list
}

/**
 * 注册女优相关的 IPC 处理器。
 * @param {Object} ipcMain - Electron ipcMain 对象
 * @param {Object} db - sql.js 数据库实例
 */
function registerActressIpc(ipcMain, db) {

  // IPC: actress:list — 渲染进程 → 主进程
  // 获取所有女优列表（按名称排序）
  ipcMain.handle(IPC.ACTRESS_LIST, () => {
    try { return { ok: true, data: rows(db.exec('SELECT * FROM actress ORDER BY name ASC')[0]) } }
    catch (e) { return { ok: false, error: e.message, data: [] } }
  })

  // IPC: actress:get — 渲染进程 → 主进程
  // 获取女优详情，并附带该女优参演的影片列表
  ipcMain.handle(IPC.ACTRESS_GET, (_e, id) => {
    try {
      // 查询女优基本信息
      const m = firstRow(db.exec('SELECT * FROM actress WHERE id=?', [Number(id)])[0])
      if (!m) return { ok: false, error: 'not found' }
      m.movies = []
      // 查询该女优参演的影片：通过 movies.yid 字段（中文逗号分隔的演员名）匹配
      // 需要匹配四种位置关系：开头、中间、结尾、独占
      const nm = m.name
      const patterns = [
        `${nm}，%`,    // 名字在开头
        `%，${nm}，%`, // 名字在中间
        `%，${nm}`,     // 名字在结尾
        nm              // 名字独占（唯一演员）
      ]
      const q = `SELECT id,ph,pm,cover,fxrq,cl FROM movies WHERE
        yid LIKE ? OR yid LIKE ? OR yid LIKE ? OR yid=? ORDER BY fxrq DESC LIMIT 50`
      m.movies = rows(db.exec(q, patterns)[0])
      return { ok: true, data: m }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: actress:create — 渲染进程 → 主进程
  // 创建女优记录
  ipcMain.handle(IPC.ACTRESS_CREATE, (_e, data) => {
    try {
      const d = data || {}
      db.run(`INSERT INTO actress (name,img,height,bust,waist,hip,zb,birthday,debut,remark)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, [
        d.name||'', d.img||'',
        Number(d.height||0), Number(d.bust||0), Number(d.waist||0), Number(d.hip||0),
        d.zb||'', d.birthday||'', d.debut||'', d.remark||''
      ])
      const id = Number(firstScalar(db.exec('SELECT last_insert_rowid()')[0]))
      persistSoon(db); return { ok: true, id }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: actress:update — 渲染进程 → 主进程
  // 更新女优信息
  ipcMain.handle(IPC.ACTRESS_UPDATE, (_e, { id, data }) => {
    try {
      const d = data || {}
      db.run(`UPDATE actress SET name=?,img=?,height=?,bust=?,waist=?,hip=?,zb=?,birthday=?,debut=?,remark=? WHERE id=?`, [
        d.name||'', d.img||'',
        Number(d.height||0), Number(d.bust||0), Number(d.waist||0), Number(d.hip||0),
        d.zb||'', d.birthday||'', d.debut||'', d.remark||'', Number(id)
      ])
      persistSoon(db); return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: actress:delete — 渲染进程 → 主进程
  // 删除女优
  ipcMain.handle(IPC.ACTRESS_DELETE, (_e, id) => {
    try { db.run('DELETE FROM actress WHERE id=?', [Number(id)])
      persistSoon(db); return { ok: true } }
    catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: actor:films — 渲染进程 → 主进程（2026-09-14）
  // 按演员名查询其出演的全部影片，并回传该演员的性别/头像与资料（男女通用）
  ipcMain.handle(IPC.ACTOR_FILMS, (_e, name) => {
    const nm = String(name || '').trim()
    const empty = { name: nm, gender: 'f', avatar: '', info: null, movies: [] }
    if (!nm) return { ok: true, data: empty }
    try {
      // 匹配：cast_json 精确名字（含男女演员）+ yid 四种位置（兼容未写 cast_json 的旧数据）
      const like = `%"name":"${nm}"%`
      const q = `SELECT * FROM movies
        WHERE cast_json LIKE ? OR yid LIKE ? OR yid LIKE ? OR yid LIKE ? OR yid=?
        ORDER BY fxrq DESC`
      const movies = rows(db.exec(q, [like, `${nm}，%`, `%，${nm}，%`, `%，${nm}`, nm])[0])
      // 从命中影片的 cast_json 取该演员的性别/头像（取第一条）
      let gender = 'f', avatar = ''
      for (const mv of movies) {
        try {
          const hit = (JSON.parse(mv.cast_json || '[]') || []).find(c => c.name === nm)
          if (hit) { gender = hit.gender || 'f'; avatar = hit.avatar || ''; break }
        } catch {}
      }
      // 演员资料（actress 表，用户维护）：身高/三围/生日等，无则留空
      const info = firstRow(db.exec('SELECT * FROM actress WHERE name=?', [nm])[0]) || null
      // 返回渲染层前剥掉两个大 JSON 字段（2026-09-21）：
      // 本页只需要番号/片名/封面/标签/喜欢/视频路径等标量字段，previews（预览图路径数组）
      // 与 cast_json（演员列表）既不展示也不需要，而参演影片多时这两项占整个响应的绝大部分。
      // 详情页需要它们时是单独查单部的，不受影响。
      for (const mv of movies) { delete mv.previews; delete mv.cast_json }
      // 热度排名（2026-09-22）：全库女优按热度指数排名后的名次/总数/配色档位。
      // 演员页热度为 null（无人数数据）或女优榜里没有该名字时返回 null，前端保持默认色。
      let heatRank = null
      try { heatRank = heatRanksCached(db).get(nm) || null } catch {}
      return { ok: true, data: { name: nm, gender, avatar, info, movies, heatRank } }
    } catch (e) { return { ok: false, error: e.message, data: empty } }
  })

  // IPC: actor:overview — 「演员」页聚合数据（2026-09-22）
  // 库内全部女优：作品数 / 热度排名 / 各自身上想看最多的 3 部影片，默认按作品数降序
  ipcMain.handle(IPC.ACTOR_OVERVIEW, () => {
    try { return { ok: true, data: overviewCached(db) } }
    catch (e) { return { ok: false, error: e.message, data: [] } }
  })
}

module.exports = { registerActressIpc }
