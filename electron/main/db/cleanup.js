/**
 * @file cleanup.js
 * @module electron/main/db/cleanup
 * @description 影片记录删除后的本地图片清理（2026-09-29 审计新增）。
 *
 * 背景：删除影片 / 清空数据库原先只删 movies 行，本地图片（covers/<番号>.jpg、
 *       covers/previews/<番号>-N.jpg、covers/actress/<id>.jpg）全部留在磁盘上 ——
 *       只增不减，时间一长会累积大量永远不再被引用的孤儿文件。
 *
 * 安全约束（必须同时满足，否则宁可不删）：
 *   ① **只删删除后不再被任何影片引用的文件**：先收集被删影片的引用，等 DB 删除完成后
 *      重算「剩余影片的引用集合」，只在候选文件不落在其中时才删；
 *   ② **只删 covers/ 目录内的文件**：用 path.resolve + 前缀校验，拒绝 `..` 目录穿越；
 *   ③ 删文件失败一律 try/catch 吞掉，绝不影响删库本身的结果。
 *
 * 用法（顺序很重要 —— 引用必须趁影片行还在时收集）：
 *   const refs = collectMovieRefs(db, ids)   // 删库前
 *   db.run('DELETE FROM movies WHERE id IN (...)')
 *   const cleaned = purgeUnreferenced(db, dataDir, refs)   // 删库后
 *
 * @dependencies fs, path, ../constants
 * @keyAPI collectMovieRefs(), collectAllRefs(), purgeUnreferenced()
 */

const fs = require('fs')
const path = require('path')
// 封面图片子目录名（只有此目录内的文件允许被本模块删除）
const { COVER_DIR } = require('../constants')

/** 统一为「正斜杠相对路径」，与库内 cover/previews/avatar 的存储口径一致 */
function normRel(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * 文件是否位于 `<dataDir>/covers/` 之内（path.resolve + 前缀校验，防目录穿越）。
 * @param {string} dataDir
 * @param {string} rel - 相对路径
 * @returns {boolean}
 */
function underCovers(dataDir, rel) {
  const root = path.resolve(dataDir, COVER_DIR)
  const abs = path.resolve(dataDir, rel)
  return abs === root || abs.startsWith(root + path.sep)
}

/**
 * 从查询结果行（[cover, previews, cast_json]）里收集全部图片引用。
 *
 * 有意**不**纳入 `actress` 表的 `img` 字段：该字段原由「女优管理页」经文件选择对话框
 * 写入用户任意选择的绝对路径，应用自身从不写 `covers/` 下的路径。该来源页面与其专用
 * 对话框通道已一并移除（2026-09-29），`actress` 表暂无 UI 消费方，故纳入「剩余引用集合」
 * 收益≈0（它永远不会与被删影片的候选文件相交）。
 * 注：纳入并不会越界删除（候选文件本身已被 underCovers 门控），只是无意义。
 * @param {Array<Array>} values - db.exec 的 values
 * @returns {Set<string>} 归一化后的相对路径集合
 */
function collectRefsFromValues(values) {
  const set = new Set()
  for (const [cover, previewsJson, castJson] of values) {
    if (cover) set.add(normRel(cover))
    try {
      for (const p of (JSON.parse(previewsJson || '[]') || [])) if (p) set.add(normRel(p))
    } catch {}
    try {
      for (const c of (JSON.parse(castJson || '[]') || [])) if (c && c.avatar) set.add(normRel(c.avatar))
    } catch {}
  }
  return set
}

/**
 * 收集指定影片（id 列表）引用的图片路径。**必须在删除这些影片行之前调用**。
 * @param {Object} db - sql.js 数据库实例
 * @param {number[]} ids
 * @returns {Set<string>}
 */
function collectMovieRefs(db, ids) {
  const list = (ids || []).map(Number).filter(Number.isFinite)
  if (!list.length) return new Set()
  const r = db.exec(
    `SELECT cover, previews, cast_json FROM movies WHERE id IN (${list.map(() => '?').join(',')})`,
    list
  )[0]
  return r ? collectRefsFromValues(r.values) : new Set()
}

/**
 * 收集全库所有影片引用的图片路径。用于「清空数据库」前收集候选。
 * @param {Object} db
 * @returns {Set<string>}
 */
function collectAllRefs(db) {
  const r = db.exec('SELECT cover, previews, cast_json FROM movies')[0]
  return r ? collectRefsFromValues(r.values) : new Set()
}

/**
 * 删除候选文件中「已不再被任何影片引用」的那些。**必须在影片行已删除后调用**。
 * @param {Object} db - sql.js 数据库实例（此时应已是删除后的状态）
 * @param {string} dataDir
 * @param {Set<string>} candidates - 被删影片曾引用的图片相对路径集合
 * @returns {number} 实际删除的文件数
 */
function purgeUnreferenced(db, dataDir, candidates) {
  let cleaned = 0
  if (!dataDir || !candidates || !candidates.size) return cleaned
  // 剩余影片的引用集合（cover + previews + 演员头像）
  const r = db.exec('SELECT cover, previews, cast_json FROM movies')[0]
  const remaining = r ? collectRefsFromValues(r.values) : new Set()
  for (const rel of candidates) {
    if (remaining.has(rel)) continue        // 仍被其它影片引用 → 保留
    if (!underCovers(dataDir, rel)) continue // 不在 covers/ 内（含目录穿越）→ 拒绝
    try {
      const abs = path.resolve(dataDir, rel)
      if (fs.existsSync(abs)) { fs.unlinkSync(abs); cleaned++ }
    } catch { /* 删文件失败不影响删库结果 */ }
  }
  return cleaned
}

module.exports = { collectMovieRefs, collectAllRefs, purgeUnreferenced, underCovers }
