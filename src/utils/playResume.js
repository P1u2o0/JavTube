/**
 * @file playResume.js
 * @module src/utils
 * @description 「续播点」的内存态 + 导航守卫（2026-10-08，按用户要求重做）。
 *
 * ── 规则（用户明确要求）──────────────────────────────────────────────────────
 *   **只有在播放页里点进「站内其它页（影片详情页 / 演员页）」再返回时才续播**；
 *   回到片库 / 首页这类列表页、从别处重新进入、或关掉软件再打开，都要从头开始。
 *
 * ── 为什么不能拿库里的 movies.play_pos 续播 ─────────────────────────────────
 *   `play_pos` 是**落库**的（跨启动有效），拿它续播就等于「永远记得上次看到哪」，
 *   正好与要求相反。所以续播点只放在这里（模块级 Map，随应用进程存活）。
 *   ⚠️ `play_pos` 仍然照常写入 —— 它只用于「观看记录」，不再驱动续播。
 *
 * ── 怎么判定「站内往返」（靠导航守卫，而不是单看某一条历史）───────────────
 *   只判「上一条历史是不是详情页」是不够的：用户完全可能
 *   `播放页 → 详情页 → 片库 → 详情页 → 播放页`，最后一跳的来路确实是详情页，
 *   但中间已经回过列表页了，按规则应当从头开始。
 *   所以改成**持续约束**：只要导航到「既不是播放页、也不是详情/演员页」的地方，
 *   就把续播点全部清掉。于是续播点只在「播放页 ⇄ 详情/演员页」这条往返路径上存活。
 *
 * @dependencies vue-router（由 installResumeGuard 注入实例）
 */

/** 这些路径属于「站内往返」，进入时**保留**续播点 */
const KEEP_PREFIXES = ['/detail/', '/actor/']
/** 播放页自身也保留（详情页 → 播放页 这一跳不能把点清掉） */
const KEEP_EXACT = ['/play/']

/** @type {Map<number, number>} 影片 id → 续播位置（秒） */
const points = new Map()
let installed = false

/**
 * 记录/更新续播点。播放中高频调用（每次 timeupdate），所以只写内存、不做任何 IPC。
 * @param {number} id - 影片 id
 * @param {number} pos - 当前位置（秒）；非正数忽略
 */
export function setResumePoint(id, pos) {
  const n = Number(id)
  const p = Number(pos)
  if (!n || !(p > 0)) return
  points.set(n, p)
}

/**
 * 取续播点。
 * @param {number} id
 * @returns {number} 位置（秒）；没有记录返回 0
 */
export function getResumePoint(id) {
  return points.get(Number(id)) || 0
}

/** 清掉某部影片的续播点 */
export function clearResumePoint(id) {
  points.delete(Number(id))
}

/** 清掉全部续播点 */
export function clearAllResumePoints() {
  points.clear()
}

/**
 * 安装导航守卫（**整个应用只装一次**，所以放在模块级而不是组件里 ——
 * 组件级注册会在离开播放页时被移除，而那一刻正是需要它判断去向的时候）。
 * @param {import('vue-router').Router} router
 */
export function installResumeGuard(router) {
  if (installed || !router?.afterEach) return
  installed = true
  router.afterEach((to) => {
    const p = String(to?.path || '')
    if (KEEP_EXACT.some(k => p.startsWith(k)) || KEEP_PREFIXES.some(k => p.startsWith(k))) return
    // 去了列表页 / 首页 / 搜索等任何其它地方 → 视为「从播放页完全退出」，续播点作废
    points.clear()
  })
}
