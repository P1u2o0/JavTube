<!--
  文件名：SortBar.vue
  所属模块：公共组件 / 排序栏
  功能描述：影片列表的排序工具栏组件，提供排序方式选择（番号、评分、添加日期、发行日期）、
           随机排序切换和重置功能。直接操作 Pinia store 中的排序状态，
           通过 emit 通知父组件排序已变更或已重置。
-->
<template>
  <!-- 排序栏主体 -->
  <div class="sortbar">
    <!-- 排序标签文字 -->
    <span class="label">排序</span>
    <!-- 排序方式下拉选择框 -->
    <el-select v-model="store.sort.by" size="small" class="sort-select" @change="onSort">
      <el-option label="番号" value="ph" />
      <el-option label="评分" value="pfs" />
      <el-option label="添加日期" value="tjrq" />
      <el-option label="发行日期" value="fxrq" />
    </el-select>
    <!-- 随机排序按钮：激活时显示为主按钮样式 -->
    <el-button size="small" :type="store.sort.random ? 'primary' : 'default'" @click="random">
      <AppIcon name="shuffle" :size="14" style="margin-right:4px" />随机
    </el-button>
    <!-- 重置按钮 -->
    <el-button size="small" @click="onReset">
      <AppIcon name="reset" :size="14" style="margin-right:4px" />重置
    </el-button>
  </div>
</template>

<script setup>
// 引入影片数据仓库（Pinia store）
import { useMoviesStore } from '@/store/movies'
// 引入统一图标组件
import AppIcon from '@/components/AppIcon.vue'
// 获取 store 实例
const store = useMoviesStore()

// 定义 emit 事件：
// - change: 排序方式变更时触发，通知父组件重新加载列表
// - reset: 重置排序时触发，通知父组件恢复默认状态
const emit = defineEmits(['change', 'reset'])

// 排序方式变更处理函数
// 关闭随机排序模式，并通知父组件排序已变更
// 触发时机：用户在下拉框中选择新的排序方式
function onSort() {
  store.sort.random = false
  emit('change')
}

// 随机排序切换函数
// 切换随机排序的开关状态，并通知父组件
// 触发时机：用户点击"随机"按钮
function random() {
  store.sort.random = !store.sort.random
  emit('change')
}

// 重置处理函数
// 调用 store 的 resetAll 重置所有筛选和排序状态，并通知父组件
// 触发时机：用户点击"重置"按钮
function onReset() {
  store.resetAll()
  emit('reset')
}
</script>

<style scoped>
/* 排序栏主体：统一面板样式（卡片圆角 + 发丝边框） */
.sortbar {
  display: flex; align-items: center; gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 8px 14px;
  margin-bottom: 10px;
}
/* "排序"标签文字样式 */
.label { color: var(--text-2); font-size: 13px; font-weight: 600; margin-right: 2px; }
/* 排序下拉框宽度 */
.sort-select {
  width: 110px !important;
}
/* 下拉框内部 wrapper 最小高度 */
.sort-select :deep(.el-select__wrapper) {
  min-height: 28px;
}
</style>
