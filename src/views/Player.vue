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
  <div class="player-page" :class="{ 'mpv-on': isMpv }" tabindex="-1">
    <!-- mpv 高兼容模式的「挖洞遮罩」（2026-10-08）：
         一个自身透明的元素 + 超大 box-shadow spread，把「除视频区域以外」的整屏涂成页面底色。
         视频那一块不绘制 → mpv 的画面从洞里透出来。teleport 到 body 是为了让它落在所有页面
         内容之下（z-index:-1）、又不被任何祖先的层叠上下文困住。
         圆角靠遮罩自身的 border-radius：box-shadow 会跟着圆角走，洞也就是圆角的。
         位置尺寸由 syncHole() 用 CSS 变量下发（mpv 侧同步收到同一份矩形）。 -->
    <Teleport to="body">
      <div v-if="isMpv" ref="shieldRef" class="mpv-shield" aria-hidden="true"></div>
    </Teleport>
    <!-- ============ 左列：标题 + 播放器 + 女优信息 ============ -->
    <div class="main-col">
      <!-- 标题行（播放器上方）：番号 + 片名。
           行高固定 --head-h，与右列「相关推荐」标题同高 → 播放器与第一张海报顶边对齐 -->
      <div class="info-head">
        <BackButton fallback="/library" />
        <div class="info-title swap-in" v-if="m" :key="'title-' + m.id" :title="[m.ph, m.pm || m.ph].filter(Boolean).join(' ')">
          <span class="info-ph">{{ m.ph }}</span>
          <span class="info-name">{{ m.pm || m.ph }}</span>
        </div>
      </div>

      <!-- 播放器外层：只为「播放质量提示」浮层与 mpv 控件条提供定位参照。自身不产生额外高度
           （两者都是 absolute），所以「播放器顶边 = 右列第一张海报顶边」这条对齐关系不受影响。 -->
      <div class="player-wrap" ref="wrapRef">
        <div class="player-box" ref="boxRef"></div>

        <!-- mpv 模式的控制条（2026-10-08）：mpv 不参与页面渲染，ArtPlayer 的控制条用不上了，
             这一条由页面自己画、经 @/player 契约驱动 mpv。只铺在视频区域内（HTML 绘制在 mpv 之上）。 -->
        <PlayerControls
          v-if="isMpv && !mediaErr"
          :state="mpvUi"
          @toggle="onCtlToggle"
          @seek="onCtlSeek"
          @volume="onCtlVolume"
          @rate="onCtlRate"
          @fullscreen="onCtlFullscreen"
          @external="playExternal"
        />

        <!-- 播放质量提示（非阻塞，2026-10-07）：
             少数影片的容器时间戳不标准（码流用了 B 帧但 MP4 缺 ctts 盒），Chromium 的渲染器
             会因此丢掉约 20% 的帧 → 画面「一卡一卡」；同一文件用外部播放器完全正常。
             内置播放器换不了内核，所以这里只做提示 + 一键转外部播放器。 -->
        <div v-if="qualityWarn" class="quality-warn">
          <div class="qw-text">
            检测到画面丢帧较多（约 {{ qualityPct }}%）。该视频的编码或封装可能不符合规范，
            内置播放器无法流畅呈现，建议改用外部播放器播放。
          </div>
          <div class="qw-actions">
            <button type="button" class="qw-btn qw-primary" @click="playExternal">使用外部播放器打开</button>
            <button type="button" class="qw-btn" @click="dismissQualityWarn">忽略</button>
          </div>
        </div>
      </div>

      <!-- 视频确实放不出来时的兜底面板。
           注意（2026-09-30 修复）：这里**不能**断言「解码器不支持」—— Chromium 把
           「资源打不开」（协议层 404/415/500、NAS/SMB 瞬时读失败、demuxer 打不开）也报成
           MEDIA_ERR_SRC_NOT_SUPPORTED(4)，与真正的「编码不支持」同一个码。
           文案按错误码分化，并附真实错误码/信息，用户回报时能直接定位。 -->
      <div v-if="mediaErr" class="media-error">
        <div class="me-title">该视频无法在内置播放器中播放</div>
        <div class="me-desc">{{ mediaErrText }}</div>
        <div class="me-hint" v-if="mediaErrDetail">{{ mediaErrDetail }}</div>
        <div class="me-actions">
          <el-button type="primary" @click="retryPlay">重试</el-button>
          <el-button @click="playExternal">使用外部播放器打开</el-button>
          <el-button @click="goDetail">查看详情</el-button>
        </div>
      </div>

      <!-- 播放器下方第一行：影片全部标签（体型/行为/玩法 置前）… 最右：属性标签 + 喜欢 + 详情 -->
      <div class="tag-row swap-in" v-if="m" :key="'tags-' + m.id">
        <div class="tags">
          <span v-for="t in sortedTags" :key="t" class="cat-tag">{{ t }}</span>
        </div>
        <div class="row-actions">
          <!-- 文件名属性标签（2026-10-04）：无码破解 / 中文字幕 / 4K，位于喜欢按钮左侧。
               原「★ 评分」显示已按用户要求移除（2026-10-04，播放页两处评分都去掉） -->
          <span v-for="b in fileBadges" :key="b.kind" class="file-tag" :class="'ft-' + b.kind">{{ b.label }}</span>
          <button type="button" class="pill-btn fav-btn" :class="{ on: m.cl === 'y' }" @click="toggleFav"
                  :title="m.cl === 'y' ? '取消喜欢' : '喜欢'">
            <AppIcon :name="m.cl === 'y' ? 'heart-filled' : 'heart'" :size="16" />
            <span>{{ m.cl === 'y' ? '已喜欢' : '喜欢' }}</span>
          </button>
          <button type="button" class="pill-btn detail-btn" @click="goDetail" title="查看影片详情">
            <AppIcon name="more" :size="16" />
            <span>详情</span>
          </button>
        </div>
      </div>

      <!-- 第二行：女优（圆形头像 + 名字，点击进入女优影片页）。
           2026-10-04：多位女优共演时**全部平铺显示**（原先只显示首位 + "+N" 悬浮提示） -->
      <div class="actress-row swap-in" v-if="m" :key="'act-' + m.id">
        <button v-for="(a, i) in actressesView" :key="a.name + '-' + i" type="button" class="actress"
                :title="`查看 ${a.name} 的全部影片`"
                @click="goActor(a.name)">
          <span class="ac-avatar">
            <img v-if="a.src" :src="a.src" :alt="a.name" @error="markAvatarBroken(a.name)" />
            <span v-else class="ac-fallback">{{ a.name.slice(0, 1) }}</span>
          </span>
          <span class="ac-name">{{ a.name }}</span>
        </button>
      </div>
    </div>

    <!-- ============ 右列：相关推荐 ============ -->
    <aside ref="recColRef" class="rec-col">
      <div class="rec-head">相关推荐</div>
      <!-- recVersion：每次推荐结果更新自增 → 列表整体淡入（切换影片时丝滑过渡）。
           注意：key 变化会重建整个列表元素，所以 --rec-gap 必须用响应式绑定下发，
           不能靠在 onMounted 里对元素写行内样式（重建后会丢）。 -->
      <div class="rec-list swap-in" :key="'recs-' + recVersion" :style="{ '--rec-gap': recGap }">
        <div v-if="!recs.length && !recLoading" class="rec-empty">暂无推荐</div>
        <div v-for="r in recs" :key="r.id" class="rec-item" @click="goMovie(r.id)">
          <div class="thumb">
            <img v-if="coverUrl(r)" :src="coverUrl(r)" loading="lazy" decoding="async" @error="r._err = true" v-show="!r._err" />
            <div v-if="!coverUrl(r) || r._err" class="no-cover">无封面</div>
            <span v-if="r.duration > 0" class="dur">{{ fmtDur(r.duration) }}</span>
          </div>
          <div class="rec-info">
            <div class="rec-title" :title="r.pm || r.ph">{{ r.pm || r.ph }}</div>
            <!-- 文件名属性标签（2026-10-04）：标题下方、演员名上方。
                 原「★ 评分」行已按用户要求移除（2026-10-04） -->
            <div class="rec-file-tags" v-if="r._badges && r._badges.length">
              <span v-for="b in r._badges" :key="b.kind" class="file-tag file-tag-sm" :class="'ft-' + b.kind">{{ b.label }}</span>
            </div>
            <!-- 演员名（番号不再展示） -->
            <div class="rec-actors" v-if="recActors(r)" :title="recActors(r)">{{ recActors(r) }}</div>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import BackButton from '@/components/BackButton.vue'
