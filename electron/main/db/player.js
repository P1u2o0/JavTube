/**
 * @file player.js
 * @module electron/main/db/player
 * @description 内置播放页的后端（2026-09-29 新增）：
 *   1. 播放进度记忆 —— 存 movies.play_pos / play_dur（秒），关闭页面 / 定时节流写入，
 *      下次进入同一部影片从上次位置续播；
 *   2. 推荐算法 —— 给右侧「相关推荐」栏取 topN：内容信号（同标签/同女优/同系列/同厂商）
 *      + 用户口味画像（近期观看与收藏里的标签、女优频次）+ 质量先验（评分/想看数）
 *      + 多样性惩罚（刚看过的降权），纯本地计算，全表扫描（本地库量级无压力）。
 * @dependencies electron (ipcMain), ./init(sql.js 实例由 index.js 注入), ../common/ipc-channels
 */

const IPC = require('../../common/ipc-channels')
const { rows: rowsRaw, persistSoon } = require('./util')

// db.exec 返回的是结果数组，util.rows 收单个结果对象 —— 在这里统一拆包
const rowsOf = (res) => rowsRaw(res && res[0])

/** 全角/半角逗号、分号都当分隔符（与 home.js 的 splitMulti 同思路） *//** 全角/半角逗号、分号都当分隔符（与 home.js 的 splitMulti 同思路） */
function splitMulti(s) {
  if (!s) return []
  return String(s).split(/[，,;；|/]+/).map(x => x.trim()).filter(Boolean)
}

/**
 * 从 movies 行里提取女优名集合：yid（逗号分隔）+ cast_json 里的女性演员名。
 * 与 actress.js:75-78 的口径一致（gender 'm' 的男优不算）。
 */
function actorNames(row) {
  const set = new Set(splitMulti(row.yid))
  try {
    const cast = row.cast_json ? JSON.parse(row.cast_json) : []
    for (const c of Array.isArray(cast) ? cast : []) {
      if (c && c.name && (c.gender || 'f') !== 'm') set.add(c.name)
    }
  } catch { /* cast_json 损坏不致命，忽略 */ }
  return set
}

/** 把 sql.js 的 exec 结果 zip 成对象数组（复用 util.rows） */

const CAND_COLS = `id, ph, pm, cover, fl, bq, yid, cast_json, xl, ps, fx, dy,
  score, want, watched, duration, tjrq, cl, play_time, play_count`

/**
 * 推荐打分（纯函数，便于将来单测）。
 * @returns {number} 综合分
 */
function scoreCandidate(cur, cand, taste, nowMs) {
  const curTags = cur._tags
  const candTags = cand._tags
  const curActors = cur._actors
  const candActors = cand._actors

  let s = 0
  const why = []

  // ── 内容信号 ─────────────────────────────────────────────
  // 标签：交集数做余弦式归一（两边标签越多，单个重叠的含金量越低）
  let tagHit = 0
  for (const t of candTags) if (curTags.has(t)) tagHit++
  if (tagHit) {
    const denom = Math.sqrt(curTags.size * candTags.size) || 1
    s += 8 * tagHit / denom
    why.push(`${tagHit} 个共同标签`)
  }
  // 女优：最强信号，封顶 2 位（避免多人群星片霸榜）
  const sharedActors = [...candActors].filter(a => curActors.has(a))
  if (sharedActors.length) {
    s += Math.min(sharedActors.length, 2) * 10
    why.push(`同女优：${sharedActors[0]}`)
  }
  // 系列 / 厂商
  const candSeries = new Set(splitMulti(cand.xl))
  if (candSeries.size && [...candSeries].some(x => cur._series.has(x))) { s += 8; why.push('同系列') }
  if ((cand.ps && cand.ps === cur.ps) || (cand.fx && cand.fx === cur.fx)) { s += 2.5; why.push('同厂商') }

  // ── 用户口味画像（近 60 天观看 + 收藏里高频出现的标签/女优）──────────
  let tasteHit = 0
  for (const t of candTags) tasteHit += (taste.tags.get(t) || 0)
  for (const a of candActors) tasteHit += 2 * (taste.actors.get(a) || 0)
  if (tasteHit > 0) {
    s += Math.min(6, tasteHit / 3)
    if (tasteHit >= 3) why.push('猜你喜欢')
  }

  // ── 质量先验 ─────────────────────────────────────────────
  if (cand.score > 0) s += (Math.min(cand.score, 10) / 10) * 2      // JAVDB 评分最多 +2
  if (cand.want > 0) s += Math.min(2, Math.log10(cand.want + 1) / 2) // 想看人数对数封顶 +2

  // ── 多样性 / 去重 ────────────────────────────────────────
  if (cand.play_time) {
    const t = Date.parse(cand.play_time)
    if (Number.isFinite(t)) {
      const days = (nowMs - t) / 86400000
      if (days < 3) s -= 6        // 三天内刚看过：强降权（用户刚看完它/换着看）
      else if (days < 30) s -= 1  // 近一月看过：轻微降权
      if ((cand.play_count || 0) >= 3) s -= 2 // 反复看过的老片降低推荐权重
    }
  }
  // 确定性微扰动（同分时打散次序；用 id 哈希而不用随机，保证同一次打开列表稳定）
  s += ((cand.id * 2654435761) % 97) / 97 * 0.3

  return { s, why }
}

