/**
 * @file home.js
 * @module electron/main/home
 * @description 首页推荐数据（2026-09-13 新增）。
 *
 * 三块数据（2026-09-13 重构）：
 *   - hero：基于近期观看兴趣画像的同类影片，随机 5 部 → 首页轮播（会话级缓存）
 *   - categories：**全库**标签按出现频率取前 5（不基于用户画像），优先 4 字以内；
 *                 每个类别随机挑一部有封面的影片作背景图（单张，非拼图）
 *   - arrivals：与画像无交集的影片（不常看的类别/系列/女优），按添加时间倒序取 8
 *
 * 实现说明：影片量级为本地库（数十~数千条），直接全表取出在 JS 中分组计算，
 * 比构造多条 SQL 更直观且便于维护；如需扩展到十万级再改 SQL 聚合。
 *
 * @dependencies ../../common/ipc-channels, ./db/util
 */

const IPC = require('../common/ipc-channels')
const { rows } = require('./db/util')

// 近期观看取用的条数（构建兴趣画像的样本量）
const RECENT_LIMIT = 20
// 首页三块的数量
const HERO_COUNT = 5
const CATEGORY_COUNT = 5
const ARRIVAL_COUNT = 8
// 轮播影片会话级缓存（首次调用生成，应用运行期间保持；重启后重新随机）
let heroCache = null

/**
 * 从多值字段中拆分出条目数组。
 * @param {string} v - 字段值（中文/英文逗号分隔）
 * @returns {string[]} 去空后的数组
 */
function splitMulti(v) {
  return String(v || '').split(/[，,]/).map(s => s.trim()).filter(Boolean)
}

/**
 * 从数组中随机抽取 n 个（不重复；不足时返回全部）。
 * @param {Array} arr - 源数组
 * @param {number} n - 抽取数量
 * @returns {Array} 抽取结果
 */