import PlayerControls from '@/components/PlayerControls.vue'
import { createBackend, isBackendAvailable, PLAYER_KINDS } from '@/player'
import { resolveMedia, resolveMediaPath, resolveCover, splitTags, dataDirRef, favLock, favUnlock, fileBadgesOf, is4kSize } from '@/utils/global'
import { useMoviesStore } from '@/store/movies'

const route = useRoute()
const router = useRouter()
const store = useMoviesStore()

// ====== 状态 ======
const boxRef = ref(null)
const wrapRef = ref(null)      // 播放器外层：mpv 模式下控件条与长按徽标的定位参照
const shieldRef = ref(null)    // mpv 模式的挖洞遮罩（teleport 到 body）
const recColRef = ref(null)    // 右列容器：整条布局按列表可用高反算条目间距
const recGap = ref('0px')      // 条目间距（fitRecRows 反算）→ :style 绑给 .rec-list
const m = ref(null)            // 当前影片行（movies 表）
const recs = ref([])           // 相关推荐列表
const recLoading = ref(false)
const recVersion = ref(0)      // 推荐结果版本号：自增即触发右侧列表淡入过渡
const mediaErr = ref(false)
const mediaErrKind = ref('')   // '' = 无错误；'media' = 播放失败；'nopath' = 这部影片没有视频路径
const mediaErrCode = ref(0)    // 最近一次 MediaError.code（0 = 未知）；见 mediaErrText 的分化文案
const mediaErrRaw = ref('')    // 原始错误信息（Chromium 原文，回报问题时最有价值）
// 播放内核后端。页面只依赖 @/player 的契约，不直接 import 任何内核。
// 默认 Chromium；onMounted 里读完设置后再决定要不要换成 mpv（换内核只改这一个变量）。
let player = createBackend()
// mpv 模式（高兼容模式，2026-10-08）：窗口镂空 + 自制控件条，见本文件 mpv 相关段落
const isMpv = ref(false)
// 控件条读的播放状态（契约里的状态是同步读的，mpv 后端已做缓存，这里只做响应式镜像）
const mpvUi = reactive({ t: 0, dur: 0, paused: false, vol: 0.8, muted: false, rate: 1 })
let playingId = null           // player 当前真正在播的影片 id（进度记账以此为准，见 initOrSwitchPlayer）
let switchSuppress = false     // 换片进行中：挡住 pause/timeupdate 的进度记账（此时内核里还是旧片的时间）
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

/**
 * 当前影片的可播放地址（按内核分化）。
 * Chromium 走 `javtube-media://`（自定义协议，支持 Range，拖进度条必需）；
 * **mpv 必须给真实文件路径** —— 它是个独立进程，读不了本应用注册的自定义协议
 * （给它 javtube-media:// 会直接报 end-file reason=error）。
 * @returns {string} 可播放地址；没有视频路径时返回空串
 */
function mediaUrl() {
  const py = m.value?.py
  return isMpv.value ? resolveMediaPath(py) : resolveMedia(py)
}

function coverUrl(r) {
  if (!r || r._err) return ''
  try { return resolveCover(r.cover, r.id) || '' } catch { return '' }
}

/**
 * 推荐项的演员名：后端 PLAYER_RECOMMEND 直接给出 actors（yid 拆分 + cast_json 女优），
 * 多演员用「、」连接（CSS 单行截断）。旧后端数据回退到 yid 字段。
 * @param {Object} r - 推荐项
 * @returns {string} 演员名串；无演员返回空串
 */
function recActors(r) {
  if (Array.isArray(r?.actors) && r.actors.length) return r.actors.join('、')
  return splitTags(r?.yid).join('、')
}

// ====== 文件名属性标签（2026-10-04）：无码破解 / 中文字幕 / 4K ======
// 规则：无码破解 = 文件名 -U/-UC/-破解；中文字幕 = -C/-UC（见 utils/global.js fileBadgesOf，
// 按用户真实库命名核对）。4K 优先看文件名标记；**文件名没写时读视频真实分辨率**
// （用户要求：部分 4K 影片文件名里没有 4K），由主进程异步批量读（utils:readVideoSize，
// NAS 上只在首次需要时读一次，主进程按路径缓存）。
const res4k = ref({})          // py → 是否真实 4K（undefined=尚未探测）
const fileBadges = computed(() => fileBadgesOf(m.value?.py, { is4k: res4k.value[m.value?.py] === true }))

/** 把标签挂到推荐项上（模板直接读 r._badges，避免在模板里调函数重算 —— 项目约定） */
function applyRecBadges() {
  for (const r of recs.value) {
    r._badges = fileBadgesOf(r.py, { is4k: res4k.value[r.py] === true })
  }
}

/**
 * 异步补探真实分辨率：只探「文件名没写 4K 且尚未探测过」的影片（当前片 + 推荐项）。
 * 结果合并进 res4k → 触发当前片标签重算 + 推荐项标签重挂；失败静默（无标签而已）。
 * @param {string[]} paths - 候选 py 列表
 */
async function probeSizes(paths) {
  if (!window.api?.readVideoSize) return
  const need = [...new Set((paths || []).filter(p => p && res4k.value[p] === undefined))]
    .filter(p => !fileBadgesOf(p).some(b => b.kind === 'uhd'))
  if (!need.length) return
  const r = await window.api.readVideoSize(need).catch(() => null)
  if (!r || !r.ok) return
  const next = { ...res4k.value }
  for (const p of need) next[p] = is4kSize(r.data?.[p])
  res4k.value = next
  applyRecBadges()
}

function fmtDur(min) {
  const n = Number(min) || 0
  if (!n) return ''
  const h = Math.floor(n / 60), mm = Math.round(n % 60)
  return h ? `${h}小时${mm ? mm + '分' : ''}` : `${mm}分钟`
}

// ====== 女优（标题下方：圆形头像 + 名字）======

/**
 * 女优列表：优先取 cast_json 里 gender !== 'm' 的项。
 * 头像由**主进程**补齐（movies:getOne 返回前按「全库已知头像」填，见 actress.js actorAvatarMap）：
 * 本页只拿得到当前这一部影片的 cast_json，而入库是逐片写入的 —— 本片刮削时没取到头像就留空，
 * 于是出现「演员页有头像、播放页没有」（2026-09-30 修复）。补齐与演员页同源，故此处直接用。
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

/** 头像加载失败的演员名（失败后回落首字占位；换片时整体复位）。用新对象赋值保证响应性 */
const brokenAvatars = ref({})
function markAvatarBroken(name) {
  brokenAvatars.value = { ...brokenAvatars.value, [name]: true }
}
/**
 * 女优展示行数据：预解析头像 URL（模板里不调函数 —— 项目约定，避免每次重渲染重算）。
 * 2026-10-04：多位女优共演时全部平铺展示（不再是「首位 + N」）。
 */
const actressesView = computed(() => actresses.value.map(a => {
  let src = ''
  if (a.avatar && !brokenAvatars.value[a.name]) {
    try { src = resolveCover(a.avatar) || '' } catch { src = '' }
  }
  return { name: a.name, src }
}))

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

/**
 * 读取播放相关设置：快捷键 + 播放内核。
 * ⚠️ 内核必须在这里（loadMovie 之前）定下来 —— 后端实例是后续所有播放调用的载体。
 * 设置项 `player_kernel`：'mpv'（高兼容模式，默认）| 'chromium'（内置 Chromium 媒体栈）。
 * mpv 通道不在场（打包漏了 mpv.exe）时自动退回 Chromium，绝不出现「点了播不了」。
 */
