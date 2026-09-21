<!--
  ============================================================
  文件名：Library.vue
  所属模块：视图 / 片库页
  功能描述：影片库主视图。整合标签筛选（TagFilter）、状态栏
           （StatusBar）和影片网格（MovieGrid）。
           支持播放、详情查看、
           收藏、批量操作（删除/收藏/刮削）、以及从
           详情页通过路由 query 跳转过滤（标签/女优/厂商/系列/导演）。
  ============================================================
-->
<template>
  <div>
    <!-- 结果页标题条：从详情页点击导演/片商/系列/类别/演员或搜索跳转时显示来源说明。
         该条仅在「从其它页面跳进来的筛选结果」时出现（片库自身的标签栏不改路由），
         故左侧的返回按钮也只在这些结果页出现，不会污染片库主界面。 -->
    <div class="filter-title" v-if="pageTitle">
      <BackButton fallback="/library" />
      <span class="ft-text">{{ pageTitle }}</span>
      <button class="ft-clear" title="查看全部影片" @click="clearFilterTitle">
        <AppIcon name="close" :size="13" />
      </button>
    </div>
    <!-- 标签筛选栏，标签变化时触发刷新 -->
    <TagFilter @change="onRefresh" />
    <!-- 状态栏：显示影片总数，提供批量删除、批量收藏、批量刮削入口 -->
    <StatusBar
      :total="store.total"
      @sortChange="onSortChange"
      @batchDelete="onBatchDelete"
      @batchFav="onBatchFav"
      @batchScrape="onBatchScrape"
      @batchAddTag="onBatchAddTag"
    />
    <!-- 影片网格组件，展示当前页影片 -->
    <MovieGrid
      :movies="store.movies"
      :total="store.total"
      :page="store.page"
      :pageSize="store.pageSize"
      :cols="store.colsPerRow"
      :loading="store.loading"
      :selectMode="store.selectMode"
      :selectedIds="store.selectedIds"
      @page="onPageChange"
      @play="onPlay"
      @fav="onFav"
      @toggle="onToggle"
      @click="onCardClick"
    />
  </div>
</template>

<script setup>
import { onMounted, ref, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useMoviesStore } from '@/store/movies'
import { buildScrapeUpdate, bumpCover, statsFillHint } from '@/utils/global'
import { useMovieList } from '@/composables/useMovieList'

// 路由实例（clearFilterTitle 用它跳回全部影片列表）
const router = useRouter()
import { useScrapeStore } from '@/store/scrape'
import TagFilter from '@/components/TagFilter.vue'
import StatusBar from '@/components/StatusBar.vue'
import MovieGrid from '@/components/MovieGrid.vue'
import AppIcon from '@/components/AppIcon.vue'
import BackButton from '@/components/BackButton.vue'

// Pinia store 实例，管理影片数据、筛选、排序等状态
const store = useMoviesStore()
// 刮削任务 store（批量刮削进度，顶栏铃铛面板展示）
const scrapeStore = useScrapeStore()
// 当前路由信息，用于读取 query 参数
const route = useRoute()
// 公共列表交互：批量选中切换 / 翻页 / 详情跳转（翻页时携带路由筛选参数不丢条件）
// onPlay / onBatchDelete / onBatchFav 由 composable 统一提供（见 useMovieList）
const { onToggle, onPageChange, onDetail, onPlay, onBatchDelete, onBatchFav, onBatchAddTag } = useMovieList(store, {
  buildLoadArgs: () => ({ append: false, extraFilter: routeExtra() }),
  onRefresh: () => onRefresh()
})

/**
 * 从路由 query 提取「筛选签名」：用于判断是「同一套筛选（返回）」还是「换了筛选（新跳转）」
 */
function routeSig(q) {
  return [q.tag || '', q.actress || '', q.director || '', q.studio || '', q.series || '', q.q || ''].join('|')
}
// 上一次已应用的筛选签名（模块级，跨挂载保留）
let lastAppliedSig = null

/**
 * 从路由 query 提取翻页需保留的筛选参数（导演/片商/系列）
 */
function routeExtra() {
  const q = route.query
  const extra = {}
  if (q.actress) extra.actress = q.actress
  if (q.director) extra.director = q.director
  if (q.studio) extra.studio = q.studio
  if (q.series) extra.series = q.series
  return extra
}

