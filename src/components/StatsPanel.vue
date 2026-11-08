<!--
  ============================================================
  文件名：StatsPanel.vue
  所属模块：公共组件 / 观影统计面板
  功能描述：观看记录页「统计」视图（2026-11-08 从独立页面并入）：
           总数/收藏/观看次数/估算时长 + 未看完数、Top 女优、Top 标签、近 12 个月趋势。
           数据由主进程一次聚合（stats:get），面板只负责展示。
  ============================================================
-->
<template>
  <div class="stats-page">
    <!-- 顶部四个数字卡 -->
    <section class="sum-grid">
      <div class="sum-card">
        <div class="sum-num">{{ fmtNum(s.total) }}</div>
        <div class="sum-label">影片总数</div>
      </div>
      <div class="sum-card">
        <div class="sum-num">{{ fmtNum(s.fav) }}</div>
        <div class="sum-label">已收藏</div>
      </div>
      <div class="sum-card">
        <div class="sum-num">{{ fmtNum(s.plays) }}</div>
        <div class="sum-label">累计观看次数</div>
      </div>
      <div class="sum-card">
        <div class="sum-num">{{ fmtHours(s.minutes) }}</div>
        <div class="sum-label">估算观看时长</div>
      </div>
    </section>

    <div class="hint" v-if="!loading">
      已看过 <b>{{ s.watched }}</b> 部，其中 <b>{{ s.inProgress }}</b> 部还没看完。
      时长按「观看次数 × 影片时长」估算（库里不记录每次看到哪）。
    </div>

    <!-- 两个 Top 排行 -->
    <section class="panels">
      <div class="panel">
        <div class="panel-title">最常看的女优</div>
        <ul class="rank" v-if="s.topActress.length">
          <li v-for="(a, i) in s.topActress" :key="a.name">
            <span class="rk" :class="{ top3: i < 3 }">{{ i + 1 }}</span>
            <span class="nm" :title="a.name">{{ a.name }}</span>
            <span class="bar"><i :style="{ width: barPct(a.count, maxActress) }"></i></span>
            <span class="cnt">{{ a.count }}</span>
          </li>
        </ul>
        <div v-else class="empty">还没有观看记录</div>
      </div>

      <div class="panel">
        <div class="panel-title">最常看的标签</div>
        <ul class="rank" v-if="s.topTags.length">
          <li v-for="(t, i) in s.topTags" :key="t.tag">
            <span class="rk" :class="{ top3: i < 3 }">{{ i + 1 }}</span>
            <span class="nm" :title="t.tag">{{ t.tag }}</span>
            <span class="bar"><i :style="{ width: barPct(t.count, maxTag) }"></i></span>
            <span class="cnt">{{ t.count }}</span>
          </li>
        </ul>
        <div v-else class="empty">还没有标签数据</div>
      </div>
    </section>

    <!-- 近 12 个月 -->
    <section class="panel months">
      <div class="panel-title">最近 12 个月观看</div>
      <div class="chart">
        <div v-for="m in s.months" :key="m.m" class="col" :title="`${m.m} · ${m.count} 部`">
          <span class="col-val">{{ m.count || '' }}</span>
          <span class="col-bar" :style="{ height: monthH(m.count) }"></span>
          <span class="col-mon">{{ m.m.slice(5) }}</span>
        </div>
      </div>
      <div v-if="!s.watched" class="empty">还没有观看记录</div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'

const loading = ref(true)
const s = ref({
  total: 0, fav: 0, watched: 0, plays: 0, minutes: 0, inProgress: 0,
  topActress: [], topTags: [], months: []
})

const maxActress = computed(() => Math.max(1, ...s.value.topActress.map(x => x.count)))
const maxTag = computed(() => Math.max(1, ...s.value.topTags.map(x => x.count)))
const maxMonth = computed(() => Math.max(1, ...s.value.months.map(x => x.count)))

const barPct = (v, max) => `${Math.max(2, Math.round((v / max) * 100))}%`
const monthH = (v) => `${Math.max(2, Math.round((v / maxMonth.value) * 100))}%`

/** 千分位（数据量大时更易读） */
function fmtNum(n) {
  return Number(n || 0).toLocaleString('zh-CN')
}
/** 分钟 → 「N 小时」/「N 分钟」 */
function fmtHours(min) {
  const m = Number(min) || 0
  if (m >= 60) return `${(m / 60).toFixed(m >= 600 ? 0 : 1)} 小时`
  return `${m} 分钟`
}

onMounted(async () => {
  try {
    const r = await window.api?.getStats?.()
    if (r?.ok && r.data) s.value = { ...s.value, ...r.data }
  } catch (e) {
    console.warn('[stats] 加载失败:', e?.message || e)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.stats-page { display: flex; flex-direction: column; gap: 14px; }

/* 顶部数字卡 */
.sum-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.sum-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md);
  padding: 16px 18px; box-shadow: var(--sh-1);
}
.sum-num {
  font-family: var(--font-display); font-weight: 700; font-size: 28px; line-height: 1.1;
  color: var(--text); font-variant-numeric: tabular-nums;
}
.sum-label { margin-top: 6px; color: var(--muted); font-size: var(--fs-sm); }
.hint { color: var(--muted); font-size: var(--fs-sm); }
.hint b { color: var(--text); font-variant-numeric: tabular-nums; }

/* 排行两栏 */
.panels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.panel {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md);
  padding: 14px 16px; box-shadow: var(--sh-1); min-width: 0;
}
.panel-title {
  font-family: var(--font-display); font-weight: 700; font-size: var(--fs-lg);
  color: var(--text); margin-bottom: 10px;
}
.rank { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.rank li { display: flex; align-items: center; gap: 10px; min-width: 0; }
.rk {
  width: 20px; text-align: center; color: var(--muted);
  font-size: var(--fs-sm); font-variant-numeric: tabular-nums;
}
.rk.top3 { color: var(--accent); font-weight: 700; }
.nm {
  width: 108px; flex-shrink: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-size: var(--fs-base); color: var(--text);
}
.bar { flex: 1; height: 8px; border-radius: var(--r-pill); background: var(--surface-3); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--accent); border-radius: var(--r-pill); }
.cnt {
  width: 42px; text-align: right; color: var(--muted);
  font-size: var(--fs-sm); font-variant-numeric: tabular-nums;
}

/* 月度柱状：用 flex 撑高，柱底对齐 */
.chart {
  display: flex; align-items: flex-end; gap: 6px;
  height: 150px; padding-top: 6px;
}
.col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; min-width: 0; height: 100%; }
.col-val { color: var(--muted); font-size: var(--fs-xs); font-variant-numeric: tabular-nums; }
.col-bar {
  width: 100%; max-width: 34px; min-height: 2px;
  background: linear-gradient(180deg, var(--accent), var(--accent-soft, var(--accent)));
  border-radius: 4px 4px 0 0;
}
.col-mon { color: var(--muted); font-size: var(--fs-xs); font-variant-numeric: tabular-nums; }
.empty { color: var(--muted); font-size: var(--fs-sm); padding: 8px 0; }
</style>
