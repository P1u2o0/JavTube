<!--
  ============================================================
  文件名：Home.vue
  所属模块：视图 / 首页
  功能描述：首页推荐面板，三块区域（数据来自 home:recommend IPC）：
           ① 轮播：按近期观看的类别 / 系列 / 女优挑选同类影片，以
              **封面流（coverflow）**形式呈现——中心为当前影片大海报，
              左右两侧依次露出半幅并逐渐缩小；不足 5 部时留出空位。
              每次打开软件挑选一次（主进程会话级缓存，软件内切页不重随机）
           ② 类别按钮：近期观看标签中「恰好两个汉字」的标签按出现频率取前 4；
              按钮左侧类别名 + 数量，右侧该类影片封面 2×2 拼接；不足 4 个留空位
           ③ 近期上新：与近期观看兴趣无交集的影片（不常看的类别/系列/女优），
              4 列 × 2 行共 8 部；不足时留空位
  视觉：沿用设计令牌（暖纸白 / 墨黑 / 朱柿红、4 级圆角、发丝边框）
  依赖：vue-router、@/components/AppIcon、@/utils/global（resolveCover）
  ============================================================
-->
<template>
  <div class="home-page">
    <!-- ===== ① 轮播：封面流（中心大图 + 两侧半幅递减） ===== -->
    <section v-if="hero.length" class="hero">
      <div class="flow-wrap">
        <!-- 传送带模式（业界标准）：单一 belt 元素整体平移，所有海报刚性同步移动；
             海报 left 按自身索引固定，切换只动 belt → 运动完全均匀自然 -->
        <div class="flow">
          <!-- 所有海报常驻 DOM（无进出场），切换仅改内联 style → CSS transition 必然触发 -->
          <div class="stage">
            <div v-for="(m, i) in hero" :key="m.id" class="slot" :style="slotStyle(i)">
              <img :src="coverOf(m)" :alt="m.pm || ''" :title="m.pm || ''" decoding="async" @click="onSlotClick(i)" />
              <div class="shade"></div>
            </div>
            <!-- 占位槽：5 个固定位，无影片时显示淡红色空白占位图 -->
            <div v-for="d in SLOTS" :key="`ph-${d}`" class="slot" :style="slotStyle(active + d, true)">
              <div v-if="!slotMovie(d)" class="slot-ph"></div>
            </div>
          </div>
        </div>
        <!-- 左右切换 -->
        <button v-if="hero.length > 1" class="flow-nav prev" aria-label="上一部" @click="step(-1)">
          <AppIcon name="back" :size="18" />
        </button>
        <button v-if="hero.length > 1" class="flow-nav next" aria-label="下一部" @click="step(1)">
          <AppIcon name="back" :size="18" class="flip" />
        </button>
      </div>
      <!-- 指示点（按实际数量） -->
      <div v-if="hero.length > 1" class="hero-dots">
        <button v-for="(m, i) in hero" :key="m.id" class="dot" :class="{ on: i === active }"
                :aria-label="`第 ${i + 1} 部`" @click="go(i)"></button>
      </div>
    </section>

    <!-- ===== ② 类别按钮：两个汉字的标签（近期观看中频率前 4，不足留空） ===== -->
    <section v-if="categories.length" class="cats">
      <button v-for="c in categories" :key="c.tag" class="cat-card" @click="goTag(c.tag)">
        <div class="cat-name">
          <div class="cat-main">{{ c.tag }}</div>
          <div class="cat-sub">{{ c.count }} 部</div>
        </div>
        <div class="cat-covers">
          <img v-for="(cv, i) in c.covers" :key="i" :src="coverOf(cv)" alt="" />
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
            <img v-if="coverOf(m)" :src="coverOf(m)" :alt="m.pm || ''" />
            <div v-else class="ac-no-cover"><AppIcon name="image" :size="22" /></div>
          </div>
          <div class="ac-code">{{ m.ph || '—' }}</div>
          <div class="ac-title" :title="m.pm">{{ m.pm || '无标题' }}</div>
        </div>
        <!-- 空位：不足 8 部时补齐占位，保持 4 列 × 2 行版式 -->
        <div v-for="n in emptySlots" :key="`ph-${n}`" class="arrival-card is-empty" aria-hidden="true">
          <div class="ac-cover"></div>
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

const router = useRouter()

