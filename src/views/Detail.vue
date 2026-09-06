<!--
  ============================================================
  文件名：Detail.vue
  所属模块：视图 / 影片详情页
  功能描述：展示单部影片的完整信息，包括封面、番号、标题、
           女优、发行日期、类型标记、导演、厂商、系列、标签等。
           支持播放、收藏切换、编辑、在线刮削元数据、删除等操作。
           页面内的标签/女优/厂商/系列均可点击跳转到片库进行筛选。
  ============================================================
-->
<template>
  <!-- 详情根容器，仅在有数据时渲染 -->
  <div class="detail" v-if="m">
    <!-- 顶部操作栏：返回、播放、收藏、编辑、刮削、删除 -->
    <div class="back">
      <el-button @click="$router.back()">
        <AppIcon name="back" :size="15" style="margin-right:5px" />返回
      </el-button>
      <el-button type="primary" @click="onPlay">
        <AppIcon name="play" :size="13" style="margin-right:5px" />播放
      </el-button>
      <el-button :class="{ 'fav-on': isFav }" @click="toggleFav">
        <AppIcon :name="isFav ? 'heart-filled' : 'heart'" :size="15" style="margin-right:5px" />{{ isFav ? '已收藏' : '收藏' }}
      </el-button>
      <el-button @click="editShow = true">
        <AppIcon name="edit" :size="15" style="margin-right:5px" />编辑
      </el-button>
      <el-button type="success" @click="onScrape" :loading="scraping">
        <AppIcon v-if="!scraping" name="globe" :size="15" style="margin-right:5px" />刮削
      </el-button>
      <el-button type="danger" @click="onDel">
        <AppIcon name="trash" :size="15" style="margin-right:5px" />删除
      </el-button>
    </div>
    <!-- 主面板：左侧封面 + 右侧信息 -->
    <div class="panel">
      <!-- 封面区域 -->
      <div class="cover">
        <!-- 有封面图且未出错时显示图片 -->
        <img v-if="cover && !imgErr" :src="cover" @error="imgErr = true" />
        <!-- 无封面或图片加载失败时显示占位 -->
        <div v-if="!cover || imgErr" class="no-cover">暂无封面</div>
      </div>
      <!-- 信息区域 -->
      <div class="info">
        <!-- 番号 -->
        <div class="code">{{ m.ph || '—' }}</div>
        <!-- 标题 -->
        <div class="title">{{ m.pm || '无标题' }}</div>
        <!-- 详细信息列表 -->
        <el-descriptions :column="1" size="small" border style="margin-top:14px" class="desc">
          <!-- 女优列表（可点击筛选） -->
          <el-descriptions-item label="女优" :span="span2(m.yid || '')">
            <div class="tag-list" v-if="actressList.length">
              <TagChip v-for="a in actressList" :key="a" :label="a" @click="filterByActress(a)" />
            </div>
            <span v-else>—</span>
          </el-descriptions-item>
          <!-- 发行日期 -->
          <el-descriptions-item v-if="m.fxrq" label="发行日期">{{ m.fxrq }}</el-descriptions-item>
          <!-- 类型标记（中字、流出等） -->
          <el-descriptions-item v-if="flagsText !== '—'" label="类型">{{ flagsText }}</el-descriptions-item>
          <!-- 导演 -->
          <el-descriptions-item v-if="m.dy" label="导演">{{ m.dy }}</el-descriptions-item>
          <!-- 厂商列表（可点击筛选） -->
          <el-descriptions-item label="厂商">
            <div class="tag-list" v-if="studioList.length">
              <TagChip v-for="s in studioList" :key="s" :label="s" @click="filterByStudio(s)" />
            </div>
            <span v-else>—</span>
          </el-descriptions-item>
          <!-- 系列（可点击筛选） -->
          <el-descriptions-item label="系列">
            <div class="tag-list" v-if="m.xl">
              <TagChip :label="m.xl" @click="filterBySeries(m.xl)" />
            </div>
            <span v-else>—</span>
          </el-descriptions-item>
          <!-- 标签列表（可点击筛选） -->
          <el-descriptions-item v-if="tags.length" label="标签">
            <div class="tag-list">
              <TagChip v-for="t in tags" :key="t" :label="t" @click="filterByTag(t)" />
            </div>
          </el-descriptions-item>
        </el-descriptions>
      </div>
    </div>

    <!-- 编辑对话框 - 复用 ManualForm 手动录入表单 -->
    <el-dialog v-model="editShow" title="编辑影片" width="820px" destroy-on-close>
      <ManualForm :initial="m" @submit="onSaveEdit" />
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useMoviesStore } from '@/store/movies'
import TagChip from '@/components/TagChip.vue'
import AppIcon from '@/components/AppIcon.vue'
import ManualForm from '@/components/AddMovieDialog/ManualForm.vue'
import { resolveCover, DELIM } from '@/utils/global'

