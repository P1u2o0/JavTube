<!--
  ============================================================
  文件名：Library.vue
  所属模块：视图 / 片库页
  功能描述：影片库主视图。整合标签筛选（TagFilter）、状态栏
           （StatusBar）、影片网格（MovieGrid）和编辑对话框
           （EditMovieDialog）。支持播放、详情查看、编辑、删除、
           收藏、批量操作（删除/收藏/刮削）、随机排序、以及从
           详情页通过路由 query 跳转过滤（标签/女优/厂商/系列）。
  ============================================================
-->
<template>
  <div>
    <!-- 标签筛选栏，标签变化时触发刷新 -->
    <TagFilter @change="onRefresh" />
    <!-- 状态栏：显示影片总数，提供批量删除、批量收藏、批量刮削入口 -->
    <StatusBar
      :total="store.total"
      @batchDelete="onBatchDelete"
      @batchFav="onBatchFav"
      @batchScrape="onBatchScrape"
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
      @detail="onDetail"
      @edit="onEdit"
      @delete="onDelete"
      @fav="onFav"
      @toggle="onToggle"
      @click="onCardClick"
    />
    <!-- 编辑影片对话框，v-model 控制显示/隐藏 -->
    <EditMovieDialog v-model="showEdit" :movie="editMovie" @saved="onEditSaved" />
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { useMoviesStore } from '@/store/movies'
import TagFilter from '@/components/TagFilter.vue'
import StatusBar from '@/components/StatusBar.vue'
import MovieGrid from '@/components/MovieGrid.vue'
import EditMovieDialog from '@/components/EditMovieDialog.vue'

// Pinia store 实例，管理影片数据、筛选、排序等状态
const store = useMoviesStore()
// 路由实例，用于编程式跳转
const router = useRouter()
// 当前路由信息，用于读取 query 参数
const route = useRoute()

/**
 * 刷新影片列表
 * 功能：重置页码为 1，重新加载影片数据
 */
async function onRefresh() { store.page = 1; await store.loadMovies({ append: false }) }

/**
 * 重置筛选并刷新
 */
function onReset() { onRefresh() }

/**
 * 翻页处理
 * @param {number} p - 目标页码
 */