// 三块数据
const hero = ref([])         // 轮播影片（封面流）
const categories = ref([])   // 类别按钮
const arrivals = ref([])     // 近期上新

// 轮播当前索引与定时器
const active = ref(0)
let timer = null
const HERO_INTERVAL = 4500   // 自动轮播间隔（毫秒）
const SLOTS = [-2, -1, 0, 1, 2]  // 轮播 5 个槽位（0 为中心）
const ARRIVAL_TOTAL = 8      // 近期上新位总数（4 列 × 2 行）

/** 封面 URL 解析（无封面时返回空串） */
function coverOf(m) {
  return resolveCover(m?.cover) || ''
}

/** 取某个槽位偏移对应的影片（越界返回 null → 该槽位显示占位） */
function slotMovie(d) {
  return hero.value[active.value + d] || null
}

/**
 * 3D coverflow 槽位样式：海报按相对中心距离 d 绕 Y 轴旋转 + 向 Z 轴后撤 + 水平偏移。
 * 所有海报（含占位）常驻 DOM，切换时 active 变化仅让各槽位的 d 变化 → transform/opacity
 * 由 CSS transition 平滑过渡，呈现「当前海报缩小向后转到侧面、下一张放大向前转到正中」。
 * |d|>2 的海报移到屏外并隐藏（仍常驻，保证过渡连续）。
 * @param {number} i - 影片（或空位）索引
 * @param {boolean} [ph] - 是否空位占位（层级略低、稍淡）
 */
function slotStyle(i, ph = false) {
  const d = i - active.value
  const sign = d < 0 ? -1 : 1
  const off = Math.abs(d) > 2          // 超出视野 → 移出屏外隐藏
  const abs = Math.min(Math.abs(d), 2)
  const angle = abs === 0 ? 0 : abs === 1 ? 35 : 60
  const depth = abs === 0 ? 0 : abs === 1 ? 180 : 320
  const x     = off ? sign * 900 : (abs === 0 ? 0 : sign * (abs === 1 ? 300 : 480))
  const scale = off ? 0.3 : (abs === 0 ? 1 : abs === 1 ? 0.72 : 0.5)
  const opacity = off ? 0 : (abs === 0 ? 1 : abs === 1 ? 0.75 : 0.4)
  return {
    // perspective() 内联进 transform，避免父级 perspective+overflow 压平 3D
    transform: `translate(-50%, -50%) translateX(${x}px) perspective(1200px) rotateY(${off ? 0 : sign * -angle}deg) translateZ(${off ? 0 : -depth}px) scale(${scale})`,
    opacity: ph ? opacity * 0.85 : opacity,
    zIndex: 10 - abs - (ph ? 1 : 0),
    '--shade': off ? 1 : (abs === 0 ? 0 : abs === 1 ? 0.35 : 0.6),   // 遮罩强度
    pointerEvents: ph || off ? 'none' : undefined
  }
}

/** 近期上新的空位数量（保持 4×2 版式） */
const emptySlots = computed(() => Math.max(0, ARRIVAL_TOTAL - arrivals.value.length))

/** 加载推荐数据（轮播影片由主进程会话级缓存，本次运行内固定） */
async function load() {
  if (!window.api?.getHomeRecommend) return
  const r = await window.api.getHomeRecommend()
  if (r?.ok) {
    hero.value = r.data.hero || []
    categories.value = r.data.categories || []
    arrivals.value = r.data.arrivals || []
    if (active.value >= hero.value.length) active.value = 0   // 防越界
  }
}

/** 切换轮播（dir=1 下一部 / -1 上一部；夹在有效范围内，不循环留空） */
function step(dir) {
  const next = active.value + dir
  if (next < 0 || next >= hero.value.length) return   // 到边界即停（无影片处不循环）
  active.value = next
}

/** 跳到指定轮播项 */
function go(i) { active.value = i }

/** 点击槽位：当前（中心）海报进详情，其他海报移到中心 */
function onSlotClick(i) {
  if (i === active.value) return goDetail(hero.value[i])
  active.value = i
}

/** 打开影片详情 */
function goDetail(m) {
  if (m?.id) router.push(`/detail/${m.id}`)
}

/** 按标签筛选片库（类别按钮） */
function goTag(tag) {
  router.push({ path: '/library', query: { tag } })
}