// 路由与 store 实例
const route = useRoute()
const router = useRouter()
const store = useMoviesStore()

// 响应式状态
const m = ref(null)            // 当前影片数据对象
const editShow = ref(false)    // 编辑对话框显示状态
const scraping = ref(false)    // 刮削进行中标志
const imgErr = ref(false)      // 封面图片加载失败标志

/**
 * 计算属性：解析封面路径为可显示的 URL
 */
const cover = computed(() => m.value ? resolveCover(m.value.cover) : '')
// 封面变化时重置图片错误状态
watch(cover, () => { imgErr.value = false })

/**
 * 计算属性：是否已收藏（cl 字段为 'y'）
 */
const isFav = computed(() => m.value?.cl === 'y')

/**
 * 计算属性：标签列表（按逗号分割 bq 字段）
 */
const tags = computed(() => (m.value?.bq || '').split(/[，,]/).map(s => s.trim()).filter(Boolean))

/**
 * 计算属性：女优列表（按逗号分割 yid 字段）
 */
const actressList = computed(() => (m.value?.yid || '').split(/[，,]/).map(s => s.trim()).filter(Boolean))

/**
 * 计算属性：厂商列表（合并 ps 制作商和 fx 发行商，去重）
 */
const studioList = computed(() => {
  const ps = (m.value?.ps || '').split(/[，,]/).map(s => s.trim()).filter(Boolean)
  const fx = (m.value?.fx || '').split(/[，,]/).map(s => s.trim()).filter(Boolean)
  return [...new Set([...ps, ...fx])]
})

/**
 * 根据值长度返回 span 值（长文本占 2 列，否则 1 列）
 * @param {string} val - 值内容
 * @returns {number} span 值
 */
function span2(val) { return val && String(val).length > 15 ? 2 : 1 }

/**
 * 计算属性：类型标记文本（中字/流出/破解等）
 */
const flagsText = computed(() => {
  if (!m.value) return ''
  // 各标记字段与中文标签的映射
  const labels = [['zz','中字'],['lc','流出'],['pj','破解'],['dt','单体'],['hj','合集'],['dm','动漫'],['vr','VR'],['sd','3D']]
  return labels.filter(([k]) => m.value[k] === 'y').map(([,n]) => n).join('，') || '—'
})

/**
 * 加载影片详情数据
 * @param {number} id - 影片 ID
 */
async function load(id) {
  if (!window.api) return
  const r = await window.api.getMovie(id)
  if (r.ok) m.value = r.data
  else { ElMessage.error(r.error); router.replace('/library') }
}

/**
 * 播放影片并记录播放
 */
async function onPlay() {
  if (!m.value?.py) return ElMessage.warning('未设置视频路径')
  window.api.playVideo(m.value.py)
  window.api.recordPlay(m.value.id)
  store.dirty = true
}

/**
 * 切换收藏状态
 */
async function toggleFav() {
  if (!m.value || !window.api) return
  const v = isFav.value ? 'n' : 'y'
  const r = await window.api.updateMovie(m.value.id, { cl: v })
  if (r.ok) m.value.cl = v
}

/**
 * 删除影片（带二次确认）
 */
async function onDel() {
  try {
    await ElMessageBox.confirm('确定删除？', '提示', { type: 'warning' })
    await window.api.deleteMovie(m.value.id)
    ElMessage.success('已删除')
    router.replace('/library')
  } catch {}
}

/**
 * 保存编辑数据
 * @param {Object} data - 表单提交的影片数据
 */
async function onSaveEdit(data) {
  if (!window.api) return
  const r = await window.api.updateMovie(m.value.id, JSON.parse(JSON.stringify(data)))
  if (r.ok) {
    ElMessage.success('保存成功')
    store.dirty = true
    editShow.value = false
    await load(m.value.id)
  } else ElMessage.error(r.error)
}

/**
 * 在线刮削影片元数据
 * 功能：调用 scrapeMovie 自动获取在线元数据，更新到数据库并刷新页面
 */
