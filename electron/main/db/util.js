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
 * 生成项目统一的本地时间字符串（本地时间，精确到秒）。
 * 格式：YYYY-MM-DD HH:mm:ss（与 movies.tjrq / movies.play_time 字段的既有数据格式一致）
 * @param {Date} [date] - 指定时间（不传 = 当前时间）。用于生成「N 天前」的阈值字符串，
 *   与库里的本地格式做同格式比较（传 ISO 字符串去比会因 ' '<'T' 在同日误判）
 * @returns {string} 格式化的时间字符串
 */
function nowLocal(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
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
  // 把落盘结果透传出去（2026-09-28 审计）：原来丢弃返回值，调用方无法判断是否真的写下去了 ——
  // 例如 settings:backup 紧接着拷贝磁盘文件，落盘失败时拷到的是上一次成功落盘的旧库，
  // 却仍然提示备份成功。
  if (db._forceSave) return !!db._forceSave()
  return true
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
 *
 * ★ 2026-09-30 性能审计修复：合并窗口改为从「上一次落盘**结束**」开始计时。
 *   原实现在 persist() **之前**就把 lastPersistAt 置为当前时间，而 persist 内部的
 *   db.export() 是整库同步导出，库越大越慢（本项目实测已达秒级）。于是「上一次落盘结束之后」
 *   再调用 persistSoon 时，`Date.now() - lastPersistAt` 已经等于「落盘耗时」这个数千毫秒的大数，
 *   恒 > 120ms → 每次都命中「立即落盘」分支，**合并窗口在秒级写面前完全失效**。
 *   实测后果：批量操作（批刮/批量加标签/收藏）在几百毫秒内逐部写入，每一步都触发一次
 *   「整库导出 + writeFileSync + fsync + 两次 rename」，主进程被反复同步阻塞。
 *   改为以「写完时刻」为基准后，同一突发从 N 次导出降到 1~2 次。
 * @param {Object} db - sql.js 数据库实例
 */
const PERSIST_WINDOW_MS = 120
let lastPersistAt = 0
let persistTimer = null

function persistSoon(db) {
  const wait = PERSIST_WINDOW_MS - (Date.now() - lastPersistAt)
  if (wait <= 0) {                    // 距上次落盘足够久：立即落盘，保持原有的"毫秒级"语义
    try { persist(db) } catch {} finally { lastPersistAt = Date.now() }
    return
  }
  if (persistTimer) return          // 已在合并窗口内：本次写由窗口结束时的那次落盘一并覆盖
  persistTimer = setTimeout(() => {
    persistTimer = null
    try { persist(db) } catch {} finally { lastPersistAt = Date.now() }
  }, wait)
}

/**
 * 从视频文件名解析派生标签（与前端 utils/global.js 的 fileBadgesOf **完全同源**）。
 * 只认文件名里的硬标记，不依赖刮削结果。前后端必须一致，否则会出现
 * 「卡片徽章显示了，但标签筛选栏里没有」或反之的错位。
 * @param {string} py - 视频文件路径
 * @returns {string[]} 标签名数组，如 ['中文字幕','无码破解']
 */
function filenameTagsOf(py) {
  if (!py) return []
  const name = String(py).replace(/\\/g, '/').split('/').pop()
  if (!name) return []
  const stem = name.replace(/\.[A-Za-z0-9]+$/, '')
  const tokens = stem.split(/[-_\s.]+/).map(t => t.toUpperCase()).filter(Boolean)
  const hasTok = (...arr) => tokens.some(t => arr.includes(t))
  const tags = []
  if (hasTok('U', 'UC') || stem.includes('破解')) tags.push('无码破解')
  if (hasTok('C', 'UC')) tags.push('中文字幕')
  if (hasTok('4K')) tags.push('4K')
  return tags
}

module.exports = { rows, firstRow, firstScalar, nowLocal, persist, persistSoon, filenameTagsOf }
