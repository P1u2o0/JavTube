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
    <!-- 空状态：无收藏影片时显示提示。
         标签栏的选中状态是跨页共享的，若带着标签筛选进来，底下其实有收藏却显示
         「还没有收藏影片」会让人误以为收藏丢了 —— 有筛选时给出可操作的说明 -->
    <el-empty v-if="store.total === 0 && !store.loading"
              :description="hasTagFilter ? '当前标签筛选下没有收藏影片，点标签栏的「全部」查看全部收藏' : '还没有收藏影片，去片库挑选喜欢的吧'" />
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
import { computed, onMounted, watch } from 'vue'
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
  // useSearch 关掉：本页有标签栏（标签筛选是可见、可清的），但没有搜索框，
  // 片库的搜索词会静默过滤收藏列表
  buildLoadArgs: () => ({ onlyFavorite: true, useSearch: false }),
  onRefresh: () => onRefresh()
})

/**
 * 标签栏是否有选中的标签：决定空状态文案。
 * 本页的标签筛选与片库共享，有筛选时「没有收藏」这个断言不成立。
 */
const hasTagFilter = computed(() => store.tagSelected.some(a => a.length > 0))

/**
 * 刷新收藏列表
 * 功能：重置页码为 1，仅加载已收藏的影片
 */
async function onRefresh() { store.page = 1; await store.loadMovies({ onlyFavorite: true, useSearch: false }) }

/**
 * 排序方式变更（StatusBar 排序下拉）：重新加载收藏列表
 */
async function onSortChange() {
  store.page = 1
  await store.loadMovies({ onlyFavorite: true, useSearch: false })
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
  // 批量模式是「某一个列表页」的临时状态：带着片库的多选态进来，批量删除/收藏会作用在
  // 本页看不见的选中项上，故进入本页即退出批量模式
  store.selectMode = false
  store.selectedIds = []
  // 页码复位：page 是三个视图共享的，片库可能停在第 N 页；
  // 带着大页码进来会请求到超出总页数的一页，收藏列表表现为空白
  store.page = 1
  // 标签库与收藏列表互不依赖，并行拉取，避免串行等待造成的切换卡顿
  await Promise.all([
    store.ensureTagsLoaded(),
    store.loadMovies({ onlyFavorite: true, useSearch: false })
  ])
})

// 顶栏新增影片后：按本页自己的筛选条件重载
watch(() => store.dataToken, () => onRefresh())
</script>
