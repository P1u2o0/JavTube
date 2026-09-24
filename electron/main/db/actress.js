/**
 * @file actress.js
 * @module electron/main/db/actress
 * @description 女优数据的 IPC 处理器注册模块。提供女优的列表查询、
 *              详情查询（含参演影片，通过 movies.yid 演员名匹配）、增删改，
 *              以及「补全缺失头像」（无头像/占位图 → 从 JAVDB 取真实头像）。
 *              handler 代码自原 movies.js 原样移入（轮次 3 按领域拆分），
 *              IPC 通道名保持不变：actress:list / get / create / update / delete。
 * @dependencies electron (ipcMain), fs, path, crypto, ./util, ../constants, ../scraper
 * @keyAPI db.exec(), db.run(), persist()
 */

// db 层通用工具（查询结果转换 / 落盘收口）
const { rows, firstRow, firstScalar, persistSoon } = require('./util')
// IPC 通道名常量（preload 与 main 共享，定义于 common/ipc-channels.js）
const IPC = require('../../common/ipc-channels')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
// 封面/头像目录名（dataDir 下的子目录，集中定义于 constants.js）
const { COVER_DIR } = require('../constants')
// 头像来源（JAVDB 演员页）+ 图片下载（含主站图床走代理的判断）
const { fetchActorAvatar, downloadImage } = require('../scraper')

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
/* ===================== 女优头像补全（2026-09-24） =====================
 * 背景：头像是在刮削影片时随 cast_json 一起存下来的（covers/actress/<sid>.jpg）。
 *       两种情况会让界面出现「空白头像」：
 *         ① cast_json 的 avatar 为空 → 前端显示灰色剪影；
 *         ② 来源站对该女优没有照片，返回的是同一张「Now Printing」占位图（多个女优共用一张）。
 *       两者都可以用 JAVDB 的演员页头像补上（JAVBUS 缺图的人 JAVDB 往往有）。
 */

/**
 * 全库女优的头像现状：姓名 → { avatar, count }。
 * 口径与 computeOverview 一致：cast_json 优先，缺 cast_json 时回退拆 yid。
 */
function avatarStateOf(db) {
  const res = db.exec('SELECT yid, cast_json FROM movies')[0]
  const acc = new Map()
  if (!res) return acc
  const col = {}
  res.columns.forEach((c, i) => { col[c] = i })
  for (const r of res.values) {
    let names = []
    let parsed = false
    try {
      const cast = JSON.parse(r[col.cast_json] || '[]')
      if (Array.isArray(cast) && cast.length) {
        parsed = true
        names = cast.filter(c => c && c.name && (c.gender || 'f') !== 'm')
      }
    } catch {}
    if (!parsed) names = String(r[col.yid] || '').split(/[，,]/).map(s => s.trim()).filter(Boolean).map(nm => ({ name: nm, avatar: '' }))
    for (const c of new Map(names.map(n => [n.name, n])).values()) {
      const e = acc.get(c.name) || { avatar: '', count: 0 }
      if (!e.avatar && c.avatar) e.avatar = c.avatar
      e.count += 1
      acc.set(c.name, e)
    }
  }
  return acc
}

/**
 * 列出「需要补头像」的女优：avatar 为空 / 文件不存在 / 文件是来源站占位图。
 * 占位图判定：同一个内容 md5 被 ≥3 位女优共用（来源站对无照片者返回同一张图）。
 * 不用写死哈希，站点换占位图也能识别。
 * @returns {Array<{name:string, count:number, reason:string}>} 按作品数降序
 */
function avatarTodoOf(db, dataDir) {
  const acc = avatarStateOf(db)
  const hashCount = new Map()   // 内容 md5 → 出现次数
  const fileHash = new Map()    // 姓名 → 内容 md5（空串表示文件缺失/读不到）
  for (const [name, e] of acc) {
    if (!e.avatar) continue
    const abs = path.join(dataDir, e.avatar.replace(/\\/g, '/'))
    try {
      const h = crypto.createHash('md5').update(fs.readFileSync(abs)).digest('hex')
      fileHash.set(name, h)
      hashCount.set(h, (hashCount.get(h) || 0) + 1)
    } catch { fileHash.set(name, '') }
  }
  const shared = new Set([...hashCount].filter(([, n]) => n >= 3).map(([h]) => h))
  const todo = []
  for (const [name, e] of acc) {
    if (!e.avatar) { todo.push({ name, count: e.count, reason: '无头像' }); continue }
    const h = fileHash.get(name)
    if (!h) { todo.push({ name, count: e.count, reason: '文件缺失' }); continue }
    if (shared.has(h)) todo.push({ name, count: e.count, reason: '占位图' })
  }
  todo.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
  return todo
}

/** 取该演员当前的头像相对路径（cast_json 里第一个非空），没有则空串 */
function currentAvatarOf(db, name) {
  const res = db.exec('SELECT cast_json FROM movies WHERE cast_json LIKE ?', [`%"name":"${name}"%`])[0]
  if (!res) return ''
  for (const [cj] of res.values) {
    try {
      const hit = (JSON.parse(cj || '[]') || []).find(c => c && c.name === name && c.avatar)
      if (hit) return hit.avatar
    } catch {}
  }
  return ''
}