async function onPageChange(p) {
  store.page = p
  await store.loadMovies({ append: false })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// 编辑对话框控制
const showEdit = ref(false)    // 对话框显示状态
const editMovie = ref(null)    // 当前编辑的影片对象

/**
 * 打开编辑对话框
 * @param {Object} m - 要编辑的影片对象
 */
function onEdit(m) { editMovie.value = m; showEdit.value = true }

/**
 * 编辑保存后的回调
 * 功能：重新从数据库获取影片最新数据并更新列表，同时刷新标签
 * @returns {Promise<void>}
 */
async function onEditSaved() {
  if (!window.api || !editMovie.value?.id) return
  const r = await window.api.getMovie(editMovie.value.id)
  if (r.ok && r.data) {
    const idx = store.movies.findIndex(m => m.id === editMovie.value.id)
    if (idx >= 0) store.movies[idx] = r.data
  }
  await store.loadAllDbTags()
}

/**
 * 播放影片
 * @param {Object} m - 影片对象，需包含 py（视频文件路径）和 id
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
 * 卡片点击处理（根据模式分发）
 * - 批量选择模式下：切换选中状态
 * - 普通模式下：根据用户设置（点击动作）决定播放或进入详情
 * @param {Object} m - 影片对象
 */
function onCardClick(m) {
  if (store.selectMode) return onToggle(m)
  const action = store.settings.click_action || 'detail'
  if (action === 'play') onPlay(m)
  else onDetail(m)
}

/**
 * 删除影片（带二次确认）
 * @param {Object} m - 影片对象
 */
async function onDelete(m) {
  try {
    await ElMessageBox.confirm(`确定删除 ${m.ph || m.pm}？`, '提示', { type: 'warning' })
    const ok = await store.deleteMovie(m.id)
    if (ok) ElMessage.success('已删除')
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
  } catch {}
}

/**
 * 批量设置收藏状态
 * @param {boolean} isFav - 是否收藏
 */
async function onBatchFav(isFav) {
  if (!window.api) return
  const r = await window.api.batchSetFavorite([...store.selectedIds], isFav)
  if (r.ok) { ElMessage.success('操作成功'); await onRefresh() }
}

/**
 * 批量刮削选中的影片元数据
 * 功能：遍历选中影片，调用 scrapeMovie 获取在线元数据，
 *      更新标题、女优、导演、厂商等字段，并实时更新进度通知
 */
async function onBatchScrape() {
  if (!window.api) return
  const ids = [...store.selectedIds]
  const selected = store.movies.filter(m => ids.includes(m.id))
  if (!selected.length) return
  // 创建不自动关闭的通知，显示刮削进度
  const notif = ElNotification({
    title: '批量刮削', message: `开始刮削 0/${selected.length} ...`, duration: 0, type: 'info'
  })
  let ok = 0, fail = 0
  for (let i = 0; i < selected.length; i++) {
    const m = selected[i]
    notif.message = `正在刮削 ${i + 1}/${selected.length}：${m.ph || m.pm}`
    try {
      const r = await window.api.scrapeMovie(m.ph, 'auto')
      if (r.ok && r.data) {
        const d = r.data
        // 按字段逐个更新，仅写入有值的字段
        const update = {}
        if (d.pm) update.pm = d.pm           // 影片名称
        if (d.fl) update.fl = d.fl           // 分辨率/格式
        if (d.fxrq) update.fxrq = d.fxrq    // 发行日期
        if (d.yy) update.yid = d.yy          // 女优名
        if (d.dy) update.dy = d.dy           // 导演
        if (d.ps) update.ps = d.ps           // 厂商
        if (d.fx) update.fx = d.fx           // 发行商
        if (d.xl) update.xl = d.xl           // 系列
        if (d.bq) update.bq = d.bq           // 标签
        if (d.cover) update.cover = d.cover  // 封面
        const saveR = await window.api.updateMovie(m.id, update)
        if (saveR.ok) {
          const idx = store.movies.findIndex(x => x.id === m.id)
          if (idx >= 0) store.movies[idx] = { ...store.movies[idx], ...update }
          ok++
        } else fail++
      } else fail++
    } catch { fail++ }
  }
  notif.close()
  if (fail === 0) ElMessage.success(`批量刮削完成，成功 ${ok} 部`)
  else ElMessage.warning(`刮削完成：成功 ${ok} 部，失败 ${fail} 部`)
  await store.loadAllDbTags()
}

/**
 * 组件挂载时：初始化 store、加载标签、处理路由参数过滤
 * 支持从详情页通过 query 跳转：tag（标签）、actress（女优）、studio（厂商）、series（系列）
 */
onMounted(async () => {
  await store.initIfNeeded()
  await store.loadAllDbTags()
  const tag = route.query.tag
  const actress = route.query.actress
  const studio = route.query.studio
  const series = route.query.series
  if (tag || actress || studio || series) {
    // 如果有 tag 参数，在 9 个类别中查找并选中
    if (tag) {
      for (let ci = 0; ci < 9; ci++) {
        if (store.categories[ci]?.tags?.includes(tag)) {
          store.tagSelected[ci] = [tag]
          break
        }
      }
    }
    store.page = 1
    // 构建附加筛选条件
    const extra = {}
    if (actress) extra.actress = actress
    if (studio) extra.studio = studio
    if (series) extra.series = series
    await store.loadMovies({ append: false, extraFilter: extra })
  } else if (store.dirty || store.movies.length === 0) {
    // 数据有变动或列表为空时自动加载
    store.page = 1
    store.dirty = false
    await store.loadMovies({ append: false })
  }
})

// 监听 store.sort.random 改变，触发刷新（随机排序切换）
watch(() => store.sort.random, () => onRefresh())

// 监听路由 query 变化（从详情页点击标签/女优/厂商跳转回片库时自动过滤）
watch(() => route.query, (q) => {
  if (!q.tag && !q.actress && !q.studio && !q.series) return
  if (q.tag) {
    for (let ci = 0; ci < 9; ci++) {
      if (store.categories[ci]?.tags?.includes(q.tag)) {
        store.tagSelected[ci] = [q.tag]
        break
      }
    }
  }
  store.page = 1
  const extra = {}
  if (q.actress) extra.actress = q.actress
  if (q.studio) extra.studio = q.studio
  if (q.series) extra.series = q.series
  store.loadMovies({ append: false, extraFilter: extra })
}, { deep: true })
</script>
