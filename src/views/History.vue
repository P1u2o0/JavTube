<!--
  ============================================================
  文件名：History.vue
  所属模块：视图 / 观看记录页
  功能描述：展示用户的观看历史。默认按播放时间倒序排列，
           复用 StatusBar 和 MovieGrid 组件，支持播放、
           详情、编辑、删除、收藏、批量操作等功能。
           仅加载有播放记录的影片。
  ============================================================
-->
<template>
  <div>
    <!-- 顶部工具栏：右侧两个视图切换（列表 / 统计），样式与演员页右上角「头像 / 排行」一致。
         统计原先是一个独立页面（2026-11-08 并入本页，用户要求）。 -->
    <div class="hist-head">
      <div class="view-toggle">
        <button :class="{ on: view === 'list' }" @click="view = 'list'" title="按观看记录列表">
          <AppIcon name="history" :size="14" /><span>列表</span>
        </button>
        <button :class="{ on: view === 'stats' }" @click="view = 'stats'" title="观看统计">
          <AppIcon name="chart" :size="14" /><span>统计</span>
        </button>
      </div>
    </div>

    <!-- ===== 列表视图 ===== -->
    <template v-if="view === 'list'">
      <!-- 状态栏：显示总数，提供批量删除与批量收藏操作。
           排序下拉只给「播放次数 / 播放时间」两项（本页只有按观看行为排序才有意义），
           且不提供随机排序 —— 见下方 HISTORY_SORT_FIELDS 与 SortDropdown 的 options 说明 -->
      <StatusBar
        :total="store.total"
        :sort-options="HISTORY_SORT_OPTIONS"
        :sort-show-random="false"
        @sortChange="onSortChange"
        @batchDelete="onBatchDelete"
        @batchFav="onBatchFav"
        @batchAddTag="onBatchAddTag"
        @batchScrape="onBatchScrape"
      />
      <!-- 空状态：无观看记录时显示提示 -->
      <el-empty v-if="store.total === 0 && !store.loading" description="还没有观看记录" />
      <!-- 影片网格组件 -->
      <MovieGrid v-else
        :movies="store.movies"
        :total="store.total"
        :page="store.page"
        :pageSize="store.pageSize"
        :cols="store.colsPerRow"
        :loading="store.loading"
        :selectMode="store.selectMode"
        :selectedIds="store.selectedIds"
        :showPlayCount="true"
        @page="onPageChange"
        @play="onPlay"
        @fav="onFav"
        @toggle="onToggle"
        @click="onCardClick"
      />
    </template>

    <!-- ===== 统计视图（原独立统计页，2026-11-08 并入）===== -->
    <StatsPanel v-else />
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useMoviesStore } from '@/store/movies'
import { useMovieList } from '@/composables/useMovieList'
import StatusBar from '@/components/StatusBar.vue'
import MovieGrid from '@/components/MovieGrid.vue'
import StatsPanel from '@/components/StatsPanel.vue'
import AppIcon from '@/components/AppIcon.vue'

/** 视图：list=观看记录列表 / stats=统计面板（2026-11-08，原独立页面并入） */
const view = ref('list')

// Pinia store 实例
const store = useMoviesStore()
// 公共列表交互：批量选中切换 / 翻页（历史页固定加载 historyOnly）/ 详情跳转
// onPlay / onBatchDelete / onBatchFav 由 composable 统一提供
const { onToggle, onPageChange, onDetail, onPlay, onBatchDelete, onBatchFav, onBatchAddTag, onBatchScrape } = useMovieList(store, {
  // useTags/useSearch 关掉：本页没有标签栏与搜索框，片库留下的筛选条件会静默过滤本页
  buildLoadArgs: () => ({ append: false, extraFilter: { historyOnly: true }, useTags: false, useSearch: false }),
  onRefresh: () => loadHistory()
})


/**
 * 加载观看历史列表
 * 功能：重置页码为 1，按 historyOnly 筛选加载有播放记录的影片
 * @returns {Promise<void>}
 */