/** 构建用户口味画像：近 60 天观看 + 全部收藏 的标签/女优频次表 */
function buildTaste(db, nowMs) {
  const rows = rowsOf(db.exec(
    `SELECT ${CAND_COLS} FROM movies
     WHERE cl = 'y' OR (play_time IS NOT NULL AND play_time >= ?)`,
    [new Date(nowMs - 60 * 86400000).toISOString()]
  ))
  const tags = new Map()
  const actors = new Map()
  const bump = (map, k, w) => map.set(k, (map.get(k) || 0) + w)
  for (const r of rows) {
    const w = r.cl === 'y' ? 1.5 : 1   // 收藏比观看更能代表口味
    for (const t of splitMulti(r.bq)) bump(tags, t, w)
    for (const a of actorNames(r)) bump(actors, a, w)
  }
  return { tags, actors }
}

/**
 * 注册播放页相关 IPC。
 * @param {Electron.IpcMain} ipcMain
 * @param {object} db - sql.js 数据库实例（init.js 产物）
 */
function registerPlayerIpc(ipcMain, db) {
  // ── 读取播放进度 ─────────────────────────────────────────
  ipcMain.handle(IPC.PLAYER_GET_PROGRESS, (_e, id) => {
    const res = db.exec('SELECT play_pos, play_dur, play_time, play_count FROM movies WHERE id = ?', [Number(id)])
    const r = rowsOf(res)[0]
    if (!r) return { ok: false, error: '影片不存在' }
    return { ok: true, pos: Number(r.play_pos) || 0, dur: Number(r.play_dur) || 0, playTime: r.play_time || '', playCount: Number(r.play_count) || 0 }
  })

  // ── 保存播放进度（播放页节流调用 + 关页前兜底调用）──────────
  ipcMain.handle(IPC.PLAYER_SAVE_PROGRESS, (_e, payload) => {
    const { id, pos, dur } = payload || {}
    if (!id || !Number.isFinite(Number(pos))) return { ok: false, error: '参数不合法' }
    db.run(
      'UPDATE movies SET play_pos = ?, play_dur = ? WHERE id = ?',
      [Math.max(0, Number(pos)), Math.max(0, Number(dur) || 0), Number(id)]
    )
    persistSoon(db)
    return { ok: true }
  })

  // ── 相关推荐 ─────────────────────────────────────────────
  ipcMain.handle(IPC.PLAYER_RECOMMEND, (_e, payload) => {
    const { id, limit = 12 } = payload || {}
    const nowMs = Date.now()
    const cur = rowsOf(db.exec(`SELECT ${CAND_COLS} FROM movies WHERE id = ?`, [Number(id)]))[0]
    if (!cur) return { ok: false, error: '影片不存在' }
    // 预解析当前影片信号（Set 提到循环外）
    cur._tags = new Set(splitMulti(cur.bq))
    cur._actors = actorNames(cur)
    cur._series = new Set(splitMulti(cur.xl))

    const taste = buildTaste(db, nowMs)
    const cands = rowsOf(db.exec(`SELECT ${CAND_COLS} FROM movies WHERE id != ?`, [Number(id)]))
    const scored = []
    for (const c of cands) {
      c._tags = new Set(splitMulti(c.bq))
      c._actors = actorNames(c)
      const { s, why } = scoreCandidate(cur, c, taste, nowMs)
      scored.push({ c, s, why })
    }
    scored.sort((a, b) => b.s - a.s)
    const data = scored.slice(0, Number(limit) || 12).map(({ c, s, why }) => ({
      id: c.id, ph: c.ph, pm: c.pm, cover: c.cover,
      score: c.score, duration: c.duration, want: c.want,
      // 演员名（yid 拆分 + cast_json 里的女优）—— _actors 是 Set，必须转数组后再过 IPC，
      // 否则前端 Array.isArray 判定失败（2026-09-29 实测：Set 能序列化但不是数组）。
      // 播放页推荐项展示演员名（番号、看过人数均不再展示，故不返回 watched）
      actors: Array.from(c._actors),
      rank: Math.round(s * 10) / 10,
      why: why.slice(0, 2).join(' · ') || '同类影片'
    }))
    return { ok: true, data }
  })
}

module.exports = { registerPlayerIpc }
