<!--
  ============================================================
  文件名：Home.vue
  所属模块：视图 / 首页
  功能描述：首页推荐面板，三块区域（数据来自 home:recommend IPC）：
           ① 轮播：按近期观看的类别 / 系列 / 女优挑选 5 部同类影片轮换展示
              （每次打开软件挑选一次——主进程会话级缓存，软件内切页不重随机）
           ② 类别按钮：近期观看标签中「恰好两个汉字」的标签按出现频率取前 4；
              按钮左侧类别名 + 数量，右侧该类影片封面 2×2 拼接
           ③ 近期上新：与近期观看兴趣无交集的影片（不常看的类别/系列/女优），
              4 列 × 2 行共 8 部
  视觉：沿用设计令牌（暖纸白/墨黑/朱柿红、4 级圆角、发丝边框、悬停上浮）
  依赖：vue-router、@/components/AppIcon、@/utils/global（resolveCover）
  ============================================================
-->
<template>
  <div class="home-page">
    <!-- ===== ① 轮播：同类影片（每次打开软件挑选 5 部） ===== -->
    <section v-if="hero.length" class="hero">
      <div class="hero-stage" @click="goDetail(hero[active])">
        <!-- 背景：当前海报模糊铺满 -->
        <div class="hero-bg" :style="{ backgroundImage: `url(${coverOf(hero[active])})` }"></div>
        <div class="hero-shade"></div>
        <!-- 前景海报 -->
        <img class="hero-poster" :src="coverOf(hero[active])" :alt="hero[active].pm || ''" />
        <!-- 影片信息 -->
        <div class="hero-meta">
          <div class="hero-code">{{ hero[active].ph || '—' }}</div>
          <div class="hero-title">{{ hero[active].pm || '无标题' }}</div>
          <div v-if="heroTagList.length" class="hero-tags">
            <span v-for="t in heroTagList" :key="t" class="hero-tag">{{ t }}</span>
          </div>
        </div>
        <!-- 左右切换（玻璃圆钮，与卡片角标同风格） -->
        <button v-if="hero.length > 1" class="hero-nav prev" aria-label="上一部" @click.stop="step(-1)">
          <AppIcon name="back" :size="18" />
        </button>
        <button v-if="hero.length > 1" class="hero-nav next" aria-label="下一部" @click.stop="step(1)">
          <AppIcon name="back" :size="18" class="flip" />
        </button>
      </div>
      <!-- 指示点 -->
      <div v-if="hero.length > 1" class="hero-dots">
        <button v-for="(m, i) in hero" :key="m.id" class="dot" :class="{ on: i === active }"
                :aria-label="`第 ${i + 1} 部`" @click.stop="go(i)"></button>
      </div>
    </section>

    <!-- ===== ② 类别按钮：两个汉字的标签（近期观看中频率前 4） ===== -->
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

    <!-- ===== ③ 近期上新：不常看的类别/系列/女优影片（4 列 × 2 行） ===== -->
    <section v-if="arrivals.length" class="arrivals">
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
      </div>
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
const hero = ref([])         // 轮播影片
const categories = ref([])   // 类别按钮
const arrivals = ref([])     // 近期上新

// 轮播当前索引与定时器
const active = ref(0)
let timer = null
const HERO_INTERVAL = 4500  // 自动轮播间隔（毫秒）

/** 封面 URL 解析（无封面时返回空串） */
function coverOf(m) {
  return resolveCover(m?.cover) || ''
}

/** 当前轮播影片的前 3 个标签（用于展示） */
const heroTagList = computed(() => {
  const m = hero.value[active.value]
  return String(m?.bq || '').split(/[，,]/).map(s => s.trim()).filter(Boolean).slice(0, 3)
})

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

/** 切换轮播（dir=1 下一部 / -1 上一部，循环） */
function step(dir) {
  const n = hero.value.length
  if (!n) return
  active.value = (active.value + dir + n) % n
}

/** 跳到指定轮播项 */
function go(i) { active.value = i }

/** 打开影片详情 */
function goDetail(m) {
  if (m?.id) router.push(`/detail/${m.id}`)
}

/** 按标签筛选片库（类别按钮） */
function goTag(tag) {
  router.push({ path: '/library', query: { tag } })
}

/** 启动自动轮播 */
function startTimer() {
  stopTimer()
  if (hero.value.length < 2) return
  timer = setInterval(() => step(1), HERO_INTERVAL)
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

/* ===== ① 轮播 ===== */
.hero { position: relative; }
.hero-stage {
  position: relative; overflow: hidden;
  height: 300px;
  border-radius: var(--r-lg);
  border: 1px solid var(--border);
  background: var(--surface-2);
  cursor: pointer;
}
/* 背景：海报放大模糊铺底 */
.hero-bg {
  position: absolute; inset: -20%;
  background-size: cover; background-position: center;
  filter: blur(34px) saturate(1.3);
  opacity: 0.55;
}
/* 压暗层：保证前景与文字可读 */
.hero-shade {
  position: absolute; inset: 0;
  background: linear-gradient(90deg, rgba(29, 28, 26, 0.72) 0%, rgba(29, 28, 26, 0.35) 45%, rgba(29, 28, 26, 0.05) 100%);
}
/* 前景海报：右侧竖版展示 */
.hero-poster {
  position: absolute; right: 64px; top: 50%; transform: translateY(-50%);
  height: 232px; width: auto; border-radius: var(--r-md);
  box-shadow: var(--sh-3);
  object-fit: cover;
}
/* 信息区：左侧 */
.hero-meta {
  position: absolute; left: 28px; top: 50%; transform: translateY(-50%);
  max-width: 46%;
  display: flex; flex-direction: column; gap: 8px;
}
.hero-code {
  font-family: var(--font-display); font-variant-numeric: tabular-nums;
  font-weight: 700; font-size: 24px; color: #fff; letter-spacing: 0.02em;
}
.hero-title {
  font-size: 15px; line-height: 1.6; color: rgba(255, 255, 255, 0.86);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.hero-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.hero-tag {
  padding: 2px 9px; border-radius: var(--r-pill);
  background: rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.9);
  font-size: 11.5px;
}
/* 左右切换按钮：玻璃圆钮（与卡片角标同一质感） */
.hero-nav {
  position: absolute; top: 50%; transform: translateY(-50%);
  width: 34px; height: 34px; border: none; border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(12px) saturate(1.5);
  -webkit-backdrop-filter: blur(12px) saturate(1.5);
  color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), var(--sh-1);
  transition: background var(--dur-fast) ease, transform var(--dur-fast) var(--ease-out), opacity var(--dur-fast) ease;
  opacity: 0;   /* 悬停时淡入 */
}
.hero-stage:hover .hero-nav { opacity: 1; }
.hero-nav:hover { background: rgba(255, 255, 255, 0.28); transform: translateY(-50%) scale(1.08); }
.hero-nav.prev { left: 12px; }
.hero-nav.next { right: 12px; }
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
.cats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.cat-card {
  display: flex; align-items: stretch;
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
/* 4 列 × 2 行（8 部） */
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
.ac-code {
  margin-top: 7px;
  font-family: var(--font-display); font-variant-numeric: tabular-nums;
  font-weight: 600; font-size: 12.5px; color: var(--primary);
}
.ac-title {
  font-size: 12.5px; color: var(--text-2); line-height: 1.5;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
</style>
