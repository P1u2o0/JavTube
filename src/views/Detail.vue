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
    <!-- 红：标题区（圆形返回按钮 + 番号 + 标题，同一行） -->
    <div class="title-row">
      <BackButton />
      <span class="code">{{ m.ph || '—' }}</span>
      <span class="title-text">{{ m.pm || '无标题' }}</span>
    </div>

    <!-- 主行：绿=海报展示区（左） + 蓝=影片信息卡（右） -->
    <div class="main-row">
      <!-- 绿：海报展示区：框体大小按海报比例计算并强制放大到窗口的 92vh/75vw
           （小分辨率海报按此系数适度放大）。悬停变暗 + 播放按钮与片库卡片一致，点击播放 -->
      <div class="main-image" :style="{ width: boxW + 'px', height: boxH + 'px' }">
        <img v-if="cover && !imgErr" :src="cover" @load="onPosterLoad" @error="imgErr = true" />
        <div v-if="!cover || imgErr" class="no-cover">暂无封面</div>
        <div class="main-hover" :class="{ playable: !!m.py }" @click="onPlay">
          <button v-if="m.py" class="play-btn" aria-label="播放">
            <AppIcon name="play" :size="24" />
          </button>
        </div>
      </div>
      <!-- 蓝：影片信息卡（行序：番号/日期/时长/导演/片商/系列/评分/类别/演员，底部为操作按钮） -->
      <div class="info-card">
        <!-- 番号行：番号 + 复制按钮（点击复制到剪贴板） -->
        <div class="info-body">
        <div class="info-line" v-if="m.ph">
          <span class="info-label">番号</span>
          <div class="info-value code-line">
            <span class="code-text">{{ m.ph }}</span>
            <button class="copy-btn" title="复制番号" @click="copyCode">
              <AppIcon name="copy" :size="14" />
            </button>
          </div>
        </div>
        <!-- 日期 -->
        <div class="info-line" v-if="m.fxrq">
          <span class="info-label">日期</span>
          <div class="info-value">{{ m.fxrq }}</div>
        </div>
        <!-- 时长（刮削優先；无刮削值时由视频文件解析补齐） -->
        <div class="info-line" v-if="m.duration">
          <span class="info-label">时长</span>
          <div class="info-value">{{ m.duration }} 分钟</div>
        </div>
        <!-- 评分（五颗星：按分数比例填充——如 4.6 分则第 5 颗填充 60%） -->
        <div class="info-line" v-if="m.score">
          <span class="info-label">评分</span>
          <div class="info-value star-row">
            <span class="stars">
              <span v-for="i in 5" :key="i" class="star">
                <svg class="star-base" viewBox="0 0 24 24" aria-hidden="true">
                  <path :d="STAR_PATH" />
                </svg>
                <span class="star-clip" :style="{ width: starFill(i) + '%' }">
                  <svg class="star-on" viewBox="0 0 24 24" aria-hidden="true">
                    <path :d="STAR_PATH" />
                  </svg>
                </span>
              </span>
            </span>
            <span class="score-num">{{ Number(m.score).toFixed(1) }}</span>
          </div>
        </div>
        <!-- 热度（想看/看过人数，来源 JAVDB） -->
        <div class="info-line" v-if="m.want || m.watched">
          <span class="info-label">热度</span>
          <div class="info-value stats-line">
            <span v-if="m.want">想看 {{ fmt(m.want) }}</span>
            <span v-if="m.watched">看过 {{ fmt(m.watched) }}</span>
          </div>
        </div>
        <!-- 导演（可点击筛选） -->
        <div class="info-line" v-if="directorList.length">
          <span class="info-label">导演</span>
          <div class="info-value tag-list">
            <TagChip v-for="d in directorList" :key="d" :label="d" @click="filterByDirector(d)" />
          </div>
        </div>
        <!-- 片商（可点击筛选） -->
        <div class="info-line" v-if="psList.length">
          <span class="info-label">片商</span>
          <div class="info-value tag-list">
            <TagChip v-for="s in psList" :key="s" :label="s" @click="filterByStudio(s)" />
          </div>
        </div>
        <!-- 系列（可点击筛选） -->
        <div class="info-line" v-if="m.xl">
          <span class="info-label">系列</span>
          <div class="info-value">
            <TagChip :label="m.xl" @click="filterBySeries(m.xl)" />
          </div>
        </div>
        <!-- 类别（影片标签，可点击筛选）——标签多行时该行自动变高，行间距仍均匀 -->
        <div class="info-line tag-line" v-if="tags.length">
          <span class="info-label">类别</span>
          <div class="info-value tag-list">
            <TagChip v-for="t in tags" :key="t" :label="t" @click="filterByTag(t)" />
          </div>
        </div>
        <!-- 演员（仅名字，点击进入该女优的影片页） -->
        <div class="info-line tag-line" v-if="actressList.length">
          <span class="info-label">演员</span>
          <div class="info-value tag-list">
            <TagChip v-for="a in actressList" :key="a" :label="a" @click="goActor(a)" />
          </div>
        </div>
        </div>
          <!-- 操作按钮：喜欢 / 刮削 / 编辑 / 删除（large 尺寸，与放大的信息文字协调） -->
          <div class="card-actions">
          <el-button size="large" class="act-fav" :class="{ 'fav-on': isFav }" @click="toggleFav">
            <AppIcon :name="isFav ? 'heart-filled' : 'heart'" :size="15" style="margin-right:5px" />{{ isFav ? '已喜欢' : '喜欢' }}
          </el-button>
          <el-button size="large" class="act-scrape" @click="onScrape" :loading="scraping">
            <AppIcon v-if="!scraping" name="globe" :size="15" style="margin-right:5px" />刮削
          </el-button>
          <el-button size="large" @click="editShow = true">
            <AppIcon name="edit" :size="15" style="margin-right:5px" />编辑
          </el-button>
          <el-button size="large" class="act-del" @click="onDel">
            <AppIcon name="trash" :size="15" style="margin-right:5px" />删除
          </el-button>
        </div>
      </div>
    </div>

    <!-- 黄：预览小图条（第一张固定为海报；点击小图在灯箱中查看，灯箱内左右切换/滚轮缩放）
         小图超出容器时横向滚动条只支持拖拽，这里把悬停其上的鼠标滚轮映射为横向滚动 -->
    <div class="preview-strip" v-if="galleryImages.length > 1" @wheel="onStripWheel">
      <div class="strip-track" ref="stripRef">
        <div v-for="(g, i) in galleryImages" :key="i" class="strip-item" @click="openLightbox(i)">
          <img :src="g" loading="lazy" />
          <span v-if="i === 0" class="strip-badge">海报</span>
        </div>
      </div>
    </div>

    <!-- ====== 灯箱查看器：点击预览图后全屏弹出（背景渐暗）， ====== -->
    <!-- ====== 滚轮缩放、左右按钮/方向键切换、Esc 或点击空白关闭 ====== -->
    <!-- Teleport 到 body：脱离滚动容器，遮罩在最大化/滚动任何状态下都严格全屏 -->
    <Teleport to="body">
      <transition name="lb-fade">
        <div v-if="lightboxShow" class="lightbox" @click.self="closeLightbox" @wheel.prevent="onWheel">
          <!-- 左右切换按钮 -->
          <button class="lb-arrow lb-prev" aria-label="上一张" @click.stop="stepLightbox(-1)">
            <AppIcon name="back" :size="22" />
          </button>
          <!-- 当前图片 -->
          <img class="lb-img" :src="galleryImages[lightboxIdx]" :style="{ transform: `scale(${zoom})` }" @click.stop />
          <button class="lb-arrow lb-next" aria-label="下一张" @click.stop="stepLightbox(1)">
            <AppIcon name="back" :size="22" class="flip-x" />
          </button>
          <!-- 页码指示 -->
          <div class="lb-count">{{ lightboxIdx + 1 }} / {{ galleryImages.length }}</div>
        </div>
      </transition>
    </Teleport>

    <!-- 编辑对话框 - 复用 ManualForm 手动录入表单 -->
    <el-dialog v-model="editShow" title="编辑影片" width="820px" destroy-on-close>
      <ManualForm :initial="m" @submit="onSaveEdit" />
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useMoviesStore } from '@/store/movies'
import { useScrapeStore } from '@/store/scrape'
import TagChip from '@/components/TagChip.vue'
import AppIcon from '@/components/AppIcon.vue'
import BackButton from '@/components/BackButton.vue'
import ManualForm from '@/components/AddMovieDialog/ManualForm.vue'
import { resolveCover, buildScrapeUpdate, safeCall, splitTags, bumpCover, SCRAPE_FIELD_LABELS, statsFillHint } from '@/utils/global'

