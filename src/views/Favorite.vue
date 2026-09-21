<!--
  ============================================================
  文件名：Favorite.vue
  所属模块：视图 / 收藏页
  功能描述：展示用户收藏的影片列表。复用 TagFilter（标签筛选）、
           StatusBar（状态栏）和 MovieGrid（影片网格）组件，
           支持播放、删除、收藏切换、批量操作等功能。
           仅加载已收藏（cl === 'y'）的影片。
  ============================================================
-->
<template>
  <div>
    <!-- 标签筛选栏，切换时触发刷新 -->
    <TagFilter @change="onRefresh" />
    <!-- 状态栏：显示总数，提供批量删除与批量收藏操作 -->
    <StatusBar
      :total="store.total"
      @sortChange="onSortChange"
      @batchDelete="onBatchDelete"
      @batchFav="onBatchFav"
      @batchAddTag="onBatchAddTag"
      @batchScrape="onBatchScrape"
    />
    <!-- 空状态：无收藏影片时显示提示 -->
    <el-empty v-if="store.total === 0 && !store.loading" description="还没有收藏影片，去片库挑选喜欢的吧" />
    <!-- 影片网格组件 -->
    <MovieGrid v-else
      :movies="store.movies"
      :total="store.total"
      :page="store.page"
      :pageSize="store.pageSize"
      :cols="store.colsPerRow"
      :selectMode="store.selectMode"
      :selectedIds="store.selectedIds"
      @page="onPageChange"
      @click="onDetail"
      @play="onPlay"
      @fav="onFav"
      @toggle="onToggle"
    />
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useMoviesStore } from '@/store/movies'
import { useMovieList } from '@/composables/useMovieList'
import TagFilter from '@/components/TagFilter.vue'
import StatusBar from '@/components/StatusBar.vue'
import MovieGrid from '@/components/MovieGrid.vue'

// Pinia store 实例，管理影片数据与状态
const store = useMoviesStore()
// 公共列表交互：批量选中切换 / 翻页（收藏页固定加载 onlyFavorite）
// onPlay / onBatchDelete / onBatchFav / onDetail 由 composable 统一提供
const { onToggle, onPageChange, onDetail, onPlay, onBatchDelete, onBatchFav, onBatchAddTag, onBatchScrape } = useMovieList(store, {
  buildLoadArgs: () => ({ onlyFavorite: true }),
  onRefresh: () => onRefresh()
})

/**
 * 刷新收藏列表
 * 功能：重置页码为 1，仅加载已收藏的影片
 */
async function onRefresh() { store.page = 1; await store.loadMovies({ onlyFavorite: true }) }

/**
 * 排序方式变更（StatusBar 排序下拉）：重新加载收藏列表
 */
async function onSortChange() {
  store.page = 1
  await store.loadMovies({ onlyFavorite: true })
}

/**
 * 切换喜欢状态（卡片右上角喜欢按钮）；取消喜欢后刷新列表使影片离开
 * @param {Object} m - 影片对象
 */
async function onFav(m) { await store.toggleFav(m.id); onRefresh() }

/**
 * 组件挂载时：初始化 store、加载标签、加载收藏影片
 */
onMounted(async () => {
  await store.initIfNeeded()
  // 标签库与收藏列表互不依赖，并行拉取，避免串行等待造成的切换卡顿
  await Promise.all([
    store.ensureTagsLoaded(),
    store.loadMovies({ onlyFavorite: true })
  ])
})
</script>