async function loadPlayerSettings() {
  let kernel = PLAYER_KINDS.MPV
  try {
    const r = await window.api?.getSettings()
    if (r?.ok) {
      if (r.data?.hotkeys) {
        const saved = JSON.parse(r.data.hotkeys)
        hk.value = {
          ...DEFAULT_HK, ...saved,
          keys: { ...DEFAULT_HK.keys, ...(saved.keys || {}) }
        }
      }
      if (r.data?.player_kernel === PLAYER_KINDS.CHROMIUM) kernel = PLAYER_KINDS.CHROMIUM
    }
  } catch { /* 解析失败按默认值 */ }

  if (kernel === PLAYER_KINDS.MPV) {
    // 双保险①：通道在不在（preload 没暴露时直接退）
    if (!isBackendAvailable(PLAYER_KINDS.MPV)) {
      console.warn('[player] mpv 控制通道不可用，退回 Chromium 内核')
      kernel = PLAYER_KINDS.CHROMIUM
    } else {
      // 双保险②：mpv.exe 在不在（打包漏了 / 被安全软件删了）。
      // 提前问一次，比「起播失败再回退」更干净：用户不会看到一次闪黑。
      const st = await window.api?.mpvControl?.({ cmd: 'status' }).catch(() => null)
      if (st && !st.exe) {
        console.warn('[player] 未找到 mpv 可执行文件，退回 Chromium 内核')
        kernel = PLAYER_KINDS.CHROMIUM
      }
    }
  }
  player = createBackend(kernel)
  isMpv.value = kernel === PLAYER_KINDS.MPV
}

/**
 * mpv 起不来时退回 Chromium 内核（例如进程被安全软件拦截）。
 * 换内核只在这里发生一次；之后整页行为与「设置里选了 Chromium」完全一致。
 * @param {string} reason - 失败原因（只用于日志）
 */
function fallbackToChromium(reason) {
  if (!isMpv.value) return
  console.warn('[player] mpv 启动失败，自动退回 Chromium 内核：', reason)
  try { player.destroy() } catch { /* 忽略 */ }
  isMpv.value = false
  clearHole()
  player = createBackend(PLAYER_KINDS.CHROMIUM)
  nextTick(() => initOrSwitchPlayer())
}

// ====== 键盘：单击 = 快进/退，长按 = 倍速/加速倒带 ======
const HOLD = { key: null, fired: false, timer: null, interval: null, ramp: 1, prevRate: null }
let badgeTimer = null

function showBadge(text) {
  const root = player.rootEl
  if (!root) return
  const el = root.querySelector('.jt-hold-badge')
  const b = el || document.createElement('div')
  b.className = 'jt-hold-badge'
  b.textContent = text
  if (!el) root.appendChild(b)
  clearTimeout(badgeTimer)
  badgeTimer = setTimeout(hideBadge, 1200)
}
function hideBadge() {
  player.rootEl?.querySelector('.jt-hold-badge')?.remove()
}

function seekBy(sec) {
  if (!player.isMounted) return
  const d = player.duration
  player.currentTime = Math.min(Math.max(0, player.currentTime + sec), d ? d - 0.1 : Infinity)
}

function onKeyDown(e) {
  if (!player.isMounted || mediaErr.value) return
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
  } else if (k === keys.toggle) { e.preventDefault(); player.toggle() }
  else if (k === keys.mute) { e.preventDefault(); player.muted = !player.muted }
  else if (k === keys.fullscreen) { e.preventDefault(); player.fullscreenWeb = false; player.fullscreen = !player.fullscreen }
  else if (k === keys.volUp) { e.preventDefault(); player.volume = Math.min(1, Math.round((player.volume + 0.05) * 100) / 100) }
  else if (k === keys.volDown) { e.preventDefault(); player.volume = Math.max(0, Math.round((player.volume - 0.05) * 100) / 100) }
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
  if (!player.isMounted || HOLD.key !== k) return
  HOLD.fired = true
  if (k === hk.value.keys.forward) {
    HOLD.prevRate = player.playbackRate || 1
    player.playbackRate = hk.value.holdSpeed
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
  if (HOLD.prevRate != null && player.isMounted) { player.playbackRate = HOLD.prevRate }
  HOLD.prevRate = null
  hideBadge()
}

// ====== mpv 高兼容模式：镂空矩形同步 + 控件条（2026-10-08）======
// mpv 是**独立进程**，它往**整个窗口**渲染；页面这一侧则把视频区域「镂空」让它透出来。
// 两侧必须用**同一个矩形**：
//   · 页面侧 → 挖洞遮罩（.mpv-shield）的位置尺寸；
//   · mpv 侧 → --video-margin-ratio-*（窗口尺寸的比例，由主进程换算）。
// 实测（tmp/mpv-spike/test-hole-align.js）：两侧对齐是像素级的，且运行时改 margin 即时生效，
// 所以窗口缩放 / 进全屏都只是「重算一次矩形」，不需要重启 mpv。
let lastHoleKey = ''

/**
 * 重算镂空矩形，同时下发给「挖洞遮罩」与 mpv。
 *
 * ⚠️ 必须是**同步**的，不能用 requestAnimationFrame 包起来：窗口被遮挡/最小化时
 *    Chromium 会把 rAF 节流甚至暂停，那样遮罩会永远停在 0×0、整窗透明也永远挂不上
 *    （实测踩到：探针里窗口被挡住时 mpv-hole=false、遮罩矩形 0×0，画面自然出不来）。
 * 反复调用是安全的：矩形没变就直接返回（resize 事件很密集，靠这个去重）。
 */
function syncHole() {
  if (!isMpv.value) return
  const box = boxRef.value
  const el = shieldRef.value
  if (!box || !el) return
  const r = box.getBoundingClientRect()
  const w = Math.max(0, r.width), h = Math.max(0, r.height)
  if (!(w > 0) || !(h > 0)) return          // 还没布局出来，等下一次
  const hole = { x: r.left, y: r.top, w, h, winW: window.innerWidth, winH: window.innerHeight }
  const key = [hole.x, hole.y, hole.w, hole.h, hole.winW, hole.winH]
    .map(n => Math.round(n * 10) / 10).join(',')
  if (key === lastHoleKey) return
  lastHoleKey = key
  el.style.setProperty('--hx', hole.x + 'px')
  el.style.setProperty('--hy', hole.y + 'px')
  el.style.setProperty('--hw', hole.w + 'px')
  el.style.setProperty('--hh', hole.h + 'px')
  player.setHole?.(hole)
  // ⚠️ 遮罩尺寸就绪之后才把整窗底色关掉（html.mpv-hole）。提前关会有一瞬整窗透明、透出桌面。
  document.documentElement.classList.add('mpv-hole')
}

/** 退出播放页时把窗口底色恢复成不透明（否则其它页面会透出桌面） */
function clearHole() {
  lastHoleKey = ''
  document.documentElement.classList.remove('mpv-hole')
}

/**
 * 入场后的一小段「落定」重算。
 * 为什么需要：刚进页面时盒子还在动 ——
 *   · 路由入场动画（.route-anim）带 `transform: translateY(6px)`，动画期间量到的矩形整体偏 6px；
 *   · 内容变高后主内容区出现滚动条，可用宽度少 8px，16:9 盒子跟着变窄。
 * 这两个都会让「首帧量到的矩形」与稳定后的实际位置不一致（实测 y 差 6px、宽差 8px），
 * 于是遮罩与 mpv 的画面会错位。syncHole 自带去重，多调几次几乎没有成本。
 */
let settleTimers = []
function settleHole() {
  for (const t of settleTimers) clearTimeout(t)
  settleTimers = [0, 130, 320, 640, 1000].map(ms => setTimeout(syncHole, ms))
}

/** 盒子尺寸变化（滚动条出现、窗口缩放、全屏切换）时自动重算 —— 事件驱动，比轮询可靠 */
let holeObs = null
function startHoleWatch() {
  stopHoleWatch()
  if (typeof ResizeObserver === 'undefined' || !boxRef.value) return
  holeObs = new ResizeObserver(() => syncHole())
  holeObs.observe(boxRef.value)
}
function stopHoleWatch() {
  try { holeObs?.disconnect() } catch { /* 忽略 */ }
  holeObs = null
}