async function onScrape() {
  if (!m.value || !window.api) return
  if (!m.value.ph) return ElMessage.warning('该影片没有番号，无法刮削')
  scraping.value = true
  try {
    const r = await window.api.scrapeMovie(m.value.ph, 'auto')
    if (r.ok && r.data) {
      const d = r.data
      // 逐字段更新，仅写入有值的字段
      const update = {}
      if (d.pm) update.pm = d.pm
      if (d.fl) update.fl = d.fl
      if (d.fxrq) update.fxrq = d.fxrq
      if (d.yy) update.yid = d.yy
      if (d.dy) update.dy = d.dy
      if (d.ps) update.ps = d.ps
      if (d.fx) update.fx = d.fx
      if (d.xl) update.xl = d.xl
      if (d.bq) update.bq = d.bq
      if (d.cover) update.cover = d.cover
      const ur = await window.api.updateMovie(m.value.id, update)
      if (ur.ok) {
        ElMessage.success(`刮削成功（来源: ${r.data.source}）`)
        store.dirty = true
        await load(m.value.id)
      } else ElMessage.error('更新失败：' + ur.error)
    } else {
      ElMessage.error('刮削失败：' + (r.error || '未找到'))
    }
  } catch (e) {
    ElMessage.error('刮削出错：' + e.message)
  } finally {
    scraping.value = false
  }
}

/**
 * 跳转到片库按标签筛选
 * @param {string} t - 标签名
 */
function filterByTag(t) {
  router.push({ path: '/library', query: { tag: t } })
}

/**
 * 跳转到片库按女优筛选
 * @param {string} a - 女优名
 */
function filterByActress(a) {
  router.push({ path: '/library', query: { actress: a } })
}

/**
 * 跳转到片库按厂商筛选
 * @param {string} s - 厂商名
 */
function filterByStudio(s) {
  router.push({ path: '/library', query: { studio: s } })
}

/**
 * 跳转到片库按系列筛选
 * @param {string} s - 系列名
 */
function filterBySeries(s) {
  router.push({ path: '/library', query: { series: s } })
}

/**
 * 组件挂载时：从路由参数获取影片 ID 并加载详情
 */
onMounted(async () => {
  const id = Number(route.params.id)
  if (!id) { router.replace('/library'); return }
  await load(id)
})
</script>

<style scoped>
/* 详情页根容器内边距 */
.detail { padding: 4px 4px 40px; }
/* 顶部操作栏 */
.back { margin-bottom: 16px; display: flex; gap: 4px; flex-wrap: wrap; }
/* 已收藏按钮：心形图标用强调色 */
.back .fav-on .app-icon { color: var(--accent); }
/* 主面板：弹性布局，统一面板样式 */
.panel {
  display: flex; gap: 24px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--r-md); padding: 22px;
}
/* 封面区域：固定内容宽度，暖灰渐变兜底 */
.cover {
  width: fit-content; max-width: 100%; flex-shrink: 0;
  border-radius: var(--r-sm);
  background: linear-gradient(135deg, var(--surface-2), var(--surface-3));
  overflow: hidden;
}
/* 封面图片自适应 */
.cover img { max-width: 100%; height: auto; display: block; }
/* 无封面占位块 */
.no-cover {
  width: 300px; aspect-ratio: 3/2;
  display: flex; align-items: center; justify-content: center;
  color: var(--muted); font-size: 14px;
}
/* 信息区域：占据剩余空间 */
.info { flex: 1; min-width: 0; }
/* 番号样式：展示字 + 等宽数字 */
.code {
  color: var(--primary);
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  font-weight: 700; font-size: 18px;
  letter-spacing: 0.02em;
  margin-bottom: 6px;
}
/* 标题样式 */
.title { font-size: 19px; font-weight: 600; color: var(--text); line-height: 1.5; margin-bottom: 6px; }
/* 描述列表表格布局 */
.desc :deep(table) { table-layout: auto; width: 100%; }
.desc :deep(.el-descriptions__cell) { width: auto; white-space: nowrap; padding: 4px 6px; }
.desc :deep(.el-descriptions__label-cell) { width: 1%; white-space: nowrap; color: var(--muted); font-size: 12px; }
.desc :deep(.el-descriptions__content-cell) { word-break: break-all; }
/* 标签列表：自动换行排列 */
.tag-list { white-space: normal; display: flex; flex-wrap: wrap; }
</style>