/** 启动自动轮播（到头反向往返，避免末尾跳回首张时海报横跨整屏飞回造成顿挫） */
function startTimer() {
  stopTimer()
  if (hero.value.length < 2) return
  let dir = 1
  timer = setInterval(() => {
    let next = active.value + dir
    if (next < 0 || next >= hero.value.length) { dir = -dir; next = active.value + dir }
    active.value = next
  }, HERO_INTERVAL)
}
function stopTimer() { if (timer) { clearInterval(timer); timer = null } }

onMounted(async () => {
  await load()
  startTimer()
})
onBeforeUnmount(stopTimer)
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
/* 槽位：基准尺寸 = 横向海报 600×400（3:2）；rotateY/translateZ/scale 由内联控制。
   立体轮换过渡：一次平滑的三维插值（旋转+后撤+缩放+位移同步） */
.slot {
  position: absolute; left: 50%; top: 50%;
  width: 600px; height: 400px;
  transform-origin: center center;
  backface-visibility: hidden;
  transition: transform 620ms cubic-bezier(0.32, 0.72, 0.3, 1),
              opacity 420ms ease;
  will-change: transform, opacity;
}
.slot img {
  width: 100%; height: 100%; object-fit: cover; display: block;
  border-radius: var(--r-md);
  box-shadow: var(--sh-3);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-out);
}
.slot img:hover { transform: translateY(-3px); }
/* 立体遮罩：非中心海报盖暗角渐变，强化前后纵深；中心时透明（--shade=0） */
.shade {
  position: absolute; inset: 0;
  border-radius: var(--r-md);
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.04) 0%, rgba(0, 0, 0, 0.62) 100%);
  opacity: var(--shade, 0);
  transition: opacity 500ms ease;
  pointer-events: none;
}
/* 缺失影片的槽位：淡红色空白占位图 */
.slot-ph {
  width: 100%; height: 100%;
  border-radius: var(--r-md);
  background: var(--accent-soft);                    /* 朱柿红浅底（令牌）*/
  border: 1px dashed rgba(210, 64, 30, 0.32);
  box-sizing: border-box;
}
/* 左右切换按钮：玻璃圆钮（与卡片角标同质感） */
.flow-nav {
  position: absolute; top: 50%; transform: translateY(-50%);
  width: 34px; height: 34px; border: none; border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(12px) saturate(1.5);
  -webkit-backdrop-filter: blur(12px) saturate(1.5);
  color: var(--text);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), var(--sh-1);
  transition: background var(--dur-fast) ease, transform var(--dur-fast) var(--ease-out);
  z-index: 20;
}
.flow-nav:hover { background: rgba(255, 255, 255, 0.55); }
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

/* ===== ② 类别按钮 ===== */
.cats { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; }
.cat-card {
  display: flex; align-items: stretch;
  width: 224px; flex-shrink: 0;
  height: 88px; padding: 0; overflow: hidden;
  border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--surface); cursor: pointer; text-align: left;
  transition: transform var(--dur-fast) var(--ease-out),
              box-shadow var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) ease;
}
.cat-card:hover { transform: translateY(-2px); box-shadow: var(--sh-2); border-color: var(--border-strong); }
.cat-name {
  flex: 0 0 42%;
  padding: 14px 12px;
  display: flex; flex-direction: column; justify-content: center; gap: 4px;
  background: linear-gradient(135deg, var(--surface-2), var(--surface-3));
}
.cat-main {
  font-family: var(--font-display); font-weight: 700; font-size: 17px;
  color: var(--text); letter-spacing: 0.02em;
}
.cat-sub { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
/* 右侧封面拼图：2×2 无缝拼接 */
.cat-covers {
  flex: 1; min-width: 0;
  display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
  gap: 1px; background: var(--border);
}
.cat-covers img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* ===== ③ 近期上新 ===== */
.arrivals { display: flex; flex-direction: column; gap: 12px; }
.sec-head { display: flex; align-items: center; }
.sec-title {
  font-family: var(--font-display); font-weight: 700; font-size: 16px; color: var(--text);
  padding-left: 10px; border-left: 3px solid var(--accent); line-height: 1.1;
}
/* 4 列 × 2 行（8 部，含空位） */
.arrival-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.arrival-card { cursor: pointer; }
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
  font-weight: 600; font-size: 12.5px; color: var(--primary);
}
.ac-title {
  font-size: 12.5px; color: var(--text-2); line-height: 1.5;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.empty-tip { font-size: 12.5px; color: var(--muted); }
</style>
