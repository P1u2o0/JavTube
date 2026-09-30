<!--
  ============================================================
  文件名：Home.vue
  所属模块：视图 / 首页
  功能描述：首页推荐面板，三块区域（数据来自 home:recommend IPC）：
           ① 轮播：按近期观看的类别 / 系列 / 女优挑选同类影片，以
              **封面流（coverflow）**形式呈现——中心为当前影片大海报，
              左右两侧依次露出半幅并逐渐缩小。
              **任意影片数（≥ 1）都渲染 5 份副本构成循环传送带 → 5 个槽位永远被海报填满**，
              左右按钮首尾循环（第 5 张点下一张回到第 1 张）；
              库内不足 5 部时副本会重复出现（如 3 部 → B C A B C），
              即"复制海报凑满 5 格"（用户 2026-09-29 选定，取代此前的空位占位 + 反向滑回）。
              **推进方向恒定**：自动轮播与「下一部」一律按 1→2→…→末张→接回第 1 张
              单向循环，不存在「到头反向」的往复（2026-09-29 按要求改）。
              **手动优先**：手动切一张（按钮/指示点/海报）会把自动轮播重新计时，
              4.5s 内不会再自动切；窗口不可见时自动轮播暂停，切回来继续。
              每次打开软件挑选一次（主进程会话级缓存，软件内切页不重随机）
           ② 类别按钮：全库标签频率前 5（4 字以内），单张背景海报 + 暗遮罩；
              **5 个类别的背景海报互不相同**（主进程按封面去重挑选）；hover 时背景缓慢放大
           ③ 近期上新：优先「与近期观看兴趣无交集」的影片，**不足 8 部用最新添加的补足**，
              4 列 × 2 行共 8 部；库本身不足 8 部时，剩余位置才是空位占位
  视觉：沿用设计令牌（暖纸白 / 墨黑 / 品牌红、4 级圆角、发丝边框）
  依赖：vue-router、@/components/AppIcon、@/utils/global（resolveCover）
  ============================================================
-->
<template>
  <div class="home-page">
    <!-- ===== ① 轮播：封面流（中心大图 + 两侧半幅递减） ===== -->
    <section v-if="hero.length" class="hero">
      <!-- no-anim：循环越界后的「静默归位」瞬间禁掉过渡（复位前后画面完全一致，看不见） -->
      <div class="flow-wrap" :class="{ 'no-anim': noAnim }">
        <!-- 传送带模式（业界标准）：单一 belt 元素整体平移，所有海报刚性同步移动；
             海报 left 按自身索引固定，切换只动 belt → 运动完全均匀自然 -->
        <div class="flow">
          <!-- 所有海报常驻 DOM（无进出场），切换仅改内联 style → CSS transition 必然触发。
               渲染 5 份副本（见 heroSlots：共 5n 个槽位），任意位置左右都有内容，
               5 个槽位永远填满、不存在空位占位图 -->
          <div class="stage">
            <div v-for="s in heroSlots" :key="s.key" class="slot"
                 :ref="el => setSlotEl(s.pos, el)" :style="slotStyle(s.pos)">
              <CoverImg :src="coverOf(s.movie)" :alt="s.movie.pm || ''" :title="s.movie.pm || ''"
                        :lazy="false" @click="onSlotClick(s.pos)" />
              <div class="shade"></div>
            </div>
          </div>
        </div>
        <!-- 左右切换 -->
        <button v-if="hero.length > 1" class="flow-nav prev" aria-label="上一部" @click="manualStep(-1)">
          <AppIcon name="back" :size="18" />
        </button>
        <button v-if="hero.length > 1" class="flow-nav next" aria-label="下一部" @click="manualStep(1)">
          <AppIcon name="back" :size="18" class="flip" />
        </button>
      </div>
      <!-- 指示点（按实际数量） -->
      <div v-if="hero.length > 1" class="hero-dots">
        <button v-for="(m, i) in hero" :key="m.id" class="dot" :class="{ on: i === activeIndex }"
                :aria-label="`第 ${i + 1} 部`" @click="go(i)"></button>
      </div>
    </section>

    <!-- ===== ② 类别按钮：全库标签频率前 5（4 字以内），单张背景海报 + 暗遮罩 ===== -->
      <section v-if="categories.length" class="cats">
        <button v-for="c in categories" :key="c.tag" class="cat-card" @click="goTag(c.tag)">
          <div v-if="c.cover" class="cat-bg" :style="{ backgroundImage: `url(${coverOf(c.cover)})` }"></div>
          <div class="cat-shade"></div>
          <div class="cat-label">
            <div class="cat-main">{{ c.tag }}</div>
          </div>
        </button>
      </section>

    <!-- ===== ③ 近期上新：不常看的影片（4 列 × 2 行，不足留空） ===== -->
    <section class="arrivals">
      <div class="sec-head">
        <span class="sec-title">近期上新</span>
      </div>
      <div class="arrival-grid">
        <div v-for="m in arrivals" :key="m.id" class="arrival-card" @click="goDetail(m)">
          <div class="ac-cover">
            <CoverImg v-if="coverOf(m)" :src="coverOf(m)" :alt="m.pm || ''" />
            <div v-else class="ac-no-cover"><AppIcon name="image" :size="22" /></div>
          </div>
          <div class="ac-code">{{ m.ph || '—' }}</div>
          <div class="ac-title" :title="m.pm">{{ m.pm || '无标题' }}</div>
        </div>
        <!-- 空位：不足 8 部时补齐占位，保持 4 列 × 2 行版式。
             番号/标题两行用不可见占位撑住 → 空位卡与影片卡**等高**，两行整齐对齐。 -->
        <div v-for="n in emptySlots" :key="`ph-${n}`" class="arrival-card is-empty" aria-hidden="true">
          <div class="ac-cover"></div>
          <div class="ac-code">&nbsp;</div>
          <div class="ac-title">&nbsp;</div>
        </div>
      </div>
      <!-- 无数据时的提示 -->
      <div v-if="!arrivals.length" class="empty-tip">暂无与近期观看偏好不同的影片</div>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { resolveCover } from '@/utils/global'
