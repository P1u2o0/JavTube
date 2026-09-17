<!--
  ============================================================
  文件名：BackButton.vue
  所属模块：公共组件 / 返回按钮
  功能描述：圆形描边「返回上一页」按钮。
           影片详情页标题行原本内联了这套样式，详情页 → 演员页 / 片库筛选页
           也需要同款，故抽成公共组件，保证三处**样式与尺寸永久一致**。
  视觉：--icon-btn-md 圆形 + 1px 发丝描边 + 悬停浅底 + 按压 0.96 缩放（与软件按钮体系一致）
  交互：优先 router.back()；没有可回退的历史（如直接以该路由启动应用）时跳到 fallback
  ============================================================
-->
<template>
  <button class="round-back" :title="title" :aria-label="title" @click="goBack">
    <AppIcon name="back" :size="iconSize" />
  </button>
</template>

<script setup>
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps({
  // 悬浮提示与无障碍标签
  title: { type: String, default: '返回上一页' },
  // 图标尺寸
  iconSize: { type: Number, default: 16 },
  // 没有可回退历史时的兜底路由
  fallback: { type: String, default: '/' }
})

const router = useRouter()

/**
 * 返回上一页。
 * 直接以某条路由启动应用（或新开窗口）时历史栈里没有上一页，
 * 此时 router.back() 会退出到空白页，故用 history.state.back 判断后走兜底。
 */
function goBack() {
  if (window.history.state?.back) router.back()
  else router.push(props.fallback)
}
</script>

<style scoped>
/* 圆形返回按钮：描边圆钮，与软件按钮体系一致 */
.round-back {
  width: var(--icon-btn-md); height: var(--icon-btn-md);
  flex-shrink: 0;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text-2);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
}
.round-back:hover { background: var(--surface-2); color: var(--text); }
.round-back:active { transform: scale(0.96); transition-duration: var(--dur-press); }
</style>
