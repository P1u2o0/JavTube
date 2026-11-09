/**
 * @file video-gate.js
 * @module electron/main/video-gate
 * @description 库内视频路径闸门（2026-11-09 P2 审计新增）。
 *
 * 背景：javtube-media:// 协议与 mpv 的 loadfile/start 原先只做「扩展名是视频」校验，
 *       任意绝对路径都能读到字节。渲染层一旦被注入（刮削回来的 HTML/标签等不可信内容），
 *       这就是「读本机任意文件」的口子。本模块把可读/可播的文件收敛到
 *       「movies 表 py 字段里登记过的那些路径」—— 应用自己只会播库内影片，
 *       收紧不影响任何正常功能。
 *
 * 缓存策略：py 集合做成带 TTL 的惰性缓存 ——
 *   · 命中 → 直接放行（<video> 的 Range 请求高频，不能每请求全表扫描）；
 *   · 未命中 → 先强制重建一次再判（新导入影片的 py 还没进 TTL 缓存时，第一次请求也能过）；
 *     重建带 1s 冷却，防止恶意刷「必然未命中」的路径把进程拖死。
 *
 * 另含 normPath()：Windows 路径归一化（大小写/斜杠/\\?\ 前缀），从 dup-scan.js
 * 迁来共用 —— 「库内占用判断」「媒体闸门」两处必须用同一套归一化口径，否则一个闸门
 * 认得出、另一个认不出，等于白做。
 * @dependencies path
 * @keyAPI normPath(), createVideoGate()
 */

const path = require('path')

/** py 集合缓存的 TTL（ms）：超过后下一个请求触发重建 */
const CACHE_TTL_MS = 15000
/**
 * 「未命中后强制重建」的冷却（ms）。
 * 重建本身廉价（sql.js 内存表全扫，万行约 1ms），冷却只为防「必然未命中」的恶意刷请求
 * 把主进程拖死；取 150ms 是让「导入影片后立刻播放」这种合法未命中几乎不会被上一笔
 * 未命中卡住（1s 会误伤，实测单测里两笔未命中间隔 <1s 就被挡）。
 */
const MISS_REBUILD_COOLDOWN_MS = 150

/**
 * 路径归一化，用于「这是不是库内那个文件」的比对。
 * 为什么必须做：Windows 路径不区分大小写，UNC 前缀、`/` 与 `\`、`\\?\` 长路径前缀都可能不同，
 * 而库里存的是导入时的原始写法 —— 直接字符串比对会被一次大小写差异绕过。
 * @param {string} p - 任意路径
 * @returns {string} 归一化后的比较键
 */
function normPath(p) {
  let s = String(p || '').trim()
  if (!s) return ''
  try { s = path.win32.normalize(s) } catch { /* 非法路径就按原样比 */ }
  return s
    .replace(/^\\\\\?\\UNC\\/, '\\\\')   // 设备路径形式的 UNC：\\?\UNC\server\share → \\server\share
    .replace(/^\\\\\?\\/, '')            // 设备路径形式：\\?\C:\... → C:\...
    .replace(/\//g, '\\')
    .toLowerCase()
}

/**
 * 创建库内视频路径闸门。
 * @param {Object} db - sql.js 数据库实例
 * @returns {function(string): boolean} isKnownVideo(absPath) —— 是否是 movies 表登记过的视频
 */
function createVideoGate(db) {
  let cache = null          // Set<归一化 py>
  let cacheAt = 0
  let lastMissRebuild = 0

  function rebuild() {
    const s = new Set()
    try {
      const r = db.exec('SELECT py FROM movies')[0]
      if (r) for (const v of r.values) {
        const k = normPath(v[0])
        if (k) s.add(k)
      }
    } catch { /* 读不到库 → 空集合，全部拒绝（fail-closed，宁可播不了也不放行库外路径） */ }
    cache = s
    cacheAt = Date.now()
  }

  return function isKnownVideo(absPath) {
    const key = normPath(absPath)
    if (!key) return false
    if (!cache || Date.now() - cacheAt > CACHE_TTL_MS) rebuild()
    if (cache.has(key)) return true
    // 未命中：可能是「刚导入、py 还没进 TTL 缓存」→ 强制重建一次再判（带冷却）
    if (Date.now() - lastMissRebuild > MISS_REBUILD_COOLDOWN_MS) {
      lastMissRebuild = Date.now()
      rebuild()
    }
    return cache.has(key)
  }
}

module.exports = { normPath, createVideoGate }
