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

// 组件 props 定义
// - total: 影片搜索结果总数
const props = defineProps({ total: Number })

// 定义 emit 事件：
// - toggle: 多选模式开关变化时触发，参数为新的开关状态
// - batchDelete: 批量删除按钮点击时触发
// - batchFav: 批量收藏/取消收藏时触发，参数为 true(收藏) 或 false(取消)
// - batchScrape: 批量刮削按钮点击时触发
const emit = defineEmits(['toggle', 'batchDelete', 'batchFav', 'batchScrape'])

// 获取 store 实例
const store = useMoviesStore()

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

// 反选函数：反转当前页面影片的选中状态
// 已选中的取消选中，未选中的加入选中
function invert() {
  // 获取当前页面所有影片 ID
  const pageIds = store.movies.map(m => m.id)
  // 复制当前已选中列表
  const newSel = [...store.selectedIds]
  // 遍历当前页面影片，反转选中状态
  for (const id of pageIds) {
    const i = newSel.indexOf(id)
    // 已选中则移除
    if (i >= 0) newSel.splice(i, 1)
    // 未选中则添加
    else newSel.push(id)
  }
  store.selectedIds = newSel
}
</script>

<style scoped>
/* 状态栏主体：统一面板样式 */
.statusbar {
  display: flex; align-items: center;
  padding: 8px 14px;
  margin: 10px 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  font-size: 13px;
  color: var(--text-2);
}
/* 左侧结果数量中的粗体数字：展示字 + 等宽数字 */
.left b {
  color: var(--primary);
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 15px;
  margin: 0 3px;
}
/* 批量操作区域：紧跟在「选择」开关左侧（不自带 auto 推力） */
.batch { display: flex; align-items: center; gap: 6px; padding-right: 12px; flex-wrap: wrap; }
/* 已选中数量提示 */
.sel-count { color: var(--muted); font-size: 12px; margin-right: 2px; }
/* 右侧多选开关区域：margin-left:auto 始终把开关推到最右——
   未开批量时开关独占贴右；开启后批量按钮组出现在其左侧，开关位置不动 */
.right { display: flex; align-items: center; margin-left: auto; flex-shrink: 0; }
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