// 路由与 store 实例
const route = useRoute()
const router = useRouter()
const store = useMoviesStore()
// 刮削任务 store（单部刮削进度，顶栏铃铛面板展示）
const scrapeStore = useScrapeStore()

// 响应式状态
const m = ref(null)            // 当前影片数据对象
const editShow = ref(false)    // 编辑对话框显示状态
const scraping = ref(false)    // 刮削进行中标志
const imgErr = ref(false)      // 海报加载失败标志
const stripRef = ref(null)     // 预览小图条轨道 DOM 引用
// 海报框尺寸：按海报原始比例计算并强制放大——目标为窗口的 92vh 高 / 75vw 宽
// （小分辨率海报按此系数适度放大），窗口 resize 时重算。默认 2:3 兜底。
const boxW = ref(413)
const boxH = ref(620)
const posterNatural = ref(null)  // 海报原始像素尺寸 { w, h }

/**
 * 按当前窗口大小计算海报框尺寸：
 * 缩放系数 = min(92vh / 海报高, 75vw / 海报宽)，框 = 海报原始尺寸 × 系数
 */
function computeBox() {
  if (!posterNatural.value) return
  const { w, h } = posterNatural.value
  const scale = Math.min(
    (window.innerHeight - 300) / h,
    (window.innerWidth * 0.56) / w
  )
  boxW.value = Math.round(w * scale)
  boxH.value = Math.round(h * scale)
}

