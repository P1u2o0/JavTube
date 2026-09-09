<!--
  ============================================================
  文件名：Detail.vue
  所属模块：视图 / 影片详情页
  功能描述：展示单部影片的完整信息。2026-09-09 按用户示意图改版：
           红=标题区（番号+片名，页面顶部）
           绿=大图展示区（左侧，默认海报，点击预览小图后切换显示）
           蓝=影片信息区（右侧，含评分/想看/看过统计）
           黄=预览小图条（底部横向，第一张固定为海报，左右箭头切换，
              点击小图在绿色大图区展示）
           支持播放、收藏切换、编辑、在线刮削（可选来源）、删除等操作。
           页面内的标签/女优/厂商/系列均可点击跳转到片库进行筛选。
  ============================================================
-->
<template>
  <!-- 详情根容器，仅在有数据时渲染 -->
  <div class="detail" v-if="m">
    <!-- 顶部操作栏：返回、播放、喜欢、刮削、编辑、删除（2026-09-09 按用户要求精简并统一风格） -->
    <div class="back">
      <el-button @click="$router.back()">
        <AppIcon name="back" :size="15" style="margin-right:5px" />返回
      </el-button>
      <el-button type="primary" @click="onPlay">
        <AppIcon name="play" :size="13" style="margin-right:5px" />播放
      </el-button>
      <el-button class="act-fav" :class="{ 'fav-on': isFav }" @click="toggleFav">
        <AppIcon :name="isFav ? 'heart-filled' : 'heart'" :size="15" style="margin-right:5px" />{{ isFav ? '已喜欢' : '喜欢' }}
      </el-button>
      <el-button class="act-scrape" @click="onScrape" :loading="scraping">
        <AppIcon v-if="!scraping" name="globe" :size="15" style="margin-right:5px" />刮削
      </el-button>
      <el-button @click="editShow = true">
        <AppIcon name="edit" :size="15" style="margin-right:5px" />编辑
      </el-button>
      <el-button class="act-del" @click="onDel">
        <AppIcon name="trash" :size="15" style="margin-right:5px" />删除
      </el-button>
    </div>

    <!-- 红：标题区（番号 + 片名） -->
    <div class="title-block">
      <div class="code">{{ m.ph || '—' }}</div>
      <div class="title">{{ m.pm || '无标题' }}</div>
    </div>

    <!-- 主行：绿=大图展示区（左，固定尺寸） + 蓝=影片信息卡（右） -->
    <div class="main-row">
      <!-- 绿：大图展示区：固定 3:4 框，任何比例的图片在框内等比缩放居中，格局不随图片尺寸变化 -->
      <div class="main-image">
        <img v-if="displayImage && !imgErr" :src="displayImage" @error="imgErr = true" />
        <div v-if="!displayImage || imgErr" class="no-cover">暂无封面</div>
      </div>
      <!-- 蓝：影片信息卡 -->
      <div class="info-card">
        <!-- 统计条：评分 / 想看 / 看过（有任一数据时展示） -->
        <div class="stats-bar" v-if="hasStats">
          <span v-if="m.score" class="stat-score">{{ Number(m.score).toFixed(1) }}<small>分</small></span>
          <span v-if="m.want" class="stat-item"><AppIcon name="heart" :size="14" />想看 {{ fmt(m.want) }}</span>
          <span v-if="m.watched" class="stat-item"><AppIcon name="history" :size="14" />看过 {{ fmt(m.watched) }}</span>
        </div>
        <!-- 女优（可点击筛选） -->
        <div class="info-line" v-if="actressList.length">
          <span class="info-label">女优</span>
          <div class="info-value tag-list">
            <TagChip v-for="a in actressList" :key="a" :label="a" @click="filterByActress(a)" />
          </div>
        </div>
        <!-- 发行日期 -->
        <div class="info-line" v-if="m.fxrq">
          <span class="info-label">发行日期</span>
          <div class="info-value">{{ m.fxrq }}</div>
        </div>
        <!-- 类型标记（中字、流出等） -->
        <div class="info-line" v-if="flagsText !== '—'">
          <span class="info-label">类型</span>
          <div class="info-value">{{ flagsText }}</div>
        </div>
        <!-- 导演 -->
        <div class="info-line" v-if="m.dy">
          <span class="info-label">导演</span>
          <div class="info-value">{{ m.dy }}</div>
        </div>
        <!-- 厂商（可点击筛选） -->
        <div class="info-line" v-if="studioList.length">
          <span class="info-label">厂商</span>
          <div class="info-value tag-list">
            <TagChip v-for="s in studioList" :key="s" :label="s" @click="filterByStudio(s)" />
          </div>
        </div>
        <!-- 系列（可点击筛选） -->
        <div class="info-line" v-if="m.xl">
          <span class="info-label">系列</span>
          <div class="info-value">
            <TagChip :label="m.xl" @click="filterBySeries(m.xl)" />
          </div>
        </div>
        <!-- 标签（可点击筛选） -->
        <div class="info-line" v-if="tags.length">
          <span class="info-label">标签</span>
          <div class="info-value tag-list">
            <TagChip v-for="t in tags" :key="t" :label="t" @click="filterByTag(t)" />
          </div>
        </div>
      </div>
    </div>

    <!-- 黄：预览小图条（第一张固定为海报；左右箭头切换；点击小图在大图区展示） -->
    <div class="preview-strip" v-if="galleryImages.length > 1">
      <button class="strip-arrow" @click="stepImage(-1)" aria-label="上一张">
        <AppIcon name="back" :size="15" />
      </button>
      <div class="strip-track" ref="stripRef">
        <div v-for="(g, i) in galleryImages" :key="i" class="strip-item"
             :class="{ active: i === activeIdx }" @click="activeIdx = i">
          <img :src="g" loading="lazy" />
          <span v-if="i === 0" class="strip-badge">海报</span>
        </div>
      </div>
      <button class="strip-arrow" @click="stepImage(1)" aria-label="下一张">
        <AppIcon name="back" :size="15" class="flip-x" />
      </button>
    </div>

    <!-- 编辑对话框 - 复用 ManualForm 手动录入表单 -->
    <el-dialog v-model="editShow" title="编辑影片" width="820px" destroy-on-close>
      <ManualForm :initial="m" @submit="onSaveEdit" />
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useMoviesStore } from '@/store/movies'
import TagChip from '@/components/TagChip.vue'
import AppIcon from '@/components/AppIcon.vue'
import ManualForm from '@/components/AddMovieDialog/ManualForm.vue'
import { resolveCover, buildScrapeUpdate, safeCall } from '@/utils/global'