/**
 * 计算属性：结果页标题条文案（按跳转来源生成说明）。
 *
 * 注意：**标签跳转（?tag=）不再显示标题条** —— 标签在标签栏里有对应的选中态，
 * 直接照片库原本的样子呈现（标签栏 + 巨乳选中）比多一条「含有「巨乳」的影片」更直观，
 * 用户也要求从详情页点标签进来时「跟片库一样」。
 * 演员/导演/系列/片商/搜索词在标签栏里没有对应项，仍用标题条说明来源。
 */
const pageTitle = computed(() => {
  const q = route.query
  if (q.actress) return `${q.actress}参演的影片`
  if (q.director) return `${q.director}执导的影片`
  if (q.series) return `${q.series}系列影片`
  if (q.studio) return `${q.studio}出品的影片`
  if (q.q) return `含有「${q.q}」的影片`
  return ''
})

/**
 * 清除标题条筛选（回到全部影片列表）
 */
async function clearFilterTitle() {
  router.push({ path: '/library' })
}

/**
 * 刷新影片列表
 * 功能：重置页码为 1，重新加载影片数据
 */
async function onRefresh() { store.page = 1; await store.loadMovies({ append: false, extraFilter: routeExtra() }) }

/**
 * 排序方式变更（StatusBar 排序下拉）：携带路由筛选重新加载
 */
async function onSortChange() {
  store.page = 1
  await store.loadMovies({ append: false, extraFilter: routeExtra() })
}


/**
 * 打开编辑对话框
 * @param {Object} m - 要编辑的影片对象
 */
/**
 * 卡片点击处理（根据模式分发）
 * - 批量选择模式下：切换选中状态
 * - 普通模式下：根据用户设置（点击动作）决定播放或进入详情
 *   （onDetail 由 useMovieList composable 提供）
 * @param {Object} m - 影片对象
 */
function onCardClick(m) {
  if (store.selectMode) return onToggle(m)
  const action = store.settings.click_action || 'detail'
  if (action === 'play') onPlay(m)
  else onDetail(m)
}

/**
 * 切换喜欢状态（卡片右上角喜欢按钮）
 * 实现说明：store.toggleFav **不是乐观更新** —— 它先 await IPC 写库，成功后才改
 *          `movies` 里的 `cl` 字段触发重渲染；失败则保持原状、无回滚动作。
 *          本地 sql.js 写库为毫秒级，无需乐观更新。
 * @param {Object} m - 影片对象
 */
async function onFav(m) { await store.toggleFav(m.id) }

/**
 * 批量刮削选中的影片元数据
 * 功能：遍历选中影片，调用 scrapeMovie 获取在线元数据，
 *      更新标题、女优、导演、厂商等字段，并实时更新进度通知
 * 语义说明（2026-09-08 用户确认）：仅处理「当前页」内被选中的影片，
 *      跨页勾选的影片不在本页数据源中，属预期行为而非缺陷。
 */
