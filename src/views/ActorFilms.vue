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
        <!-- page-title：页面级标题统一类（字号/字重/字距在 global.css 一处定义） -->
        <div class="ah-name-row">
          <div class="ah-name page-title">{{ name }}</div>
          <!-- 编辑按钮：点开弹窗可改名字/头像/资料（2026-10-06） -->
          <button class="ah-edit-btn" @click="openEditDialog" title="编辑演员信息">
            <AppIcon name="edit" :size="14" />
            <span>编辑</span>
          </button>
        </div>
        <div class="ah-count">{{ films.length }} 部作品</div>
        <!-- 女优个人资料（身高/三围/罩杯/出生日期）：有值才显示，
             数据来自 actress 表，由编辑弹窗写入。 -->
        <div class="ah-info" v-if="hasInfo">
          <div class="info-chips">
            <span class="info-chip" v-if="info.height">身高 <b>{{ info.height }}</b>cm</span>
            <span class="info-chip" v-if="info.zb">罩杯 <b>{{ info.zb }}</b></span>
            <span class="info-chip" v-if="info.bust">胸围 <b>{{ info.bust }}</b></span>
            <span class="info-chip" v-if="info.waist">腰围 <b>{{ info.waist }}</b></span>
            <span class="info-chip" v-if="info.hip">臀围 <b>{{ info.hip }}</b></span>
            <span class="info-chip" v-if="info.birthday">出生日期 <b>{{ info.birthday }}</b></span>
          </div>
        </div>
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

    <!-- ===== 编辑演员信息弹窗（2026-10-06） =====
         可改：名字（同步改所有影片 cast_json）、头像（选本地图片导入）、身高三围等资料。
         头像导入走 importActressAvatar（复制到 images/actress/<名字>.<ext>），
         保存时把返回的相对路径传给 updateActress。 -->
    <el-dialog v-model="editVisible" title="编辑演员信息" width="520px" :close-on-click-modal="false"
               destroy-on-close append-to-body @closed="onEditClosed">
      <div class="edit-body">
        <!-- 头像区：当前头像预览 + 选择图片按钮 -->
        <div class="edit-avatar-row">
          <div class="edit-avatar-preview">
            <img :src="editAvatarUrl" :alt="editName" @error="editAvatarBroken = true" />
          </div>
          <div class="edit-avatar-actions">
            <el-button type="primary" @click="pickAvatar" :disabled="saving" round>选择图片</el-button>
            <div class="edit-avatar-hint">支持 jpg / png / webp，导入后存到 images/actress/</div>
          </div>
        </div>

        <!-- 名字 -->
        <div class="edit-field">
          <label>名字</label>
          <el-input v-model="editName" placeholder="演员名字" />
        </div>

        <!-- 从 TheIdolBase 一键检索（2026-10-07）：按当前名字查身高/三围/出道，自动填表，不自动保存 -->
        <div class="edit-scrape-row">
          <el-button type="primary" plain @click="scrapeFromIdol" :disabled="saving || scraping" round>
            <AppIcon name="search" :size="14" />
            <span>{{ scraping ? '检索中…' : '从 TheIdolBase 检索' }}</span>
          </el-button>
          <div class="edit-scrape-hint">按当前名字查 TheIdolBase，命中后自动填入身高/三围/出生日期</div>
        </div>

        <!-- 资料：两列网格（身高/罩杯/胸围/腰围/臀围/出生日期） -->
        <div class="edit-grid">
          <div class="edit-field">
            <label>身高 (cm)</label>
            <el-input v-model.number="editInfo.height" type="number" placeholder="如 160" />
          </div>
          <div class="edit-field">
            <label>罩杯</label>
            <el-input v-model="editInfo.zb" placeholder="如 C" />
          </div>
          <div class="edit-field">
            <label>胸围 (cm)</label>
            <el-input v-model.number="editInfo.bust" type="number" placeholder="如 88" />
          </div>
          <div class="edit-field">
            <label>腰围 (cm)</label>
            <el-input v-model.number="editInfo.waist" type="number" placeholder="如 58" />
          </div>
          <div class="edit-field">
            <label>臀围 (cm)</label>
            <el-input v-model.number="editInfo.hip" type="number" placeholder="如 86" />
          </div>
          <div class="edit-field">
            <label>出生日期</label>
            <el-input v-model="editInfo.birthday" placeholder="如 1995-01-01" />
          </div>
        </div>
      </div>
      <template #footer>
        <div class="edit-dialog-footer">
          <el-button type="danger" plain @click="deleteActress" :disabled="saving" round>删除该女优</el-button>
          <div class="edit-dialog-footer-right">
            <el-button @click="editVisible = false" :disabled="saving" round>取消</el-button>
            <el-button type="primary" @click="saveEdit" :disabled="saving" round>
              {{ saving ? '保存中…' : '保存' }}
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, toRaw } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useMoviesStore } from '@/store/movies'
import { resolveCover, splitTags, favLock, favUnlock } from '@/utils/global'
import { playMovie } from '@/utils/playback'
import AppIcon from '@/components/AppIcon.vue'
import MovieCard from '@/components/MovieCard.vue'
import TagChip from '@/components/TagChip.vue'
import SortDropdown from '@/components/SortDropdown.vue'
import BackButton from '@/components/BackButton.vue'