function sample(arr, n) {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {   // Fisher-Yates 洗牌
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

/**
 * 校验是否为「恰好两个汉字」的标签（首页类别按钮只从这类标签中挑选）。
 * @param {string} t - 标签
 * @returns {boolean}
 */
function isTwoCharTag(t) {
  return /^[\u4e00-\u9fa5]{2}$/.test(String(t || ''))
}

/**
 * 注册首页推荐的 IPC 处理器。
 * @param {Object} ipcMain - Electron ipcMain 对象
 * @param {Object} db - sql.js 数据库实例
 */
function registerHomeIpc(ipcMain, db) {
  // IPC: home:recommend — 渲染进程 → 主进程
  // 返回 { hero, categories, arrivals }，见文件头说明
  ipcMain.handle(IPC.HOME_RECOMMEND, () => {
    try {
      const all = rows(db.exec(
        `SELECT id, ph, pm, cover, bq, xl, yid, yy, fl, pfs, tjrq, play_time, play_count
         FROM movies`
      )[0])

      // === 预处理：把每部影片的多值字段（标签/系列/女优）预先拆好缓存 ===
      // 原实现对同一字段反复 splitMulti：hitInterest 被调 2n 次、categories
      // 又对每个候选标签各扫一遍全表，合计约 12n 次字符串拆分 —— 库大时首页明显变慢。
      // 这里一次性拆好，后续全部复用。
      const prepared = all.map(m => ({
        m,
        tags: splitMulti(m.bq),
        series: splitMulti(m.xl),
        actresses: splitMulti(m.yid)
      }))

      // === 近期观看：按播放时间倒序取最近 N 部 ===
      const recent = all
        .filter(m => m.play_time)
        .sort((a, b) => String(b.play_time).localeCompare(String(a.play_time)))
        .slice(0, RECENT_LIMIT)

      // === 兴趣画像：标签 / 系列 / 女优 的权重表 ===
      const tagFreq = new Map()      // 标签 → 近期观看中出现次数
      const seriesSet = new Set()
      const actressSet = new Set()
      const recentIds = new Set(recent.map(m => m.id))
      for (const m of recent) {
        for (const t of splitMulti(m.bq)) tagFreq.set(t, (tagFreq.get(t) || 0) + 1)
        for (const s of splitMulti(m.xl)) seriesSet.add(s)
        for (const a of splitMulti(m.yid)) actressSet.add(a)
      }

      // 影片是否与画像有交集（任一类匹配即算）—— 复用预处理结果，不再重复 split
      const hitInterest = (p) => {
        if (p.tags.some(t => tagFreq.has(t))) return true
        if (p.series.some(s => seriesSet.has(s))) return true
        if (p.actresses.some(a => actressSet.has(a))) return true
        return false
      }

      // === 红区：轮播 5 部 ===
      // 分层挑选，**尽量凑满 HERO_COUNT 部**（只有库本身不足 5 部时才会少于 5）：
      //   ① 未近期观看 ∩ 有共同兴趣   ② 未近期观看
      //   ③ 有共同兴趣                ④ 全部影片
      // 旧实现只取「第一个非空的池子」，池子只有 3 部就直接给 3 部 ——
      // 前端 5 个槽位因此露出 2 个空位占位图（用户反馈的「有海报却还有粉红占位」根因之一）。
      // 会话级缓存：应用运行期间固定同一批（每次打开软件挑选一次）；重启后重新随机。
      if (!heroCache) {
        const tiers = [
          prepared.filter(p => !recentIds.has(p.m.id) && hitInterest(p)),
          prepared.filter(p => !recentIds.has(p.m.id)),
          prepared.filter(p => hitInterest(p)),
          prepared
        ]
        const picked = []
        const pickedIds = new Set()
        for (const tier of tiers) {
          if (picked.length >= HERO_COUNT) break
          const rest = tier.filter(p => !pickedIds.has(p.m.id))
          for (const p of sample(rest, HERO_COUNT - picked.length)) {
            picked.push(p.m)
            pickedIds.add(p.m.id)
          }
        }
        heroCache = picked
      }
      const hero = heroCache
      const heroIds = new Set(hero.map(m => m.id))

      // === 绿区：全库标签按出现频率取前 5（不基于用户画像），优先 4 字以内；
      //          每个类别随机挑一部有封面的影片作背景图（单张）===
      const allTagFreq = new Map()
      for (const p of prepared) {
        for (const t of p.tags) {
          allTagFreq.set(t, (allTagFreq.get(t) || 0) + 1)
        }
      }
      const topTags = [...allTagFreq.entries()]
        .filter(([t]) => t.length <= 4)   // 4 字以内（标签名用于卡片显示）
        .sort((a, b) => b[1] - a[1])
        .slice(0, CATEGORY_COUNT)
      // 一次遍历同时收集「每个候选标签下、有封面的影片」
      // （原实现是 topTags.map 里对每个标签再 all.filter 一遍 → 5n 次 split + 遍历）
      const topTagSet = new Set(topTags.map(([t]) => t))
      const tagMembers = new Map()
      for (const p of prepared) {
        if (!p.m.cover) continue
        for (const t of p.tags) {
          if (!topTagSet.has(t)) continue
          let list = tagMembers.get(t)
          if (!list) { list = []; tagMembers.set(t, list) }
          list.push(p.m)
        }
      }
      // 背景海报去重：优先挑没被前面类别用过的封面。
      // 三级兜底 —— 否则 5 个类别很容易撞同一张图（用户反馈「中出 / 巨乳」背景完全一样）：
      //   ① 本类别里没被用过的封面
      //   ② 全库其它影片里没被用过的封面（背景属装饰性，标签文字才是语义主体）
      //   ③ 实在无新图可挑才允许重复
      const allCovered = prepared.filter(p => p.m.cover).map(p => p.m)
      const usedCovers = new Set()
      const categories = topTags.map(([tag, count]) => {
        const members = tagMembers.get(tag) || []
        const bg =
          sample(members.filter(m => !usedCovers.has(m.cover)), 1)[0] ||
          sample(allCovered.filter(m => !usedCovers.has(m.cover)), 1)[0] ||
          sample(members, 1)[0]
        if (bg) usedCovers.add(bg.cover)
        return {
          tag,
          count,
          cover: bg ? { id: bg.id, cover: bg.cover, pm: bg.pm } : null
        }
      })

      // === 蓝区：近期上新 —— 4 列 × 2 行共 8 部 ===
      // ① 优先「与画像无交集」（不常看的）；② 不足 8 部时用**其余影片按添加时间倒序**补足。
      // 旧实现只做 ①，库里 7 部全命中画像时就返回 0 部，整块变成 8 个空位占位图
      // —— 用户要求「有符合条件的影片就显示出来，只有影片数量不足的位置才留占位」。
      const byNewest = (list) => list
        .slice()
        .sort((a, b) => String(b.m.tjrq || '').localeCompare(String(a.m.tjrq || '')))
      const arrivalsPicked = []
      const arrivalIds = new Set()
      const pushFrom = (list) => {
        for (const p of list) {
          if (arrivalsPicked.length >= ARRIVAL_COUNT) return
          if (arrivalIds.has(p.m.id)) continue
          arrivalsPicked.push(p.m)
          arrivalIds.add(p.m.id)
        }
      }
      pushFrom(byNewest(prepared.filter(p => !hitInterest(p))))                  // ① 不常看的
      pushFrom(byNewest(prepared.filter(p => !heroIds.has(p.m.id))))             // ② 其余最新添加（不与轮播重复）
      pushFrom(byNewest(prepared))                                              // ③ 还不够就把轮播那几部也用上
      const arrivals = arrivalsPicked

      return { ok: true, data: { hero, categories, arrivals, recentCount: recent.length } }
    } catch (e) {
      return { ok: false, error: e.message, data: { hero: [], categories: [], arrivals: [], recentCount: 0 } }
    }
  })
}

module.exports = { registerHomeIpc }
