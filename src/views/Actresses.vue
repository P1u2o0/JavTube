<!--
  ============================================================
  文件名：Actresses.vue
  所属模块：视图 / 演员页（2026-09-22）
  功能描述：库内女优总览，右上角切换两个视图：
           ① 头像墙（默认）：按「作品数量」降序的女优头像网格；
           ② 排行：按「热度指数」降序，一行一女优 ——
              名次 + 头像 + 名字/作品数/热度火焰（分档配色）+
              该女优「想看人数最多」的 3 部影片 + 「更多」按钮。
           头像与「更多」都进入该女优的演员影片页（/actor/:name），
           影片格子进入影片详情页。
  数据来源：window.api.getActressOverview()（后端一次性聚合 + 缓存）
  ============================================================
-->
<template>
  <div class="actresses-page">
    <!-- 页头：标题 + 视图切换 -->
    <div class="page-head">
      <h3>演员 <span class="cnt" v-if="list.length">{{ list.length }}</span></h3>
      <div class="head-right">
        <span class="sort-hint">{{ view === 'grid' ? '按作品数量排序' : '按热度指数排序' }}</span>
        <div class="view-toggle">
          <button :class="{ on: view === 'grid' }" @click="switchView('grid')" title="显示所有女优头像">
            <AppIcon name="user" :size="14" /><span>头像</span>
          </button>
          <button :class="{ on: view === 'rank' }" @click="switchView('rank')" title="按热度排行">
            <AppIcon name="flame" :size="14" /><span>排行</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ① 头像墙：作品数量降序 -->
    <div v-if="view === 'grid'" class="avatar-wall">
      <button v-for="a in list" :key="a.name" class="a-card" @click="goActor(a.name)" :title="a.name">
        <span class="a-avatar">
          <img v-if="a.avatar" :src="resolveCover(a.avatar)" :alt="a.name" loading="lazy" />
          <img v-else :src="DEFAULT_AVATAR.f" :alt="a.name" />
        </span>
        <span class="a-name">{{ a.name }}</span>
        <span class="a-count">{{ a.count }} 部作品</span>
      </button>
      <div v-if="!list.length && !loading" class="empty">库内还没有女优数据</div>
    </div>

    <!-- ② 排行：热度降序，一行一女优 -->
    <div v-else class="rank-list">
      <div v-for="a in rankList" :key="a.name" class="rank-row"
           :class="{ hl: a.name === highlight }" :data-name="a.name">
        <span class="r-no">{{ a.rank ?? '—' }}</span>
        <button class="r-avatar" @click="goActor(a.name)" :title="'查看 ' + a.name + ' 的全部影片'">
          <img v-if="a.avatar" :src="resolveCover(a.avatar)" :alt="a.name" loading="lazy" />
          <img v-else :src="DEFAULT_AVATAR.f" :alt="a.name" />
        </button>
        <div class="r-main">
          <div class="r-name">{{ a.name }}</div>
          <div class="r-sub">{{ a.count }} 部作品</div>
          <div class="r-heat" v-if="a.heat !== null" :title="'热度排名：第 ' + a.rank + ' / ' + a.total + ' 名'">
            <AppIcon name="flame-filled" :size="17" class="r-flame" :class="'t-' + a.tier" />
            <span class="r-heat-val">{{ a.heat.toLocaleString('zh-CN') }}</span>
          </div>
        </div>
        <!-- 想看人数最多的 3 部影片 -->
        <div class="r-movies">
          <button v-for="mv in a.top" :key="mv.id" class="r-mv"
                  @click="goDetail(mv.id)" :title="(mv.pm || mv.ph) + '（想看 ' + mv.want.toLocaleString('zh-CN') + '）'">
            <img v-if="mv.cover" :src="resolveCover(mv.cover)" :alt="mv.ph" loading="lazy" />
            <span v-else class="r-mv-ph">{{ mv.ph }}</span>
            <span class="r-mv-cap">
              <span class="r-mv-ph2">{{ mv.ph }}</span>
              <span class="r-mv-want">想看 {{ mv.want.toLocaleString('zh-CN') }}</span>
            </span>
          </button>
        </div>
        <button class="r-more" @click="goActor(a.name)">
          更多<AppIcon name="more" :size="15" />
        </button>
      </div>
      <div v-if="!list.length && !loading" class="empty">库内还没有女优数据</div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { resolveCover } from '@/utils/global'