const route = useRoute()
const router = useRouter()
const store = useMoviesStore()

// 演员名（路由参数解码）
// 演员名（路由参数）：vue-router 4 在 resolve 时**已经解码过一次**，
// 这里再 decodeURIComponent 会二次解码 —— 名字含 % 时抛 URIError（computed 在渲染期抛错 → 页面空白），
// 含 %XX 形式则被错误解码成别的名字（2026-09-28 审计）
const name = computed(() => String(route.params.name || ''))
// 演员数据
const gender = ref('f')
const avatar = ref('')
const info = ref(null)
/** 是否有任何可展示的女优资料（任一字段非空） */
const hasInfo = computed(() => {
  const i = info.value
  if (!i) return false
  return Boolean(i.height || i.bust || i.waist || i.hip || i.zb || i.birthday)
})
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
 * 播放：按设置分发 —— 内置播放器开启进内置播放页，关闭则交给外部播放器
 * （与 useMovieList.onPlay / Detail.onPlay 走同一个入口）。
 */
async function onPlay(m) {
  await playMovie(m, store.settings, router.push)
}
/** 切换喜欢（乐观更新 + 失败回滚）
 *  原实现的写库调用同样因为 safeCall 传函数而从未执行 —— 界面已变红、库里却没变，
 *  重启后"喜欢"会复原。这里改为直接 await 并校验 r.ok，失败回滚。 */
async function onFav(m) {
  if (!window.api) return
  // 同一 id 的操作去重（2026-09-29 审计）：连点会打出两个在飞请求，后者覆盖前者结论
  if (!favLock(m.id)) return
  const next = m.cl === 'y' ? 'n' : 'y'
  const idx = films.value.findIndex(x => x.id === m.id)
  if (idx >= 0) films.value[idx] = { ...films.value[idx], cl: next }
  try {
    const r = await window.api.updateMovie(m.id, { cl: next }).catch(() => null)
    if (!r || !r.ok) {
      const i2 = films.value.findIndex(x => x.id === m.id)
      if (i2 >= 0) films.value[i2] = { ...films.value[i2], cl: m.cl }
      ElMessage.error(r?.error || '操作失败')
    }
  } finally {
    favUnlock(m.id)
  }
}

