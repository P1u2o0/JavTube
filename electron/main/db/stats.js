/**
 * @file stats.js
 * @module electron/main/db/stats
 * @description 观影统计聚合（2026-11-08）。一次 IPC 返回前端要展示的全部数字，
 *              避免页面发十几条查询。
 *
 * 数据来源只有 movies 表：
 *   play_count（观看次数）/ duration（分钟）/ play_time（最近播放时间）/ cl（收藏）/ bq（标签）/ yid（演员）
 *
 * 注意「估算观看时长」= Σ(play_count × duration)：
 *   库里没有逐次观看的时长记录（play_pos 只存"最近一次的进度"），这是唯一能算出的近似值，
 *   前端会明确标注「估算」。
 */
const IPC = require('../../common/ipc-channels')
const { rows, firstScalar } = require('./util')

/** 把「，/ ,」分隔的多值字段拆成数组 */
const splitMulti = (v) => String(v || '').split(/[，,]/).map(s => s.trim()).filter(Boolean)

/**
 * 注册统计 IPC。
 * @param {Object} ipcMain - Electron ipcMain
 * @param {Object} db - sql.js 数据库实例
 */
function registerStatsIpc(ipcMain, db) {
  ipcMain.handle(IPC.STATS_GET, () => {
    try {
      const all = rows(db.exec(
        `SELECT bq, yid, play_count, duration, play_time, cl, play_pos, play_dur FROM movies`
      )[0])

      let fav = 0, watched = 0, plays = 0, minutes = 0, inProgress = 0
      const actressCount = new Map()
      const tagCount = new Map()
      const monthCount = new Map()

      for (const m of all) {
        const pc = Number(m.play_count) || 0
        const dur = Number(m.duration) || 0
        if (m.cl === 'y') fav++
        if (m.play_time) {
          watched++
          const key = String(m.play_time).slice(0, 7)     // YYYY-MM
          if (/^\d{4}-\d{2}$/.test(key)) monthCount.set(key, (monthCount.get(key) || 0) + 1)
        }
        plays += pc
        minutes += pc * dur
        // 未看完（进度 3%~95%）
        const pos = Number(m.play_pos) || 0
        const pd = Number(m.play_dur) || 0
        if (pos > 0 && pd > 0 && pos / pd >= 0.03 && pos / pd <= 0.95) inProgress++

        // 权重：看过 N 次就算 N 票（没看过的算 1 票，保证"库里有多少部"仍有意义）
        const w = Math.max(1, pc)
        for (const a of splitMulti(m.yid)) actressCount.set(a, (actressCount.get(a) || 0) + w)
        for (const t of splitMulti(m.bq)) tagCount.set(t, (tagCount.get(t) || 0) + w)
      }

      const top = (map, keyName, limit = 10) => [...map.entries()]
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
        .slice(0, limit)
        .map(([k, v]) => ({ [keyName]: k, count: v }))

      // 最近 12 个月的观看数（含没有记录的月份 → 补 0，柱状图不会缺格）
      const months = []
      const now = new Date()
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        months.push({ m: key, count: monthCount.get(key) || 0 })
      }

      const total = Number(firstScalar(db.exec('SELECT COUNT(*) FROM movies')[0])) || 0
      return {
        ok: true,
        data: {
          total, fav, watched, plays,
          minutes: Math.round(minutes),
          inProgress,
          topActress: top(actressCount, 'name'),
          topTags: top(tagCount, 'tag'),
          months
        }
      }
    } catch (e) {
      console.error('[ipc stats:get]', e)
      return { ok: false, error: e.message }
    }
  })
}

module.exports = { registerStatsIpc }