/**
 * 海报加载完成：记录原始尺寸并计算框体
 */
function onPosterLoad(e) {
  posterNatural.value = {
    w: e.target.naturalWidth || 800,
    h: e.target.naturalHeight || 1200
  }
  computeBox()
}

// 窗口尺寸变化时重算海报框
onMounted(() => window.addEventListener('resize', computeBox))
onBeforeUnmount(() => window.removeEventListener('resize', computeBox))
// 灯箱查看器状态
const lightboxShow = ref(false)  // 灯箱显隐
const lightboxIdx = ref(0)       // 灯箱当前图片索引（galleryImages 内）
const zoom = ref(1)              // 灯箱图片缩放倍数（滚轮调节）

/**
 * 计算属性：海报图解析为可显示的 URL（无值时为空串）
 * 传影片 id 作版本键：本页刮削成功后 bumpCover 会让 URL 换新（同一路径的封面文件
 * 被覆盖写入时，URL 不变浏览器就不会重新加载，海报会停在旧图）
 */
const cover = computed(() => m.value ? resolveCover(m.value.cover, m.value.id) : '')

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
    // 预览图同样是「固定文件名覆盖写入」，共用影片 id 作版本键才能一起刷新
    const u = resolveCover(p, m.value?.id)
    if (u) list.push(u)
  }
  return list
})

// 画廊变化（加载新影片/刮削后刷新）时，重置海报加载错误状态并关闭灯箱
watch([galleryImages], () => { imgErr.value = false; lightboxShow.value = false })

/**
 * 灯箱：打开（从预览小图点击进入），索引指向所点小图，缩放复位
 */
function openLightbox(i) {
  lightboxIdx.value = i
  zoom.value = 1
  lightboxShow.value = true
}

/**
 * 灯箱：关闭
 */