async function loadHistory() {
  store.page = 1
  await store.loadMovies({
    append: false,
    extraFilter: { historyOnly: true },
    // 本页无标签筛选栏、无搜索框：不带全局筛选条件，否则片库选中的标签/搜索词
    // 会把观看记录静默过滤成 0 条（用户看到的是「还没有观看记录」）
    useTags: false,
    useSearch: false
  })
}

/**
 * 排序方式变更（StatusBar 排序下拉）：重新加载观看历史
 */
async function onSortChange() {
  await loadHistory()
}

// 本页可选的排序字段（2026-11-07 用户要求）：只看观看行为 —— 播放次数 / 播放时间。
// value 与后端 SORTABLE_COLUMNS 对齐（play_count / play_time），否则后端会静默回退成 tjrq。
const HISTORY_SORT_OPTIONS = [
  { value: 'play_count', label: '播放次数' },
  { value: 'play_time', label: '播放时间' }
]
// 本页可能写入 store.sort 的字段集合：离开时要按它判断「当前排序是不是本页设的」，
// 只认 play_time 会漏掉 play_count（那样退出本页会把「播放次数」带给片库/喜欢）
const HISTORY_SORT_FIELDS = HISTORY_SORT_OPTIONS.map(o => o.value)

/**
 * 卡片点击处理（直接进入详情页）
 *   （onDetail 由 useMovieList composable 提供）
 * @param {Object} m - 影片对象
 */
function onCardClick(m) { onDetail(m) }

/**
 * 切换喜欢状态（卡片右上角喜欢按钮，乐观更新即时变色）
 * @param {Object} m - 影片对象
 */
async function onFav(m) { await store.toggleFav(m.id) }

/**
 * 组件挂载时：初始化 store、设置按播放时间倒序、加载历史
 */
// store.sort 是全局共享的（StatusBar 的排序下拉直接写它）。本页要按「播放时间倒序」，
// 但若直接把全局排序改掉，离开本页后片库/喜欢的排序会一起变成播放时间，而排序下拉的
// 文案表里没有 play_time，按钮会显示成「添加日期」——界面与真实顺序不符（2026-09-28 审计）。
// 故进入时保存、离开时还原。
let sortBackup = null
onMounted(async () => {
  await store.initIfNeeded()
  // 批量模式属于「某一个列表页」的临时状态：从片库带着多选态切进来，会对着本页看不见的
  // 选中项执行批量删除/收藏（selectedIds 还是片库那批），故进入本页即退出批量模式
  store.selectMode = false
  store.selectedIds = []
  // 设置排序：按播放时间倒序（离开本页时还原，不影响其它页面）
  sortBackup = { ...store.sort }
  store.sort = { by: 'play_time', order: 'DESC', random: false }
  await loadHistory()
})

// 离开本页：还原进入前的全局排序，避免把「播放时间/播放次数」带给片库/喜欢。
// 但只在「本页设置的排序仍然生效」时还原 —— 否则会覆盖掉顶栏/用户在离开前的排序改动
// （例如点顶栏「片库」时 TopNav 的 resetAll 会把排序复位，随后本页卸载又把旧值写回去）。
onBeforeUnmount(() => {
  if (sortBackup && HISTORY_SORT_FIELDS.includes(store.sort.by) && store.sort.random === false) store.sort = sortBackup
})

// 顶栏新增影片后：按本页自己的筛选条件重载（不能由顶栏直接 loadMovies，那会把列表换成全库）
watch(() => store.dataToken, () => loadHistory())
</script>

<style scoped>
/* 顶部工具栏：只放右侧的视图切换，与演员页右上角「头像 / 排行」同款 */
.hist-head {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-bottom: 10px;
}
.view-toggle {
  display: flex; padding: 3px; gap: 2px;
  border: 1px solid var(--border-strong); border-radius: var(--r-pill);
  background: var(--surface);
}
.view-toggle button {
  display: flex; align-items: center; gap: 5px;
  padding: 5px 14px; border: none; border-radius: var(--r-pill);
  background: transparent; color: var(--muted);
  font-size: var(--fs-sm); font-weight: 500; cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.view-toggle button:hover { color: var(--text); }
.view-toggle button.on { background: var(--primary); color: #fff; }
.view-toggle button:active { transform: scale(0.97); }
</style>
