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
import { ElMessage } from 'element-plus'

/**
 * 影片列表页公共交互。
 * @param {Object} store - useMoviesStore 实例
 * @param {Object} [options]
 * @param {Function} [options.buildLoadArgs] - 返回 loadMovies 参数的函数
 *   （Favorite 传 { onlyFavorite: true }，History 传 extraFilter 等；
 *     缺省为仅刷新当前筛选）
 * @returns {{
 *   onToggle: (m: Object) => void,
 *   onPageChange: (p: number) => Promise<void>,
 *   onDetail: (m: Object) => void
 * }}
 */
export function useMovieList(store, { buildLoadArgs } = {}) {
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

  return { onToggle, onPageChange, onDetail }
}