function closeLightbox() {
  lightboxShow.value = false
}

/**
 * 灯箱：左右切换图片（循环），切换后缩放复位
 */
function stepLightbox(dir) {
  const n = galleryImages.value.length
  if (!n) return
  lightboxIdx.value = (lightboxIdx.value + dir + n) % n
  zoom.value = 1
}

/**
 * 灯箱：鼠标滚轮缩放（上滚放大 / 下滚缩小，0.5 ~ 5 倍）
 */
function onWheel(e) {
  const delta = e.deltaY > 0 ? -0.15 : 0.15
  zoom.value = Math.min(5, Math.max(0.5, zoom.value + delta))
}

/**
 * 预览小图条：鼠标滚轮 → 横向滚动。
 *
 * 小图条是 overflow-x 容器，图片多时会出现横向滚动条，但滚轮默认只滚页面纵向，
 * 用户必须去拖那条细滚动条，很不顺手。这里把悬停在预览区上的滚轮位移映射到横向滚动：
 * - 触控板/横向滚轮本身带 deltaX，优先用它；普通鼠标只有 deltaY，拿它当横向位移。
 * - deltaMode 归一化：1=行、2=页，都换算成像素。
 * - 未溢出、或已滚到两端时**不拦截**，让页面照常上下滚动，避免"滚不动还被吞掉"的卡顿感。
 */
function onStripWheel(e) {
  const track = stripRef.value
  if (!track) return
  const max = track.scrollWidth - track.clientWidth
  if (max <= 0) return                                   // 没溢出：交给页面
  let d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  if (e.deltaMode === 1) d *= 16                         // 按行
  else if (e.deltaMode === 2) d *= track.clientWidth      // 按页
  const next = Math.min(max, Math.max(0, track.scrollLeft + d))
  if (next === track.scrollLeft) return                   // 已到两端：交给页面
  e.preventDefault()                                      // 拦截，阻止页面跟着纵向滚动
  // behavior:'instant' 覆盖 CSS 的 scroll-behavior:smooth —— 逐次滚轮若走平滑动画会明显发黏
  track.scrollBy({ left: next - track.scrollLeft, behavior: 'instant' })
}

/**
 * 灯箱打开时的键盘操作：Esc 关闭、←/→ 切换
 */
function onKey(e) {
  if (e.key === 'Escape') closeLightbox()
  else if (e.key === 'ArrowLeft') stepLightbox(-1)
  else if (e.key === 'ArrowRight') stepLightbox(1)
}

// 灯箱显隐时挂载/卸载键盘监听
watch(lightboxShow, (v) => {
  if (v) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})

// 组件卸载时清理键盘监听，避免泄漏
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

/**
 * 计算属性：是否已收藏（cl 字段为 'y'）
 */
const isFav = computed(() => m.value?.cl === 'y')

/**
 * 计算属性：标签列表（按逗号分割 bq 字段）
 */
const tags = computed(() => splitTags(m.value?.bq))

/**
 * 计算属性：女优列表（按逗号分割 yid 字段）
 */
const actressList = computed(() => splitTags(m.value?.yid))

/** 跳转该女优的影片列表页（演员栏点击名字时） */
function goActor(name) {
  if (name) router.push(`/actor/${encodeURIComponent(name)}`)
}

/**
 * 计算属性：导演列表（按逗号分割 dy 字段）
 */
const directorList = computed(() => splitTags(m.value?.dy))

/**
 * 计算属性：片商列表（按逗号分割 ps 制作商字段）
 */
const psList = computed(() => splitTags(m.value?.ps))

/**
 * 计算属性：五角星填充数量（一颗星一分，四舍五入，范围 0-5）
 */
/**
 * 第 i 颗星的填充百分比（0-100）：按分数精确比例，如 4.6 分 → 第 5 颗 60%。
 * 例：4.6 → i=1..4 得 100，i=5 得 60；3.25 → 星 1-3 100、星 4 25、星 5 0。
 * @param {number} i - 星序号（1-5）
 * @returns {number} 填充百分比
 */