// 路由与 store 实例
const route = useRoute()
const router = useRouter()
const store = useMoviesStore()

// 响应式状态
const m = ref(null)            // 当前影片数据对象
const editShow = ref(false)    // 编辑对话框显示状态
const scraping = ref(false)    // 刮削进行中标志
const imgErr = ref(false)      // 大图加载失败标志
const activeIdx = ref(0)       // 当前大图在画廊中的索引（0 = 海报）
const stripRef = ref(null)     // 预览小图条轨道 DOM 引用

/**
 * 计算属性：海报图解析为可显示的 URL（无值时为空串）
 */
const cover = computed(() => m.value ? resolveCover(m.value.cover) : '')

/**
 * 计算属性：本地预览图路径列表（m.previews 为 JSON 字符串数组）
 */
const previewList = computed(() => {
  try {
    const arr = JSON.parse(m.value?.previews || '[]')
    return Array.isArray(arr) ? arr.filter(Boolean) : []
  } catch { return [] }
})

/**
 * 计算属性：画廊全部图片 URL（第一张固定为海报，其后为预览图）
 */
const galleryImages = computed(() => {
  const list = []
  if (cover.value) list.push(cover.value)
  for (const p of previewList.value) {
    const u = resolveCover(p)
    if (u) list.push(u)
  }
  return list
})

/**
 * 计算属性：大图区当前展示的图片 URL
 */
