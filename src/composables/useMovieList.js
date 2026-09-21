/**
 * ============================================================
 * 文件名：useMovieList.js
 * 功能：影片列表页（Library / Favorite / History）的公共交互逻辑。
 *      此前 onToggle（批量模式切换选中）在三个视图中逐字重复，
 *      翻页处理（改页码 → 重载 → 回顶）也是同一模式仅加载参数不同，
 *      收敛为一个组合式函数，行为与各视图原实现完全一致。
 * 依赖：vue-router（useRouter）、@/store/movies
 * ============================================================
 */
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { safeCall, buildScrapeUpdate, bumpCover, statsFillHint } from '@/utils/global'
import { useScrapeStore } from '@/store/scrape'

/**
 * 影片列表页公共交互。
 * @param {Object} store - useMoviesStore 实例
 * @param {Object} [options]
 * @param {Function} [options.buildLoadArgs] - 返回 loadMovies 参数的函数
 *   （Favorite 传 { onlyFavorite: true }，History 传 extraFilter 等；
 *     缺省为仅刷新当前筛选）
 * @param {Function} [options.onRefresh] - 批量操作后的刷新回调
 *   （各视图刷新函数不同名：Library/Favorite 为 onRefresh，History 为 loadHistory）
 * @returns {{
 *   onToggle: (m: Object) => void,
 *   onPageChange: (p: number) => Promise<void>,
 *   onDetail: (m: Object) => void,
 *   onPlay: (m: Object) => Promise<void>,
 *   onBatchDelete: () => Promise<void>,
 *   onBatchFav: (isFav: boolean) => Promise<void>,
 *   onBatchAddTag: () => Promise<void>
 * }}
 */
