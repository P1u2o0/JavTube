<!--
  文件名：TagChip.vue
  所属模块：公共组件 / 标签芯片
  功能描述：单个标签芯片（药丸样式）的基础展示组件，显示标签文本并支持选中状态。
           点击时触发 click 事件，由父组件处理选中/取消选中的逻辑。
           作为 TagFilter 等组件的子单元使用。
-->
<template>
  <!-- 标签芯片主体，点击时触发 click 事件 -->
  <span class="tag-pill" :class="{ selected }" @click="$emit('click')">
    {{ label }}
  </span>
</template>

<script setup>
// 组件 props 定义
// - label: 标签显示文本（必填）
// - selected: 是否处于选中状态（默认 false）
defineProps({
  label: { type: String, required: true },
  selected: { type: Boolean, default: false }
})

// 定义 emit 事件：
// - click: 点击标签芯片时触发，由父组件处理选中逻辑
defineEmits(['click'])
</script>

<style scoped>
/* 标签芯片默认样式：药丸形、暖灰底 */
.tag-pill {
  display: inline-block;
  padding: 4px 13px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: var(--fs-base);
  line-height: 1.6;
  margin: 3px 6px 3px 0;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease,
              transform var(--dur-fast) ease;
  border: none;
}
/* 悬停时背景加深 */
.tag-pill:hover {
  background: var(--surface-3);
  color: var(--text);
}
/* 按压反馈 */
.tag-pill:active { transform: scale(0.96); }
/* 选中状态：墨黑底白字 */
.tag-pill.selected {
  background: var(--primary);
  color: #fff;
}
/* 选中状态悬停：背景稍浅 */
.tag-pill.selected:hover {
  background: var(--primary-hover);
  color: #fff;
}
</style>