function starFill(i) {
  const score = Number(m.value?.score) || 0
  return Math.min(100, Math.max(0, Math.round((score - (i - 1)) * 100)))
}

// 五角星 SVG 路径（实心五角星）
// 星形路径（内径比 ~0.48 的偏瘦五角星，比通用实心星更轻盈克制，贴合工具软件的线性气质）
const STAR_PATH = 'M12 2.6l2.75 5.85 6.45.83-4.75 4.42 1.22 6.3L12 16.9l-5.67 3.1 1.22-6.3-4.75-4.42 6.45-.83z'

/**
 * 复制番号到剪贴板
 */
async function copyCode() {
  if (!m.value?.ph) return
  try {
    await navigator.clipboard.writeText(m.value.ph)
    ElMessage.success('番号已复制：' + m.value.ph)
  } catch {
    ElMessage.error('复制失败，请手动选择复制')
  }
}

/**
 * 数字格式化（千分位，用于想看/看过人数）
 */
function fmt(n) { return Number(n || 0).toLocaleString() }


/**
 * 加载影片详情数据
 * @param {number} id - 影片 ID
 */
async function load(id) {
  if (!window.api) return
  const r = await window.api.getMovie(id)
  if (r.ok) m.value = r.data
  else { ElMessage.error(r.error); router.replace('/library') }
  // 时长兜底：无刮削时长且有本地视频文件时，解析 MP4 文件时长（分钟）并入库
  if (r.ok && m.value && !m.value.duration && m.value.py && window.api.readVideoDuration) {
    try {
      const dr = await window.api.readVideoDuration(m.value.py)
      if (dr.ok && dr.data) {
        await window.api.updateMovie(m.value.id, { duration: dr.data })
        m.value.duration = dr.data
      }
    } catch {}
  }
}

/**
 * 播放影片并记录播放
 */
async function onPlay() {
  if (!m.value?.py) return ElMessage.warning('未设置视频路径')
  const r = await window.api.playVideo(m.value.py).catch(() => null)
  if (!r || !r.ok) return ElMessage.error(r?.error || '播放失败')
  safeCall(window.api.recordPlay(m.value.id))
}

/**
 * 切换收藏状态（乐观更新：先翻转界面状态，写入失败回滚）
 */