import AppIcon from '@/components/AppIcon.vue'
import CoverImg from '@/components/CoverImg.vue'

const router = useRouter()

// 三块数据
const hero = ref([])         // 轮播影片（封面流）
const categories = ref([])   // 类别按钮
const arrivals = ref([])     // 近期上新

// 轮播当前索引与定时器
const active = ref(0)            // 当前居中的「固定位置」；循环越界时会短暂超出 [0, n)，随后静默归位
let timer = null                 // 自动轮播
let settleTimer = null           // 循环越界后的静默归位
const noAnim = ref(false)        // 静默归位期间禁掉 CSS 过渡
const HERO_INTERVAL = 4500   // 自动轮播间隔（毫秒）
const HERO_WINDOW = 5        // 可见槽位数（中心 + 左右各 2）= 副本份数
const SETTLE_MS = 480        // 静默归位延迟（略大于位移过渡 --dur-xl 420ms，确保动画已结束）
const ARRIVAL_TOTAL = 8      // 近期上新位总数（4 列 × 2 行）

/**
 * 系统「减少动态效果」开关。CSS 媒体查询管不到 WAAPI 动画（下面的 playCenterFadeIn），
 * 所以这里单独跟踪并据此把淡化时长降为 0 —— 与 global.css 的降级策略保持一致：
 * 大范围运动降级、低强度反馈（颜色/透明度）保留。
 *
 * 用 ref + change 监听（而不是模块常量只读一次）：用户在系统设置里拨动「动画效果」后
 * 无需重启软件即可生效 —— CSS 侧的媒体查询是实时的，JS 侧若只读一次就会出现
 * 「CSS 已经动了、WAAPI 还按旧值跑」的不一致。
 */
const REDUCE_MOTION = ref(
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
)
// 「动画效果」偏好变化的订阅放在生命周期里成对增删（2026-09-30 审计）：
// 原实现写在 <script setup> 顶层，而 matchMedia 返回的 MediaQueryList 是**全局共享**对象
// —— 每次进首页都会往同一个对象上再挂一个 change 监听且从不移除，
// 关闭/重开首页 N 次就多 N 个监听（闭包还持有已卸载组件的 ref）。
let reduceMotionMQL = null
function onReduceMotionChange(e) { REDUCE_MOTION.value = e.matches }

/** 当前居中的影片索引（把越界的 active 取模还原；指示点用它，避免循环瞬间无高亮） */
const activeIndex = computed(() => {
  const n = hero.value.length
  return n ? ((active.value % n) + n) % n : 0
})

