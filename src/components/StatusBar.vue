<!--
  文件名：StatusBar.vue
  所属模块：公共组件 / 状态栏
  功能描述：影片列表的状态栏组件，显示搜索结果总数、批量操作按钮（全选、反选、批量删除、
           批量刮削、批量收藏/取消收藏）和多选模式开关。批量操作按钮在多选模式下显示，
           操作对象为 store 中已选中的影片列表。
-->
<template>
  <!-- 状态栏主体 -->
  <div class="statusbar">
    <!-- 排序选择（2026-09-10 优化）：点击当前排序项可切换正序/倒序；含随机排序 -->
    <el-dropdown trigger="click" @command="onSortCommand">
      <el-button class="sort-btn">
        <AppIcon v-if="store.sort.random" name="shuffle" :size="14" style="margin-right:5px" />
        <span>{{ sortLabel }}</span>
        <span v-if="sortArrow" class="sort-dir" :class="store.sort.order === 'ASC' ? 'asc' : 'desc'">
          <AppIcon name="back" :size="12" />
        </span>
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="tjrq" :class="{ 'sort-active': !store.sort.random && store.sort.by === 'tjrq' }">添加日期</el-dropdown-item>
          <el-dropdown-item command="fxrq" :class="{ 'sort-active': !store.sort.random && store.sort.by === 'fxrq' }">发行日期</el-dropdown-item>
          <el-dropdown-item command="want" :class="{ 'sort-active': !store.sort.random && store.sort.by === 'want' }">想看人数</el-dropdown-item>
          <el-dropdown-item command="watched" :class="{ 'sort-active': !store.sort.random && store.sort.by === 'watched' }">看过人数</el-dropdown-item>
          <el-dropdown-item command="score" :class="{ 'sort-active': !store.sort.random && store.sort.by === 'score' }">评分</el-dropdown-item>
          <el-dropdown-item command="random" divided :class="{ 'sort-active': store.sort.random }">随机排序</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
    <!-- 左侧：显示搜索结果总数 -->
    <div class="left">共找到 <b>{{ total }}</b> 个结果</div>
    <!-- 批量操作区域：仅在多选模式下显示 -->
    <div v-if="store.selectMode" class="batch">
      <!-- 已选中数量提示 -->
      <span class="sel-count">已选 {{ store.selectedIds.length }} 项</span>
      <!-- 全选当前页面所有影片 -->
      <el-button size="small" @click="selectAll">全选</el-button>
      <!-- 反选当前页面影片的选中状态 -->
      <el-button size="small" @click="invert">反选</el-button>
      <!-- 批量删除：无选中项时禁用（中性描边，hover 显现危险色） -->
      <el-button size="small" class="batch-btn batch-danger" :disabled="!store.selectedIds.length" @click="$emit('batchDelete')">
        <AppIcon name="trash" :size="14" style="margin-right:4px" />批量删除
      </el-button>
      <!-- 批量刮削：无选中项时禁用（中性描边，hover 显现朱柿红强调色） -->
      <el-button size="small" class="batch-btn batch-scrape" :disabled="!store.selectedIds.length" @click="$emit('batchScrape')">
        <AppIcon name="globe" :size="14" style="margin-right:4px" />批量刮削
      </el-button>
      <!-- 批量收藏：无选中项时禁用 -->
      <el-button size="small" :disabled="!store.selectedIds.length" @click="$emit('batchFav', true)">
        <AppIcon name="heart" :size="14" style="margin-right:4px" />全部收藏
      </el-button>
      <!-- 批量取消收藏：无选中项时禁用 -->
      <el-button size="small" :disabled="!store.selectedIds.length" @click="$emit('batchFav', false)">
        <AppIcon name="close" :size="14" style="margin-right:4px" />取消收藏
      </el-button>
    </div>
    <!-- 右侧：多选模式开关 -->
    <div class="right">
      <span class="right-label">选择</span>
      <el-switch v-model="store.selectMode" @change="onToggle" />
    </div>
  </div>
</template>

<script setup>
// 引入影片数据仓库（Pinia store）
import { useMoviesStore } from '@/store/movies'
// 引入统一图标组件
import AppIcon from '@/components/AppIcon.vue'
// 引入 Vue 响应式 API
import { computed, ref } from 'vue'

// 组件 props 定义
// - total: 影片搜索结果总数
const props = defineProps({ total: Number })

// 定义 emit 事件：
// - toggle: 多选模式开关变化时触发，参数为新的开关状态
// - batchDelete: 批量删除按钮点击时触发
// - batchFav: 批量收藏/取消收藏时触发，参数为 true(收藏) 或 false(取消)
// - batchScrape: 批量刮削按钮点击时触发
// - sortChange: 排序方式变更时触发（父页面按各自筛选场景重新加载列表）
const emit = defineEmits(['toggle', 'batchDelete', 'batchFav', 'batchScrape', 'sortChange'])

// 获取 store 实例
const store = useMoviesStore()