async function onBatchScrape() {
  if (!window.api) return
  const ids = [...store.selectedIds]
  const selected = store.movies.filter(m => ids.includes(m.id))
  if (!selected.length) return
  // 刮削来源跟随设置：此前这里写死 'auto'，导致设置里的「仅 JAVBUS / 仅 JAVDB」对批量刮削不生效。
  // fill = 补全字段模式：照常自动刮削，但只写当前为空的字段（补齐早年刮削不全的影片）。
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
          // 本来就完整：不写库；但如果统计字段仍缺，说明是 JAVDB 没返回（Cookie/403），计一笔提示
          if (statsFillHint({ ...m, ...update }, store.settings.scrape_stats !== 'n')) statsBlocked++
          scrapeStore.done(key, true)
          skipped++
          ok++
          continue
        }
        const saveR = await window.api.updateMovie(m.id, update)
        if (saveR.ok) {
          const idx = store.movies.findIndex(x => x.id === m.id)
          if (idx >= 0) store.movies[idx] = { ...store.movies[idx], ...update }
          // 封面是「按番号固定文件名覆盖写入」的：路径没变 → <img> src 不变 → 浏览器不会重新
          // 请求，海报会停留在旧图。bumpCover 让该影片的封面 URL 换新，海报即时刷新。
          bumpCover(m.id)
          scrapeStore.done(key, true)
          if (fillOnly) {
            filled++
            // 本次补齐后仍缺统计字段（JAVDB 未返回）→ 计一笔，汇总时提示
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

/**
 * 根据路由 query 应用筛选并刷新片库
 * 从详情页通过 query 跳转过滤（标签/女优/厂商/系列），
 * 或从顶栏搜索跳转（q：番号/片名/标签模糊搜索，2026-09-09 新增）
 */
async function applyRouteFilter(q) {
  // 同步搜索词到 store（loadMovies 统一并入 filter.q；翻页不丢失）
  store.searchQ = q.q || ''
  if (!q.tag && !q.actress && !q.director && !q.studio && !q.series && !q.q) return false
  if (q.tag) {
    // 优先放入该标签所属的分类槽；未归入任何分类的标签（如首页类别按钮
    // 里未配置分类的 2 字标签）兜底放入第一个槽，保证筛选生效
    let placed = false
    for (let ci = 0; ci < 9; ci++) {
      if (store.categories[ci]?.tags?.includes(q.tag)) {
        store.tagSelected[ci] = [q.tag]
        placed = true
        break
      }
    }
    if (!placed) {
      store.tagSelected = store.tagSelected.map(() => [])
      store.tagSelected[0] = [q.tag]
    }
  }
  store.page = 1
  const extra = {}
  if (q.actress) extra.actress = q.actress
  if (q.director) extra.director = q.director
  if (q.studio) extra.studio = q.studio
  if (q.series) extra.series = q.series
  await store.loadMovies({ append: false, extraFilter: extra })
  return true
}

/**
 * 组件挂载时：初始化 store、加载标签、处理路由参数过滤
 */
onMounted(async () => {
  await store.initIfNeeded()
  // 标签库与影片列表互不依赖，并行拉取，减少切换页面时的等待
  const tagsP = store.loadAllDbTags()
  const sig = routeSig(route.query)
  if (sig && sig === lastAppliedSig) {
    // 同一套筛选参数（典型场景：从影片详情页返回）→ **保留当前页码**，只重载这一页的数据。
    // store.movies 是三个视图共享的，从喜欢/历史页回来时它已被换成子集，所以必须重载。
    await store.loadMovies({ append: false, extraFilter: routeExtra() })
  } else if (!await applyRouteFilter(route.query)) {
    // 无筛选条件时也必须重新加载全量列表：store.movies 是三个视图共享的，
    // 切到喜欢/历史页后它已被替换为子集数据，不重载会导致片库影片「消失」
    // 页码不在这里写死 1：顶栏点「片库」会通过 requestLibraryReset() 把页码复位，
    // 而「详情页返回」要保持原页码（见上面的 sig 分支）。
    await store.loadMovies({ append: false, extraFilter: routeExtra() })
  }
  lastAppliedSig = sig
  await tagsP
})

// 监听 store.sort.random 改变，触发刷新（随机排序切换）
watch(() => store.sort.random, () => onRefresh())

// 监听路由 query 变化（从详情页点击标签/女优/厂商跳转回片库、或顶栏搜索跳转时自动过滤）
watch(() => route.query, async (q) => {
  const sig = routeSig(q)
  // 同一套筛选参数：典型场景是从详情页返回，页码与列表都保持原样，不做任何重置
  if (sig === lastAppliedSig) return
  lastAppliedSig = sig
  if (await applyRouteFilter(q)) return
  // 筛选被清空（点导航回片库 / 点标题条上的 ×）：标签与搜索条件一并复位，回到第 1 页。
  // 排序保持用户选择（不在这里重置），避免「只想清筛选却被改了排序」。
  store.tagSelected = [[], [], [], [], [], [], [], [], []]
  store.searchQ = ''
  store.page = 1
  await store.loadMovies({ append: false, extraFilter: routeExtra() })
}, { deep: true })

// 顶栏点「片库」：路由本身没变化（已在 /library 且无 query）时，靠这个信号复位并重载
watch(() => store.libraryResetToken, async () => {
  lastAppliedSig = routeSig(route.query)
  await onRefresh()
})
</script>

<style scoped>
/* 结果页标题条：说明当前列表的筛选来源（女优/导演/系列/片商/类别/搜索词）
   圆角与同区域的标签面板/状态栏统一，见 --r-tag */
.filter-title {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-tag);
  /* 左侧改为 32px 返回按钮（原先只有文字，故左内距较大） */
  padding: 6px 8px;
}
.ft-text {
  flex: 1;
  font-size: var(--fs-lg); font-weight: 600;
  color: var(--text);
  font-family: var(--font-display);
}
/* 清除筛选按钮：圆形弱化，hover 危险色 */
.ft-clear {
  width: var(--icon-btn-sm); height: var(--icon-btn-sm);
  border: none; border-radius: 50%;
  background: transparent; color: var(--muted);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease,
              transform var(--dur-press) var(--ease-out);
}
.ft-clear:hover { background: var(--danger-soft); color: var(--danger); }
.ft-clear:active { transform: scale(0.96); }
</style>