/** 封面 URL 解析（无封面时返回空串） */
function coverOf(m) {
  return resolveCover(m?.cover, m?.id) || ''
}

/**
 * 轮播槽位列表 —— 「传送带」：**任意影片数（≥ 1）都渲染 5 份副本**。
 * 共 5n 个槽位，第 k 个的位置固定为 `k - 2n`，内容是 `hero[k % n]`；可见判定 |pos - active| <= 2。
 *
 * 为什么 5 份副本对任意 n 都成立：
 *   可见窗口只跨 5 个连续 pos，渲染区间 [-2n, 3n-1] 恰好覆盖 active ∈ [-2n+2, 3n-3]
 *   （= safeActiveRange）下的可见区间 [active-2, active+2] → **任意 active 下 5 个槽位都被填满**。
 *   n >= 5 时窗口内 `pos % n` 两两不同，每部影片恰好一个副本可见（画面与 5 部时无异）；
 *   n < 5 时副本必然重复（如 n=3、active=0 → pos -2..2 → B C A B C），
 *   即用户选定的「复制海报凑满 5 格」，取代此前的空位占位 + 反向滑回。
 *   静默归位的不变式同样对任意 n 成立：pos 与 pos+n 上的影片相同（list[p % n]），
 *   且两者相对 active 的偏移一致 → active 与 active+n 的画面签名逐像素相同。
 *
 * 为什么是 5 份而不是 3 份：连点"下一部"时 active 会在归位前持续累加，
 *   3 份（pos ∈ [-n, 2n-1]）最多只撑得住越界 2~3 格，快速连点会把副本用尽、槽位凭空消失。
 *   5 份把安全区间扩到 active ∈ [-2n+2, 3n-3]，连点十几下也不会露馅。
 */
const heroSlots = computed(() => {
  const list = hero.value
  const n = list.length
  if (!n) return []
  const out = []
  for (let k = 0; k < n * HERO_WINDOW; k++) {
    out.push({ key: 'b' + k, movie: list[k % n], pos: k - n * 2 })
  }
  return out
})

/** 传送带能安全支撑的 active 区间（超出说明副本快用尽了，必须立刻归位） */
function safeActiveRange(n) {
  return [-2 * n + 2, 3 * n - 3]
}

/**
 * coverflow 槽位样式：按相对中心的距离 d 算「水平偏移 + 缩放」，纵深只由 scale 表达
 * （不用 perspective / translateZ —— 3D 合成层在 5 张海报同时大位移时会掉帧）。
 * 所有海报常驻 DOM，切换时 active 变化仅让各槽位的 d 变化 → transform/opacity
 * 由 CSS transition 平滑过渡，呈现「当前海报缩小滑向侧面、下一张放大滑到正中」。
 * |d|>2 的海报移到屏外并隐藏（仍常驻，保证过渡连续）。
 * @param {number} pos - 槽位固定位置（-2n ~ 3n-1）
 */
function slotStyle(pos) {
  const d = pos - active.value
  const sign = d < 0 ? -1 : 1
  const off = Math.abs(d) > 2          // 超出视野 → 移出屏外隐藏
  const abs = Math.min(Math.abs(d), 2)
  const x     = off ? sign * 900 : (abs === 0 ? 0 : sign * (abs === 1 ? 300 : 480))
  const scale = off ? 0.3 : (abs === 0 ? 1 : abs === 1 ? 0.72 : 0.5)
  // 两侧弱化不用「半透明」，而用「纯白遮罩」（海报本体保持实色）
  const veil = abs === 0 ? 0 : abs === 1 ? 0.5 : 0.74
  return {
    // 纯 2D 变换（位移 + 缩放）：
    // 不再用 perspective/translateZ —— 3D 合成层在 5 张海报同时大位移时会掉帧（顿挫感来源之一），
    // 纵深改由 scale 单独表达，GPU 只需处理 2D 合成，滑动明显更顺
    transform: `translate(-50%, -50%) translateX(${x}px) scale(${scale})`,
    opacity: off ? 0 : 1,          // 静止态一律不透明；淡入淡出由切换时的 WAAPI 动画负责
    zIndex: 10 - abs,
    '--shade': off ? 0 : veil,     // 白色遮罩强度（中心 0，越外越白）
    pointerEvents: off ? 'none' : undefined
  }
}

