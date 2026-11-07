<!--
  文件名：SortDropdown.vue
  所属模块：公共组件 / 排序
  功能描述：影片列表的排序下拉按钮 —— 选择排序字段、点击当前字段切换正序/倒序、
           或切到「随机排序」。

  背景：这段 UI 原先在 StatusBar.vue（片库/收藏/历史共用）与 ActorFilms.vue（演员影片页）
        各内联一份：模板 17 行 + sortLabel/sortArrow 两个 computed + onSortCommand 状态推进
        + 3 条样式，共约 45 行完全重复。任何排序字段增减都要改两处。

  契约（受控组件）：父级传入当前排序状态 by/order/random，组件内部算出「下一状态」后
  以 change 事件抛出，由父级写回自己的状态源 ——
    · StatusBar 写回 store.sort（Pinia 共享状态）
    · ActorFilms 写回本地 sort ref（该页有自己的筛选/分页场景）
  这样组件不依赖任何具体状态容器，两个调用方的差异被收敛到一行回调里。
-->
<template>
  <el-dropdown trigger="click" @command="onCommand">
    <el-button class="sort-btn">
      <AppIcon v-if="random" name="shuffle" :size="14" style="margin-right:5px" />
      <span>{{ label }}</span>
      <span v-if="arrow" class="sort-dir" :class="order === 'ASC' ? 'asc' : 'desc'">
        <AppIcon name="back" :size="12" />
      </span>
    </el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <!-- 选项由调用方给（options 默认是影片列表那 5 个字段；观看记录页换成「播放次数/播放时间」） -->
        <el-dropdown-item
          v-for="o in options" :key="o.value" :command="o.value"
          :class="{ 'sort-active': !random && by === o.value }"
        >{{ o.label }}</el-dropdown-item>
        <el-dropdown-item v-if="showRandom" command="random" divided :class="{ 'sort-active': random }">随机排序</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup>
import { computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'

// 当前排序状态（受控）：字段 / 方向 / 是否随机
const props = defineProps({
  by: { type: String, default: 'tjrq' },
  order: { type: String, default: 'DESC' },
  random: { type: Boolean, default: false },
  /**
   * 下拉里可选的排序字段：[{ value, label }]。
   * 默认是影片列表（片库/喜欢）那 5 个字段；**观看记录页传自己的两个**
   * （播放次数 play_count / 播放时间 play_time）—— 那一页只按观看行为排序才有意义。
   * value 必须在后端 SORTABLE_COLUMNS 白名单里，否则会被后端回退成 tjrq（排序静默失效）。
   */
  options: {
    type: Array,
    default: () => [
      { value: 'tjrq', label: '添加日期' },
      { value: 'fxrq', label: '发行日期' },
      { value: 'want', label: '想看人数' },
      { value: 'watched', label: '看过人数' },
      { value: 'score', label: '评分' }
    ]
  },
  /** 是否提供「随机排序」（观看记录页关掉：按观看行为排序才有意义） */
  showRandom: { type: Boolean, default: true }
})

// change：算出下一状态后抛出，交由父级写回
const emit = defineEmits(['change'])

// 排序按钮文案：随机模式显示「随机排序」，否则显示当前字段名
// 文案表直接来自 options —— 新增字段只要调用方传对 { value, label }，按钮文案就不会说错
// （历史上是硬编码表，观看记录页用 play_time 时按钮会 fallback 成「添加日期」，2026-09-28 审计）
const label = computed(() => {
  if (props.random) return '随机排序'
  const hit = props.options.find(o => o.value === props.by)
  return hit ? hit.label : (props.options[0]?.label || '添加日期')
})
// 方向箭头（随机模式无方向）
const arrow = computed(() => (props.random ? '' : (props.order === 'ASC' ? '↑' : '↓')))

/**
 * 排序命令处理：
 * - 点击当前字段：切换正序/倒序
 * - 点击其他字段：默认降序
 * - 随机：进入随机模式（保留当前字段，退出时回到同一字段）
 * @param {string} cmd - el-dropdown 的 command（字段名或 'random'）
 */
function onCommand(cmd) {
  let next
  if (cmd === 'random') {
    // seed 决定「随机排序」的具体顺序：后端用 (id*seed) % 大质数 做置换，
    // 同一 seed 分页顺序稳定（否则每翻一页重新随机，会出现重复/漏片）；重新点随机即换 seed
    next = { by: props.by, order: props.order, random: true, seed: Math.floor(Math.random() * 999983) + 1 }
  } else if (props.by === cmd && !props.random) {
    next = { by: cmd, order: props.order === 'DESC' ? 'ASC' : 'DESC', random: false }
  } else {
    next = { by: cmd, order: 'DESC', random: false }
  }
  emit('change', next)
}
</script>

<style scoped>
/* 排序方向箭头：左箭头旋转为上/下，带过渡 */
.sort-dir { display: inline-flex; margin-left: 5px; }
.sort-dir :deep(svg) { transition: transform var(--dur-fast) var(--ease-out); }
.sort-dir.desc :deep(svg) { transform: rotate(-90deg); }  /* 左箭头 → 下 */
.sort-dir.asc :deep(svg) { transform: rotate(90deg); }   /* 左箭头 → 上 */
/* 排序按钮：圆角与所在筛选区（标签面板/状态栏）统一，覆盖 global.css 的 .el-button 全圆规则 */
.sort-btn {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  border-radius: var(--r-tag) !important;
}
/* 下拉菜单当前排序项高亮 */
.sort-active { color: var(--accent); font-weight: 600; }
</style>
