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
        <img :src="avatarUrl" :alt="name" />
      </div>
      <div class="ah-main">
        <div class="ah-name">
          <span class="ah-sex" :class="gender">{{ gender === 'm' ? '♂' : '♀' }}</span>{{ name }}
        </div>
        <div class="ah-count">{{ films.length }} 部作品</div>
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

/** 演员头像：有本地头像走封面协议，否则按性别用默认剪影 */
const avatarUrl = computed(() => avatar.value
  ? resolveCover(avatar.value)
  : (gender.value === 'm' ? DEFAULT_AVATAR.m : DEFAULT_AVATAR.f))

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
/** 播放 */
function onPlay(m) {
  if (m?.py) safeCall(() => window.api.playMovie(m.py))
}
/** 切换喜欢（乐观更新） */
async function onFav(m) {
  if (!window.api) return
  const next = m.cl === 'y' ? 'n' : 'y'
  const idx = films.value.findIndex(x => x.id === m.id)
  if (idx >= 0) films.value[idx] = { ...films.value[idx], cl: next }
  await safeCall(() => window.api.updateMovie(m.id, { cl: next }), '操作失败')
}

/** 加载演员影片数据 */
async function load() {
  if (!window.api?.getActorFilms) { loading.value = false; return }
  loading.value = true
  const r = await window.api.getActorFilms(name.value)
  if (r?.ok) {
    gender.value = r.data.gender || 'f'
    avatar.value = r.data.avatar || ''
    info.value = r.data.info || null
    films.value = r.data.movies || []
  } else {
    ElMessage.error(r?.error || '加载失败')
  }
  loading.value = false
}

onMounted(async () => {
  // 确保设置与全局标签已加载（每行数量 + 标签分类栏都依赖 store）
  await safeCall(() => store.initIfNeeded())
  await safeCall(() => store.loadAllDbTags())
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
  display: flex; align-items: center; gap: 4px;
}
/* 性别符号：♀ 品牌红 / ♂ 柔蓝 */
.ah-sex { font-size: var(--fs-xl); color: var(--accent); }
.ah-sex.m { color: #3d7ebf; }
.ah-count { font-size: var(--fs-sm); color: var(--muted); font-variant-numeric: tabular-nums; }

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