/** 近期上新的空位数量（保持 4×2 版式） */
const emptySlots = computed(() => Math.max(0, ARRIVAL_TOTAL - arrivals.value.length))

/** 加载推荐数据（轮播影片由主进程会话级缓存，本次运行内固定） */
async function load() {
  if (!window.api?.getHomeRecommend) return
  // .catch 兜底（2026-09-30 审计）：主进程 handler 本身有 try（返回 {ok:false}），
  // 但 IPC 层异常（通道未注册、主进程忙）会让 invoke reject —— 不接住就是
  // unhandled rejection，且首页停在空列表没有任何提示。
  const r = await window.api.getHomeRecommend().catch((e) => { console.warn('[home] 首屏数据加载失败:', e); return null })
  if (r?.ok) {
    hero.value = r.data.hero || []
    categories.value = r.data.categories || []
    arrivals.value = r.data.arrivals || []
    // 防越界：active 允许临时越界（传送带副本），但重新加载后必须回到基础区间，
    // 否则会落在新列表没有渲染的副本位置上 → 首屏 5 格可能填不满
    const n = hero.value.length
    if (!n) active.value = 0
    else if (active.value < 0 || active.value >= n) {
      active.value = ((active.value % n) + n) % n
    }
  }
}

/** 轮播槽位 DOM 引用：按「固定位置 pos」索引（循环模式下同一部影片有 3 个副本，pos 唯一） */
const slotEls = new Map()
function setSlotEl(pos, el) {
  if (el) slotEls.set(pos, el)
  else slotEls.delete(pos)
}

/**
 * 切换瞬间给「进入中心」的海报播一段淡入（WAAPI）。
 * 为什么用 WAAPI 而不是常驻 CSS opacity：
 *   - 常驻透明度会让两侧海报长期处于半透明态（与「用白遮罩弱化」的诉求冲突）
 *   - WAAPI 只在切换瞬间叠加一段动画，播放结束自动回落到内联 opacity:1，
 *     静止态完全不透明，白遮罩仍是唯一的弱化手段
 * 时长与位移同步（--dur-xl 420ms，见 CSS）、强 ease-out：起步快、收尾稳，丝滑且不拖沓。
 * reduced-motion 下 duration 取 0（WAAPI 不受 CSS 媒体查询约束，必须在这里判断）。
 */