/** 把契约事件映射到控件条的响应式状态（mpv 模式才需要） */
function bindMpvUi() {
  const pull = () => {
    mpvUi.t = player.currentTime || 0
    mpvUi.dur = player.duration || 0
    mpvUi.vol = player.volume
    mpvUi.muted = player.muted
    mpvUi.rate = player.playbackRate || 1
  }
  player.on('timeupdate', pull)
  player.on('loadedmetadata', pull)
  player.on('canplay', pull)
  player.on('volumechange', pull)
  player.on('ended', pull)
  player.on('playing', () => { mpvUi.paused = false; pull() })
  player.on('pause', () => { mpvUi.paused = true; pull() })
  pull()
}

function onCtlToggle() { player.toggle() }
/** 拖进度条：传进来的是 0~1 的比例 */
function onCtlSeek(frac) {
  const d = player.duration || 0
  if (!d) return
  player.currentTime = Math.max(0, Math.min(d - 0.1, frac * d))
}
function onCtlVolume(v) { player.volume = v }
function onCtlRate(r) { player.playbackRate = r }
function onCtlFullscreen() { player.fullscreen = !player.fullscreen }

/** 全屏进出会改变视口尺寸 → 镂空矩形要重算（DOM 全屏在透明窗口下可用，见 mpv-backend.js） */
function onFullscreenChange() { syncHole() }

// ====== 播放器铺满（消除边角黑边）======
// 视频层由 GPU 合成且像素对齐取整：只要「盒子宽高比 ≠ 视频宽高比」，object-fit:contain
// 就会在边缘留黑边（盒子被 max-height 压矮、或片源比例与 16:9 略有出入时都会出现，
// 黑边在四角圆弧处收成黑楔，最显眼）。偏差 ≤ 8% 时改用 cover 裁掉一点画面（肉眼不可见）
// 铺满盒子；偏差大（如 4:3 老片）则保留 contain 的有意留黑。
function fitVideoObject() {
  const v = player.element
  const box = boxRef.value
  if (!v || !box || !v.videoWidth || !v.videoHeight || !box.clientWidth || !box.clientHeight) return
  const vAr = v.videoWidth / v.videoHeight
  const bAr = box.clientWidth / box.clientHeight
  const off = Math.abs(vAr - bAr) / vAr
  v.style.objectFit = off <= 0.08 ? 'cover' : 'contain'
}

// ====== 右列整条布局：可见区域只放「完整的条」，零头摊进条目间距 ======
// 列表可用高几乎不可能被 149.5px 的整条高度整除：直接铺会裁出半张海报，
// 锁整条又会在底部留空白（两种都做过，用户都不满意）。
// 这里按可用高反算能放下几整条 k，把零头 (listH - k*整条高) 均摊成条目间额外
// 间距写进 --rec-gap：可见区域 = k 条完整海报、底边无空白，第 k+1 条正好从列表
// 底边之下开始（滚动能看，折叠处不露半截）。
// 注意：条目是 border-box，height 显式钉死为整条高，首条的 padding-top:0 不会
// 缩小盒高，所以每条占位恒为 nominal，零头就是 listH % nominal。
// 推荐最多 10 条（加载处截断），窗口化/最大化行为一致：都是可滚动列表。
function fitRecRows() {
  const list = recColRef.value?.querySelector?.('.rec-list')
  if (!list) return
  const cs = getComputedStyle(recColRef.value)
  const pad = parseFloat(cs.getPropertyValue('--rec-pad')) || 6
  const nominal = parseFloat(cs.getPropertyValue('--rec-thumb-h')) + pad * 2   // 整条高（= 每条占位）
  if (!(nominal > 0)) return
  const listH = list.clientHeight
  if (!(listH > 0)) return
  const k = Math.max(1, Math.floor(listH / nominal))          // 可见的完整条数
  const gap = k > 1 ? (listH - k * nominal) / (k - 1) : 0     // 零头均摊进 k-1 个间隙
  // 写成响应式 ref：列表带 :key 会随推荐结果重建，行内样式会丢，必须走 :style 绑定
  recGap.value = Math.max(0, gap).toFixed(2) + 'px'
}

// ====== 进度记忆 ======
// 记账 id 必须用 playingId（内核实例真正在播的那部），不能用 m.value：
// 换片流程是「先改 m.value（新片）→ 再 switchUrl」，而 ArtPlayer 的 switchUrl
// 内部第一件事就是 pause() —— pause 事件异步触发时若按 m.value 记账，
// 就会把旧片的播放位置写到新片的 play_pos 上（新片下次进入会直接跳到旧片的位置）。
function saveProgress(force = false) {
  if (!player.isMounted || !playingId || switchSuppress) return
  const now = Date.now()
  if (!force && now - lastSaveTs < 5000) return
  lastSaveTs = now
  pendingPos = player.currentTime || 0
  pendingDur = player.duration || 0
  window.api?.savePlayProgress({ id: playingId, pos: pendingPos, dur: pendingDur }).catch(() => {})
}

// ====== 播放错误：确认、自愈、文案 ======
// 背景（2026-09-30 修复用户报告的「切换影片时误报解码器不支持」）：
//   ① Chromium 把「资源打不开」（协议层 404/415/500、NAS/SMB 瞬时读失败、demuxer 打不开）
//      一律报成 MEDIA_ERR_SRC_NOT_SUPPORTED(4)，与真正的「编码不支持」**同码** ——
//      凭一个 code 4 就断言格式问题，就是原来那句错误文案的由来。
//   ② ArtPlayer 自带重连：错误后等 RECONNECT_SLEEP_TIME(1000ms) 重设 url，最多 5 次。
//      实测（tmp/probe-switch-media-error3.js）错误后 1 秒 canplay/playing 正常到来、
//      视频照常播放 —— 绝大多数「错误」是一次性的，播放器自己就恢复了。
//   ③ 旧实现在 video:error 上直接永久置 mediaErr，而清错只有 loadMovie() 开头一处
//      ⇒ 视频明明在播，面板却一直挂着「解码器不支持」，直到用户再切一次片。
// 现在的策略：错误先不自证，给自愈留 ERR_GRACE_MS 宽限；宽限结束时**只看元素状态** ——
//             能播（无 error 且已有元数据）当瞬时故障放过，仍不能播才上报；
//             上报后 canplay/playing 一到还会撤销，所以偶尔的「短暂显示」也能自愈。
//             ⚠️ 判据不要写成「累计 N 次错误」：ArtPlayer 的重连只有 5 次
//             （RECONNECT_TIME_MAX），次数用完后它就不再重载了，「点重试仍失败」时
//             只会产生 1 次错误，按次数判断会出现「面板消失后再也不回来」的死角
//             （2026-09-30 实测 tmp/verify-media-error-fix.js V3 就是这么暴露出来的）。
const ERR_GRACE_MS = 1800
let errTimer = null        // 宽限定时器：等待 ArtPlayer 自愈

/** 当前是否处于「可播的健康态」。
 *  判据收在内核后端里（Chromium 看 `<video>.error/readyState`；mpv 看是否已拿到元数据且未报错），
 *  因为 mpv 后端**没有 `<video>` 元素**，页面侧不能再用元素判据。 */
function mediaHealthy() {
  return typeof player.isPlayable === 'function' ? player.isPlayable() : false
}

/** 清空错误态（换片 / 重试 / 恢复播放时调用） */
function resetMediaErr() {
  if (errTimer) { clearTimeout(errTimer); errTimer = null }
  mediaErr.value = false
  mediaErrKind.value = ''
  mediaErrCode.value = 0
  mediaErrRaw.value = ''
}

function onMediaError() {
  const v = player.element
  const e = v && v.error
  if (e) { mediaErrCode.value = e.code; mediaErrRaw.value = String(e.message || '') }
  if (errTimer) return                 // 已在宽限窗口内，等它到点统一复核
  errTimer = setTimeout(() => recheckMediaErr(false), ERR_GRACE_MS)
}

/**
 * 宽限到点后的复核。
 * @param {boolean} extended 是否已经延长过一次（只延长一次，避免无限等待）
 */
