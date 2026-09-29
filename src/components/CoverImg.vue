<!--
  文件名：CoverImg.vue
  所属模块：公共组件
  功能描述：统一的图片展示组件，负责「加载失败自动回落」这一全站重复逻辑。
           背景（2026-09-28 代码审计）：封面/头像/预览图的 <img> 散落在 9 个文件里，
           其中只有 4 处写了 @error 兜底，坏图的地方会显示成系统的破图图标（很难看且
           无法自查）；而且靠 watch(cover) 复位错误态的写法在「修复失效图片」这类
           **写回同一路径** 的场景下不会复位（URL 才带版本号、字符串没变）。

           本组件把三件事收口：
             ① @error → 渲染占位（默认图标，可用 #fallback 插槽自定义）；
             ② src 变化（含 ?v= 版本号变化）→ 自动重试加载；
             ③ 加载成功后清除错误态。
-->
<template>
  <!-- 显式把父级传入的 class/style/title 等落到 img 上：
       本组件模板有两个分支（img / 占位），属于 fragment 根，Vue 不会自动继承属性；
       若不做这层转发，父组件写在 <CoverImg class="x"> 上的类不会生效。
       inheritAttrs:false + v-bind="$attrs" 保证与直接写 <img> 的外观完全一致。 -->
  <img v-if="!broken && src" v-bind="$attrs" :src="src" :alt="alt"
       :loading="lazy ? 'lazy' : 'eager'" decoding="async"
       @error="broken = true" @load="broken = false" />
  <slot v-else name="fallback">
    <span class="ci-fallback" :style="{ width: w, height: h }">
      <AppIcon name="image" :size="iconSize" />
    </span>
  </slot>
</template>

<script setup>
import { ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'

// 不自动继承属性：由上面的 v-bind="$attrs" 精确转发到 img（见模板注释）
defineOptions({ inheritAttrs: false })

// ★ 必须把 defineProps 的返回值赋给变量：脚本里用到了 props.src（下面的 watch），
// 而 <script setup> 里 defineProps 不赋值时并不会注入 props 变量 → 运行期
// ReferenceError: props is not defined，watch 直接失效（「URL 变化自动重试」这个核心行为
// 从未生效过，组件其他部分靠模板自动解包所以看起来正常）。2026-09-29 审计发现并修正。
const props = defineProps({
  src: { type: String, default: '' },
  alt: { type: String, default: '' },
  /** 是否懒加载（列表里的图建议开，首屏关键图可关） */
  lazy: { type: Boolean, default: true },
  /** 占位符尺寸（不传则由父级 CSS 决定） */
  w: { type: String, default: '' },
  h: { type: String, default: '' },
  iconSize: { type: Number, default: 20 }
})

// 加载失败态
const broken = ref(false)
// src 变化（含刮削/修复后带上的 ?v= 版本号）就重新给一次机会 —— 这是「修复失效图片」在
// 列表里也能立刻生效的关键：修复写回的是同一路径，只有版本号会变。
watch(() => props.src, () => { broken.value = false }, { immediate: true })
</script>

<style scoped>
/* 占位：居中一个图标，尺寸跟随父容器（父级若未限定宽高则由 w/h 兜底） */
.ci-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 24px;
  background: var(--surface-2);
  color: var(--muted);
}
</style>