export function useMovieList(store, { buildLoadArgs, onRefresh } = {}) {
  const router = useRouter()

  /**
   * 批量模式下切换单个影片的选中状态。
   * 与原三视图内联实现一致：已选中则移除，未选中则追加。
   */
  function onToggle(m) {
    const ids = store.selectedIds
    const i = ids.indexOf(m.id)
    if (i >= 0) ids.splice(i, 1)
    else ids.push(m.id)
  }

  /**
   * 翻页处理：设置页码 → 按视图各自的加载参数重载 → 滚回顶部。
   */
  async function onPageChange(p) {
    store.page = p
    const args = buildLoadArgs ? buildLoadArgs() : { append: false }
    await store.loadMovies(args)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /**
   * 跳转到影片详情页。
   */
  function onDetail(m) { router.push(`/detail/${m.id}`) }

  /**
   * 播放影片：原三视图内联实现逐字相同，此处收拢。
   */
  async function onPlay(m) {
    if (!window.api || !m.py) return ElMessage.warning('未设置视频路径')
    const r = await window.api.playVideo(m.py).catch(() => null)
    if (!r || !r.ok) return ElMessage.error(r?.error || '播放失败')
    safeCall(window.api.recordPlay(m.id))
  }

  /**
   * 批量删除选中影片。
   * 注：Favorite 原实现的确认框缺少标题与 warning 类型（与其他两处分叉），
   * 收拢后三视图统一为带标题的 warning 确认框。
   */
  async function onBatchDelete() {
    // 确认框单独 try：用户点「取消」是正常路径，不能和真正的删除失败混在一个 catch 里
    // （原实现把两者一起吞掉，删除真失败时用户看不到任何提示、列表也不刷新）
    try {
      await ElMessageBox.confirm(
        `确定删除选中的 ${store.selectedIds.length} 项？`, '批量删除', { type: 'warning' }
      )
    } catch { return }   // 用户取消
    const r = await window.api.deleteMovies([...store.selectedIds]).catch(() => null)
    if (!r) return ElMessage.error('删除失败：主进程未响应')
    if (!r.ok) return ElMessage.error(r.error || '删除失败')
    store.selectedIds = []
    ElMessage.success('已删除')
    if (onRefresh) await onRefresh()
  }

  /**
   * 批量收藏 / 取消收藏。
   * 注：Favorite 原实现缺 window.api 守卫与成功提示（与另两处分叉），此处统一。
   */
  async function onBatchFav(isFav) {
    if (!window.api) return
    const r = await window.api.batchSetFavorite([...store.selectedIds], isFav).catch(() => null)
    // 原实现只在成功时提示，失败静默（用户以为点了没反应）
    if (!r || !r.ok) return ElMessage.error(r?.error || '操作失败')
    ElMessage.success('操作成功')
    if (onRefresh) await onRefresh()
  }

  /**
   * 批量添加标签：把同一个（或同一批）标签追加到所有选中影片。
   * 追加语义由主进程 `movies:batchTags` 保证 —— 它在事务里按「，」拆分现有标签、
   * 去重后再写回，因此重复添加同一标签是幂等的，不会产生重复项。
   * 成功后刷新标签栏（新标签要立刻能在筛选面板看到）。
   */
  async function onBatchAddTag() {
    if (!window.api) return
    const count = store.selectedIds.length
    if (!count) return ElMessage.warning('请先选择影片')
    let input = ''
    try {
      const r = await ElMessageBox.prompt(
        `将标签添加到选中的 ${count} 部影片：`, '批量添加标签',
        {
          confirmButtonText: '添加', cancelButtonText: '取消',
          inputPlaceholder: '输入标签，多个用「，」分隔',
          inputValidator: v => (String(v || '').trim() ? true : '标签不能为空')
        }
      )
      input = r.value
    } catch { return }   // 用户取消
    // 拆分规则与主进程一致：中英文逗号都认，去空白、去重
    const tags = [...new Set(String(input).split(/[，,]/).map(s => s.trim()).filter(Boolean))]
    if (!tags.length) return ElMessage.warning('标签不能为空')
    const r = await window.api.batchAddTags([...store.selectedIds], tags).catch(() => null)
    if (!r || !r.ok) return ElMessage.error(r?.error || '添加标签失败')
    ElMessage.success(`已为 ${count} 部影片添加标签：${tags.join('、')}`)
    // 刷新标签栏（保留选中状态，便于继续加下一个标签）
    await store.loadAllDbTags()
    if (onRefresh) await onRefresh()
  }

  /**
   * 批量刮削选中的影片（片库 / 喜欢 / 观看记录三页共用）。
   * 语义（2026-09-08 用户确认）：仅处理「当前页」内被选中的影片，跨页勾选不在数据源中属预期行为。
   * 刮削来源跟随设置（此前写死 'auto'，设置里的来源选项对批量刮削不生效）；
   * 来源为 fill 时进入「补全字段」模式：只写当前为空的字段，且已有预览图时不再重复下载。
   */
  async function onBatchScrape() {
    if (!window.api) return
    const ids = [...store.selectedIds]
    const selected = store.movies.filter(m => ids.includes(m.id))
    if (!selected.length) return
    const scrapeStore = useScrapeStore()
    const mode = store.settings.scrape_source || 'auto'
    const fillOnly = mode === 'fill'
    const source = fillOnly ? 'auto' : mode
    // 批量刮削进度走顶栏铃铛面板（取代 ElNotification 右上角弹窗）
    let ok = 0, fail = 0, filled = 0, skipped = 0, statsBlocked = 0
    // 先把全部选中影片登记为「待刮削」（pending），铃铛红标立即显示任务总数
    const keys = selected.map(m => scrapeStore.enqueue(m.ph, m.pm))
    for (let idx = 0; idx < selected.length; idx++) {
      const m = selected[idx]
      const key = keys[idx]
      scrapeStore.begin(key)   // 待刮削 → 正在刮削
      try {
        const r = await window.api.scrapeMovie(m.ph, source, { skipPreviews: fillOnly && !!m.previews })
        if (r.ok && r.data) {
          // 刮削结果 → 更新字段映射（公共函数，与 Detail.vue 共用）
          const update = buildScrapeUpdate(r.data, m, { fillOnly })
          // 补全模式下若没有缺失字段，直接跳过写库（该影片本来就完整）
          if (fillOnly && !Object.keys(update).length) {
            if (statsFillHint({ ...m, ...update }, store.settings.scrape_stats !== 'n')) statsBlocked++
            scrapeStore.done(key, true)
            skipped++
            ok++
            continue
          }
          const saveR = await window.api.updateMovie(m.id, update)
          if (saveR.ok) {
            const i = store.movies.findIndex(x => x.id === m.id)
            if (i >= 0) store.movies[i] = { ...store.movies[i], ...update }
            // 封面是按番号固定文件名覆盖写入的：URL 不变浏览器不会重新请求 → 换版本号强制刷新
            bumpCover(m.id)
            scrapeStore.done(key, true)
            if (fillOnly) {
              filled++
              if (statsFillHint({ ...m, ...update }, store.settings.scrape_stats !== 'n')) statsBlocked++
            }
            ok++
          } else {
            scrapeStore.done(key, false, saveR.error || '入库失败')
            fail++
          }
        } else {
          scrapeStore.done(key, false, r.error || '刮削失败')
          fail++
        }
      } catch (e) {
        scrapeStore.done(key, false, e.message)
        fail++
      }
    }
    if (fillOnly) {
      const statsTip = statsBlocked ? `；${statsBlocked} 部的评分/想看/看过未取到（JAVDB 未返回，检查 Cookie 与代理）` : ''
      const tail = fail ? `，失败 ${fail} 部（详情见顶栏铃铛）` : ''
      const msg = `补全完成：${filled} 部补齐字段，${skipped} 部无需补全${tail}${statsTip}`
      if (fail || statsBlocked) ElMessage.warning(msg)
      else ElMessage.success(msg)
    } else if (fail === 0) {
      ElMessage.success(`批量刮削完成，成功 ${ok} 部`)
    } else {
      ElMessage.warning(`刮削完成：成功 ${ok} 部，失败 ${fail} 部（详情见顶栏铃铛）`)
    }
    await store.loadAllDbTags()
  }

  return { onToggle, onPageChange, onDetail, onPlay, onBatchDelete, onBatchFav, onBatchAddTag, onBatchScrape }
}