function playCenterFadeIn() {
  const el = slotEls.get(active.value)
  if (!el?.animate) return
  el.animate(
    [{ opacity: 0.22 }, { opacity: 1 }],
    { duration: REDUCE_MOTION.value ? 0 : 420, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' }   // 与位移同时长同曲线
  )
}

/** 切换轮播（dir=1 下一部 / -1 上一部）。
 *  **恒定单向循环**：走到末尾后直接接回第 1 张、继续同方向推进，没有「到头反向」的往复。
 *  传送带里的副本负责无缝接续（active 允许临时越界，动画结束后静默归位）——
 *  对任意影片数都成立，n < 5 时同一部影片的多个副本会同时可见（复制凑满 5 格）。
 *  注意：本函数是「切一格」的原子操作，自动轮播与手动都调用它；
 *        手动入口要包一层 manualStep()，用于把自动轮播重新计时。 */
function step(dir) {
  const n = hero.value.length
  if (n < 2) return
  active.value += dir
  // 连点过快时 active 一路累加，接近传送带副本边界 → 立刻静默归位（宁可闪一下也不能让槽位消失）
  const [lo, hi] = safeActiveRange(n)
  if (active.value < lo || active.value > hi) normalizeNow()
  playCenterFadeIn()
  scheduleSettle()
}

/**
 * 手动「上一部 / 下一部」= 切一格 + **把自动轮播重新计时**。
 *
 * 为什么必须重新计时（用户 2026-09-29 反馈）：
 *   不加这一下，手动切完不到 4.5s 自动那一步就会插进来 —— 尤其「末张 → 第 1 张」这一格
 *   后面紧跟一个静默归位（480ms），自动步恰好落在归位之后，用户看到的就是
 *   「刚点完又是一跳」的顿挫。重新计时后，手动操作之后 4.5s 内一定不会再自动切。
 */
function manualStep(dir) {
  step(dir)
  bumpAuto()
}

/**
 * 跳到指定轮播项（指示点）。
 *
 * **必须取「离当前最近的那一份副本」**，不能直接写基础副本的 pos：
 * 传送带里 index i 出现在 pos = i + k*n（k = -2..2）。过去直接 `active = i`，
 * 于是从第 5 个点回第 1 个时位移是 4 格（1200px）—— 整条带子横飞，观感就是「卡一下」
 * （实测：20 组点对里最大位移 900px）。
 * 取最近副本后位移 ≤ 2 格（|d|=2 → 480px，实测最大 480px），
 * 「5 → 1」正好是**向前 1 格**（300px，落到 pos = n 那份副本上），
 * 与自动轮播的「末张 → 第 1 张」是同一个动作，自然衔接；越界由 scheduleSettle 稍后静默归位。
 * 平票（正好差 n/2）取向前那份，保持「正方向优先」。
 * n < 5 时副本会重复，取最近副本同样只走 1~2 格，不会横飞。
 */
function go(i) {
  const n = hero.value.length
  if (!n) return
  let best = i
  for (let k = -2; k <= 2; k++) {
    const p = i + k * n
    const d = Math.abs(p - active.value)
    const bd = Math.abs(best - active.value)
    if (d < bd || (d === bd && p > best)) best = p
  }
  active.value = best
  playCenterFadeIn()
  scheduleSettle()
  bumpAuto()
}

/**
 * 点击槽位：中心海报进详情，其他海报移到中心。
 * 直接把 active 设成该槽位的**固定位置** pos —— 无论它是第几份副本，
 * 位移都只有 1~2 格，滑动自然；越界由 scheduleSettle 稍后静默归位。
 */
function onSlotClick(pos) {
  if (pos === active.value) {
    const n = hero.value.length
    return goDetail(hero.value[((pos % n) + n) % n])
  }
  active.value = pos
  playCenterFadeIn()
  scheduleSettle()
  bumpAuto()
}

/** 打开影片详情 */
function goDetail(m) {
  if (m?.id) router.push(`/detail/${m.id}`)
}

/** 按标签筛选片库（类别按钮） */
function goTag(tag) {
  router.push({ path: '/library', query: { tag } })
}

/**
 * 循环越界后的「静默归位」。
 *
 * 传送带里同一部影片有 5 份副本，所以 active = n 与 active = 0 呈现的画面**完全一致**
 * （只是居中/相邻的是不同副本元素）。等位移动画播完后把 active 拉回 [0, n)，
 * 并在这两帧内禁掉 CSS 过渡 → 用户看不到任何变化，但内部索引回到正常区间。
 *
 * 注意：必须在动画结束后才归位。若立刻归位，各副本元素的 transform 会同时大跳，
 * 过渡会被截断成一次横跨整屏的滑动。
 */
function scheduleSettle() {
  const n = hero.value.length
  if (active.value >= 0 && active.value < n) return   // 没越界，无需处理
  clearTimeout(settleTimer)                           // 每次切换都重新计时：总在最后一次动画之后归位
  settleTimer = setTimeout(() => {
    settleTimer = null
    normalizeNow()
  }, SETTLE_MS)
}

/** 立刻静默归位到 [0, n)（关过渡 → 改索引 → 双 rAF 后恢复过渡） */
function normalizeNow() {
  const n = hero.value.length
  if (!n) return
  if (active.value >= 0 && active.value < n) return
  noAnim.value = true
  active.value = ((active.value % n) + n) % n
  requestAnimationFrame(() => requestAnimationFrame(() => { noAnim.value = false }))
}

/**
 * 启动自动轮播。与手动「下一部」走**同一条** step(1)：
 * 恒定单向推进 1→2→…→末张→接回第 1 张，不再「到头反向」往复
 * （反向会让观感忽左忽右，用户明确要求方向一致）。
 * 传送带副本保证「末张 → 第 1 张」是无缝接续，不需要靠反向来回避整屏横飞。
 *
 * 只重启「间隔计时器」，**不清 settleTimer**：静默归位该发生还得发生，
 * 否则会把 active 永久留在越界区间（画面没错，但副本会白跑）。
 * 窗口不可见时不启动（下面 onVisibility 会在切回来时重新启动）。
 */
function startTimer() {
  pauseTimer()
  if (hero.value.length < 2) return
  if (typeof document !== 'undefined' && document.hidden) return
  timer = setInterval(() => {
    if (settleTimer) return                 // 正在静默归位，跳过本次，避免与归位抢索引
    step(1)
  }, HERO_INTERVAL)
}

/** 只停「间隔计时器」（保留待执行的静默归位） */
function pauseTimer() {
  if (timer) { clearInterval(timer); timer = null }
}

/**
 * 手动操作后把自动轮播重新计时。
 * 只在「本来就开着自动轮播」时重启 —— 影片 < 2 部或窗口不可见时不会凭空开启。
 */
function bumpAuto() {
  if (timer) startTimer()
}

/** 完全停掉（含待执行的静默归位与 no-anim 状态）：组件卸载时用 */
function stopTimer() {
  pauseTimer()
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null }
  noAnim.value = false
}

