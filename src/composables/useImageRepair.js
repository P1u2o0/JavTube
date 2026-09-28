/**
 * 失效图片（封面 / 预览图）的检查与修复。
 *
 * 设置页的「检查并修复」按钮与启动后的自动检查共用这一段，避免两处逻辑漂移。
 * 修复以**影片**为单位（一次刮削把它缺的封面/预览图都补齐），修好的图写回原来路径，
 * 所以不需要改数据库；修完触发一次数据刷新信号，各列表页按自己的筛选重新拉取，
 * 卡片就会用带版本号的新 URL 重新加载图片（否则浏览器还用着旧的坏图缓存）。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useMoviesStore } from '@/store/movies'
import { bumpCover } from '@/utils/global'

// 这两个状态放在**模块作用域**（而不是函数内）：App.vue 的启动自动检查与设置页按钮
// 各自调用一次 useImageRepair()，若 busy 是每实例的 ref，两者互不可见 → 同一时间可能跑起
// 两条修复循环（重复刮削同一批影片、并发写同名图片文件）。做成模块级单例即天然互斥。
// （2026-09-28 审计）
const busy = ref(false)
const status = ref('')

export function useImageRepair() {

  /**
   * 扫描并修复全库失效图片。
   * @param {Object} [opts]
   * @param {boolean} [opts.silent] - 静默模式（启动自动检查）：没有坏图时完全不打扰
   * @returns {Promise<{bad:number, fixed:number, failed:number}>}
   */
  async function checkAndRepair({ silent = false } = {}) {
    const idle = { bad: 0, fixed: 0, failed: 0 }
    if (busy.value) return idle
    if (!window.api?.scanBrokenImages) return idle
    busy.value = true
    let fixed = 0
    let failed = 0
    let still = 0
    try {
      const s = await window.api.scanBrokenImages().catch(() => null)
      if (!s?.ok) {
        if (!silent) ElMessage.error(s?.error || '检查失效图片失败')
        return idle
      }
      const movies = s.data?.movies || []
      const bad = (s.data?.coverCount || 0) + (s.data?.previewCount || 0)
      if (!movies.length) {
        status.value = '未发现失效图片'
        if (!silent) ElMessage.success('未发现失效图片')
        return idle
      }
      status.value = `发现 ${bad} 张失效图片（${movies.length} 部影片），正在修复…`
      const store = useMoviesStore()
      for (let i = 0; i < movies.length; i++) {
        status.value = `修复中 ${i + 1}/${movies.length}（已修好 ${fixed} 张）`
        const r = await window.api.repairMovieImages(movies[i].id).catch(() => null)
        if (r?.ok) {
          fixed += r.data?.fixed || 0
          still += r.data?.still || 0
          // 让卡片换用带新版本号的图片 URL（同路径新内容，否则用的是旧缓存）
          bumpCover(movies[i].id)
          if (movies[i].ph) bumpCover(movies[i].ph)
        } else failed++
      }
      const tail = []
      if (still) tail.push(`${still} 张源站也取不到（已清理坏文件，可稍后重试）`)
      if (failed) tail.push(`${failed} 部影片刮削失败`)
      status.value = `已修复 ${fixed} 张失效图片${tail.length ? '；' + tail.join('；') : ''}`
      if (fixed) store.requestDataRefresh()
      // 静默模式（启动自动检查）：没修好任何图就不出声，免得每次开机都弹提示
      if (fixed) ElMessage[tail.length ? 'warning' : 'success'](silent ? `已自动修复 ${fixed} 张失效图片` : status.value)
      else if (!silent && tail.length) ElMessage.warning(status.value)
      else if (!silent) ElMessage.success('未发现失效图片')
      return { bad, fixed, failed }
    } finally {
      busy.value = false
    }
  }

  return { busy, status, checkAndRepair }
}
