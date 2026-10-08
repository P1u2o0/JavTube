/**
 * ============================================================
 * 文件名：playback.js
 * 功能：统一的「打开影片」入口。
 *      2026-09-30 新增设置项 use_builtin_player（是否使用内置播放器）后，
 *      各处的播放入口都改走这里：内置播放器开启 → 跳内置播放页；
 *      关闭 → 把视频交给外部播放器（设置里的「播放器路径」，
 *      留空则由主进程回落到系统默认程序，见 electron/main/ipc-utils.js）。
 *      此前 Library / Favorite / History / 演员影片页 / 详情页 各自 push
 *      '/play/:id'，加了这个开关就必须一处改、处处生效。
 * 依赖：element-plus（ElMessage）、window.api（playVideo IPC）
 * ============================================================
 */
import { ElMessage } from 'element-plus'

/**
 * 播放影片（按设置决定内置播放页还是外部播放器）。
 * @param {Object} m - 影片对象，需含 id（路由用）与 py（视频文件路径）
 * @param {Object} settings - 设置对象（store.settings）
 * @param {Function} push - vue-router 的 push（内置播放页跳转用）
 * @returns {Promise<void>}
 */
export async function playMovie(m, settings, push) {
  if (!m?.py) { ElMessage.warning('该影片未设置视频文件路径'); return }
  // 缺省按「使用内置播放器」处理：老库没有这个键也能正常工作
  const builtin = (settings?.use_builtin_player ?? 'y') !== 'n'
  if (builtin) { push(`/play/${m.id}`); return }
  const r = await window.api?.playVideo(m.py).catch(() => null)
  if (!r || !r.ok) ElMessage.error(r?.error || '无法通过外部播放器打开该影片')
}
