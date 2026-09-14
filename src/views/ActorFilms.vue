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
    <!-- ===== ① 演员区（蓝）：头像 + 信息 ===== -->
    <div class="actor-head">
      <div class="ah-avatar">
        <img :src="avatarUrl" :alt="name" />
      </div>
      <div class="ah-main">
        <div class="ah-name">
          <span class="ah-sex" :class="gender">{{ gender === 'm' ? '♂' : '♀' }}</span>{{ name }}
        </div>
        <!-- 演员资料：无资料时仅留白（不显示占位文案） -->
        <div class="ah-meta" v-if="metaText">{{ metaText }}</div>
        <div class="ah-count">{{ films.length }} 部作品</div>
      </div>
    </div>

    <!-- ===== ② 标签类别栏（红）：与片库页同款（面板 + 分类分组 + TagChip 多选） ===== -->
    <div class="tag-filter" v-if="tagList.length">
      <div class="filter-header">
        <span class="header-label">标签筛选</span>
        <TagChip label="全部" :selected="selectedTags.length === 0" @click="clearTags" />
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

    <!-- ===== ③ 排序 / 选择栏（黄）：左排序、右选择 ===== -->
    <div class="actor-bar">
      <div class="ab-left">
        <el-dropdown @command="onSort">
          <button class="ab-sort">
            <AppIcon name="shuffle" :size="14" />
            <span>{{ sortLabel }}</span>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="fxrq">发行日期</el-dropdown-item>
              <el-dropdown-item command="tjrq">添加日期</el-dropdown-item>
              <el-dropdown-item command="score">评分</el-dropdown-item>
              <el-dropdown-item command="play_count">观看次数</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <div class="ab-right">
        <button class="ab-select" :class="{ on: selectMode }" @click="toggleSelect">
          <AppIcon :name="selectMode ? 'close' : 'check'" :size="14" />
          <span>{{ selectMode ? '退出选择' : '选择' }}</span>
        </button>
      </div>
    </div>

    <!-- ===== ④ 影片海报网格（绿）：每行数量跟随设置 ===== -->
    <div v-if="loading" class="actor-empty">加载中…</div>
    <div v-else-if="!shownFilms.length" class="actor-empty">该演员暂无影片</div>
    <div v-else class="actor-grid" :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)` }">
      <MovieCard v-for="m in pagedFilms" :key="m.id" :m="m"
                 :selectMode="selectMode" :isSel="selectedIds.has(m.id)"
                 @click="onCardClick(m)" @play="onPlay(m)" @toggle="onToggle(m.id)" @fav="onFav(m)" />
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
import { resolveCover, safeCall } from '@/utils/global'
import MovieCard from '@/components/MovieCard.vue'
import TagChip from '@/components/TagChip.vue'
import AppIcon from '@/components/AppIcon.vue'

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

// 筛选 / 排序 / 分页 / 多选
const selectedTags = ref([])
const sortKey = ref('fxrq')
const sortDesc = ref(true)
const page = ref(1)
const pageSize = computed(() => store.pageSize || 20)
const selectMode = ref(false)
const selectedIds = ref(new Set())

/** 演员头像：有本地头像走封面协议，否则按性别用默认剪影 */
const avatarUrl = computed(() => avatar.value
  ? resolveCover(avatar.value)
  : (gender.value === 'm' ? '/actor-male.svg' : '/actor-female.svg'))

/** 演员资料文本（身高/三围/罩杯/生日/出道）：无资料则为空串（留白） */
const metaText = computed(() => {
  const i = info.value
  if (!i) return ''
  const parts = []
  if (i.height) parts.push(`${i.height}cm`)
  if (i.bust || i.waist || i.hip) parts.push(`B${i.bust || '-'}/W${i.waist || '-'}/H${i.hip || '-'}`)
  if (i.zb) parts.push(`${i.zb}罩杯`)
  if (i.birthday) parts.push(`生日 ${i.birthday}`)
  if (i.debut) parts.push(`出道 ${i.debut}`)
  return parts.join(' · ')
})

/** 标签统计：该演员影片的标签出现次数降序 */
const tagList = computed(() => {
  const freq = new Map()
  for (const m of films.value) {
    for (const t of String(m.bq || '').split(/[，,]/).map(s => s.trim()).filter(Boolean)) {
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

const sortLabel = computed(() => {
  const map = { fxrq: '发行日期', tjrq: '添加日期', score: '评分', play_count: '观看次数' }
  return `${map[sortKey.value] || '排序'}${sortDesc.value ? ' ↓' : ' ↑'}`
})

/** 标签筛选后的影片 */
const shownFilms = computed(() => {
  let list = films.value
  if (selectedTags.value.length) {
    list = list.filter(m => {
      const tags = String(m.bq || '').split(/[，,]/).map(s => s.trim())
      return selectedTags.value.every(t => tags.includes(t))   // AND（与片库标签逻辑一致）
    })
  }
  const k = sortKey.value
  const arr = [...list].sort((a, b) => {
    let va = a[k], vb = b[k]
    if (typeof va === 'string' || typeof vb === 'string') {
      return String(vb || '').localeCompare(String(va || ''))
    }
    return (Number(vb) || 0) - (Number(va) || 0)   // 默认降序（大在前）
  })
  return sortDesc.value ? arr : arr.reverse()
})

const pageCount = computed(() => Math.ceil(shownFilms.value.length / pageSize.value) || 1)
const pagedFilms = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return shownFilms.value.slice(start, start + pageSize.value)
})

/** 排序：重复点击同一项切换升/降序 */
function onSort(cmd) {
  if (sortKey.value === cmd) sortDesc.value = !sortDesc.value
  else { sortKey.value = cmd; sortDesc.value = true }
  page.value = 1
}
/** 切换多选模式 */
function toggleSelect() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) selectedIds.value = new Set()
}
/** 切换单个选中（Set 需替换以触发响应式） */
function onToggle(id) {
  const next = new Set(selectedIds.value)
  next.has(id) ? next.delete(id) : next.add(id)
  selectedIds.value = next
}
/** 点击卡片：选择模式切换选中，否则进详情 */
function onCardClick(m) {
  if (selectMode.value) return onToggle(m.id)
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

/* ===== ① 演员区 ===== */
.actor-head { display: flex; align-items: center; gap: 16px; }
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
/* 性别符号：♀ 朱柿红 / ♂ 柔蓝 */
.ah-sex { font-size: var(--fs-xl); color: var(--accent); }
.ah-sex.m { color: #3d7ebf; }
.ah-meta { font-size: var(--fs-base); color: var(--text-2); }
.ah-count { font-size: var(--fs-sm); color: var(--muted); font-variant-numeric: tabular-nums; }

/* ===== ② 标签类别栏（样式与片库页 TagFilter 一致） ===== */
.tag-filter {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  margin-bottom: 10px;
}
.filter-header {
  display: flex; align-items: center; gap: 5px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
}
.header-label {
  font-weight: 600; color: var(--text); font-size: 13.5px;
  flex-shrink: 0; min-width: 60px; margin-right: 6px;
}
.filter-body { padding: 6px 14px; }
.cat-row {
  display: flex; align-items: flex-start; flex-wrap: wrap;
  gap: 2px 5px; padding: 4px 0;
}
.cat-name {
  font-weight: 500; color: var(--text-2); font-size: 13px;
  line-height: 1.9; margin-right: 6px; flex-shrink: 0; min-width: 60px;
}
.cat-tags { display: flex; flex-wrap: wrap; gap: 2px 5px; flex: 1; }

/* ===== ③ 排序 / 选择栏 ===== */
.actor-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px;
}
.ab-sort, .ab-select {
  display: inline-flex; align-items: center; gap: 6px;
  height: var(--icon-btn-md); padding: 0 14px;
  border: 1px solid var(--border-strong); border-radius: var(--r-pill);
  background: var(--surface); color: var(--text-2);
  font-size: var(--fs-base); cursor: pointer;
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease,
              border-color var(--dur-fast) ease, transform var(--dur-fast) var(--ease-out);
}
.ab-sort:hover, .ab-select:hover { background: var(--surface-2); color: var(--text); }
.ab-sort:active, .ab-select:active { transform: scale(0.96); }
.ab-select.on { background: var(--primary); border-color: var(--primary); color: #fff; }

/* ===== ④ 影片网格 ===== */
.actor-grid { display: grid; gap: 14px; }
.actor-empty { padding: 60px 0; text-align: center; color: var(--muted); font-size: var(--fs-md); }
.actor-pager { display: flex; justify-content: center; margin-top: 4px; }
</style>