/** 加载演员影片数据 */
async function load() {
  if (!window.api?.getActorFilms) { loading.value = false; return }
  loading.value = true
  // try/finally（2026-09-28 审计）：原实现若 getActorFilms reject，下面的 loading=false
  // 不会执行 → 页面永久卡在「加载中…」，同时产生一条 unhandled rejection
  try {
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
  } catch (e) {
    heatRank.value = null
    ElMessage.error('加载失败：' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

// ========== 编辑演员信息（2026-10-06） ==========
const editVisible = ref(false)
const saving = ref(false)
const scraping = ref(false)
const editName = ref('')
const editAvatar = ref('')            // 相对路径（images/actress/xxx.jpg）
const editAvatarBroken = ref(false)
const editInfo = ref({ height: null, bust: null, waist: null, hip: null, zb: '', birthday: '', debut: '', remark: '' })

/** 编辑弹窗内的头像预览 URL */
const editAvatarUrl = computed(() => (editAvatar.value && !editAvatarBroken.value)
  ? resolveCover(editAvatar.value)
  : (gender.value === 'm' ? DEFAULT_AVATAR.m : DEFAULT_AVATAR.f))

/** 打开编辑弹窗：用当前演员的数据回填 */
function openEditDialog() {
  editName.value = name.value
  editAvatar.value = avatar.value || ''
  editAvatarBroken.value = false
  const i = info.value || {}
  editInfo.value = {
    height: i.height ?? null,
    bust: i.bust ?? null,
    waist: i.waist ?? null,
    hip: i.hip ?? null,
    zb: i.zb ?? '',
    birthday: i.birthday ?? '',
    debut: i.debut ?? '',
    remark: i.remark ?? ''
  }
  editVisible.value = true
}

/** 选择本地图片作为头像：复制到 images/actress/ 并拿到相对路径 */
async function pickAvatar() {
  if (typeof window.api?.openImageDialog !== 'function') return
  const p = await window.api.openImageDialog()
  if (!p) return
  const nm = editName.value.trim()
  if (!nm) { ElMessage.warning('请先填写名字'); return }
  try {
    if (typeof window.api?.importActressAvatar !== 'function') {
      ElMessage.error('接口未就绪，请重启应用后重试')
      return
    }
    const r = await window.api.importActressAvatar({ name: nm, srcPath: p })
    if (r?.ok) {
      editAvatar.value = r.data.path
      editAvatarBroken.value = false
      ElMessage.success('头像已导入')
    } else {
      ElMessage.error(r?.error || '导入失败')
    }
  } catch (e) {
    ElMessage.error('导入出错：' + (e?.message || String(e)))
  }
}

/** 从 TheIdolBase 检索身高/三围/出道，命中后填入 editInfo（不自动保存，让用户审阅） */
async function scrapeFromIdol() {
  if (scraping.value || saving.value) return
  const nm = editName.value.trim()
  if (!nm) { ElMessage.warning('请先填写名字'); return }
  if (typeof window.api?.scrapeActressInfo !== 'function') {
    ElMessage.error('接口未就绪，请重启应用后重试')
    return
  }
  scraping.value = true
  try {
    const r = await window.api.scrapeActressInfo(nm)
    if (!r?.ok) {
      ElMessage.error(r?.error || '检索失败')
      return
    }
    const d = r.data || {}
    // 仅覆盖 scrape 取到值的字段，保留用户已手填的值
    if (d.height != null) editInfo.value.height = d.height
    if (d.bust != null) editInfo.value.bust = d.bust
    if (d.waist != null) editInfo.value.waist = d.waist
    if (d.hip != null) editInfo.value.hip = d.hip
    if (d.zb) editInfo.value.zb = d.zb
    if (d.birthday) editInfo.value.birthday = d.birthday
    const filled = [d.height, d.bust, d.waist, d.hip, d.zb, d.birthday].filter(v => v != null && v !== '').length
    ElMessage.success(`已填入 ${filled} 项（按「${d.matchedName || nm}」命中），确认无误后点保存`)
  } catch (e) {
    ElMessage.error('检索出错：' + (e?.message || String(e)))
  } finally {
    scraping.value = false
  }
}

/** 保存编辑：调 updateActress，改名成功后跳转到新名字的页面 */
async function saveEdit() {
  if (saving.value) return
  const nm = editName.value.trim()
  if (!nm) { ElMessage.warning('名字不能为空'); return }
  saving.value = true
  try {
    const payload = {
      oldName: name.value,
      newName: nm,
      avatar: editAvatar.value || '',
      // editInfo 是 ref，.value 是 reactive Proxy，不能直接走 Electron IPC（structured clone 失败报
      // "An object could not be cloned"）。用 toRaw + 展开构造一个纯字面量对象再传。
      info: { ...toRaw(editInfo.value) }
    }
    // 安全检查：接口未就绪时给出明确提示（此前 .catch(() => null) 会吞掉同步异常，
    // 导致 window.api 缺失时用户看不到任何反馈）
    if (typeof window.api?.updateActress !== 'function') {
      ElMessage.error('接口未就绪，请重启应用后重试')
      return
    }
    const r = await window.api.updateActress(payload)
    if (r?.ok) {
      ElMessage.success('保存成功')
      editVisible.value = false
      // 改名后跳转到新名字的演员页（路由参数变了，本页数据不会自动刷新）
      if (nm !== name.value) {
        router.push({ path: `/actor/${encodeURIComponent(nm)}` })
      } else {
        await load()
      }
    } else {
      ElMessage.error(r?.error || '保存失败')
    }
  } catch (e) {
    // 捕获所有异常（包括同步抛出的 TypeError），给用户明确反馈
    ElMessage.error('保存出错：' + (e?.message || String(e)))
  } finally {
    saving.value = false
  }
}

/** 弹窗关闭后复位（destroy-on-close 已保证 DOM 销毁，这里清状态位） */
function onEditClosed() {
  editAvatarBroken.value = false
}

/** 删除该女优的个人资料（不影响影片 cast_json） */
async function deleteActress() {
  if (saving.value) return
  try {
    await ElMessageBox.confirm(
      `确定要删除「${name.value}」的女优资料吗？\n\n影片中的出演记录不会被删除，但若该女优没有任何出演影片，将从女优列表中消失。`,
      '删除女优',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }
  saving.value = true
  try {
    if (typeof window.api?.deleteActress !== 'function') {
      ElMessage.error('接口未就绪，请重启应用后重试')
      return
    }
    const r = await window.api.deleteActress(name.value)
    if (r?.ok) {
      ElMessage.success('已删除')
      editVisible.value = false
      router.push('/actresses')
    } else {
      ElMessage.error(r?.error || '删除失败')
    }
  } catch (e) {
    ElMessage.error('删除出错：' + (e?.message || String(e)))
  } finally {
    saving.value = false
  }
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
/* 名字行：大名 + 编辑按钮同一行，按钮跟在名字右侧、垂直居中 */
.ah-name-row { display: flex; align-items: center; gap: 10px; }
.ah-edit-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px;
  font-size: var(--fs-sm);
  color: var(--muted);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease-out);
}
.ah-edit-btn:hover { color: var(--primary); border-color: var(--primary); }
.ah-edit-btn:active { transform: scale(0.96); }
.ah-edit-btn svg { --icon-fill: currentColor; --icon-stroke: currentColor; }
/* .ah-name 的字号 / 字重 / 字距 / 颜色全部来自 global.css 的 .page-title（页面标题体系）
   —— 此前这里重复定义了 18px/700/color，改字号要改两处，已收口 */

.ah-count { font-size: var(--fs-sm); color: var(--muted); font-variant-numeric: tabular-nums; }
/* 女优个人资料区：身高/三围/罩杯等以 chip 形式横排，备注单独一行 */
.ah-info { margin-top: 2px; display: flex; flex-direction: column; gap: 4px; }
.info-chips { display: flex; flex-wrap: wrap; gap: 6px 10px; }
.info-chip {
  font-size: var(--fs-sm); color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  padding: 2px 10px;
  line-height: 1.6;
}
.info-chip b { color: var(--text); font-weight: 600; margin: 0 1px; }
.info-remark { font-size: var(--fs-sm); color: var(--muted); line-height: 1.5; }

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
  --icon-stroke: var(--border-strong);             /* 浅灰描边（空槽）＝边框令牌，不再裸写 #d8d4cb */
}
.idx-star .star-fg {
  position: absolute; inset: 0; overflow: hidden;
  --icon-fill: var(--star-fill);                   /* 评分填充：金（令牌） */
  --icon-stroke: var(--star-stroke);               /* 边框线：墨色（令牌） */
}
.idx-flame {
  --icon-fill: var(--accent);                      /* 热度填充：品牌红（与 logo 同色） */
  --icon-stroke: var(--star-stroke);               /* 边框线：墨色（令牌） */
  stroke-width: 0.9;
  flex-shrink: 0;
}
/* 热度排名分档配色：越热越靠上（前 10% 紫 → 前 60% 蓝 → 其余青）。
   无排名（无人数数据/不在女优榜）时保持上面的品牌红默认值。
   色值统一来自 global.css 的 --heat-* 令牌（演员页排行视图共用同一组）。 */
.idx-flame.t-purple { --icon-fill: var(--heat-purple); }      /* 前 10% */
.idx-flame.t-darkred { --icon-fill: var(--heat-darkred); }    /* 前 11%~20% */
.idx-flame.t-lightred { --icon-fill: var(--heat-lightred); }  /* 前 21%~30% */
.idx-flame.t-orange { --icon-fill: var(--heat-orange); }      /* 前 31%~40% */
.idx-flame.t-gold { --icon-fill: var(--heat-gold); }          /* 前 41%~50% */
.idx-flame.t-blue { --icon-fill: var(--heat-blue); }          /* 前 51%~60% */
.idx-flame.t-cyan { --icon-fill: var(--heat-cyan); }          /* 61% 以后 */
.idx-num { display: flex; flex-direction: column; gap: 1px; }
.idx-val {
  font-family: var(--font-display);
  font-size: 26px; font-weight: 700; line-height: 1.05;   /* 展示级大号数字：令牌阶梯最大 20px，这一处有意超出 */
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

/* ===== 编辑弹窗（2026-10-06） ===== */
.edit-body { display: flex; flex-direction: column; gap: 16px; }
/* 头像行：预览图 + 操作按钮，左右布局 */
.edit-avatar-row { display: flex; align-items: center; gap: 16px; }
.edit-avatar-preview {
  width: 96px; height: 96px; flex-shrink: 0;
  border-radius: var(--r-md); overflow: hidden;
  border: 1px solid var(--border); background: var(--surface-2);
}
.edit-avatar-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
.edit-avatar-actions { display: flex; flex-direction: column; gap: 8px; }
.edit-avatar-hint { font-size: var(--fs-sm); color: var(--muted); }
/* 表单字段 */
.edit-field { display: flex; flex-direction: column; gap: 4px; }
.edit-field label { font-size: var(--fs-sm); color: var(--text-2); font-weight: 500; }
/* TheIdolBase 检索行：按钮 + 提示文字水平排列，浅底卡片 */
.edit-scrape-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; padding: 10px 12px; background: var(--surface-2); border-radius: var(--r-sm); }
.edit-scrape-row .el-button { flex-shrink: 0; }
.edit-scrape-hint { font-size: var(--fs-sm); color: var(--muted); }
/* 两列网格 */
.edit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 14px; }
.edit-field-full { grid-column: 1 / -1; }
/* 弹窗底部：左删除 / 右取消+保存，按钮间距与全站 dialog 一致（12px） */
.edit-dialog-footer { display: flex; justify-content: space-between; align-items: center; width: 100%; }
.edit-dialog-footer-right { display: flex; gap: 12px; }
</style>
