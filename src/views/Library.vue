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
import { useMovieList } from '@/composables/useMovieList'

// 路由实例（clearFilterTitle 用它跳回全部影片列表）
const router = useRouter()
import TagFilter from '@/components/TagFilter.vue'
import StatusBar from '@/components/StatusBar.vue'
import MovieGrid from '@/components/MovieGrid.vue'
import AppIcon from '@/components/AppIcon.vue'
import BackButton from '@/components/BackButton.vue'

// Pinia store 实例，管理影片数据、筛选、排序等状态
const store = useMoviesStore()
// 当前路由信息，用于读取 query 参数
const route = useRoute()
// 公共列表交互：批量选中切换 / 翻页 / 详情跳转（翻页时携带路由筛选参数不丢条件）
// onPlay / onBatchDelete / onBatchFav 由 composable 统一提供（见 useMovieList）
const { onToggle, onPageChange, onDetail, onPlay, onBatchDelete, onBatchFav, onBatchAddTag, onBatchScrape } = useMovieList(store, {
  buildLoadArgs: () => ({ append: false, extraFilter: routeExtra() }),
  onRefresh: () => onRefresh()
})

/**
 * 从路由 query 提取「筛选签名」：用于判断是「同一套筛选（返回）」还是「换了筛选（新跳转）」
 */
function routeSig(q) {
  return [q.tag || '', q.actress || '', q.director || '', q.studio || '', q.series || '', q.q || ''].join('|')
}
// 上一次已应用的筛选签名。
// 注意：它写在 <script setup> 内 → 每次挂载都会重置为 null，所以 onMounted 里
// `sig === lastAppliedSig` 恒不成立（该分支是防御性保留）。从详情页返回时页码得以
// 保留，靠的是下面的 fallback 分支 —— 它同样不重置 page。
// 本变量的实际作用域是「本次挂载内的 watch」：用来区分「同一套筛选（返回）」与「换了筛选」。
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
 * 根据路由 query 应用筛选并刷新片库
 * 从详情页通过 query 跳转过滤（标签/女优/厂商/系列），
 * 或从顶栏搜索跳转（q：番号/片名/标签模糊搜索，2026-09-09 新增）
 */
async function applyRouteFilter(q) {
  // 同步搜索词到 store（loadMovies 统一并入 filter.q；翻页不丢失）
  store.searchQ = q.q || ''
  if (!q.tag && !q.actress && !q.director && !q.studio && !q.series && !q.q) return false
  // 先清空标签栏的选中态：路由筛选是「从别处跳进来的这一套条件」的唯一来源。
  // tagSelected 是跨页面保留的，若不清空，上一次在标签栏里选的标签会与本次条件
  // 形成 AND（如 运动 AND 女大学生），把结果压成 0 条 —— 界面表现为片库空白
  // （「共找到 0 个结果」），点「全部」清掉标签后才恢复。
  store.tagSelected = store.tagSelected.map(() => [])
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
    if (!placed) store.tagSelected[0] = [q.tag]
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
  // 批量模式是「某一个列表页」的临时状态：上次离开片库时若开着多选，回来会带着一批
  // 早已不可见的选中项（选中项按当前页指令处理，换页后它们不在列表里），故进入即退出
  store.selectMode = false
  store.selectedIds = []
  // 标签库与影片列表互不依赖，并行拉取，减少切换页面时的等待
  // 挂载只需拿到标签（有守卫，已加载过就不再拉）；写操作路径仍用 loadAllDbTags() 强制刷新
  const tagsP = store.ensureTagsLoaded()
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

// 顶栏新增影片后：按本页当前的路由筛选重载（不能由顶栏直接 loadMovies，那会丢掉 actress/studio 等筛选）
watch(() => store.dataToken, () => onRefresh())
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
