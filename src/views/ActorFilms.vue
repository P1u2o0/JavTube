<!--
  ============================================================
  文件名：ActorFilms.vue
  所属模块：视图 / 演员影片页（2026-09-14 新增）
  功能描述：某位演员（女优 / 男优）出演的全部影片页面。布局：
           ① 演员区：圆角方形头像 + 姓名（带性别符号）+ 资料（无资料留白）
           ② 标签类别栏：该演员影片的标签，按出现次数降序，点击筛选（参考片库标签栏）
           ③ 排序 / 选择栏：左侧排序下拉、右侧选择（多选）按钮（参考片库状态栏）
           ④ 影片海报网格：复用 MovieCard；每行数量跟随设置中的「每行显示数量」
  数据来源：window.api.getActorFilms(name) → { name, gender, avatar, info, movies }
  依赖：vue-router、@/store/movies、@/components/MovieCard、@/utils/global
  ============================================================
-->
<template>
  <div class="actor-page">
    <!-- ===== ① 演员区（蓝）：返回按钮 + 头像 + 信息，同一行 =====
         （返回按钮原本单独占一行，旁边全空显得很怪，故并入本行、紧贴头像左侧） -->
    <div class="actor-head">
      <BackButton class="head-back" />
      <div class="ah-avatar">
        <img :src="avatarUrl" :alt="name" @error="avatarBroken = true" />
      </div>
      <div class="ah-main">
        <div class="ah-name">{{ name }}</div>
        <div class="ah-count">{{ films.length }} 部作品</div>
      </div>
      <!-- 指数区（评分指数 + 热度）：跟在大名/作品数右侧，靠右对齐。
           评分指数 = 所有「有评分」作品的平均分，星星按 平均分/5 从左往右填充；
           热度 = 在「有想看/看过人数」的作品里取 (想看+看过) 的平均值。 -->
      <div class="ah-idx">
        <div class="idx-card" :title="scoreTitle">
          <div class="idx-star">
            <AppIcon name="star-filled" :size="42" class="star-bg" />
            <span class="star-fg" :style="{ width: starPct + '%' }">
              <AppIcon name="star-filled" :size="42" />
            </span>
          </div>
          <div class="idx-num">
            <div class="idx-val">{{ scoreIndex === null ? '—' : scoreIndex.toFixed(2) }}</div>
            <div class="idx-cap">评分指数</div>
          </div>
        </div>
        <!-- 热度卡片可点击：进入全库女优热度排行榜（并定位到当前演员）；
             title 保留热度算法与排名说明 -->
        <div class="idx-card idx-clickable" :title="heatTitle + (heatRank ? '\n点击查看全库排行榜' : '')"
             @click="router.push({ path: '/actresses', query: { view: 'rank', hl: name } })">
          <AppIcon name="flame-filled" :size="42" class="idx-flame"
                   :class="heatRank ? 't-' + heatRank.tier : ''" />
          <div class="idx-num">
            <div class="idx-val">{{ heatIndex === null ? '—' : heatIndex.toLocaleString('zh-CN') }}</div>
            <div class="idx-cap">热度</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== ② 标签类别栏（红）：与片库页同款（面板 + 分类分组 + TagChip 多选） ===== -->
    <div class="tag-filter" v-if="tagList.length">
      <div class="filter-header">
        <span class="header-label">标签筛选</span>
        <TagChip label="全部" :selected="selectedTags.length === 0" @click="clearTags" />
        <!-- 排序按钮并入本行右侧（与片库页同款） -->
        <div class="filter-tools">
          <!-- 排序下拉：与片库页共用同一受控组件 -->
          <SortDropdown
            :by="sort.by"
            :order="sort.order"
            :random="sort.random"
            @change="onSortChange"
          />
          <span class="result-count">共 <b>{{ shownFilms.length }}</b> 部</span>
        </div>
      </div>
      <div class="filter-body">
        <div v-for="cat in displayCategories" :key="cat.idx" class="cat-row">
          <span class="cat-name">{{ cat.cat }}</span>
          <div class="cat-tags">
            <TagChip v-for="t in cat.tags" :key="t" :label="t"
                     :selected="selectedTags.includes(t)" @click="toggleTag(t)" />
          </div>
        </div>
        <div v-if="uncategorizedTags.length" class="cat-row">
          <span class="cat-name">未分类</span>
          <div class="cat-tags">
            <TagChip v-for="t in uncategorizedTags" :key="t" :label="t"
                     :selected="selectedTags.includes(t)" @click="toggleTag(t)" />
          </div>
        </div>
      </div>
    </div>

    <!-- ===== ④ 影片海报网格（绿）：每行数量跟随设置 ===== -->
    <div v-if="loading" class="actor-empty">加载中…</div>
    <div v-else-if="!shownFilms.length" class="actor-empty">该演员暂无影片</div>
    <div v-else class="actor-grid" :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)` }">
      <MovieCard v-for="m in pagedFilms" :key="m.id" :m="m"
                 @click="onCardClick(m)" @play="onPlay(m)" @fav="onFav(m)" />
    </div>

    <!-- 分页（多于 1 页时显示） -->
    <div class="actor-pager" v-if="pageCount > 1">
      <el-pagination layout="prev, pager, next" :total="shownFilms.length"
                     :page-size="pageSize" :current-page="page"
                     @current-change="p => (page = p)" background small />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useMoviesStore } from '@/store/movies'
import { resolveCover, safeCall, splitTags } from '@/utils/global'
import AppIcon from '@/components/AppIcon.vue'
import MovieCard from '@/components/MovieCard.vue'
import TagChip from '@/components/TagChip.vue'
import SortDropdown from '@/components/SortDropdown.vue'
import BackButton from '@/components/BackButton.vue'

const route = useRoute()
const router = useRouter()
const store = useMoviesStore()

// 演员名（路由参数解码）
const name = computed(() => decodeURIComponent(String(route.params.name || '')))
// 演员数据
const gender = ref('f')
const avatar = ref('')
const info = ref(null)
const films = ref([])
/** 热度排名（后端按全库女优排序后回传）：{ rank, total, tier } 或 null */
const heatRank = ref(null)
const loading = ref(true)

// 每行数量：跟随设置（store.colsPerRow；未加载时回退 5）
const cols = computed(() => store.colsPerRow || 5)

// 筛选 / 排序 / 分页（排序状态结构与片库页 store.sort 一致）
const selectedTags = ref([])
const sort = ref({ by: 'fxrq', order: 'DESC', random: false })
const page = ref(1)
const pageSize = computed(() => store.pageSize || 20)

/** 默认头像资源：用 BASE_URL 前缀（base='./'）拼相对路径。
 *  注意不能写 '/actor-female.svg' —— 这是运行时表达式，Vite 不会像静态 src 属性那样
 *  改写路径，打包后会被解析成 file:///C:/actor-female.svg 直接 404（默认剪影显示为破图）。 */
const DEFAULT_AVATAR = {
  f: import.meta.env.BASE_URL + 'actor-female.svg',
  m: import.meta.env.BASE_URL + 'actor-male.svg'
}

/** 头像文件缺失/损坏时置真 → 回落本地剪影（统一显示：没有可用的真实照片就显示剪影，不留破图） */
const avatarBroken = ref(false)

/** 演员头像：有本地头像走封面协议，否则按性别用默认剪影 */
const avatarUrl = computed(() => (avatar.value && !avatarBroken.value)
  ? resolveCover(avatar.value)
  : (gender.value === 'm' ? DEFAULT_AVATAR.m : DEFAULT_AVATAR.f))

/**
 * 评分指数：该演员**所有有评分的作品**的平均分。
 * score 为 0 / 空视为「没有评分」（JAVDB 无评分时入库即为 0），不参与平均。
 * @returns {number|null} 平均分；一部有评分的都没有时返回 null（模板显示 —）
 */
const scoreIndex = computed(() => {
  const scored = films.value
    .map(f => Number(f.score) || 0)
    .filter(v => v > 0)
  if (!scored.length) return null
  return scored.reduce((a, b) => a + b, 0) / scored.length
})

/** 星星填充比例 = 平均分 / 5（满分按 5 分计），并夹在 0~100 之间 */
const starPct = computed(() => {
  if (scoreIndex.value === null) return 0
  return Math.max(0, Math.min(100, (scoreIndex.value / 5) * 100))
})

/**
 * 热度：在**有想看/看过人数的作品**里，取 (想看 + 看过) 的平均值。
 * 即：所有有人数字段作品的人数和 ÷ 这些作品的数量。
 * @returns {number|null} 取整后的热度指数；没有任何人数数据时返回 null
 */
const heatIndex = computed(() => {
  const counts = films.value
    .map(f => (Number(f.want) || 0) + (Number(f.watched) || 0))
    .filter(v => v > 0)
  if (!counts.length) return null
  return Math.round(counts.reduce((a, b) => a + b, 0) / counts.length)
})

/** 评分数、人数样本数：用于 tooltip 说明指数是怎么算的 */
const scoredCount = computed(() => films.value.filter(f => (Number(f.score) || 0) > 0).length)
const heatCount = computed(() => films.value.filter(f => ((Number(f.want) || 0) + (Number(f.watched) || 0)) > 0).length)
const scoreTitle = computed(() => scoreIndex.value === null
  ? '评分指数：该演员暂无有评分的作品'
  : `评分指数：${scoredCount.value} 部有评分作品的平均分（满分 5）`)
/** 热度档位的说明文字（与后端 HEAT_TIERS 的「前 X%」口径一致） */
const TIER_LABEL = {
  purple: '紫色（前 10%）', darkred: '深红（前 20%）', lightred: '浅红（前 30%）',
  orange: '橙色（前 40%）', gold: '金色（前 50%）', blue: '蓝色（前 60%）', cyan: '青色（60% 之后）'
}

const heatTitle = computed(() => {
  if (heatIndex.value === null) return '热度：该演员的作品暂无想看/看过人数'
  const base = `热度：${heatCount.value} 部有想看/看过人数作品的平均人数（想看 + 看过）`
  const h = heatRank.value
  if (!h) return base
  return `${base}\n全库女优热度排名：第 ${h.rank} / ${h.total} 名 · ${TIER_LABEL[h.tier] || ''}`
})

/** 标签统计：该演员影片的标签出现次数降序 */
const tagList = computed(() => {
  const freq = new Map()
  for (const m of films.value) {
    for (const t of splitTags(m.bq)) {
      freq.set(t, (freq.get(t) || 0) + 1)
    }
  }
  return [...freq.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
})

// 该演员影片的标签名集合
const actorTags = computed(() => tagList.value.map(t => t.name))

/** 该演员影片标签的出现次数表（用于类内排序） */
const tagCountMap = computed(() => new Map(tagList.value.map(t => [t.name, t.count])))
/** 按出现次数降序排序（同数量按名称稳定排序，与片库 byUsage 一致） */
function byUsage(tags) {
  const m = tagCountMap.value
  return [...tags].sort((a, b) => {
    const ca = m.get(a) || 0, cb = m.get(b) || 0
    if (cb !== ca) return cb - ca
    return String(a).localeCompare(String(b), 'zh-Hans-CN')
  })
}

/** 分类分组：按 9 大类展示该演员影片中出现的标签（与片库标签栏同结构） */
const displayCategories = computed(() => {
  const set = new Set(actorTags.value)
  return (store.visibleCategories || [])
    .map((c, i) => ({ idx: c.idx ?? i, cat: c.cat, tags: byUsage((c.tags || []).filter(t => set.has(t))) }))
    .filter(c => c.tags.length > 0)
})

/** 未分类标签：该演员影片有、但不属于任何分类的标签 */
const uncategorizedTags = computed(() => {
  const categorized = new Set()
  for (const c of (store.categories || [])) for (const t of (c.tags || [])) categorized.add(t)
  return byUsage(actorTags.value.filter(t => !categorized.has(t)))
})

/** 切换标签选中（多选，AND 筛选，与片库标签逻辑一致） */
function toggleTag(t) {
  const i = selectedTags.value.indexOf(t)
  if (i >= 0) selectedTags.value.splice(i, 1)
  else selectedTags.value.push(t)
  page.value = 1
}
/** 清除所有标签筛选 */
function clearTags() { selectedTags.value = []; page.value = 1 }

/** 标签筛选 + 排序后的影片（语义与片库页一致：点当前项切正倒序、随机打乱） */
const shownFilms = computed(() => {
  let list = films.value
  if (selectedTags.value.length) {
    list = list.filter(m => {
      const tags = splitTags(m.bq)
      return selectedTags.value.every(t => tags.includes(t))   // AND（与片库标签逻辑一致）
    })
  }
  const { by, order, random } = sort.value
  if (random) {
    // Fisher-Yates 洗牌（对应片库「随机排序」）
    const arr = [...list]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }
  const dir = order === 'ASC' ? 1 : -1
  return [...list].sort((a, b) => {
    const va = a[by], vb = b[by]
    if (typeof va === 'string' || typeof vb === 'string') {
      return String(va || '').localeCompare(String(vb || '')) * dir
    }
    return ((Number(va) || 0) - (Number(vb) || 0)) * dir
  })
})

const pageCount = computed(() => Math.ceil(shownFilms.value.length / pageSize.value) || 1)
const pagedFilms = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return shownFilms.value.slice(start, start + pageSize.value)
})

/**
 * 排序变更：把 SortDropdown 算好的新状态写回本页本地 sort，
 * 并回到第 1 页（与片库页共用同一组件，这里只负责各自的写回目标）
 * @param {{by: string, order: string, random: boolean}} next - 新的排序状态
 */
function onSortChange(next) {
  sort.value = next
  page.value = 1
}
/** 点击卡片：进入详情 */
function onCardClick(m) {
  router.push(`/detail/${m.id}`)
}
/**
 * 播放。
 * 原实现是 `safeCall(() => window.api.playMovie(m.py))`：safeCall 只吃 Promise，
 * 传函数等于永不执行（点了没反应）；且没有失败提示、不记录播放次数。
 * 现与其他页面（useMovieList.onPlay / Detail.onPlay）保持一致：
 * 校验视频路径 → playVideo → 失败给明确原因 → 成功后记一次播放（累加观看记录）。
 */
async function onPlay(m) {
  if (!window.api || !m?.py) return ElMessage.warning('未设置视频路径')
  const r = await window.api.playVideo(m.py).catch(() => null)
  if (!r || !r.ok) return ElMessage.error(r?.error || '播放失败')
  safeCall(window.api.recordPlay(m.id))
}
/** 切换喜欢（乐观更新 + 失败回滚）
 *  原实现的写库调用同样因为 safeCall 传函数而从未执行 —— 界面已变红、库里却没变，
 *  重启后"喜欢"会复原。这里改为直接 await 并校验 r.ok，失败回滚。 */
async function onFav(m) {
  if (!window.api) return
  const next = m.cl === 'y' ? 'n' : 'y'
  const idx = films.value.findIndex(x => x.id === m.id)
  if (idx >= 0) films.value[idx] = { ...films.value[idx], cl: next }
  const r = await window.api.updateMovie(m.id, { cl: next }).catch(() => null)
  if (!r || !r.ok) {
    const i2 = films.value.findIndex(x => x.id === m.id)
    if (i2 >= 0) films.value[i2] = { ...films.value[i2], cl: m.cl }
    ElMessage.error(r?.error || '操作失败')
  }
}

/** 加载演员影片数据 */
async function load() {
  if (!window.api?.getActorFilms) { loading.value = false; return }
  loading.value = true
  const r = await window.api.getActorFilms(name.value)
  if (r?.ok) {
    gender.value = r.data.gender || 'f'
    avatar.value = r.data.avatar || ''
    avatarBroken.value = false      // 换人后重新给新头像一次加载机会
    info.value = r.data.info || null
    films.value = r.data.movies || []
    heatRank.value = r.data.heatRank || null
  } else {
    heatRank.value = null
    ElMessage.error(r?.error || '加载失败')
  }
  loading.value = false
}

onMounted(async () => {
  // 确保设置与全局标签已加载（每行数量 + 标签分类栏都依赖 store）
  // 注：这两行此前用 `safeCall(() => ...)` 传函数，实际从未执行 ——
  // 直接进本页（不先经过片库）时 store 未初始化、标签栏为空。现修正为直接 await。
  await store.initIfNeeded()
  await store.ensureTagsLoaded()
  await load()
})
</script>

<style scoped>
.actor-page { display: flex; flex-direction: column; gap: 14px; }

/* ===== ① 演员区 =====
   返回按钮 + 头像 + 信息 同行；按钮与头像之间的间距略小于信息区间距，
   让「按钮｜头像」看起来是一个整体，而不是三块等距并排。 */
.actor-head { display: flex; align-items: center; gap: 16px; }
.head-back { margin-right: -4px; }
.ah-avatar {
  width: 88px; height: 88px; flex-shrink: 0;
  border-radius: var(--r-md);
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--surface-2);
}
.ah-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ah-main { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.ah-name {
  font-family: var(--font-display);
  font-size: var(--fs-2xl); font-weight: 700; color: var(--text);
}
.ah-count { font-size: var(--fs-sm); color: var(--muted); font-variant-numeric: tabular-nums; }

/* ===== 指数区（评分指数 + 热度）：紧接大名右侧、整体靠右 =====
   视觉沿用应用既有卡片语言：--surface 底 + 发丝边框 + --r-md 圆角 + --sh-1 微阴影；
   图标沿用 AppIcon 的内联 SVG 体系，主色用品牌红 --accent（与 logo / exe 图标同色）。 */
.ah-idx { margin-left: auto; display: flex; align-items: stretch; gap: 12px; flex-shrink: 0; }
.idx-card {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 18px 10px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--sh-1);
}
/* 热度卡片可点击（进全库排行榜）：手型 + 轻微悬停反馈 */
.idx-clickable { cursor: pointer; transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), transform var(--dur-press) var(--ease-out); }
.idx-clickable:hover { border-color: var(--border-strong); box-shadow: var(--sh-2); }
.idx-clickable:active { transform: scale(0.97); }
/* 星星两图层：底层只画描边（深金边框 + 空槽），上层按比例裁切「黄色填充 + 深金边框」。
   这样既能看到清晰的边框线，也能一眼看出填充了几成（= 平均分/5）。 */
.idx-star { position: relative; width: 42px; height: 42px; flex-shrink: 0; }
.idx-star svg { stroke-width: 0.9; }              /* 42px 显示时线宽更细，更扁平 */
.idx-star .star-bg {
  --icon-fill: transparent;                        /* 未填充部分：星内留空，只显示描边 */
  --icon-stroke: #d8d4cb;                          /* 浅灰描边（空槽） */
}
.idx-star .star-fg {
  position: absolute; inset: 0; overflow: hidden;
  --icon-fill: #fbc02d;                            /* 评分填充：黄 */
  --icon-stroke: #111111;                          /* 边框线：黑（同参考图标） */
}
.idx-flame {
  --icon-fill: var(--accent);                      /* 热度填充：品牌红（与 logo 同色） */
  --icon-stroke: #111111;                          /* 边框线：黑（同参考图标） */
  stroke-width: 0.9;
  flex-shrink: 0;
}
/* 热度排名分档配色：越热越靠上（前 10% 紫 → 前 60% 蓝 → 其余青）。
   无排名（无人数数据/不在女优榜）时保持上面的品牌红默认值。 */
.idx-flame.t-purple { --icon-fill: #8b46d6; }      /* 前 10% */
.idx-flame.t-darkred { --icon-fill: #c0121a; }     /* 前 11%~20% */
.idx-flame.t-lightred { --icon-fill: #f2564d; }    /* 前 21%~30% */
.idx-flame.t-orange { --icon-fill: #f0812a; }      /* 前 31%~40% */
.idx-flame.t-gold { --icon-fill: #e0a80d; }        /* 前 41%~50% */
.idx-flame.t-blue { --icon-fill: #2f6fdb; }        /* 前 51%~60% */
.idx-flame.t-cyan { --icon-fill: #17b3c9; }        /* 61% 以后 */
.idx-num { display: flex; flex-direction: column; gap: 1px; }
.idx-val {
  font-family: var(--font-display);
  font-size: 26px; font-weight: 700; line-height: 1.05;
  color: var(--text); font-variant-numeric: tabular-nums;
}
.idx-cap { font-size: var(--fs-sm); color: var(--muted); }

/* ===== ② 标签类别栏（样式与片库页 TagFilter 一致；圆角与芯片/筛选按钮统一，见 --r-tag） ===== */
.tag-filter {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-tag);
  box-shadow: var(--sh-1);        /* Apple：面板微阴影 */
  margin-bottom: 10px;
}
.filter-header {
  display: flex; align-items: center; gap: 5px;
  padding: 8px 14px 0;      /* 下 0：与分类行的间距统一由 body/cat-row 提供 */
  /* 无下边框：与下方分类行连成一体（用户要求） */
}
/* 右侧工具区：排序按钮 + 结果数，始终贴右 */
.filter-tools { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.result-count { color: var(--muted); font-size: var(--fs-base); font-variant-numeric: tabular-nums; white-space: nowrap; }
.result-count b { color: var(--primary); font-family: var(--font-display); font-weight: 700; }
.header-label {
  font-weight: 600; color: var(--text); font-size: var(--fs-md);
  flex-shrink: 0; min-width: 60px; margin-right: 6px;
}
.filter-body { padding: 4px 14px 8px; }
.cat-row {
  display: flex; align-items: flex-start; flex-wrap: wrap;
  gap: 2px 5px; padding: 4px 0;
}
.cat-name {
  font-weight: 500; color: var(--text-2); font-size: var(--fs-base);
  /* 行高 = 芯片总高（12.5×1.6 行高 + 8 padding + 6 上下 margin = 34px），
     使分类名与同行的芯片文字落在同一条水平线上 */
  line-height: 34px; margin-right: 6px; flex-shrink: 0; min-width: 60px;
}
.cat-tags { display: flex; flex-wrap: wrap; gap: 2px 5px; flex: 1; }

/* ===== ③ 排序按钮（已并入标签面板 header 右侧；实现与样式共用 SortDropdown.vue） ===== */

/* ===== ④ 影片网格 ===== */
.actor-grid { display: grid; gap: 14px; }
.actor-empty { padding: 60px 0; text-align: center; color: var(--muted); font-size: var(--fs-md); }
.actor-pager { display: flex; justify-content: center; margin-top: 4px; }
</style>
