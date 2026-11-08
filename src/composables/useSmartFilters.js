/**
 * ============================================================
 * 文件名：useSmartFilters.js
 * 功能：把「当前筛选」存成命名的收藏夹（智能收藏夹，2026-11-08）。
 *
 * 存什么：标签组合（tagSelected）、搜索词（searchQ）、排序（sort）。
 *   —— 不含路由筛选（actress/director/studio/series）：那些来自"从详情页跳进来"的临时条件，
 *      存下来会在下次应用时叠加出空集。需要的话用标签/搜索词就够了。
 * 存哪：settings 表的 `smart_filters`（JSON 字符串）。复用现成的 getSettings / updateSettingsBatch，
 *   不新增 IPC 通道 —— 设置读写本来就是这条链路。
 * ============================================================
 */
import { ref } from 'vue'

/** 收藏夹列表：[{ id, name, tagSelected, searchQ, sort }] */
export const smartFilters = ref([])
/** 是否已从设置里读过（避免每页重复拉） */
let loaded = false

/** 从设置里读收藏夹（幂等：读过就不再拉） */
export async function loadSmartFilters(force = false) {
  if (loaded && !force) return smartFilters.value
  try {
    const r = await window.api?.getSettings?.()
    const raw = r?.ok ? r.data?.smart_filters : ''
    const arr = raw ? JSON.parse(raw) : []
    smartFilters.value = Array.isArray(arr) ? arr.filter(f => f && f.id && f.name) : []
  } catch (e) {
    console.warn('[smart-filters] 读取失败:', e?.message || e)
    smartFilters.value = []
  }
  loaded = true
  return smartFilters.value
}

/** 写回设置 */
async function persist() {
  try {
    await window.api?.updateSettingsBatch?.({ smart_filters: JSON.stringify(smartFilters.value) })
  } catch (e) {
    console.warn('[smart-filters] 保存失败:', e?.message || e)
  }
}

/**
 * 从当前 store 状态抓一份快照。
 * @param {Object} store - useMoviesStore
 * @returns {{tagSelected: string[][], searchQ: string, sort: Object}}
 */
export function captureFilter(store) {
  return {
    tagSelected: JSON.parse(JSON.stringify(store.tagSelected || [])),
    searchQ: store.searchQ || '',
    sort: JSON.parse(JSON.stringify(store.sort || { by: 'tjrq', order: 'DESC', random: false }))
  }
}

/** 当前筛选是否"有内容"（全是空的就没必要存） */
export function hasFilter(store) {
  const n = (store.tagSelected || []).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0)
  return n > 0 || !!String(store.searchQ || '').trim()
}

/** 保存一份新收藏夹（同名覆盖） */
export async function saveSmartFilter(store, name) {
  const nm = String(name || '').trim()
  if (!nm) return { ok: false, error: '名字不能为空' }
  const snap = captureFilter(store)
  const exist = smartFilters.value.find(f => f.name === nm)
  if (exist) {
    Object.assign(exist, snap)
  } else {
    smartFilters.value = [{ id: `${Date.now()}`, name: nm, ...snap }, ...smartFilters.value]
  }
  await persist()
  return { ok: true }
}

/** 删除一份收藏夹 */
export async function removeSmartFilter(id) {
  smartFilters.value = smartFilters.value.filter(f => f.id !== id)
  await persist()
  return { ok: true }
}

/**
 * 把收藏夹写回 store（调用方负责随后重新加载列表）。
 * @param {Object} store
 * @param {Object} f - 收藏夹条目
 */
export function applySmartFilter(store, f) {
  if (!f) return
  store.tagSelected = JSON.parse(JSON.stringify(f.tagSelected || []))
  store.searchQ = f.searchQ || ''
  store.sort = JSON.parse(JSON.stringify(f.sort || { by: 'tjrq', order: 'DESC', random: false }))
  store.page = 1
}

/** 一句话摘要：标签数 + 搜索词（下拉里显示，便于区分同名筛选） */
export function summarize(f) {
  const n = (f?.tagSelected || []).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0)
  const parts = []
  if (n) parts.push(`${n} 个标签`)
  if (f?.searchQ) parts.push(`搜「${f.searchQ}」`)
  if (f?.sort?.random) parts.push('随机')
  return parts.join(' · ') || '全部影片'
}