async function toggleFav() {
  if (!m.value || !window.api) return
  const v = isFav.value ? 'n' : 'y'
  const prev = m.value.cl
  m.value.cl = v
  const r = await window.api.updateMovie(m.value.id, { cl: v })
  if (!r.ok) m.value.cl = prev
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
  const key = scrapeStore.start(m.value.ph, m.value.pm)
  // 刮削来源：fill = 补全字段模式（照常走自动刮削，但只写当前为空的字段）
  const mode = store.settings.scrape_source || 'auto'
  const fillOnly = mode === 'fill'
  const source = fillOnly ? 'auto' : mode
  try {
    const r = await window.api.scrapeMovie(m.value.ph, source, {
      // 补全模式且已有预览图时不必重复下载（10 张/部）
      skipPreviews: fillOnly && !!m.value.previews
    })
    if (r.ok && r.data) {
      const update = buildScrapeUpdate(r.data, m.value, { fillOnly })
      const fields = Object.keys(update)
      // 评分/想看/看过 只来自 JAVDB：Cookie 过期或 403 时静默拿不到，这里给出明确原因
      // 判断依据是「合并本次更新之后」的记录：已补上的字段不能再报未取到
      const statsHint = fillOnly ? statsFillHint({ ...m.value, ...update }, store.settings.scrape_stats !== 'n') : ''
      if (fillOnly && !fields.length) {
        // 该影片所有可补字段都已有值 —— 不写库，避免无谓覆盖
        scrapeStore.done(key, true)
        if (statsHint) ElMessage.warning(`未能补全 ${statsHint}：JAVDB 未返回数据（请检查 Cookie 与代理设置）`)
        else ElMessage.info('该影片字段已完整，无需补全')
        return
      }
      const ur = await window.api.updateMovie(m.value.id, update)
      if (ur.ok) {
        scrapeStore.done(key, true)
        // 封面/预览图是按固定文件名覆盖写入的，URL 不变浏览器不会重新加载 → 换新版本号强制刷新
        bumpCover(m.value.id)
        if (fillOnly) {
          const hint = statsHint ? `；${statsHint} 未取到（检查 JAVDB Cookie 与代理）` : ''
          ElMessage.success(`已补全 ${fields.length} 个字段：${fields.map(f => SCRAPE_FIELD_LABELS[f] || f).join('、')}${hint}`)
        } else {
          ElMessage.success(`刮削成功（来源: ${r.data.source}）`)
        }
        await load(m.value.id)
        await store.loadAllDbTags()  // 刷新标签统计（标签按影片数量排序，见 TagFilter.byUsage）
      } else {
        scrapeStore.done(key, false, ur.error)
        ElMessage.error('更新失败：' + ur.error)
      }
    } else {
      scrapeStore.done(key, false, r.error || '未找到')
      ElMessage.error('刮削失败：' + (r.error || '未找到'))
    }
  } catch (e) {
    scrapeStore.done(key, false, e.message)
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
 * 跳转到片库按厂商筛选
 */
function filterByStudio(s) { router.push({ path: '/library', query: { studio: s } }) }
/**
 * 跳转到片库按导演筛选（2026-09-09 新增）
 */
function filterByDirector(d) { router.push({ path: '/library', query: { director: d } }) }
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
/* 信息卡底部操作按钮区（喜欢/刮削/编辑/删除）：恒定贴底，
   margin-top:auto + flex-shrink:0 使其不受上方信息行间距调整影响 */
.card-actions {
  display: flex; gap: 8px; flex-wrap: wrap;
  margin-top: auto;
  padding-top: 12px;
  flex-shrink: 0;
  border-top: 1px dashed var(--border);
}
/* 喜欢按钮：收藏态品牌红描边 + 图标强调 */
.card-actions .act-fav.fav-on {
  color: var(--accent) !important;
  border-color: var(--accent) !important;
  background: var(--accent-soft) !important;
}
.card-actions .act-fav.fav-on .app-icon { color: var(--accent); }
/* 刮削按钮：hover 品牌红（强调语义） */
.card-actions .act-scrape:hover,
.card-actions .act-scrape:focus {
  background: var(--accent-soft) !important;
  border-color: var(--accent) !important;
  color: var(--accent) !important;
}
/* 删除按钮：hover 危险红（强调语义） */
.card-actions .act-del:hover,
.card-actions .act-del:focus {
  background: var(--danger-soft) !important;
  border-color: var(--danger) !important;
  color: var(--danger) !important;
}

/* 红：标题行（圆形返回 + 番号 + 标题） */
.title-row {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  margin-bottom: 14px;
}
/* 圆形返回按钮的样式已抽到公共组件 @/components/BackButton.vue */
/* 番号样式：展示字 + 等宽数字 */
.code {
  color: var(--primary);
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  font-weight: 700; font-size: var(--fs-3xl);
  letter-spacing: 0.02em;
}
/* 标题样式：与番号同行，长标题自动换行 */
.title-text { font-size: var(--fs-3xl); font-weight: 600; color: var(--text); line-height: 1.5; word-break: break-all; }

/* 主行：海报区（左，尺寸按海报比例放大）+ 信息卡（右，等高对齐） */
.main-row { display: flex; gap: 20px; align-items: stretch; }
/* 绿：海报展示区：框体尺寸由 JS 按海报原始比例计算（:style 绑定 boxW/boxH），
   按视口剩余高度（100vh - 300px，容纳标题/预览条/边距）与 56vw 宽度放大，页面不出现滚动条——小分辨率海报同样放大显示，
   窗口 resize 时重算。海报 contain 贴合框体，无空白 */
.main-image {
  flex-shrink: 0;
  border-radius: var(--r-md);
  background: linear-gradient(135deg, var(--surface-2), var(--surface-3));
  overflow: hidden;
  border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.main-image img {
  display: block;
  width: 100%; height: 100%;
  object-fit: contain;
}
/* 悬停遮罩：海报变暗 + 中央播放按钮（样式/过渡与片库卡片完全一致） */
.main-hover {
  position: absolute; inset: 0;
  background: var(--overlay-hover);
  opacity: 0;
  transition: opacity var(--dur-fast) ease;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
}
.main-hover.playable { cursor: pointer; }
.main-image:hover .main-hover.playable { opacity: 1; pointer-events: auto; }
/* 播放按钮：圆形白底墨黑图标（详情页海报区更大，按钮相应放大） */
.play-btn {
  width: 56px; height: 56px;
  border: none; border-radius: 50%;
  background: rgba(255, 255, 255, 0.94);
  color: var(--primary);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: var(--sh-2);
  /* 柔和反馈：与片库卡片播放按钮一致 */
  transition: transform var(--dur-base) var(--ease-spring), background var(--dur-fast) ease;
}
.play-btn:hover { transform: scale(1.06); background: #fff; }
.play-btn:active { transform: scale(0.96); transition-duration: var(--dur-press); }
/* 无图占位块 */
.no-cover {
  width: 300px; aspect-ratio: 3/2;
  display: flex; align-items: center; justify-content: center;
  color: var(--muted); font-size: var(--fs-md);
}

/* 蓝：影片信息卡（轻量行式布局）：高度与大图区一致（stretch），
   信息行在卡内均匀分布（space-evenly），行数多时自动紧凑 */
.info-card {
  flex: 1; min-width: 0;
  align-self: stretch;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--sh-1);        /* Apple：面板微阴影 */
  padding: 12px 20px;
  display: flex; flex-direction: column;
  overflow: hidden;
}
/* 信息行容器：信息行均分卡片高度（不含底部按钮区），
   每行上下间距严格一致；行内容多时该行自动扩展、其余行压缩 */
.info-body {
  flex: 1;
  display: flex; flex-direction: column;
  justify-content: space-evenly;   /* 行间距均匀（含首尾），标签两行时自动压缩仍相等 */
  min-height: 0;
  overflow: hidden;                /* 内容过多时裁剪，不挤压底部按钮区 */
}
/* 番号行：番号文字 + 复制按钮 */
.code-line { display: inline-flex; align-items: center; gap: 8px; }
.code-text {
  color: var(--primary);
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  font-weight: 700; font-size: var(--fs-2xl);
  letter-spacing: 0.02em;
}
/* 复制按钮：小型圆形弱化按钮，hover 强调色 */
.copy-btn {
  width: var(--icon-btn-sm); height: var(--icon-btn-sm);
  border: none; border-radius: 50%;
  background: transparent; color: var(--muted);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
}
.copy-btn:hover { background: var(--accent-soft); color: var(--accent); }
.copy-btn:active { transform: scale(0.96); transition-duration: var(--dur-press); }

/* 评分五角星行 */
.star-row { display: flex; align-items: center; gap: 10px; }
.stars { display: inline-flex; gap: 3px; }
/* 单颗星：灰底 + 按比例填充的叠层（clip 宽度由 starFill 控制） */
.star { position: relative; width: 19px; height: 19px; display: inline-block; }
.star-base { position: absolute; inset: 0; width: 100%; height: 100%; fill: var(--border-strong); }
.star-clip {
  position: absolute; left: 0; top: 0; height: 100%;
  overflow: hidden;                 /* 按宽度裁出填充比例 */
  transition: width var(--dur-base) var(--ease-out);
}
.star-clip .star-on { width: 19px; height: 19px; display: block; fill: var(--warning); }
.score-num {
  color: var(--text); font-weight: 600; font-size: var(--fs-md);
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
}

/* 热度行（想看/看过） */
.stats-line { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.stats-line > span { display: inline-flex; align-items: center; gap: 5px; }
.stats-line .app-icon { color: var(--muted); }
/* 信息行：高度由内容决定，行与行之间由父容器 space-evenly 均匀分配间距
   （无横线；标签多行时该行自动变高，间距仍保持相等） */
.info-line {
  flex: 0 0 auto;
  display: flex; gap: 14px;
  align-items: center;
}
.info-label {
  width: 60px; flex-shrink: 0;
  color: var(--muted); font-size: var(--fs-lg);
}
.info-value {
  flex: 1; min-width: 0;
  color: var(--text); font-size: var(--fs-xl);
  line-height: 1.7;
  word-break: break-all;
}
/* 标签列表：自动换行排列，chip 与行内文字垂直居中。
   TagChip 自带 3px 上下外边距，会让标签行盒比纯文字行"虚高"，
   导致该行与相邻行的视觉间距比其他行大 6px；这里用负 margin 抵消，
   使标签单行/多行时的行间距都与其他信息行严格相同。 */
.tag-list { white-space: normal; display: flex; flex-wrap: wrap; align-items: center; margin: -3px 0; }
.preview-strip {
  margin-top: 16px;
  display: flex; align-items: center; gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 10px 12px;
}
/* 右箭头：左箭头图标翻转 180°（灯箱切换按钮复用） */
.flip-x { transform: rotate(180deg); }

/* ====== 灯箱查看器 ====== */
/* 全屏遮罩：点击空白处关闭；淡入淡出过渡（背景慢慢变暗/变亮） */
.lightbox {
  position: fixed; inset: 0;
  top: 48px;   /* 与 el-dialog 遮罩一致：从顶栏下方开始，顶栏与窗口按钮区不受影响 */
  z-index: 3000;
  /* 遮罩色与 el-dialog（设置等弹窗）保持一致：直接引用 EP 的遮罩变量，
     而不是自定义的 --overlay-backdrop（那是 88% 暖黑，比弹窗重得多） */
  background: var(--el-overlay-color-lighter);
  display: flex; align-items: center; justify-content: center;
}
.lb-fade-enter-active { transition: opacity var(--dur-base) var(--ease-out); }
.lb-fade-leave-active { transition: opacity var(--dur-fast) ease; }   /* 退出更快 */
.lb-fade-enter-from, .lb-fade-leave-to { opacity: 0; }
/* 当前图片：初始 contain 于视口内（约 82% 宽 / 84% 高），滚轮缩放经 transform 生效 */
.lb-img {
  max-width: 82vw; max-height: 92vh;
  width: auto; height: auto;
  border-radius: var(--r-sm);
  box-shadow: 0 12px 48px rgba(50, 46, 38, 0.5);
  transition: transform var(--dur-fast) var(--ease-out);
  cursor: grab;
}
/* 左右切换按钮：两侧居中半透明圆钮，hover 放大 */
.lb-arrow {
  position: absolute; top: 50%;
  transform: translateY(-50%);
  width: 48px; height: 48px;
  border: none; border-radius: 50%;
  background: var(--overlay-glass);
  color: rgba(255, 255, 255, 0.9);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background var(--dur-fast) ease, transform var(--dur-fast) ease;
}
.lb-arrow:hover { background: var(--overlay-glass-hover); transform: translateY(-50%) scale(1.06); }
.lb-arrow:active { transform: translateY(-50%) scale(0.96); transition-duration: var(--dur-press); }
.lb-prev { left: 24px; }
.lb-next { right: 24px; }
/* 页码指示：底部居中 */
.lb-count {
  position: absolute; bottom: 22px; left: 50%;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.85);
  font-size: var(--fs-base);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.06em;
}
/* 小图横向轨道 */
.strip-track { display: flex; gap: 8px; overflow-x: auto; flex: 1; scroll-behavior: smooth; padding: 2px; }
/* 单个小图：3:2 缩略，选中时品牌红描边 */
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
  background: var(--overlay-strong);
  color: #fff; font-size: var(--fs-xs); line-height: 1;
  padding: 3px 6px; border-radius: var(--r-pill);
  pointer-events: none;
}

</style>