function recheckMediaErr(extended) {
  errTimer = null
  if (mediaHealthy()) return           // 已自愈：当作瞬时故障，不上报
  const v = player.element
  // 仍在加载中（ArtPlayer 的重连正在进行、NAS/SMB 首包慢）→ 再给一次机会。
  // 这一支只在「真在加载」时命中：文件确实打不开时元素是 networkState=NO_SOURCE，不走这里。
  if (!extended && v && v.error == null && v.networkState === 2) {
    errTimer = setTimeout(() => recheckMediaErr(true), ERR_GRACE_MS)
    return
  }
  mediaErrKind.value = 'media'
  mediaErr.value = true
  // 换片失败时 switchSuppress 会一直挂着（它只由 loadedmetadata 解除），
  // 那会让进度记账从此静默失效 —— 在这里补一次解除。
  switchSuppress = false
}

/** canplay / playing：只要回到可播状态就撤销错误面板（换片途中自己恢复的也算） */
function onMediaRecovered() {
  if (!mediaHealthy()) return
  if (errTimer) { clearTimeout(errTimer); errTimer = null }
  if (mediaErr.value) {
    mediaErr.value = false
    mediaErrKind.value = ''
    mediaErrRaw.value = ''
  }
}

/** 兜底面板正文：按错误码分化，不确定的绝不断言（见本段顶部注释）。
 *  措辞保持书面、中性：不臆断原因、不用口语（「放不了」「多半」这类），
 *  也不把「资源读不到」说成「格式不支持」。 */
const mediaErrText = computed(() => {
  const f = ext.value
  if (mediaErrKind.value === 'nopath') {
    return '该影片在资料库中没有可用的视频文件路径，可能是在入库时未能关联到源文件。可在「详情页」中核对，或使用外部播放器手动打开。'
  }
  switch (mediaErrCode.value) {
    case 2: return `读取中断，未能从磁盘或网络共享完整读取该影片（${f}）。此情况通常是暂时性的，可尝试重试。`
    case 3: return `视频数据无法解码（${f}）。文件可能未完整下载，或该编码格式不受浏览器支持。`
    case 4: return `无法打开该文件（${f}）：磁盘或网络共享可能暂时不可用，也可能是该文件的容器或编码超出浏览器的解码能力。可尝试重试，或使用外部播放器打开。`
    default: return `播放未能开始（${f}）。可尝试重试，或使用外部播放器打开。`
  }
})

/** 面板末尾的小字：真实错误码 + Chromium 原文，方便回报时直接定位 */
const mediaErrDetail = computed(() => {
  if (mediaErrKind.value === 'nopath') return ''
  const parts = []
  if (mediaErrCode.value) parts.push('错误码 ' + mediaErrCode.value)
  if (mediaErrRaw.value) parts.push(mediaErrRaw.value)
  return parts.join(' · ')
})

// ====== 播放质量自检（2026-10-07）======
// 背景：少数影片的容器时间戳不标准 —— 码流用了 B 帧（需要重排序）但 MP4 容器缺少 ctts
// （composition time offset）盒，容器里 PTS == DTS。Chromium 的呈现时间轴完全取自容器，
// 于是解码器按 POC 输出的「呈现顺序」帧配着「解码顺序」的时间戳送到渲染器 → 渲染器判定
// 帧序错乱 → **恒定丢掉约 20% 的帧**，画面「一卡一卡」；同一文件用 PotPlayer / mpv 完全正常
// （它们按码流自带的重排信息还原时间轴，不看容器）。
// 内置播放器换不了内核（Electron 只有 Chromium 一套媒体栈），所以这里做**非阻塞提示**：
// 丢帧率持续偏高时说明原因，并给一键「用外部播放器打开」。
// ⚠️ 判据必须用**滑动窗口**而不是累计值 —— 累计值会被开头的正常片段稀释，永远到不了阈值。
// ⚠️ 与 mediaErr（硬失败面板）互斥：真放不出来时由那个面板负责，这里不重复打扰。
const QUALITY_SAMPLE_MS = 2000    // 采样间隔
const QUALITY_WINDOW = 3          // 窗口采样数（3 × 2s ≈ 4~6s）
const QUALITY_MIN_FRAMES = 90     // 窗口内至少这么多帧才判定（约 3s @30fps），避免样本太少误报
const QUALITY_DROP_PCT = 10       // 丢帧率阈值（%）。真问题片实测在 18~25%，留足余量；
                                  // 阈值定太低会把「机器一时忙 / 窗口被遮挡降频」误判成文件问题。
const qualityWarn = ref(false)
const qualityPct = ref(0)
let qualityTimer = null
let qualityHist = []              // [{t,d}] 累计 totalVideoFrames / droppedVideoFrames
let qualityMutedFor = null        // 用户点过「忽略」的影片 id（同一会话内不再提示）

function stopQualityWatch() {
  if (qualityTimer) { clearInterval(qualityTimer); qualityTimer = null }
  qualityHist = []
}

function startQualityWatch() {
  stopQualityWatch()
  qualityTimer = setInterval(() => {
    if (!player.isMounted || mediaErr.value || qualityWarn.value) return
    if (qualityMutedFor != null && qualityMutedFor === playingId) return
    // ⚠️ 页面不可见（最小化 / 被遮挡）时 Chromium 会降频，丢帧是环境造成的、不是文件问题。
    //    此时必须丢弃采样窗口，否则切出去再切回来就会误报（实测踩到过）。
    if (document.visibilityState !== 'visible') { qualityHist = []; return }
    const v = player.element
    if (!v || typeof v.getVideoPlaybackQuality !== 'function') return
    const q = v.getVideoPlaybackQuality()
    qualityHist.push({ t: q.totalVideoFrames || 0, d: q.droppedVideoFrames || 0 })
    if (qualityHist.length > QUALITY_WINDOW) qualityHist.shift()
    if (qualityHist.length < QUALITY_WINDOW) return
    const a = qualityHist[0]
    const b = qualityHist[qualityHist.length - 1]
    const total = b.t - a.t
    const dropped = b.d - a.d
    if (total < QUALITY_MIN_FRAMES) return
    const pct = (dropped / total) * 100
    if (pct < QUALITY_DROP_PCT) return
    qualityPct.value = Math.round(pct)
    qualityWarn.value = true
  }, QUALITY_SAMPLE_MS)
}

/** 忽略：本次会话不再对这部影片提示（换片后重新开始判断） */
function dismissQualityWarn() {
  qualityWarn.value = false
  qualityMutedFor = playingId
}

// ====== 数据加载 ======
async function loadMovie(id) {
  const r = await window.api.getMovie(id).catch(() => null)
  if (!r || !r.ok) { ElMessage.error(r?.error || '无法加载该影片的资料'); router.replace('/library'); return }
  m.value = r.data
  resetMediaErr()

  // 记一次播放（同一影片一次会话只记一次；进度写入不经过这里）
  if (recordedFor !== id) {
    recordedFor = id
    window.api.recordPlay(id).catch(() => {})
  }

  await nextTick()
  initOrSwitchPlayer()
  loadRecommendations(id)
  probeSizes([m.value?.py])   // 当前片的真实分辨率补探（文件名没写 4K 时）
}