/** 窗口切走/最小化时停掉自动轮播，切回来再继续：看不见就不空转，回来也不会一次补一串 */
function onVisibilityChange() {
  if (document.hidden) pauseTimer()
  else startTimer()
}

onMounted(async () => {
  await load()
  startTimer()
  document.addEventListener('visibilitychange', onVisibilityChange)
  // 订阅系统「动画效果」偏好变化（与下方的移除严格成对，见 REDUCE_MOTION 注释）
  try {
    reduceMotionMQL = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null
    reduceMotionMQL?.addEventListener?.('change', onReduceMotionChange)
  } catch { reduceMotionMQL = null }
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  try { reduceMotionMQL?.removeEventListener?.('change', onReduceMotionChange) } catch {}
  reduceMotionMQL = null
  stopTimer()
})
</script>

<style scoped>
.home-page { display: flex; flex-direction: column; gap: 18px; }

/* ===== ① 轮播：封面流 ===== */
.flow-wrap {
  position: relative;
  height: 430px;                                    /* 板块加大 */
  border-radius: var(--r-lg);
  /* 不设背景与边框：海报直接悬浮在页面底色上，由海报自身投影拉开层次 */
  background: transparent;
  overflow: hidden;   /* 两侧海报被裁切 */
}
.flow {
  position: absolute; inset: 0;
  transform-style: preserve-3d;   /* 让透视传递到 stage → slot */
}
/* 3D 舞台：让子海报的 rotateY/translateZ 产生真实透视 */
.stage {
  position: absolute; inset: 0;
  transform-style: preserve-3d;
}
/* 静默归位：越界后瞬间复位，复位前后画面完全一致，
   必须禁掉过渡，否则会看到一次横跨整屏的大幅滑动。
   ⚠️ 必须带 !important：global.css 的 reduced-motion 降级块是 `* { transition-*: … !important }`，
   而 !important 只能压过**普通声明**——降级块与本行都是 !important 时比的是**特异性**，
   本行 (0,3,0) 高于 `*` (0,0,0)，所以本行胜。不加 !important 时本行是普通声明，会被压过：
   归位瞬间 5 张海报会各自跑一次 120ms 的透明度过渡（实测整排闪一下）。
   （别以为「加了 !important 就必胜」——将来若有人也写成 `* { … !important }`，
     这条就要靠特异性继续赢，所以选择器不要简写。） */
.flow-wrap.no-anim .slot,
.flow-wrap.no-anim .shade { transition: none !important; }
/* 槽位：基准尺寸 = 横向海报 600×400（3:2）；rotateY/translateZ/scale 由内联控制。
   立体轮换过渡：一次平滑的三维插值（旋转+后撤+缩放+位移同步） */