// 排序按钮显示文案：随机模式显示「随机排序」，否则显示当前字段名
const sortLabel = computed(() => {
  if (store.sort.random) return '随机排序'
  return { tjrq: '添加日期', fxrq: '发行日期', want: '想看人数', watched: '看过人数', score: '评分' }[store.sort.by] || '添加日期'
})
// 方向箭头（随机模式无方向）
const sortArrow = computed(() => (store.sort.random ? '' : (store.sort.order === 'ASC' ? '↑' : '↓')))

/**
 * 排序命令处理（el-dropdown）：
 * - 点击当前字段：切换正序/倒序
 * - 点击其他字段：默认降序
 * - 随机：进入随机模式
 * 变更后通知父页面按各自筛选场景重新加载列表
 */
function onSortCommand(cmd) {
  if (cmd === 'random') {
    store.sort = { by: store.sort.by, order: store.sort.order, random: true }
  } else if (store.sort.by === cmd && !store.sort.random) {
    store.sort = { by: cmd, order: store.sort.order === 'DESC' ? 'ASC' : 'DESC', random: false }
  } else {
    store.sort = { by: cmd, order: 'DESC', random: false }
  }
  emit('sortChange', cmd)
}

// 多选模式开关变化处理函数
// 参数 v: 新的开关状态（true=开启多选，false=关闭多选）
// 关闭多选模式时清空所有已选中项
// 触发时机：用户切换多选模式开关
function onToggle(v) {
  if (!v) store.selectedIds = []
  emit('toggle', v)
}

// 全选函数：将当前页面所有影片 ID 加入已选中列表（去重）
function selectAll() {
  const ids = [...new Set([...store.selectedIds, ...store.movies.map(m => m.id)])]
  store.selectedIds = ids
}

// 反选函数：反转当前页面影片的选中状态（页面外的选中保持不变）
// 原实现用 indexOf + splice 逐条查找搬移（每页 200 部 ≈ 2 万次比较 + 200 次数组搬移），
// 改为 Set 差集：页面内已选中的剔除、未选中的补上，一次完成。
function invert() {
  const pageIds = store.movies.map(m => m.id)
  const pageSet = new Set(pageIds)
  const cur = new Set(store.selectedIds)
  // 页面外的选中原样保留
  const kept = [...cur].filter(id => !pageSet.has(id))
  // 页面内：原本未选中的补进来（原本选中的已在 kept 之外，自然被剔除）
  const added = pageIds.filter(id => !cur.has(id))
  store.selectedIds = [...kept, ...added]
}
</script>

<style scoped>
.sort-dir { display: inline-flex; margin-left: 5px; }
.sort-dir :deep(svg) { transition: transform var(--dur-fast) var(--ease-out); }
.sort-dir.desc :deep(svg) { transform: rotate(-90deg); }  /* 左箭头 → 下 */
.sort-dir.asc :deep(svg) { transform: rotate(90deg); }   /* 左箭头 → 上 */
.sort-btn { margin-right: 14px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
/* 下拉菜单当前排序项高亮 */
.sort-active { color: var(--accent); font-weight: 600; }
/* 状态栏主体：统一面板样式 */
.statusbar {
  display: flex; align-items: center;
  padding: 8px 14px;
  margin: 10px 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--sh-1);        /* Apple：面板微阴影 */
  font-size: var(--fs-base);
  color: var(--text-2);
}
/* 左侧结果数量中的粗体数字：展示字 + 等宽数字 */
.left b {
  color: var(--primary);
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: var(--fs-lg);
  margin: 0 3px;
}
/* 左侧结果数量：margin-right:auto 把右侧内容（批量按钮组/选择开关）整体推到最右，
   无论批量模式是否开启，右侧元素始终贴右且不跳动 */
.left { margin-right: auto; }
/* 批量操作区域：紧跟「选择」开关左侧，与其一起贴右（自身不带 auto 推力） */
.batch { display: flex; align-items: center; gap: 6px; padding-right: 12px; flex-wrap: wrap; }
/* 已选中数量提示 */
.sel-count { color: var(--muted); font-size: var(--fs-sm); margin-right: 2px; }
/* 右侧多选开关区域 */
.right { display: flex; align-items: center; flex-shrink: 0; }
.right-label { margin-right: 8px; color: var(--text-2); }
/* 批量删除/刮削按钮：默认中性描边与全选/反选一致，hover/focus 时才显现语义色，
   替换原实心红/绿（EP 默认冷色调与暖纸白+墨黑+朱柿红配色冲突） */
.batch-btn.batch-danger:hover,
.batch-btn.batch-danger:focus {
  background: var(--danger-soft) !important;
  border-color: var(--danger) !important;
  color: var(--danger) !important;
}
.batch-btn.batch-scrape:hover,
.batch-btn.batch-scrape:focus {
  background: var(--accent-soft) !important;
  border-color: var(--accent) !important;
  color: var(--accent) !important;
}
</style>
