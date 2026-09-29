<!--
  @file Player.vue
  @module src/views/Player
  @description 内置播放页（2026-09-29）：左侧播放器 + 右侧「相关推荐」栏（参考视频站版式）。
               播放器用 ArtPlayer（轻量、零依赖）；键盘由页面统一接管：
                 单击 ←/→  = 快退/进 seekStep 秒
                 长按 →    = holdSpeed 倍速播放（松开恢复）
                 长按 ←    = 加速倒带（HTML5 不支持负倍速，用连续 seek 模拟，越按越快）
                 空格/M/F/↑/↓ = 播放暂停 / 静音 / 全屏 / 音量（键位可在设置→快捷键里改）
               进度记忆：每 5 秒 + 暂停/切页时落库（movies.play_pos），再次进入自动续播。
  @dependencies artplayer, vue-router, window.api (getPlayProgress/savePlayProgress/getRecommendations/playVideo)
-->

<template>
  <div class="player-page" tabindex="-1">
    <!-- ============ 左列：标题 + 播放器 + 女优信息 ============ -->
    <div class="main-col">
      <!-- 标题行（播放器上方）：番号 + 片名。
           行高固定 --head-h，与右列「相关推荐」标题同高 → 播放器与第一张海报顶边对齐 -->
      <div class="info-head">
        <div class="info-title" v-if="m" :title="[m.ph, m.pm || m.ph].filter(Boolean).join(' ')">
          <span class="info-ph">{{ m.ph }}</span>
          <span class="info-name">{{ m.pm || m.ph }}</span>
        </div>
      </div>

      <div class="player-box" ref="boxRef"></div>

      <!-- 视频无法播放（容器/编码不支持，如 avi/wmv）-->
      <div v-if="mediaErr" class="media-error">
        <div class="me-title">该视频无法在软件内播放</div>
        <div class="me-desc">
          当前格式（{{ ext }}）浏览器的解码器不支持。可以用外部播放器打开，
          或到「详情页」检查文件是否完好。
        </div>
        <div class="me-actions">
          <el-button type="primary" @click="playExternal">用外部播放器打开</el-button>
          <el-button @click="goDetail">查看详情</el-button>
        </div>
      </div>

      <!-- 播放器下方一行：女优（头像+名字）+ 全部标签 → 最右：评分统计 + 喜欢 -->
      <div class="info-sub" v-if="m">
        <div class="sub-left">
          <!-- 女优：圆形头像 + 名字，点击进入该女优的影片页（多女优时显示首位 + 余数） -->
          <button v-if="leadActress" type="button" class="actress"
                  :title="`查看 ${leadActress.name} 的全部影片`"
                  @click="goActor(leadActress.name)">
            <span class="ac-avatar">
              <img v-if="avatarUrl" :src="avatarUrl" :alt="leadActress.name" @error="avatarBroken = true" />
              <span v-else class="ac-fallback">{{ leadActress.name.slice(0, 1) }}</span>
            </span>
            <span class="ac-name">{{ leadActress.name }}</span>
            <span v-if="actressExtra > 0" class="ac-more">+{{ actressExtra }}</span>
          </button>

          <!-- 影片全部标签：体型/行为/玩法 三类排在所有标签之前（顺序：体型 → 行为 → 玩法） -->
          <span v-for="t in sortedTags" :key="t" class="cat-tag">{{ t }}</span>
        </div>

        <div class="sub-right">
          <span class="info-stats">
            <span v-if="m.score > 0" class="rating">★ {{ Number(m.score).toFixed(1) }}</span>
            <span v-if="m.duration > 0">{{ fmtDur(m.duration) }}</span>
          </span>
          <!-- 喜欢（图标 + 文字，与详情页同一套文案与红态） -->
          <button type="button" class="fav-btn" :class="{ on: m.cl === 'y' }" @click="toggleFav"
                  :title="m.cl === 'y' ? '取消喜欢' : '喜欢'">
            <AppIcon :name="m.cl === 'y' ? 'heart-filled' : 'heart'" :size="15" />
            <span>{{ m.cl === 'y' ? '已喜欢' : '喜欢' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ============ 右列：相关推荐 ============ -->
    <aside class="rec-col">
      <div class="rec-head">相关推荐</div>
      <div class="rec-list">
        <div v-if="!recs.length && !recLoading" class="rec-empty">暂无推荐</div>
        <div v-for="r in recs" :key="r.id" class="rec-item" @click="goMovie(r.id)">
          <div class="thumb">
            <img v-if="coverUrl(r)" :src="coverUrl(r)" loading="lazy" decoding="async" @error="r._err = true" v-show="!r._err" />
            <div v-if="!coverUrl(r) || r._err" class="no-cover">无封面</div>
            <span v-if="r.duration > 0" class="dur">{{ fmtDur(r.duration) }}</span>
          </div>
          <div class="rec-info">
            <div class="rec-title" :title="r.pm || r.ph">{{ r.pm || r.ph }}</div>
            <div class="rec-meta">
              <span class="rec-ph">{{ r.ph }}</span>
              <span v-if="r.score > 0">★ {{ Number(r.score).toFixed(1) }}</span>
            </div>
            <!-- 热度数据（替代原「共同标签/同厂商」推荐理由描述） -->
            <div class="rec-stats" v-if="fmtCount(r.watched) || fmtCount(r.want)">
              <span v-if="fmtCount(r.watched)">看过 {{ fmtCount(r.watched) }}</span>
              <span v-if="fmtCount(r.want)">想看 {{ fmtCount(r.want) }}</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import Artplayer from 'artplayer'
import AppIcon from '@/components/AppIcon.vue'
import { resolveMedia, resolveCover, splitTags, dataDirRef } from '@/utils/global'
import { useMoviesStore } from '@/store/movies'

const route = useRoute()
const router = useRouter()
const store = useMoviesStore()

// ====== 状态 ======
const boxRef = ref(null)
const m = ref(null)            // 当前影片行（movies 表）
const recs = ref([])           // 相关推荐列表
const recLoading = ref(false)
const mediaErr = ref(false)
let art = null                 // ArtPlayer 实例（非响应式）
let recordedFor = null         // recordPlay 去重：同一部影片一次会话只记一次
let lastSaveTs = 0             // 进度节流
let pendingPos = 0             // 最新播放位置（切页兜底保存用）
let pendingDur = 0
let resumedFor = null          // 已对哪部影片做过续播

const ext = computed(() => {
  const py = m.value?.py || ''
  const i = py.lastIndexOf('.')
  return i >= 0 ? py.slice(i + 1).toUpperCase() : '?'
})

function coverUrl(r) {
  if (!r || r._err) return ''
  try { return resolveCover(r.cover, r.id) || '' } catch { return '' }
}

function fmtDur(min) {
  const n = Number(min) || 0
  if (!n) return ''
  const h = Math.floor(n / 60), mm = Math.round(n % 60)
  return h ? `${h}小时${mm ? mm + '分' : ''}` : `${mm}分钟`
}

/**
 * 想看/看过人数格式化：推荐栏窄，1 万以上折成「1.2万」避免换行；1 万以内原样显示。
 * @param {number|string} n
 * @returns {string} 空值（0/NaN）返回空串，调用方据此隐藏
 */
function fmtCount(n) {
  const v = Number(n) || 0
  if (v <= 0) return ''
  if (v < 10000) return String(v)
  const w = v / 10000
  return (w >= 10 ? Math.round(w) : Math.round(w * 10) / 10) + '万'
}

// ====== 女优（标题下方：圆形头像 + 名字）======
const avatarBroken = ref(false)

/**
 * 女优列表：优先取 cast_json 里 gender !== 'm' 的项（带 avatar，是头像的唯一可靠来源）；
 * cast_json 缺失（未刮削的老数据）时退回演员文本字段 —— 名字仍可点，头像用首字占位。
 * @returns {{name: string, avatar: string}[]}
 */
const actresses = computed(() => {
  const row = m.value
  if (!row) return []
  let cast = []
  try { cast = JSON.parse(row.cast_json || '[]') } catch { cast = [] }
  const list = Array.isArray(cast)
    ? cast
      .filter(c => c && c.name && String(c.gender || '').toLowerCase() !== 'm')
      .map(c => ({ name: String(c.name), avatar: c.avatar || '' }))
    : []
  if (list.length) return list
  return splitTags(row.yid).map(name => ({ name, avatar: '' }))
})

const leadActress = computed(() => actresses.value[0] || null)
/** 除首位外还有几位（>0 时名字右侧显示 +N） */
const actressExtra = computed(() => Math.max(0, actresses.value.length - 1))
const avatarUrl = computed(() => {
  const a = leadActress.value
  if (!a || !a.avatar || avatarBroken.value) return ''
  try { return resolveCover(a.avatar) || '' } catch { return '' }
})

// ====== 标签：全部展示，其中「体型 / 行为 / 玩法」三类排到最前 ======
const CAT_WHITELIST = ['体型', '行为', '玩法']
/**
 * 影片全部标签（bq）重排：
 *  1) 先输出「体型 → 行为 → 玩法」三类里命中的标签（类内保持分类配置顺序，跨类去重）
 *  2) 其余标签按 bq 原顺序跟在后面
 * @returns {string[]}
 */
const sortedTags = computed(() => {
  const all = splitTags(m.value?.bq)
  if (!all.length) return []
  const present = new Set(all)
  const cats = store.categories || []
  const keyTags = []
  for (const name of CAT_WHITELIST) {
    const c = cats.find(x => x && x.cat === name)
    if (!c || !Array.isArray(c.tags)) continue
    for (const t of c.tags) if (present.has(t) && !keyTags.includes(t)) keyTags.push(t)
  }
  const keySet = new Set(keyTags)
  return [...keyTags, ...all.filter(t => !keySet.has(t))]
})

/** 键位配置：默认值 + 设置表 hotkeys 覆盖 */
const DEFAULT_HK = {
  seekStep: 5, holdSpeed: 2, holdThresholdMs: 350,
  keys: { toggle: ' ', forward: 'arrowright', back: 'arrowleft', mute: 'm', fullscreen: 'f', volUp: 'arrowup', volDown: 'arrowdown' }
}
const hk = ref(JSON.parse(JSON.stringify(DEFAULT_HK)))

async function loadHotkeys() {
  try {
    const r = await window.api?.getSettings()
    if (r?.ok && r.data?.hotkeys) {
      const saved = JSON.parse(r.data.hotkeys)
      hk.value = {
        ...DEFAULT_HK, ...saved,
        keys: { ...DEFAULT_HK.keys, ...(saved.keys || {}) }
      }
    }
  } catch { /* 解析失败按默认键位 */ }
}

// ====== 键盘：单击 = 快进/退，长按 = 倍速/加速倒带 ======
const HOLD = { key: null, fired: false, timer: null, interval: null, ramp: 1, prevRate: null }
let badgeTimer = null

function showBadge(text) {
  if (!art) return
  const el = art.template.$player.querySelector('.jt-hold-badge')
  const b = el || document.createElement('div')
  b.className = 'jt-hold-badge'
  b.textContent = text
  if (!el) art.template.$player.appendChild(b)
  clearTimeout(badgeTimer)
  badgeTimer = setTimeout(hideBadge, 1200)
}
function hideBadge() {
  art?.template?.$player?.querySelector('.jt-hold-badge')?.remove()
}

function seekBy(sec) {
  if (!art) return
  const d = art.duration || 0
  art.currentTime = Math.min(Math.max(0, art.currentTime + sec), d ? d - 0.1 : Infinity)
}

function onKeyDown(e) {
  if (!art || mediaErr.value) return
  // 输入控件聚焦时不抢键（播放页本身没有输入框，防御性处理）
  const tag = (e.target && e.target.tagName) || ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return
  if (e.repeat) { e.preventDefault(); return }  // OS 自动重复忽略，长按节奏由我们自己控制
  const k = (e.key || '').toLowerCase()
  const { keys } = hk.value
  if (k === keys.forward || k === keys.back) {
    e.preventDefault()
    if (HOLD.key) return                       // 已按住一个方向键时忽略另一个
    HOLD.key = k; HOLD.fired = false
    HOLD.timer = setTimeout(() => startHold(k), hk.value.holdThresholdMs)
  } else if (k === keys.toggle) { e.preventDefault(); art.toggle() }
  else if (k === keys.mute) { e.preventDefault(); art.muted = !art.muted }
  else if (k === keys.fullscreen) { e.preventDefault(); art.fullscreenWeb = false; art.fullscreen = !art.fullscreen }
  else if (k === keys.volUp) { e.preventDefault(); art.volume = Math.min(1, Math.round((art.volume + 0.05) * 100) / 100) }
  else if (k === keys.volDown) { e.preventDefault(); art.volume = Math.max(0, Math.round((art.volume - 0.05) * 100) / 100) }
}

function onKeyUp(e) {
  const k = (e.key || '').toLowerCase()
  if (k !== HOLD.key) return
  clearTimeout(HOLD.timer)
  if (HOLD.fired) endHold()
  else seekBy(k === hk.value.keys.forward ? hk.value.seekStep : -hk.value.seekStep)  // 单击：快退/进
  HOLD.key = null
}

/** 长按判定触发：→ 进倍速；← 进加速倒带 */
function startHold(k) {
  if (!art || HOLD.key !== k) return
  HOLD.fired = true
  if (k === hk.value.keys.forward) {
    HOLD.prevRate = art.playbackRate || 1
    art.playbackRate = hk.value.holdSpeed
    showBadge(`▶▶ ${hk.value.holdSpeed}x 倍速`)
  } else {
    HOLD.ramp = 1
    const tick = () => {
      const step = hk.value.seekStep * HOLD.ramp
      seekBy(-step)
      showBadge(`◀◀ 快退 ${step}s`)
      HOLD.ramp = Math.min(8, HOLD.ramp + 1)   // 越按越快
    }
    tick()
    HOLD.interval = setInterval(tick, 200)
  }
}

function endHold() {
  if (HOLD.interval) { clearInterval(HOLD.interval); HOLD.interval = null }
  if (HOLD.prevRate != null && art) { art.playbackRate = HOLD.prevRate }
  HOLD.prevRate = null
  hideBadge()
}

// ====== 进度记忆 ======
function saveProgress(force = false) {
  if (!art || !m.value) return
  const now = Date.now()
  if (!force && now - lastSaveTs < 5000) return
  lastSaveTs = now
  pendingPos = art.currentTime || 0
  pendingDur = art.duration || 0
  window.api?.savePlayProgress({ id: m.value.id, pos: pendingPos, dur: pendingDur }).catch(() => {})
}

// ====== 数据加载 ======
async function loadMovie(id) {
  const r = await window.api.getMovie(id).catch(() => null)
  if (!r || !r.ok) { ElMessage.error(r?.error || '影片加载失败'); router.replace('/library'); return }
  m.value = r.data
  mediaErr.value = false

  // 记一次播放（同一影片一次会话只记一次；进度写入不经过这里）
  if (recordedFor !== id) {
    recordedFor = id
    window.api.recordPlay(id).catch(() => {})
  }

  await nextTick()
  initOrSwitchPlayer()
  loadRecommendations(id)
}

function initOrSwitchPlayer() {
  const url = resolveMedia(m.value?.py)
  if (!url) { mediaErr.value = true; return }
  if (art) {
    endHold()
    art.switchUrl(url)
    return
  }
  if (!boxRef.value) return
  art = new Artplayer({
    container: boxRef.value,
    url,
    autoplay: true,
    volume: Number(localStorage.getItem('jt-vol') || 0.8),
    muted: false,
    playbackRate: true,
    aspectRatio: false,
    flip: false,
    fullscreen: true,
    fullscreenWeb: false,
    miniProgressBar: true,
    pip: true,
    setting: true,
    mutex: false,
    backdrop: true,
    hotkey: false,          // 内置键盘关闭：方向键长按/单击语义由本页面接管
    moreVideoAttr: { playsInline: true }
  })

  art.on('video:timeupdate', () => saveProgress(false))
  art.on('video:pause', () => saveProgress(true))
  art.on('video:ended', () => { if (m.value) { art && (art.currentTime = 0); window.api?.savePlayProgress({ id: m.value.id, pos: 0, dur: art?.duration || 0 }) } })
  art.on('video:error', () => { mediaErr.value = true })
  art.on('video:volumechange', () => { try { localStorage.setItem('jt-vol', String(art.volume)) } catch {} })
  art.on('video:loadedmetadata', resumeIfNeeded)

  // 续播：超过 15 秒且不在结尾附近才跳
  async function resumeIfNeeded() {
    if (!art || !m.value || resumedFor === m.value.id) return
    resumedFor = m.value.id
    try {
      const r = await window.api.getPlayProgress(m.value.id)
      if (r?.ok && r.pos > 15 && (!art.duration || r.pos < art.duration - 20)) {
        art.currentTime = r.pos
        ElMessage({ message: `已从 ${fmtPos(r.pos)} 继续播放`, duration: 2500 })
      }
    } catch {}
  }
}

function fmtPos(sec) {
  const s = Math.floor(sec)
  const mm = Math.floor(s / 60), ss = s % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

async function loadRecommendations(id) {
  recLoading.value = true
  try {
    const r = await window.api.getRecommendations(id, 14)
    recs.value = r?.ok ? (r.data || []) : []
  } catch { recs.value = [] }
  recLoading.value = false
}

// ====== 操作 ======
function goMovie(id) {
  if (Number(route.params.id) === Number(id)) return
  router.push(`/play/${id}`)
}
function goDetail() { if (m.value) router.push(`/detail/${m.value.id}`) }
/** 进入该女优的影片页（与详情页/演员页的跳转方式保持一致） */
function goActor(name) { if (name) router.push(`/actor/${encodeURIComponent(name)}`) }
async function playExternal() {
  if (!m.value?.py) return ElMessage.warning('未设置视频路径')
  const r = await window.api.playVideo(m.value.py).catch(() => null)
  if (!r || !r.ok) return ElMessage.error(r?.error || '播放失败')
}
async function toggleFav() {
  if (!m.value) return
  const v = m.value.cl === 'y' ? 'n' : 'y'
  const prev = m.value.cl
  m.value.cl = v
  try {
    const r = await window.api.updateMovie(m.value.id, { cl: v })
    if (!r?.ok) throw new Error(r?.error)
  } catch (e) {
    m.value.cl = prev
    ElMessage.error('操作失败：' + (e.message || '写库未响应'))
  }
}

// ====== 生命周期 ======
watch(() => Number(route.params.id), (id) => { if (id) loadMovie(id) })

/** 换影片时给新女优的头像一次加载机会（上一张的失败标记不能沿用到下一部） */
watch(() => m.value?.id, () => { avatarBroken.value = false })

onMounted(async () => {
  // 标签分类配置（体型/行为/玩法）来自 store；直接进播放页时可能尚未初始化
  store.initIfNeeded().catch(() => {})
  await loadHotkeys()
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  if (dataDirRef.value) window.__dataDir = dataDirRef.value
  loadMovie(Number(route.params.id))
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('keyup', onKeyUp, true)
  endHold()
  // 兜底保存进度（route 切走/关页都会走这里）
  if (art && m.value && art.currentTime > 0) {
    try { window.api?.savePlayProgress({ id: m.value.id, pos: art.currentTime, dur: art.duration || 0 }) } catch {}
  }
  try { art?.destroy(false) } catch {}
  art = null
})
</script>

<style scoped>
/* 播放页沿用全局底色（--bg 暖纸白），与片库/详情/演员页同一套表层令牌，
   本地 scope 不污染其它页面；只有播放器画布本身是黑的。 */
.player-page {
  /* 左列标题行 / 右列「相关推荐」标题的统一行高：
     两列头部等高，下面的播放器与第一张海报的顶边才能严格对齐（改这一处即可） */
  --head-h: 46px;
  display: flex;
  gap: 18px;
  align-items: flex-start;
  min-height: calc(100vh - var(--nav-h, 56px) - 24px);
  margin: -12px;                 /* 抵消 main-content 的页边距，播放页要贴近满幅 */
  padding: 12px;
  background: var(--bg);
  color: var(--text);
  outline: none;
}

/* ====== 左列 ====== */
.main-col { flex: 1; min-width: 0; }

/* 标题行：位于播放器上方；高度锁死 --head-h（内部标题单行截断，不会被长片名撑高） */
.info-head {
  height: var(--head-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  overflow: hidden;
}

.player-box {
  width: 100%;
  aspect-ratio: 16 / 9;
  max-height: calc(100vh - var(--head-h) - 220px);
  border-radius: var(--r-md);
  overflow: hidden;
  background: #000;
}

/* 长按倍速 / 快退角标（挂在 ArtPlayer 根节点上，非 scoped —— 用 :global 穿透） */
.player-box :deep(.jt-hold-badge) {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.04em;
  pointer-events: none;
}

/* 视频无法播放的提示层 */
.media-error {
  margin-top: 12px;
  padding: 18px;
  border-radius: var(--r-md);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--sh-1);
  text-align: center;
}
.me-title { font-size: 16px; font-weight: 600; color: var(--text); }
.me-desc { margin: 8px 0 14px; color: var(--text-2); font-size: 13px; }

/* 标题行：番号在前 + 片名（番号不参与截断） */
.info-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
}
.info-ph {
  flex-shrink: 0;
  color: var(--primary);
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;   /* 等宽数字：与详情页番号同一处理 */
  font-weight: 700;
  font-size: 16px;
  letter-spacing: -0.01em;
}
/* 单行截断：标题行高恒定，播放器顶边位置不受片名长短影响 */
.info-name {
  min-width: 0;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 播放器下方一行：左（女优 + 全部标签）/ 右（评分统计 + 喜欢按钮，永远贴最右） */
.info-sub {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--muted);
}
.sub-left {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.sub-right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14px;
}
.actress {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 10px 3px 3px;
  border: none;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), transform var(--dur-press) var(--ease-out);
}
.actress:hover { background: var(--surface-2); }
.actress:active { transform: scale(0.97); }
.ac-avatar {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-3);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ac-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ac-fallback { font-size: 13px; font-weight: 600; color: var(--text-2); }
.ac-name { white-space: nowrap; }
.ac-more { color: var(--muted); font-size: 12px; font-weight: 500; }

/* 标签（展示影片全部 bq；三类排在前，纯展示不可点 → 不用 TagChip 的 pointer 语义） */
.cat-tag {
  padding: 3px 10px;
  border-radius: var(--r-tag);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.6;
  white-space: nowrap;
  user-select: none;
}

.info-stats { display: inline-flex; align-items: center; gap: 14px; white-space: nowrap; }
.info-stats .rating { color: var(--star-fill); }

/* 喜欢按钮（图标 + 文字；与详情页 act-fav 同一套文案与红态） */
.fav-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 16px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-pill);
  background: var(--surface);
  color: var(--text-2);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) var(--ease-out);
}
.fav-btn:hover { background: var(--surface-2); color: var(--text); }
.fav-btn:active { transform: scale(0.98); }
.fav-btn.on {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}
.fav-btn.on .app-icon { color: var(--accent); }