/**
 * 把某演员在所有影片 cast_json 里的 avatar 写成 relPath。
 * 必须是「所有出现处」——演员页与女优总览都是扫描 cast_json 取第一个非空值，
 * 只改一处会让不同入口显示不同头像。
 * @returns {number} 实际更新的影片条数
 */
function applyAvatarToCast(db, name, relPath) {
  const res = db.exec('SELECT id, cast_json FROM movies')[0]
  if (!res) return 0
  let touched = 0
  for (const [id, cj] of res.values) {
    let cast
    try { cast = JSON.parse(cj || '[]') } catch { continue }
    if (!Array.isArray(cast) || !cast.length) continue
    let changed = false
    for (const c of cast) {
      if (c && c.name === name && c.avatar !== relPath) { c.avatar = relPath; changed = true }
    }
    if (changed) { db.run('UPDATE movies SET cast_json=? WHERE id=?', [JSON.stringify(cast), id]); touched++ }
  }
  return touched
}

/** 图片内容校验：确认下载到的确实是图片（避免把错误页/占位 GIF 当头像存下） */
function looksLikeImage(buf) {
  if (!buf || buf.length < 1200) return false
  const jpeg = buf[0] === 0xFF && buf[1] === 0xD8
  const png = buf[0] === 0x89 && buf[1] === 0x50
  const webp = buf.length > 12 && buf.subarray(8, 12).toString('latin1') === 'WEBP'
  return jpeg || png || webp
}

/**
 * 注册女优相关的 IPC 处理器。
 * @param {Object} ipcMain - Electron ipcMain 对象
 * @param {Object} db - sql.js 数据库实例
 * @param {string} [dataDir] - 数据目录（补全头像时读写 covers/actress）
 */
function registerActressIpc(ipcMain, db, dataDir) {

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

  // IPC: actress:avatarTodo — 列出缺头像的女优（无头像 / 文件缺失 / 占位图）
  ipcMain.handle(IPC.ACTRESS_AVATAR_TODO, () => {
    try {
      if (!dataDir) return { ok: false, error: '未取到数据目录', data: [] }
      return { ok: true, data: avatarTodoOf(db, dataDir) }
    } catch (e) { return { ok: false, error: e.message, data: [] } }
  })

  // IPC: actress:avatarFill — 从 JAVDB 补一位女优的头像（2026-09-24）
  // 由渲染层驱动循环调用（与批量刮削同一套约定），便于逐条显示进度与失败原因
  ipcMain.handle(IPC.ACTRESS_AVATAR_FILL, async (_e, name) => {
    const nm = String(name || '').trim()
    if (!nm) return { ok: false, error: '演员名为空' }
    if (!dataDir) return { ok: false, error: '未取到数据目录' }
    try {
      // 代理与 JAVDB Cookie：与 scraper:scrape 读同一套设置（JAVDB 需代理 + Cookie）
      const st = {}
      try {
        const rs = db.exec(`SELECT key, value FROM settings WHERE key IN ('javdb_cookie','proxy_enabled','proxy_url')`)
        for (const row of (rs[0]?.values || [])) st[row[0]] = row[1]
      } catch {}
      const proxy = st.proxy_enabled === 'y' ? (st.proxy_url || '') : ''
      const cookie = st.javdb_cookie || ''

      const got = await fetchActorAvatar(nm, { proxy, cookie })
      if (!got.ok) return { ok: false, error: got.error }

      // 已有头像文件且扩展名一致 → 直接覆盖它（不留孤儿文件）；否则用 actorId 命名新建
      const cur = currentAvatarOf(db, nm).replace(/\\/g, '/')
      const ext = (got.url.match(/\.(jpg|jpeg|png|webp)$/i) || ['.jpg'])[0]
      const rel = cur && cur.toLowerCase().endsWith(ext) ? cur : `${COVER_DIR}/actress/${got.id}${ext}`
      const abs = path.join(dataDir, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      // 先下到 .tmp、校验后再改名：中途失败不会破坏已有头像
      const tmp = abs + '.tmp'
      await downloadImage(got.url, tmp, `https://javdb.com/actors/${got.id}`, proxy)
      const buf = fs.readFileSync(tmp)
      if (!looksLikeImage(buf)) {
        try { fs.unlinkSync(tmp) } catch {}
        return { ok: false, error: '下载到的不是有效图片' }
      }
      fs.renameSync(tmp, abs)
      const touched = applyAvatarToCast(db, nm, rel)
      persistSoon(db)
      // 女优总览的缓存指纹只看「影片条数 + 最大 id」，改 cast_json 不会让它失效 → 手动清一次，
      // 否则补完后界面最长 60 秒仍显示旧头像
      ovCache.key = ''
      return { ok: true, data: { name: nm, path: rel, movies: touched, actorId: got.id, note: got.note || '' } }
    } catch (e) { return { ok: false, error: e.message } }
  })
}

module.exports = { registerActressIpc }
