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
      @batchDelete="onBatchDelete"
      @batchFav="onBatchFav"
    />
    <!-- 空状态：无收藏影片时显示提示 -->
    <el-empty v-if="store.total === 0 && !store.loading" description="还没有收藏影片，去片库挑选喜欢的吧" />
    <!-- 影片网格组件 -->
    <MovieGrid v-else
      :movies="store.movies"
      :total="store.total"
      :page="store.page"
      :pageSize="store.pageSize"
      :selectMode="store.selectMode"
      :selectedIds="store.selectedIds"
      @page="onPageChange"
      @play="onPlay"
      @detail="onDetail"
      @delete="onDelete"
      @fav="onFav"
      @toggle="onToggle"
    />
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useMoviesStore } from '@/store/movies'
import TagFilter from '@/components/TagFilter.vue'
import StatusBar from '@/components/StatusBar.vue'
import MovieGrid from '@/components/MovieGrid.vue'

// Pinia store 实例，管理影片数据与状态
const store = useMoviesStore()
// 路由实例，用于页面跳转
const router = useRouter()

/**
 * 刷新收藏列表
 * 功能：重置页码为 1，仅加载已收藏的影片
 */
async function onRefresh() { store.page = 1; await store.loadMovies({ onlyFavorite: true }) }

/**
 * 翻页处理
 * @param {number} p - 目标页码
 */
async function onPageChange(p) {
  store.page = p
  await store.loadMovies({ onlyFavorite: true })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/**
 * 播放影片
 * @param {Object} m - 影片对象，需包含 py（视频路径）
 */
function onPlay(m) { if (m.py) window.api?.playVideo(m.py) }

/**
 * 跳转到影片详情页
 * @param {Object} m - 影片对象，需包含 id
 */
function onDetail(m) { router.push(`/detail/${m.id}`) }

/**
 * 删除影片（带二次确认）
 * @param {Object} m - 影片对象
 */
async function onDelete(m) {
  try {
    await ElMessageBox.confirm('确定删除？'); const ok = await store.deleteMovie(m.id)
    if (ok) { ElMessage.success('已删除') }
  } catch {}
}

/**
 * 切换收藏状态后刷新列表
 * @param {Object} m - 影片对象
 */
async function onFav(m) { await store.toggleFav(m.id); onRefresh() }

/**
 * 切换单个影片的选中状态（批量模式下使用）
 * @param {Object} m - 影片对象
 */
function onToggle(m) {
  const ids = store.selectedIds
  const i = ids.indexOf(m.id)
  if (i >= 0) ids.splice(i, 1)
  else ids.push(m.id)
}

/**
 * 批量删除选中影片
 */
async function onBatchDelete() {
  try {
    await ElMessageBox.confirm(`删除 ${store.selectedIds.length} 项？`)
    await store.batchDelete()
  } catch {}
}

/**
 * 批量设置收藏状态
 * @param {boolean} f - 是否收藏
 */
async function onBatchFav(f) {
  const r = await window.api.batchSetFavorite([...store.selectedIds], f)
  if (r.ok) onRefresh()
}

/**
 * 组件挂载时：初始化 store、加载标签、加载收藏影片
 */
onMounted(async () => {
  await store.initIfNeeded()
  await store.loadAllDbTags()
  await store.loadMovies({ onlyFavorite: true })
})
</script>