const displayImage = computed(() => galleryImages.value[activeIdx.value] || '')

// 画廊变化（加载新影片/刮削后刷新）时，重置索引与图片错误状态
watch([galleryImages], () => { activeIdx.value = 0; imgErr.value = false })

/**
 * 预览小图条左右箭头：切换大图并滚动到对应小图（循环）
 * @param {number} dir - 1 下一张 / -1 上一张
 */
function stepImage(dir) {
  const n = galleryImages.value.length
  if (!n) return
  activeIdx.value = (activeIdx.value + dir + n) % n
  nextTick(() => {
    const track = stripRef.value
    const el = track?.children?.[activeIdx.value]
    el?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  })
}

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
 * 计算属性：是否有统计数据（评分/想看/看过任一有值）
 */
const hasStats = computed(() => !!(m.value && (m.value.score || m.value.want || m.value.watched)))

/**
 * 数字格式化（千分位，用于想看/看过人数）
 */
function fmt(n) { return Number(n || 0).toLocaleString() }

/**
 * 计算属性：类型标记文本（中字/流出/破解等）
 */
const flagsText = computed(() => {
  if (!m.value) return ''
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
  safeCall(window.api.playVideo(m.value.py))
  safeCall(window.api.recordPlay(m.value.id))
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
 * 刮削来源取设置页「刮削设置」的来源配置（auto/javbus/javdb）；
 * 刮削选项（预览图下载/统计抓取）同样由设置页配置，主进程自动读取
 */
async function onScrape() {
  if (!m.value || !window.api) return
  if (!m.value.ph) return ElMessage.warning('该影片没有番号，无法刮削')
  scraping.value = true
  try {
    const r = await window.api.scrapeMovie(m.value.ph, store.settings.scrape_source || 'auto')
    if (r.ok && r.data) {
      const ur = await window.api.updateMovie(m.value.id, buildScrapeUpdate(r.data))
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
 */
function filterByTag(t) { router.push({ path: '/library', query: { tag: t } }) }
/**
 * 跳转到片库按女优筛选
 */
function filterByActress(a) { router.push({ path: '/library', query: { actress: a } }) }
/**
 * 跳转到片库按厂商筛选
 */
function filterByStudio(s) { router.push({ path: '/library', query: { studio: s } }) }
/**
 * 跳转到片库按系列筛选
 */
function filterBySeries(s) { router.push({ path: '/library', query: { series: s } }) }

/**
 * 组件挂载时：从路由参数获取影片 ID 并加载详情
 */
onMounted(async () => {
  await store.initIfNeeded()
  const id = Number(route.params.id)
  if (!id) { router.replace('/library'); return }
  await load(id)
})
</script>

<style scoped>
/* 详情页根容器内边距 */
.detail { padding: 4px 4px 40px; }
/* 顶部操作栏 */
.back { margin-bottom: 14px; display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }

/* 喜欢按钮：收藏态朱柿红描边 + 图标强调 */
.back .act-fav.fav-on {
  color: var(--accent) !important;
  border-color: var(--accent) !important;
  background: var(--accent-soft) !important;
}
.back .act-fav.fav-on .app-icon { color: var(--accent); }
/* 刮削按钮：hover 朱柿红（强调语义），替代原实心绿 */
.back .act-scrape:hover,
.back .act-scrape:focus {
  background: var(--accent-soft) !important;
  border-color: var(--accent) !important;
  color: var(--accent) !important;
}
/* 删除按钮：hover 危险红（强调语义），替代原实心红 */
.back .act-del:hover,
.back .act-del:focus {
  background: var(--danger-soft) !important;
  border-color: var(--danger) !important;
  color: var(--danger) !important;
}

/* 红：标题区（番号 + 片名，页面顶部） */
.title-block { margin-bottom: 14px; }
/* 番号样式：展示字 + 等宽数字 */
.code {
  color: var(--primary);
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  font-weight: 700; font-size: 18px;
  letter-spacing: 0.02em;
  margin-bottom: 4px;
}
/* 标题样式 */
.title { font-size: 19px; font-weight: 600; color: var(--text); line-height: 1.5; }

/* 主行：大图区（左，固定尺寸）+ 信息卡（右） */
.main-row { display: flex; gap: 20px; align-items: flex-start; }
/* 绿：大图展示区：固定 3:4 框——图片更换时框体尺寸不变，格局稳定 */
.main-image {
  width: 400px;
  aspect-ratio: 3 / 4;
  flex-shrink: 0;
  border-radius: var(--r-md);
  background: linear-gradient(135deg, var(--surface-2), var(--surface-3));
  overflow: hidden;
  border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
}
/* 图片在固定框内等比缩放居中（竖版海报/横版预览图都不改变框体） */
.main-image img { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; }
/* 无图占位块 */
.no-cover {
  width: 300px; aspect-ratio: 3/2;
  display: flex; align-items: center; justify-content: center;
  color: var(--muted); font-size: 14px;
}

/* 蓝：影片信息卡（与整体卡片风格一致的轻量行式布局） */
.info-card {
  flex: 1; min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 14px 20px;
}
/* 统计条：评分大字 + 想看/看过，底部与信息行分隔 */
.stats-bar {
  display: flex; align-items: baseline; gap: 20px; flex-wrap: wrap;
  padding-bottom: 12px; margin-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.stat-score {
  color: var(--accent);
  font-family: var(--font-display);
  font-weight: 700; font-size: 24px;
  font-variant-numeric: tabular-nums;
}
.stat-score small { font-size: 12px; font-weight: 500; margin-left: 3px; color: var(--muted); }
.stat-item {
  display: inline-flex; align-items: center; gap: 5px;
  color: var(--text-2); font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.stat-item .app-icon { color: var(--muted); }
/* 信息行：固定宽标签 + 内容，行间细虚线分隔 */
.info-line {
  display: flex; gap: 14px;
  padding: 8px 0;
  align-items: flex-start;
}
.info-line + .info-line { border-top: 1px dashed var(--border); }
.info-label {
  width: 60px; flex-shrink: 0;
  color: var(--muted); font-size: 12.5px;
  line-height: 26px;
}
.info-value {
  flex: 1; min-width: 0;
  color: var(--text); font-size: 13.5px;
  line-height: 1.7;
  padding-top: 3px;
  word-break: break-all;
}
/* 标签列表：自动换行排列 */
.tag-list { white-space: normal; display: flex; flex-wrap: wrap; }
.preview-strip {
  margin-top: 16px;
  display: flex; align-items: center; gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 10px 12px;
}
/* 左右箭头按钮：圆形中性描边 */
.strip-arrow {
  width: 32px; height: 32px;
  flex-shrink: 0;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text-2);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
}
.strip-arrow:hover { background: var(--surface-2); color: var(--text); }
/* 右箭头：左箭头图标翻转 180° */
.flip-x { transform: rotate(180deg); }
/* 小图横向轨道 */
.strip-track { display: flex; gap: 8px; overflow-x: auto; flex: 1; scroll-behavior: smooth; padding: 2px; }
/* 单个小图：3:2 缩略，选中时朱柿红描边 */
.strip-item {
  position: relative;
  width: 104px; aspect-ratio: 3/2;
  flex-shrink: 0;
  border-radius: var(--r-sm);
  overflow: hidden;
  border: 2px solid transparent;
  cursor: pointer;
  background: var(--surface-2);
}
.strip-item.active { border-color: var(--accent); }
.strip-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* 第一张「海报」角标 */
.strip-badge {
  position: absolute; left: 4px; top: 4px;
  background: rgba(29, 28, 26, 0.7);
  color: #fff; font-size: 10px; line-height: 1;
  padding: 3px 6px; border-radius: var(--r-pill);
  pointer-events: none;
}

/* 标签列表：自动换行排列（TagChip 自带外边距） */
.tag-list { white-space: normal; display: flex; flex-wrap: wrap; }
</style>