.slot {
  position: absolute; left: 50%; top: 50%;
  width: 600px; height: 400px;
  transform-origin: center center;
  backface-visibility: hidden;
  /* 圆角 + 裁剪 + 阴影统一在槽位层：图片与白色遮罩都被裁到同一圆角，
     消除二者边缘的亚像素缝隙（此前遮罩顶部会漏出一条线） */
  border-radius: var(--r-md);
  overflow: hidden;
  box-shadow: var(--sh-3);
  /* 位移 --dur-xl 420ms + iOS 抽屉曲线（起步快、中段顺、收尾缓）：
     之前的 --ease-in-out（0.77,0,0.175,1）前 20% 几乎不动，跟手轮播用它会明显迟滞。
     时长走令牌：这是全项目唯一允许超过 300ms 的档位（整幅海报横移接近一屏宽）
     ⚠️ opacity 必须与 transform **同时长同曲线**一起过渡（2026-09-29 盲测发现的缺陷）：
     slotStyle 对 |d|>2 的槽位内联 opacity:0，而 off 分支的 x 是**钳制在 ±900** 的 ——
     只过渡 transform 时，d 由 2 变 3 的那一帧 opacity 立刻归零，可那张海报此刻还停在
     x=±480、**有约 300~430px 宽仍在视口内**，于是屏上凭空出现一块空洞，要等 420ms
     才被滑进来的海报填上（实测 4 个场景 29 个「还在屏内却已不可见」的帧）。
     一起过渡后淡出跟随滑出，离开视野时才基本透明。
     注意：`.no-anim`（静默归位）会把两者的过渡一起关掉，所以"归位要瞬时"的约束不受影响。 */
  transition: transform var(--dur-xl) var(--ease-drawer),
              opacity var(--dur-xl) var(--ease-drawer);
  will-change: transform, opacity;
}
.slot img {
  width: 100%; height: 100%; object-fit: cover; display: block;
  /* 圆角与阴影已上移到 .slot（统一裁剪，避免与遮罩之间出现缝隙） */
  cursor: pointer;
}
/* 注：轮播海报不做 hover 位移 —— 海报本身在滑动，再叠加 translateY 会显得跳动，
   且在自动轮播时鼠标与海报的相对位置不断变化，会反复触发/取消 hover 造成顿挫 */
/* 白色遮罩：非中心海报盖纯白半透明层（替代原透明弱化 + 暗角），
   越靠外越白，与暖纸白底色自然衔接；中心时完全透明（--shade=0） */
.shade {
  position: absolute; inset: 0;
  border-radius: var(--r-md);
  background: var(--surface);                     /* 纯白遮罩 = 表面色令牌（不再裸写 #ffffff） */
  opacity: var(--shade, 0);
  transition: opacity var(--dur-xl) var(--ease-drawer);   /* 与位移同步，避免"先白了还在滑" */
  pointer-events: none;
}
/* 左右切换按钮：玻璃圆钮（与卡片角标同质感） */
.flow-nav {
  position: absolute; top: 50%; transform: translateY(-50%);
  width: var(--icon-btn-md); height: var(--icon-btn-md); border: none; border-radius: 50%;
  background: var(--glass);
  backdrop-filter: blur(12px) saturate(1.5);
  -webkit-backdrop-filter: blur(12px) saturate(1.5);
  color: var(--text);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), var(--sh-1);
  transition: background var(--dur-fast) ease, transform var(--dur-fast) var(--ease-out);
  z-index: var(--z-base);          /* 叠层阶梯：页内局部浮层 */
}
.flow-nav:hover { background: var(--glass-hover); }
.flow-nav:active { transform: translateY(-50%) scale(0.96); transition-duration: var(--dur-press); }
.flow-nav.prev { left: 14px; }
.flow-nav.next { right: 14px; }
.flip { transform: rotate(180deg); }
/* 指示点 */
.hero-dots { display: flex; gap: 6px; justify-content: center; margin-top: 10px; }
.dot {
  width: 7px; height: 7px; padding: 0; border: none; border-radius: 50%;
  background: var(--border-strong); cursor: pointer;
  transition: width var(--dur-base) var(--ease-out), background var(--dur-fast) ease;
}
.dot.on { width: 20px; border-radius: var(--r-pill); background: var(--accent); }
.dot:active { transform: scale(0.85); }

