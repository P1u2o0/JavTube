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
      @batchDelete="onBatchDelete"
      @batchFav="onBatchFav"
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
      @page="onPageChange"
      @play="onPlay"
      @edit="onEdit"
      @delete="onDelete"
      @fav="onFav"
      @toggle="onToggle"
      @click="onCardClick"
    />
    <!-- 编辑影片对话框 -->
    <EditMovieDialog v-model="showEdit" :movie="editMovie" @saved="onEditSaved" />
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useMoviesStore } from '@/store/movies'
import StatusBar from '@/components/StatusBar.vue'
import MovieGrid from '@/components/MovieGrid.vue'
import EditMovieDialog from '@/components/EditMovieDialog.vue'

// Pinia store 实例
const store = useMoviesStore()
// 路由实例
const router = useRouter()

// 编辑对话框控制
const showEdit = ref(false)    // 对话框显示状态
const editMovie = ref(null)    // 当前编辑的影片对象

/**
 * 加载观看历史列表
 * 功能：重置页码为 1，按 historyOnly 筛选加载有播放记录的影片
 * @returns {Promise<void>}
 */
async function loadHistory() {
  store.page = 1
  await store.loadMovies({
    append: false,
    extraFilter: { historyOnly: true }
  })
}

/**
 * 翻页处理
 * @param {number} p - 目标页码
 */
async function onPageChange(p) {
  store.page = p
  await store.loadMovies({ append: false, extraFilter: { historyOnly: true } })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/**
 * 播放影片并记录播放
 * @param {Object} m - 影片对象，需包含 py（视频路径）和 id
 */
function onPlay(m) {
  if (!window.api || !m.py) return ElMessage.warning('未设置视频路径')
  window.api.playVideo(m.py)
  window.api.recordPlay(m.id)
}

/**
 * 跳转到影片详情页
 * @param {Object} m - 影片对象
 */
function onDetail(m) { router.push(`/detail/${m.id}`) }

/**
 * 卡片点击处理（直接进入详情页）
 * @param {Object} m - 影片对象
 */
function onCardClick(m) { onDetail(m) }

/**
 * 打开编辑对话框
 * @param {Object} m - 要编辑的影片对象
 */
function onEdit(m) { editMovie.value = m; showEdit.value = true }

/**
 * 编辑保存后的回调，重新加载历史列表并刷新标签
 */
async function onEditSaved() { await loadHistory(); await store.loadAllDbTags() }

/**
 * 删除影片（带二次确认）
 * @param {Object} m - 影片对象
 */
async function onDelete(m) {
  try {
    await ElMessageBox.confirm(`确定删除 ${m.ph || m.pm}？`, '提示', { type: 'warning' })
    const ok = await store.deleteMovie(m.id)
    if (ok) { ElMessage.success('已删除'); await loadHistory() }
  } catch {}
}

/**
 * 切换收藏状态
 * @param {Object} m - 影片对象
 */
async function onFav(m) { await store.toggleFav(m.id) }

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
    await ElMessageBox.confirm(`确定删除选中的 ${store.selectedIds.length} 项？`, '批量删除', { type: 'warning' })
    await store.batchDelete()
    ElMessage.success('已删除')
    await loadHistory()
  } catch {}
}

/**
 * 批量设置收藏状态
 * @param {boolean} isFav - 是否收藏
 */
async function onBatchFav(isFav) {
  if (!window.api) return
  const r = await window.api.batchSetFavorite([...store.selectedIds], isFav)
  if (r.ok) { ElMessage.success('操作成功'); await loadHistory() }
}

/**
 * 组件挂载时：初始化 store、设置按播放时间倒序、加载历史
 */
onMounted(async () => {
  await store.initIfNeeded()
  // 设置排序：按播放时间倒序
  store.sort = { by: 'play_time', order: 'DESC', random: false }
  await loadHistory()
})
</script>
