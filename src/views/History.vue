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
    <!-- 状态栏：显示总数，提供批量删除与批量收藏操作 -->
    <StatusBar
      :total="store.total"
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
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'
import { useMoviesStore } from '@/store/movies'
import { useMovieList } from '@/composables/useMovieList'
import StatusBar from '@/components/StatusBar.vue'
import MovieGrid from '@/components/MovieGrid.vue'

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
onMounted(async () => {
  await store.initIfNeeded()
  // 批量模式属于「某一个列表页」的临时状态：从片库带着多选态切进来，会对着本页看不见的
  // 选中项执行批量删除/收藏（selectedIds 还是片库那批），故进入本页即退出批量模式
  store.selectMode = false
  store.selectedIds = []
  // 设置排序：按播放时间倒序
  store.sort = { by: 'play_time', order: 'DESC', random: false }
  await loadHistory()
})

// 顶栏新增影片后：按本页自己的筛选条件重载（不能由顶栏直接 loadMovies，那会把列表换成全库）
watch(() => store.dataToken, () => loadHistory())
</script>