import AppIcon from '@/components/AppIcon.vue'

const route = useRoute()
const router = useRouter()

/** 默认女优剪影（与演员影片页一致，BASE_URL 相对路径防打包 404） */
const DEFAULT_AVATAR = { f: import.meta.env.BASE_URL + 'actor-female.svg' }

/** 视图状态：grid=头像墙（默认）/ rank=热度排行；支持 ?view= 直达 */
const view = ref(route.query.view === 'rank' ? 'rank' : 'grid')
const list = ref([])
const loading = ref(true)
/** 高亮的演员名（?hl=，从演员影片页的热度区跳过来时定位用） */
const highlight = ref(String(route.query.hl || ''))

/** 排行视图顺序：名次升序（无名次即无人数数据，排最后按名字） */
const rankList = computed(() =>
  [...list.value].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.name.localeCompare(b.name, 'zh')))

function switchView(v) { view.value = v }

function goActor(name) { router.push('/actor/' + encodeURIComponent(name)) }
function goDetail(id) { router.push('/detail/' + id) }

/** 加载聚合数据 */
async function load() {
  if (!window.api?.getActressOverview) { loading.value = false; return }
  loading.value = true
  const r = await window.api.getActressOverview().catch(() => null)
  list.value = r?.ok ? (r.data || []) : []
  loading.value = false
  // 带 hl 进入排行视图时，滚动定位到该女优并高亮
  if (view.value === 'rank' && highlight.value) {
    await nextTick()
    document.querySelector(`.rank-row[data-name="${CSS.escape(highlight.value)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

// 从其它页面带不同 query 跳进来时同步视图/高亮（如演员影片页点热度区）
watch(() => route.query, (q) => {
  if (route.path !== '/actresses') return
  if (q.view) view.value = q.view === 'rank' ? 'rank' : 'grid'
  highlight.value = String(q.hl || '')
  if (q.hl || q.view) load()
})

onMounted(load)
</script>

<style scoped>
.actresses-page { display: flex; flex-direction: column; gap: 14px; }
.cnt {
  font-size: var(--fs-md); font-weight: 600; color: var(--muted);
  margin-left: 4px;
}
.head-right { display: flex; align-items: center; gap: 10px; }
.sort-hint { font-size: var(--fs-sm); color: var(--muted); }

/* ===== 右上角视图切换（分段控件） ===== */
.view-toggle {
  display: flex; padding: 3px; gap: 2px;
  border: 1px solid var(--border-strong); border-radius: var(--r-pill);
  background: var(--surface);
}
.view-toggle button {
  display: flex; align-items: center; gap: 5px;
  padding: 5px 14px; border: none; border-radius: var(--r-pill);
  background: transparent; color: var(--muted);
  font-size: var(--fs-sm); font-weight: 500; cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.view-toggle button:hover { color: var(--text); }
.view-toggle button.on { background: var(--primary); color: #fff; }
.view-toggle button:active { transform: scale(0.97); }

/* ===== ① 头像墙 ===== */
.avatar-wall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 14px;
}
.a-card {
  display: flex; flex-direction: column; align-items: center; gap: 7px;
  padding: 12px 8px 11px;
  border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--surface); cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) var(--ease-out);
}
.a-card:hover { transform: translateY(-2px); box-shadow: var(--sh-2); border-color: var(--border-strong); }
.a-card:active { transform: scale(0.97); transition-duration: var(--dur-press); }
.a-avatar {
  width: 84px; height: 84px; border-radius: var(--r-md); overflow: hidden;
  background: var(--surface-2); border: 1px solid var(--border);
}
.a-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.a-name {
  max-width: 100%;
  font-size: var(--fs-base); font-weight: 600; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.a-count { font-size: var(--fs-sm); color: var(--muted); font-variant-numeric: tabular-nums; }

/* ===== ② 排行 ===== */
.rank-list { display: flex; flex-direction: column; gap: 10px; }
.rank-row {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 16px;
  border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--surface);
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}
.rank-row:hover { border-color: var(--border-strong); box-shadow: var(--sh-1); }
/* 从演员影片页热度区跳转过来的定位高亮 */
.rank-row.hl { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }

.r-no {
  width: 30px; flex-shrink: 0; text-align: center;
  font-family: var(--font-display); font-size: var(--fs-xl); font-weight: 700;
  color: var(--muted); font-variant-numeric: tabular-nums;
}
.r-avatar {
  width: 72px; height: 72px; flex-shrink: 0; padding: 0;
  border-radius: var(--r-md); overflow: hidden;
  border: 1px solid var(--border); background: var(--surface-2);
  cursor: pointer;
}
.r-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.r-main { width: 148px; flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; }
.r-name {
  font-family: var(--font-display); font-size: var(--fs-lg); font-weight: 700; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.r-sub { font-size: var(--fs-sm); color: var(--muted); font-variant-numeric: tabular-nums; }
.r-heat { display: flex; align-items: center; gap: 5px; }
.r-heat-val { font-size: var(--fs-base); font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
/* 热度火焰分档配色（与演员影片页一致） */
.r-flame { --icon-stroke: #111111; stroke-width: 0.9; flex-shrink: 0; }
.r-flame.t-purple { --icon-fill: #8b46d6; }
.r-flame.t-darkred { --icon-fill: #c0121a; }
.r-flame.t-lightred { --icon-fill: #f2564d; }
.r-flame.t-orange { --icon-fill: #f0812a; }
.r-flame.t-gold { --icon-fill: #e0a80d; }
.r-flame.t-blue { --icon-fill: #2f6fdb; }
.r-flame.t-cyan { --icon-fill: #17b3c9; }

/* 中间弹性区：想看最多的 3 部影片 */
.r-movies {
  flex: 1; min-width: 0;
  display: flex; gap: 10px; align-items: center;
  justify-content: flex-start;
}
.r-mv {
  position: relative; flex: 1; max-width: 168px; min-width: 0;
  aspect-ratio: 16 / 10.6;             /* JAV 封面横版比例 */
  border: 1px solid var(--border); border-radius: var(--r-sm);
  overflow: hidden; padding: 0; cursor: pointer; background: var(--surface-2);
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}
.r-mv:hover { transform: translateY(-2px); box-shadow: var(--sh-2); }
.r-mv:active { transform: scale(0.97); transition-duration: var(--dur-press); }
.r-mv img { width: 100%; height: 100%; object-fit: cover; display: block; }
.r-mv-ph {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  padding: 6px; font-size: var(--fs-sm); font-weight: 600; color: var(--muted); text-align: center;
}
.r-mv-cap {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; align-items: center; justify-content: space-between; gap: 6px;
  padding: 14px 8px 5px;
  background: linear-gradient(transparent, rgba(0, 0, 0, .62));
  color: #fff; font-size: var(--fs-xs);
}
.r-mv-ph2 { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.r-mv-want { flex-shrink: 0; opacity: .92; font-variant-numeric: tabular-nums; }

/* 最右：更多按钮（进演员影片页） */
.r-more {
  flex-shrink: 0;
  display: flex; align-items: center; gap: 3px;
  padding: 7px 14px;
  border: 1px solid var(--border-strong); border-radius: var(--r-pill);
  background: var(--surface); color: var(--text);
  font-size: var(--fs-sm); font-weight: 500; cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), transform var(--dur-press) var(--ease-out);
}
.r-more:hover { background: var(--surface-2); }
.r-more:active { transform: scale(0.96); }

.empty { padding: 40px 0; text-align: center; color: var(--muted); font-size: var(--fs-base); }

/* 窄窗口：影片格子收紧 */
@media (max-width: 1200px) {
  .r-main { width: 118px; }
  .r-mv { max-width: 140px; }
}
</style>
