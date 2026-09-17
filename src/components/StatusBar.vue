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
    <!-- 排序选择（2026-09-10 优化）：点击当前排序项可切换正序/倒序；含随机排序。
         已抽为受控组件，与演员影片页共用同一份实现 -->
    <SortDropdown
      :by="store.sort.by"
      :order="store.sort.order"
      :random="store.sort.random"
      @change="onSortChange"
    />
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
      <!-- 批量刮削：无选中项时禁用（中性描边，hover 显现品牌红强调色） -->
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
// 引入统一图标组件（批量操作按钮用）
import AppIcon from '@/components/AppIcon.vue'
// 引入排序下拉组件（排序 UI 与状态推进已收拢在组件内，与演员影片页共用）
import SortDropdown from '@/components/SortDropdown.vue'

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

/**
 * 排序变更：把组件算好的新状态写回共享 store.sort，
 * 并通知父页面按各自筛选场景重新加载列表。
 * （「下一状态」的计算已收拢到 SortDropdown 组件内）
 * @param {{by: string, order: string, random: boolean}} next - 新的排序状态
 */
function onSortChange(next) {
  store.sort = next
  emit('sortChange')
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
/* 排序按钮与左侧结果数之间的间距（其余排序样式已随组件迁至 SortDropdown.vue） */
.statusbar :deep(.sort-btn) { margin-right: 14px; }
/* 状态栏主体：统一面板样式（与标签面板同圆角，见 --r-tag） */
.statusbar {
  display: flex; align-items: center;
  padding: 8px 14px;
  margin: 10px 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-tag);
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
   替换原实心红/绿（EP 默认冷色调与暖纸白+墨黑+品牌红配色冲突） */
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