/* ===== ② 类别按钮：5 列卡片式，单张背景海报 + 暗遮罩 + 左下角文字 ===== */
.cats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.cat-card {
  position: relative;
  display: block; width: 100%;
  aspect-ratio: 16 / 9;           /* 横向卡片（参考 Emby 横滑卡片） */
  padding: 0; overflow: hidden;
  border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--surface-2);   /* 无封面时的底色 */
  cursor: pointer; text-align: left;
  /* 移出：--dur-lg 快速收回 */
  transition: transform var(--dur-lg) var(--ease-out),
              box-shadow var(--dur-lg) var(--ease-out);
}
/* 类别卡整体：轻微上浮（进入时长曲线与背景缩放统一，避免「一个硬一个软」的割裂感） */
.cat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--sh-2);
  transition-duration: var(--dur-xl);
  transition-timing-function: var(--ease-drawer);
}
.cat-card:active { transform: translateY(-1px) scale(0.99); }   /* 按压反馈 */
/* 背景海报图（单张，含该类别随机一部影片） */
.cat-bg {
  position: absolute; inset: 0;
  background-size: cover; background-position: center;
  /* 移出：较短、快速收回（遵循「退出快于进入」） */
  transition: transform var(--dur-lg) var(--ease-out);
}
/* hover 放大：旧实现是 300ms + --ease-out —— 起步太猛、到位太硬，观感「生硬」。
   改为 iOS 抽屉曲线（起步快、中段顺、收尾极缓），并放大到 1.08 让位移量更从容。
   时长从 620ms 收到 --dur-lg 340ms：与同类卡片（.cat-card 自身）一致，
   620ms 远超令牌上限、且比卡片上浮慢近一倍，会出现「卡片停住了背景还在滑」的脱节 */
.cat-card:hover .cat-bg {
  transform: scale(1.08);
  transition-duration: var(--dur-lg);
  transition-timing-function: var(--ease-drawer);
}
/* 暗色遮罩：从右往左逐渐加深（左侧最深，承载靠左的类别名） */
.cat-shade {
  position: absolute; inset: 0;
  background: linear-gradient(to right,
    rgba(22, 21, 19, 0.78) 0%,
    rgba(22, 21, 19, 0.52) 50%,
    rgba(22, 21, 19, 0.30) 100%);
  pointer-events: none;
}
/* 类别名：靠左显示、垂直居中（字号 20px，不含数量） */
.cat-label {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: flex-start;
  padding-left: 14px;
  color: #fff;
  text-shadow: 0 1px 4px rgba(22, 21, 19, 0.55);   /* 增强对比（暖黑，遵循"不用纯黑"规范） */
  pointer-events: none;
}
.cat-label .cat-main {
  font-family: var(--font-display); font-weight: 700; font-size: var(--fs-3xl);
  letter-spacing: var(--ls-display);   /* 20px 大字 → 收紧（此前误用 +0.02em，与 Apple 相反） */
  max-width: 88%;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ===== ③ 近期上新 ===== */
.arrivals { display: flex; flex-direction: column; gap: 12px; }
.sec-head { display: flex; align-items: center; }
.sec-title {
  font-family: var(--font-display); font-weight: 700; font-size: var(--fs-xl); color: var(--text);
  padding-left: 10px; border-left: 3px solid var(--accent); line-height: 1.1;
}
/* 4 列 × 2 行（8 部，含空位）。
   ⚠️ 必须用 minmax(0, 1fr) 而不是 1fr：
   `1fr` 等价于 `minmax(auto, 1fr)`，列的最小尺寸会被内容撑开 ——
   .ac-title 是 white-space: nowrap，长番号/长标题会把列撑到 700px+，
   结果四列宽度各不相同、海报大小不一（用户反馈的「每个海报图都不一样大」根因）。
   minmax(0, 1fr) 把最小尺寸压到 0，配合下面的 overflow:hidden 让标题省略号生效。 */
.arrival-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.arrival-card { cursor: pointer; min-width: 0; }   /* min-width:0 让卡片可被压缩 */
.ac-cover {
  width: 100%; aspect-ratio: 3/2; overflow: hidden;
  border-radius: var(--r-md); border: 1px solid var(--border);
  background: linear-gradient(135deg, var(--surface-2), var(--surface-3));
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}
.arrival-card:hover .ac-cover { transform: translateY(-3px); box-shadow: var(--sh-2); }
.ac-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ac-no-cover {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center; color: var(--muted);
}
/* 空位：仅保留占位，无边框与悬停效果 */
.arrival-card.is-empty .ac-cover {
  border: 1px dashed var(--border);
  background: transparent;
}
.arrival-card.is-empty:hover .ac-cover { transform: none; box-shadow: none; }
.ac-code {
  margin-top: 7px;
  font-family: var(--font-display); font-variant-numeric: tabular-nums;
  font-weight: 600; font-size: var(--fs-base); color: var(--primary);
}
.ac-title {
  font-size: var(--fs-base); color: var(--text-2); line-height: 1.5;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.empty-tip { font-size: var(--fs-base); color: var(--muted); }
</style>