/* ====== 右列：推荐 ====== */
.rec-col {
  width: 400px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;        /* 标题固定、列表独立滚动 */
  max-height: calc(100vh - var(--nav-h, 56px) - 48px);
}
.rec-head {
  height: var(--head-h);         /* 与左列标题行等高 → 海报顶边对齐播放器顶边 */
  display: flex;
  align-items: center;
  flex-shrink: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.rec-list { flex: 1; min-height: 0; overflow-y: auto; padding-right: 4px; }
.rec-empty { color: var(--muted); font-size: 13px; padding: 20px 0; text-align: center; }
.rec-item {
  display: flex;
  gap: 10px;
  padding: 6px;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
/* 首项去掉上内边距：缩略图顶边正好落在列表顶边（= 播放器顶边） */
.rec-item:first-child { padding-top: 0; }
.rec-item:hover { background: var(--surface-2); }
.rec-item .thumb {
  position: relative;
  width: 196px;
  aspect-ratio: 16 / 10;
  border-radius: var(--r-sm);
  overflow: hidden;
  background: var(--surface-3);
  flex-shrink: 0;
}
.rec-item .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.rec-item .thumb .no-cover {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  color: var(--muted); font-size: 12px;
}
.rec-item .dur {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.75);   /* 压在缩略图上，保持深底白字 */
  color: #fff;
  font-size: 11px;
}
.rec-info { min-width: 0; padding-top: 2px; }
.rec-title {
  font-size: 13px;
  color: var(--text);
  line-height: 1.45;
  max-height: 4.35em;            /* 最多 3 行（3 × 1.45em） */
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
.rec-meta { margin-top: 5px; font-size: 12px; color: var(--muted); display: flex; gap: 10px; }
.rec-meta .rec-ph { color: var(--text-2); font-variant-numeric: tabular-nums; }
/* 热度数据：看过 / 想看（放不下时自动换行，不撑破卡片） */
.rec-stats {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-variant-numeric: tabular-nums;
}

/* 窄窗口：推荐栏换到下方 */
@media (max-width: 1100px) {
  .player-page { flex-direction: column; }
  .rec-col { width: 100%; max-height: none; }
}
</style>
