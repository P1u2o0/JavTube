/**
 * @file util.js
 * @module electron/main/db/util
 * @description sql.js 数据库层的通用小工具。
 *              rows / firstRow / firstScalar 负责查询结果到 JS 对象的转换；
 *              nowLocal 生成项目统一的本地时间格式（YYYY-MM-DD HH:mm:ss，
 *              与 movies.tjrq 字段既有数据格式一致）；
 *              persist 封装「写库后立即落盘」的重复模式（原以
 *              if (db._forceSave) db._forceSave() 形式散落在各 IPC handler 中）。
 * @keyAPI rows(), firstRow(), firstScalar(), nowLocal(), persist()
 */

/**
 * 将 sql.js 查询结果（{columns, values} 格式）转换为对象数组。
 * @param {Object} r - sql.js exec 返回的结果对象，包含 columns 和 values
 * @returns {Object[]} 对象数组，每个对象的键为列名，值为对应数据
 */
function rows(r) {
  if (!r || !r.values || !r.values.length) return []
  return r.values.map(row => {
    const o = {}
    for (let i = 0; i < r.columns.length; i++) o[r.columns[i]] = row[i]
    return o
  })
}

/**
 * 获取查询结果的第一行（转换为对象）。
 * @param {Object} r - sql.js 查询结果
 * @returns {Object|undefined} 第一行数据对象，无结果时返回 undefined
 */
function firstRow(r) { return rows(r)[0] }

/**
 * 获取查询结果的第一个标量值（第一行第一列）。
 * @param {Object} r - sql.js 查询结果
 * @returns {*} 第一个值，无结果时返回 undefined
 */
function firstScalar(r) { return r?.values?.[0]?.[0] }

/**
 * 生成当前时间的 ISO 格式字符串（本地时间，精确到秒）。
 * 格式：YYYY-MM-DD HH:mm:ss（与 movies.tjrq 字段既有数据格式一致）
 * @returns {string} 格式化的时间字符串
 */
function nowLocal() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')  // 补零函数
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 写库后立即持久化到磁盘。
 * sql.js 为内存数据库，依赖 _forceSave（见 init.js）将内存数据导出写盘。
 * 统一收口原先散落在各 IPC handler 中的 if (db._forceSave) db._forceSave() 写法，
 * 行为与原写法完全一致（_forceSave 不存在时静默跳过）。
 * @param {Object} db - sql.js 数据库实例（带 init.js 附加的 _forceSave 方法）
 */
function persist(db) {
  if (db._forceSave) db._forceSave()
}

/**
 * 延迟持久化（2026-09-11 从 movies.js 提升为公共工具）。
 * persist 内部的 db.export() 是整库同步导出，在 IPC handler 内同步执行会
 * 阻塞主进程事件循环，拖慢并发请求与交互响应（表现为播放/点击卡顿）。
 * persistSoon 立即返回、把落盘推迟到本轮事件循环之后；崩溃窗口为毫秒级，
 * 且 init.js 的 10 秒定时持久化可兜底。
 *
 * 2026-09-21 增强：**合并短时间内的多次落盘**。
 * 原实现是 setImmediate(每次调用各导出一次整库)，于是批量操作（批量刮削会逐部
 * updateMovie、批量加标签/收藏等）在一两百毫秒内能触发十几次「整库导出 + 写盘 +
 * 两次 rename」，主进程被反复同步阻塞 → 界面明显卡顿。
 * 现改为「前缘节流」：距上次落盘已超过 120ms 时仍然**立即**落盘（单次写延迟不变），
 * 窗口内的后续写合并为窗口结束时的一次 —— 突发写从 N 次导出降到 1~2 次。
 * @param {Object} db - sql.js 数据库实例
 */
const PERSIST_WINDOW_MS = 120
let lastPersistAt = 0
let persistTimer = null

function persistSoon(db) {
  const wait = PERSIST_WINDOW_MS - (Date.now() - lastPersistAt)
  if (wait <= 0) {                    // 距上次落盘足够久：立即落盘，保持原有的"毫秒级"语义
    lastPersistAt = Date.now()
    try { persist(db) } catch {}
    return
  }
  if (persistTimer) return          // 已在合并窗口内：本次写由窗口结束时的那次落盘一并覆盖
  persistTimer = setTimeout(() => {
    persistTimer = null
    lastPersistAt = Date.now()
    try { persist(db) } catch {}
  }, wait)
}

module.exports = { rows, firstRow, firstScalar, nowLocal, persist, persistSoon }