function initOrSwitchPlayer() {
  // 换片：清掉上一部的质量提示与采样窗口（否则新片会被旧片的丢帧数据误判）
  qualityWarn.value = false
  qualityHist = []
  const url = mediaUrl()
  if (!url) {
    // 新片没有视频路径：旧播放器必须先停掉并销毁。
    // 否则上一部的画面/声音会继续播，而标题、标签已经切成了新片（2026-09-30 审计 P1）。
    if (player.isMounted) {
      endHold()
      player.destroy()
      playingId = null
    }
    mediaErrKind.value = 'nopath'
    mediaErr.value = true
    return
  }
  if (player.isMounted) {
    endHold()
    // 换片前先把旧片的最后进度落库（此刻 playingId 仍指向旧片，记的是旧片的账）
    saveProgress(true)
    // 挡住换片过程中 pause / timeupdate 触发的记账（它们拿到的 currentTime 还是旧片的），
    // 新片 loadedmetadata 后自动恢复记账。
    switchSuppress = true
    // 换片失败时内核会让这个 Promise 变成 rejected，不接住会变成 unhandled rejection；
    // 真正的失败判定交给 onMediaError 的宽限复核。
    player.load(url).catch(() => {})
    playingId = m.value.id
    return
  }
  if (!boxRef.value) return
  // mpv 模式：先把镂空矩形定下来 —— mount 时会把它一并带给 mpv（避免起播瞬间画面位置不对）
  if (isMpv.value) syncHole()
  player.mount(boxRef.value, {
    url,
    autoplay: true,
    volume: Number(localStorage.getItem('jt-vol') || 0.8),
    muted: false,
    // mpv 模式：长按徽标挂在 .player-wrap 上（.player-box 没有定位，且 mpv 没有内核根节点）
    overlayEl: wrapRef.value || boxRef.value,
    // mpv 起不来（exe 缺失/被拦截/管道连不上）→ 自动退回 Chromium 内核，绝不留「点了播不了」
    onFatal: fallbackToChromium
  })
  playingId = m.value.id        // 首次构造：内核从此刻起播的就是当前影片
  switchSuppress = false

  player.on('timeupdate', () => saveProgress(false))
  player.on('pause', () => saveProgress(true))
  player.on('ended', () => {
    if (!playingId) return
    if (player.isMounted) player.currentTime = 0
    window.api?.savePlayProgress({ id: playingId, pos: 0, dur: player.duration || 0 }).catch(() => {})
  })
  // 播放失败：先宽限复核再上报；canplay/playing 一到就撤销（见本文件「播放错误」段注释）
  player.on('error', onMediaError)
  player.on('canplay', onMediaRecovered)
  player.on('playing', onMediaRecovered)
  player.on('volumechange', () => { try { localStorage.setItem('jt-vol', String(player.volume)) } catch {} })
  player.on('loadedmetadata', resumeIfNeeded)
  player.on('loadedmetadata', fitVideoObject)
  // 换源（点右侧推荐）后自动起播：内核不保证换源后自动播放（上一部处于暂停/播完时尤其），
  // 这里统一在元数据就绪后补一次 play；被浏览器自动播放策略拒绝时静默忽略。
  player.on('loadedmetadata', () => { try { player.play()?.catch?.(() => {}) } catch {} })
  // 新片元数据就绪 = 换片完成：解除换片期的记账抑制（见 initOrSwitchPlayer 的 switchSuppress）
  player.on('loadedmetadata', () => { switchSuppress = false })
  // 窗口尺寸变化会改变盒子宽高比（max-height 参与钳制时尤其），铺满方式需要重算
  window.addEventListener('resize', fitVideoObject)

  // mpv 模式：控件条的响应式状态 + 镂空矩形（挂载后立刻算一次，遮罩就位后再关整窗底色）
  if (isMpv.value) {
    bindMpvUi()
    nextTick(() => { syncHole(); settleHole() })
  }


  // 续播：超过 15 秒且不在结尾附近才跳
  async function resumeIfNeeded() {
    if (!player.isMounted || !m.value || resumedFor === m.value.id) return
    resumedFor = m.value.id
    try {
      const r = await window.api.getPlayProgress(m.value.id)
      if (r?.ok && r.pos > 15 && (!player.duration || r.pos < player.duration - 20)) {
        player.currentTime = r.pos
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
    const r = await window.api.getRecommendations(id, 10)
    recs.value = r?.ok ? (r.data || []).slice(0, 10) : []
  } catch { recs.value = [] }
  recLoading.value = false
  recVersion.value++      // 列表整体淡入（切换影片后新推荐丝滑登场）
  // 文件名属性标签挂到推荐项（先按文件名出标签；4K 的真实分辨率随后异步补探）
  applyRecBadges()
  probeSizes(recs.value.map(r => r.py))
  // 列表元素因 :key 变化被重建，等 DOM 落地后重新反算间距（否则整条布局丢一次）
  await nextTick()
  fitRecRows()
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
  if (!m.value?.py) return ElMessage.warning('该影片未设置视频文件路径')
  const r = await window.api.playVideo(m.value.py).catch(() => null)
  if (!r || !r.ok) return ElMessage.error(r?.error || '无法通过外部播放器打开该影片')
}
/**
 * 重试：强制重新加载当前影片。
 * 必须走 `player.reload()`（内核内部用 `art.url = url` 而非 `switchUrl(url)`）——
 * 后者对同一个地址会提前 `return`（`if (e === t.url) void a()`），拿它重试等于什么都没做；
 * `url` 的 setter 则是无条件 `$video.src = a`，能真正触发一次重新加载。
 * 这段内核细节已收进 chromium-backend.js，本页只调 reload()。
 */
function retryPlay() {
  const url = mediaUrl()
  resetMediaErr()
  if (!player.isMounted || !url) { initOrSwitchPlayer(); return }
  endHold()
  switchSuppress = true          // 重新加载期间先挡住记账，loadedmetadata 后自动恢复
  try { player.reload(url) } catch { switchSuppress = false }
  playingId = m.value?.id ?? null
}
async function toggleFav() {
  if (!m.value) return
  // 与片库/喜欢/详情页同一套去重（2026-09-30 审计）：连点会打出两个在飞的写库请求，
  // 后返回的那个覆盖前一个的结论（界面与数据库可能不一致）
  if (!favLock(m.value.id)) return
  const v = m.value.cl === 'y' ? 'n' : 'y'
  const prev = m.value.cl
  m.value.cl = v
  try {
    const r = await window.api.updateMovie(m.value.id, { cl: v })
    if (!r?.ok) throw new Error(r?.error)
  } catch (e) {
    m.value.cl = prev
    ElMessage.error('操作失败：' + (e.message || '写库未响应'))
  } finally {
    favUnlock(m.value.id)
  }
}

// ====== 生命周期 ======
watch(() => Number(route.params.id), (id) => { if (id) loadMovie(id) })

/** 换影片时给新女优的头像一次加载机会（上一张的失败标记不能沿用到下一部） */
watch(() => m.value?.id, () => { brokenAvatars.value = {} })

// 内核确定后（onMounted 里读设置才知道）把挖洞遮罩的矩形补上：等遮罩渲染出来再算。
// 少了这一条，直接进播放页时遮罩会停在 0×0（首帧没有 resize 事件来触发 syncHole）。
watch(isMpv, async (on) => {
  if (!on) return
  await nextTick()
  startHoleWatch()
  syncHole()
  settleHole()
})

onMounted(async () => {
  // 标签分类配置（体型/行为/玩法）来自 store；直接进播放页时可能尚未初始化
  store.initIfNeeded().catch(() => {})
  await loadPlayerSettings()
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  window.addEventListener('resize', fitRecRows)
  window.addEventListener('resize', syncHole)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  fitRecRows()
  startQualityWatch()          // 播放质量自检（mpv 模式下没有 <video> 元素，内部会自动跳过）
  if (dataDirRef.value) window.__dataDir = dataDirRef.value
  loadMovie(Number(route.params.id))
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('keyup', onKeyUp, true)
  window.removeEventListener('resize', fitVideoObject)
  window.removeEventListener('resize', fitRecRows)
  window.removeEventListener('resize', syncHole)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  for (const t of settleTimers) clearTimeout(t)
  settleTimers = []
  stopHoleWatch()
  clearHole()                  // 恢复窗口底色（否则离开播放页后会透出桌面）
  endHold()
  stopQualityWatch()
  // 兜底保存进度（route 切走/关页都会走这里）；记账同样以 playingId 为准（换片流程见 saveProgress 注释）
  if (player.isMounted && playingId && player.currentTime > 0) {
    try { window.api?.savePlayProgress({ id: playingId, pos: player.currentTime, dur: player.duration || 0 }).catch(() => {}) } catch {}
  }
  player.destroy()
})
</script>

<style scoped>
/* 播放页沿用全局底色（--bg 暖纸白），与片库/详情/演员页同一套表层令牌，
   本地 scope 不污染其它页面；只有播放器画布本身是黑的。 */
.player-page {
  /* 左列标题行 / 右列「相关推荐」标题的统一行高：
     两列头部等高，下面的播放器与第一张海报的顶边才能严格对齐（改这一处即可） */
  --head-h: 46px;
  /* 顶部导航真实高度（TopNav 48px）。此前本页从未定义 --nav-h，var() 一直落在 56px 兜底上，
     与实际差 8px —— 所有按 100vh 反算的公式都会累计这个误差。这里就地给准数。 */
  --nav-h: 48px;
  /* 播放器宽度上限：按视口高反算出「严格 16:9」时的宽度（宽高比铁律的副产品）。
     它同时是播放器上下的标题行 / 标签行 / 女优行的公共尺子 —— 窗口最大化、盒子居中
     收窄时，这些行也跟着收窄居中，左右边缘始终与播放器边框线对齐，
     不会在两侧各甩出一截（原先它们铺满 .main-col，左右各超出盒子 50px 上下）。
     减掉的 138px：导航 48 + 标题行 46 + 播放器上下留白合计 144（原 130 是按导航 56 配的，
     导航改准数后 +8 抵消，播放器实际尺寸不变）。 */
  --box-max-w: calc((100vh - var(--nav-h) - var(--head-h) - 138px) * 16 / 9);
  display: flex;
  gap: 14px;
  align-items: flex-start;
  min-height: calc(100vh - var(--nav-h) - 24px);
  /* 底部内边距吃满 main-content 的 24px（左右上只吃 12px）：播放页贴到窗口底边，
     右列推荐列表下方不会再留出一条空白（此前 main-content 自带 24px 底部内边距，
     右列只能到「窗口底 - 24px」，下面那条就什么都不显示）。 */
  margin: -12px -12px -24px;
  padding: 12px 12px 0;
  background: var(--bg);
  color: var(--text);
  outline: none;
}

/* mpv 高兼容模式：页面自己不再画底色 —— 底色交给「挖洞遮罩」去画（它会把视频那一块留空）。
   本元素若继续画 --bg，就会把镂空处填上，mpv 的画面就透不出来了。
   （窗口是 transparent: true，见 electron/main/index.js；祖先链的底色由 global.css
    的 html.mpv-hole 规则一并关掉。） */
.player-page.mpv-on { background: transparent; }

/* mpv 模式的挖洞遮罩（teleport 到 body，所以这里的 scoped 样式仍会生效 —— Vue 会把
   scope 属性打在 teleport 出去的元素上）。
   原理：元素自身不画任何东西，靠 box-shadow 的 spread 把「除了洞以外」的整屏涂成页面底色。
   位置尺寸由 syncHole() 用内联 CSS 变量下发；圆角让 box-shadow 跟着走 → 洞也是圆角的。 */
.mpv-shield {
  --hx: 0px; --hy: 0px; --hw: 0px; --hh: 0px;
  position: fixed;
  left: var(--hx);
  top: var(--hy);
  width: var(--hw);
  height: var(--hh);
  border-radius: var(--r-md);
  box-shadow: 0 0 0 100vmax var(--bg);
  pointer-events: none;
  /* 落在所有页面内容之下：只提供底色，不遮挡任何 UI（TopNav / 标题 / 标签行照常显示） */
  z-index: -1;
}

/* ====== 左列 ====== */
.main-col { flex: 1; min-width: 0; }

/* 与播放器等宽同列（单一尺子 --box-max-w）：
   播放器上方的标题、下方的标签行 / 女优行 / 报错块，左右边缘必须与播放器边框线严格对齐。
   窗口够宽时上面这个 max-width 会生效（盒子居中收窄），若这些行仍铺满 .main-col，
   就会左右各超出盒子一大截 —— 就是「最大化下两行跟播放器对不齐」的原因。 */
.info-head,
.player-wrap,
.player-box,
.tag-row,
.actress-row,
.media-error {
  width: 100%;
  max-width: var(--box-max-w);
  margin-inline: auto;
}

/* 播放器外层：只为「播放质量提示」浮层提供定位参照。自身不产生额外高度（浮层是 absolute），
   所以「播放器顶边 = 右列第一张海报顶边」这条对齐关系不受影响。 */
.player-wrap { position: relative; }

/* 标题行：位于播放器上方；高度锁死 --head-h（内部标题单行截断，不会被长片名撑高）。
   2026-10-07 加 BackButton：原 space-between 会让按钮贴左、标题贴右（间距过大），
   改 flex-start + gap:16px 让二者紧挨；.info-title 的 flex:1 仍撑满右侧，视觉与原来一致。 */
.info-head {
  height: var(--head-h);
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 16px;
  overflow: hidden;
}

.player-box {
  /* 宽高比铁律：盒子必须永远是严格 16:9。高度被视口钳制时同步收窄宽度
     （max-width = --box-max-w，见 .player-page），绝不让宽高比跑偏 —— 一旦跑偏，
     视频按 contain 就铺不满盒子，四边露黑边且在四角圆弧处收成黑楔（「四角黑边」的根源）。
     代价：矮宽窗口下播放器左右留一点页底色空隙（居中），比黑边好看得多。
     宽度上限与居中在 .main-col 下的公共规则里统一给（与下方两行同一把尺子）。 */
  aspect-ratio: 16 / 9;
  border-radius: var(--r-md);
  overflow: hidden;
  /* 这里必须保持透明：圆角裁切边缘做抗锯齿时，容器自己的背景色会参与合成，
     黑底会在浅色页底上渗出成一条贴着圆角的「黑线」（2026-09-30 平场实测
     仅此一项下潜 9.8 灰阶）。黑色垫底职责全部收口到 <video> 自身（见下）。 */
  background: transparent;
}
/* 圆角双保险：视频层是 GPU 合成层，个别驱动下父级 overflow:hidden 的圆角裁切会失效
   （视频方角盖住圆角、四角出现黑楔）。让 ArtPlayer 根节点与 <video> 自身也带圆角，
   裁切在合成层内部完成。进全屏（art-fullscreen / 网页全屏）时恢复 0，避免全屏圆角。 */
.player-box :deep(.art-video-player),
.player-box :deep(.art-video-player video) {
  border-radius: var(--r-sm);
}
.player-box :deep(.art-video-player.art-fullscreen),
.player-box :deep(.art-video-player.art-fullscreen video),
.player-box :deep(.art-video-player.art-fullscreen-web),
.player-box :deep(.art-video-player.art-fullscreen-web video) {
  border-radius: 0;
}
/* ArtPlayer 内部 UI 统一圆角：倍速提示（左上角 notice）、设置面板、影片信息、右键菜单、
   音量面板、进度缩略图、清晰度选择列表等全部由 --art-border-radius 这一个变量驱动，
   改这里一处即可，不会再出现「某个面板是方框」的违和。 */
.player-box :deep(.art-video-player) {
  --art-border-radius: var(--r-sm);
  /* ArtPlayer 自带 background:#000（消融实验实测），它压在圆角裁切边缘之下，
     与容器黑底一起在浅色页底上渗出成角部黑线（仅容器透明时还剩 +9.8 灰阶，
     这里也透明后归零）。全部黑底职责收口到最内层的 <video> 自身。 */
  background: transparent;
}
/* 唯一保留的黑底：<video> 自身。
   ① 换片源瞬间还没有新帧可画时垫黑，避免个别机器合成器把未初始化缓冲画成白闪；
   ② object-fit: contain 的左右黑边也由它提供。
   它是最内层、被画面内容完全覆盖，不参与圆角边缘的抗锯齿合成，不会产生黑线。 */
.player-box :deep(.art-video-player video) {
  background: #000;
}
/* 加载指示器延迟显示：连续快进时，命中已缓冲区间的 seek 通常 <150ms 完成，
   延迟 150ms 后才显示转圈，避免「明明没卡却闪一下缓冲图标」的观感。
   真正需要缓冲（跳到未读区间）时 150ms 后正常显示。 */
.player-box :deep(.art-loading) {
  opacity: 0 !important;
  transition: opacity 0.12s linear 0.15s;
}
.player-box :deep(.art-loading.art-loading-show) {
  opacity: 1 !important;
}

/* 长按倍速 / 快退角标：Chromium 模式挂在 ArtPlayer 根节点上（:deep 穿透），
   mpv 模式挂在 .player-wrap 上（内核没有根节点，由 mount 的 overlayEl 指定）。 */
.player-box :deep(.jt-hold-badge),
.player-wrap :deep(.jt-hold-badge) {
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
/* 错误码 + Chromium 原文：小一号、等宽、低对比 —— 是「可回报的证据」，不该抢正文视线。
   本文件没有 --text-3/--font-mono 令牌，用现有令牌 + 内联字体栈，不新造令牌。 */
.me-hint {
  margin: -6px 0 14px;
  color: var(--text-2);
  font-size: 11px;
  font-family: ui-monospace, Menlo, Consolas, "Courier New", monospace;
  opacity: 0.8;
  word-break: break-word;
}
/* 三个按钮（重试 / 外部播放器打开 / 查看详情）：统一间距，不依赖 el-button 默认外边距 */
.me-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* 播放质量提示（浮层，2026-10-07）：贴在播放器左上角。
   为什么不放在播放器下方那一列：.main-col 的纵向预算按视口高反算死（--box-max-w），
   往列里插元素会把标签行/女优行顶出视口。浮层不参与布局，几何零影响。
   为什么靠左上而不是左下：左下会被 ArtPlayer 的控制条（进度条/按钮）压住。
   右上留给内核自带按钮组（设置/画中画/全屏），所以 max-width 收到 62% 让开。 */
.quality-warn {
  position: absolute;
  left: 12px;
  top: 12px;
  max-width: 62%;
  z-index: 45;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--r-sm);
  background: var(--overlay-strong);
  color: #fff;
  box-shadow: var(--sh-2);
  font-size: 12px;
  line-height: 1.55;
}
.qw-text { opacity: 0.94; }
.qw-actions { display: flex; gap: 8px; }
.qw-btn {
  border: 1px solid rgba(255, 255, 255, 0.32);
  background: transparent;
  color: #fff;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: var(--r-pill);
  cursor: pointer;
}
.qw-btn:hover { background: rgba(255, 255, 255, 0.14); }
/* 主操作（用外部播放器打开）：用品牌红实底，与页面其它主按钮一致 */
.qw-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.qw-primary:hover { background: var(--accent); filter: brightness(1.08); }

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

/* 播放器下方第一行：标签 … 最右 属性标签 + 喜欢 + 详情 */
.tag-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--muted);
}
.tag-row .tags {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 7px 9px;
}
/* 第二行：女优（头像 + 名字）。2026-10-04：多位女优共演全部平铺 → 允许换行 */
.actress-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 8px;
  font-size: 13px;
  color: var(--muted);
}
.actress {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 4px 14px 4px 4px;
  border: none;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 17px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), transform var(--dur-press) var(--ease-out);
}
.actress:hover { background: var(--surface-2); }
.actress:active { transform: scale(0.97); }
.ac-avatar {
  width: 44px;
  height: 44px;
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
.ac-fallback { font-size: 19px; font-weight: 600; color: var(--text-2); }
.ac-name { white-space: nowrap; }

/* 标签（展示影片全部 bq；三类排在前，纯展示不可点 → 不用 TagChip 的 pointer 语义） */
.cat-tag {
  padding: 4px 12px;
  border-radius: var(--r-tag);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.6;
  white-space: nowrap;
  user-select: none;
}

/* 文件名属性标签（2026-10-04）：位于喜欢按钮左侧 / 推荐项标题下方。
   .file-tag / .ft-* / .file-tag-sm 三组样式已统一到 FileTags.vue 的非 scoped 全局样式
   （2026-10-05，全站单一事实来源）——本页标记不变、样式不变；配色令牌见 global.css --filetag-* */

/* 标签行右侧的操作按钮组（属性标签 / 喜欢 / 详情，同一行） */
.row-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 胶囊按钮基础样式（图标 + 文字，与详情页操作按钮同一视觉语言） */
.pill-btn {
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
.pill-btn:hover { background: var(--surface-2); color: var(--text); }
.pill-btn:active { transform: scale(0.98); }
/* 已喜欢：品牌红 */
.fav-btn.on {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}
.fav-btn.on .app-icon { color: var(--accent); }

/* ====== 右列：推荐 ====== */
.rec-col {
  /* 右列宽度只影响文字列宽度：海报尺寸由 --rec-thumb-w 锁死（220×137.5 不变）。
     列越窄 → 左列越宽 → 播放器越大。440 → 400 让播放器加宽 44px（+4.3%）。 */
  width: 400px;
  flex-shrink: 0;
  /* 推荐项尺寸令牌：海报 220×137.5（16:10），整条高 = 137.5 + 6×2 = 149.5px。
     --rec-thumb-h 必须是固定像素值：fitRecRows() 要 parseFloat 它参与间距反算。 */
  --rec-thumb-w: 220px;
  --rec-thumb-h: 137.5px;
  --rec-pad: 6px;                                      /* .rec-item 上下内边距 */
  display: flex;
  flex-direction: column;        /* 标题固定、列表独立滚动 */
  /* 高度钉死为「顶到窗口底边」：视口 - 导航 48 - 页面上内边距 12。
     页面底部内边距已归零（见 .player-page），右列底边 = 窗口底边，
     列表下方不会再有空白条。 */
  height: calc(100vh - var(--nav-h) - 12px);
  /* 贴到窗口最右：负外边距吃掉 player-page(12) + main-content(12) 的右侧内边距，
     这样列表滚动条与其它页面一样落在窗口右边缘 */
  margin-right: -24px;
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
.rec-list {
  flex: 1;
  min-height: 0;
  /* 可见区域只放「完整条目」：--rec-gap 由 fitRecRows() 按列表可用高反算，
     把凑不成整条的零头摊进条目间距 —— 第 k+1 条正好从列表底边之下开始，
     折叠处不露半截海报、可见底边也不留空白。条目超出可见数的部分滚轮下翻可见。 */
  display: flex;
  flex-direction: column;
  gap: var(--rec-gap, 0px);
  overflow-y: auto;
  padding-right: 8px;
}
.rec-empty { color: var(--muted); font-size: 13px; padding: 20px 0; text-align: center; }
.rec-item {
  display: flex;
  gap: 10px;
  padding: var(--rec-pad);
  /* 条目高度钉死为「海报高 + 上下内边距」：最大化下 --rec-thumb-h 被缩小后，
     单条高跟着变小，6 条正好铺满列表可用高度（不留半条、不留空白）。 */
  height: calc(var(--rec-thumb-h) + var(--rec-pad) * 2);
  /* 列表是 flex 列：条目必须禁止收缩，否则条目多于一屏时会被压扁（而不是出现滚动条） */
  flex: 0 0 auto;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), transform var(--dur-press) var(--ease-out);
}
/* 首项去掉上内边距：缩略图顶边正好落在列表顶边（= 播放器顶边） */
.rec-item:first-child { padding-top: 0; }
.rec-item:hover { background: var(--surface-2); }
.rec-item:active { transform: scale(0.99); }
.rec-item .thumb {
  position: relative;
  /* 高度是单一事实来源（--rec-thumb-h），宽度按 16:10 由高度推导 */
  height: var(--rec-thumb-h);
  width: calc(var(--rec-thumb-h) * 16 / 10);
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
/* 演员名（替代原番号位置；过长单行截断） */
.rec-actors {
  margin-top: 5px;
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 文件名属性标签行（2026-10-04）：标题下方、演员名上方；原「★ 评分」行已移除 */
.rec-file-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}

/* 换片过渡：信息块按 m.id 重建 DOM → 动画重放（淡入 + 轻微上移）。
   用「重建即淡入」而不是 Transition out-in —— 旧元素不参与离开动画，中间不会出现空档，
   播放器顶边位置与第一行内容都不会抖。prefers-reduced-motion 下由全局规则自动瞬时结束。 */
.swap-in { animation: jt-swap-in var(--dur-base) var(--ease-out) both; }
@keyframes jt-swap-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}

/* 窄窗口：推荐栏换到下方 */
@media (max-width: 1100px) {
  .player-page { flex-direction: column; }
  /* 纵向排布后右列高度回到按内容自适应 */
  .rec-col { width: 100%; height: auto; margin-right: 0; }
}
</style>
