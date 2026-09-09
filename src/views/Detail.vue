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
    <!-- 顶部操作栏：返回、播放、收藏、编辑、刮削来源、刮削、删除 -->
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
      <!-- 刮削来源选择（2026-09-09 新增）：自动 / 仅 JAVBUS / 仅 JAVDB -->
      <el-select v-model="scrapeSource" size="small" class="scrape-source" title="刮削来源">
        <el-option label="来源：自动" value="auto" />
        <el-option label="仅 JAVBUS" value="javbus" />
        <el-option label="仅 JAVDB" value="javdb" />
      </el-select>
      <el-button type="success" @click="onScrape" :loading="scraping">
        <AppIcon v-if="!scraping" name="globe" :size="15" style="margin-right:5px" />刮削
      </el-button>
      <el-button type="danger" @click="onDel">
        <AppIcon name="trash" :size="15" style="margin-right:5px" />删除
      </el-button>
    </div>

    <!-- 红：标题区（番号 + 片名） -->
    <div class="title-block">
      <div class="code">{{ m.ph || '—' }}</div>
      <div class="title">{{ m.pm || '无标题' }}</div>
    </div>

    <!-- 主行：绿=大图展示区（左） + 蓝=影片信息区（右） -->
    <div class="main-row">
      <!-- 绿：大图展示区（默认海报，点击底部小图切换） -->
      <div class="main-image">
        <img v-if="displayImage && !imgErr" :src="displayImage" @error="imgErr = true" />
        <div v-if="!displayImage || imgErr" class="no-cover">暂无封面</div>
      </div>
      <!-- 蓝：影片信息区 -->
      <div class="info">
        <el-descriptions :column="1" size="small" border style="margin-top:0" class="desc">
          <!-- 评分 / 想看 / 看过（有任一数据时展示，2026-09-09 新增） -->
          <el-descriptions-item v-if="hasStats" label="统计">
            <div class="stats-row">
              <span v-if="m.score" class="stat-score">{{ Number(m.score).toFixed(1) }} 分</span>
              <span v-if="m.want">想看 {{ Number(m.want).toLocaleString() }}</span>
              <span v-if="m.watched">看过 {{ Number(m.watched).toLocaleString() }}</span>
            </div>
          </el-descriptions-item>
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
          <!-- 预览图数量提示 -->
          <el-descriptions-item v-if="previewCount" label="预览图">
            {{ previewCount }} 张（点击下方小图查看）
          </el-descriptions-item>
        </el-descriptions>
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
// 刮削来源（auto/javbus/javdb），初始值取设置页的 scrape_source
const scrapeSource = ref('auto')

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

/**
 * 计算属性：预览图数量（不含海报）
 */
const previewCount = computed(() => previewList.value.length)

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
 * 根据值长度返回 span 值（长文本占 2 列，否则 1 列）
 */
function span2(val) { return val && String(val).length > 15 ? 2 : 1 }

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
  if (r.ok) {
    m.value = r.data
    // 刮削来源初始值取设置页配置（每次加载详情同步一次）
    scrapeSource.value = store.settings.scrape_source || 'auto'
  }
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
 * 在线刮削影片元数据（按顶部来源下拉指定的来源）
 * 刮削选项（预览图下载/统计抓取）由设置页配置，主进程自动读取
 */
async function onScrape() {
  if (!m.value || !window.api) return
  if (!m.value.ph) return ElMessage.warning('该影片没有番号，无法刮削')
  scraping.value = true
  try {
    const r = await window.api.scrapeMovie(m.value.ph, scrapeSource.value)
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
/* 刮削来源下拉宽度 */
.scrape-source { width: 140px; }
/* 已收藏按钮：心形图标用强调色 */
.back .fav-on .app-icon { color: var(--accent); }

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

/* 主行：大图区（左）+ 信息区（右） */
.main-row { display: flex; gap: 20px; align-items: flex-start; }
/* 绿：大图展示区：内容自适应宽度，暖灰渐变兜底 */
.main-image {
  width: fit-content;
  max-width: 52%;
  flex-shrink: 0;
  border-radius: var(--r-md);
  background: linear-gradient(135deg, var(--surface-2), var(--surface-3));
  overflow: hidden;
  border: 1px solid var(--border);
}
/* 大图：等比自适应，限制高度避免竖版海报过长 */
.main-image img { display: block; max-width: 100%; max-height: 620px; width: auto; height: auto; }
/* 无图占位块 */
.no-cover {
  width: 300px; aspect-ratio: 3/2;
  display: flex; align-items: center; justify-content: center;
  color: var(--muted); font-size: 14px;
}
/* 蓝：信息区占据剩余空间 */
.info { flex: 1; min-width: 0; }

/* 统计行（评分/想看/看过） */
.stats-row { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.stat-score {
  color: var(--accent);
  font-family: var(--font-display);
  font-weight: 700; font-size: 15px;
  font-variant-numeric: tabular-nums;
}
.stats-row span { color: var(--text-2); }

/* 黄：预览小图条（统一面板样式，与整体卡片风格一致） */
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

/* 描述列表表格布局 */
.desc :deep(table) { table-layout: auto; width: 100%; }
.desc :deep(.el-descriptions__cell) { width: auto; white-space: nowrap; padding: 4px 6px; }
.desc :deep(.el-descriptions__label-cell) { width: 1%; white-space: nowrap; color: var(--muted); font-size: 12px; }
.desc :deep(.el-descriptions__content-cell) { word-break: break-all; }
/* 标签列表：自动换行排列 */
.tag-list { white-space: normal; display: flex; flex-wrap: wrap; }
</style>
