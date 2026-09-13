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

      // 影片是否与画像有交集（任一类匹配即算）
      const hitInterest = (m) => {
        if (splitMulti(m.bq).some(t => tagFreq.has(t))) return true
        if (splitMulti(m.xl).some(s => seriesSet.has(s))) return true
        if (splitMulti(m.yid).some(a => actressSet.has(a))) return true
        return false
      }

      // === 红区：同类影片随机 5 部（排除近期观看过的）===
      // 会话级缓存：本轮应用运行期间固定同一批（用户要求「每次打开软件挑选一次」，
      // 软件内切换页面回到首页时不重新随机）；重启应用后模块重载即重新挑选。
      if (!heroCache) {
        // 只取「同类且未近期观看」的影片；不足 5 部时按实际数量返回，
        // 由首页按固定槽位渲染并留出空位（不用无关影片补足，避免推荐失真）
        const pool = all.filter(m => !recentIds.has(m.id) && hitInterest(m))
        heroCache = sample(pool, HERO_COUNT)
      }
      const hero = heroCache

      // === 绿区：全库标签按出现频率取前 5（不基于用户画像），优先 4 字以内；
      //          每个类别随机挑一部有封面的影片作背景图（单张）===
      const allTagFreq = new Map()
      for (const m of all) {
        for (const t of splitMulti(m.bq)) {
          allTagFreq.set(t, (allTagFreq.get(t) || 0) + 1)
        }
      }
      const topTags = [...allTagFreq.entries()]
        .filter(([t]) => t.length <= 4)   // 4 字以内（标签名用于卡片显示）
        .sort((a, b) => b[1] - a[1])
        .slice(0, CATEGORY_COUNT)
      const categories = topTags.map(([tag, count]) => {
        const members = all.filter(m => splitMulti(m.bq).includes(tag) && m.cover)
        const bg = sample(members, 1)[0]   // 随机一部有封面的作背景
        return {
          tag,
          count,
          cover: bg ? { id: bg.id, cover: bg.cover, pm: bg.pm } : null
        }
      })

      // === 蓝区：与画像无交集的影片（不常看），按添加时间倒序取 8 ===
      // 不足 8 部时用「其余影片按添加时间倒序」补足——避免库较小时该区域空白
      // （语义仍是「近期上新」，补足项即最新添加的影片）
      // 不足 8 部时按实际数量返回，首页留出空位（不补足无关影片）
      const arrivals = all
        .filter(m => !hitInterest(m))
        .sort((a, b) => String(b.tjrq || '').localeCompare(String(a.tjrq || '')))
        .slice(0, ARRIVAL_COUNT)

      return { ok: true, data: { hero, categories, arrivals, recentCount: recent.length } }
    } catch (e) {
      return { ok: false, error: e.message, data: { hero: [], categories: [], arrivals: [], recentCount: 0 } }
    }
  })
}

module.exports = { registerHomeIpc }
