<!--
  @file App.vue
  @module src/App
  @description JavTube 应用的根组件。定义了整体布局结构：顶部导航栏 + 主内容区域。
               主内容区域使用 Vue Router 的 <router-view> 渲染当前路由对应的页面组件，
               并添加了路由切换时的淡入淡出过渡动画。
               在组件挂载时，会通过 IPC 获取数据目录路径并初始化应用状态（设置、标签分类、影片列表）。
  @dependencies TopNav.vue (顶部导航), Vue Router, Pinia (useMoviesStore), dataDirRef (全局数据目录)
-->
<template>
  <!-- 页面根容器 -->
  <div class="page-container">
    <!-- 顶部导航栏组件 -->
    <TopNav />
    <!-- 主内容区域 -->
    <div class="main-content">
      <!-- 路由出口：渲染当前匹配的路由组件 -->
      <!-- 说明：这里刻意不使用 <transition mode="out-in">。
           out-in 模式必须等待旧页面的离场动画帧回调完成后才会挂载新页面，
           而 Electron 在 --disable-gpu 等环境下帧回调可能被节流/暂停，
           一旦过渡未结束，新页面将永远不挂载，表现为「点击导航后一片空白」。
           改为纯 CSS 入场动画（见 global.css .route-anim），动画不参与渲染流程，
           因此不存在死锁风险。 -->
      <router-view v-slot="{ Component, route }">
        <component :is="Component" :key="route.path" class="route-anim" />
      </router-view>
    </div>
  </div>
</template>

<script setup>
// 引入顶部导航栏组件
import TopNav from '@/components/TopNav.vue'
// 引入 Vue 的 onMounted 生命周期钩子
import { onMounted } from 'vue'
// 引入影片状态管理 Store
import { useMoviesStore } from '@/store/movies'
// 引入全局数据目录引用（用于封面图等资源的路径解析）
import { dataDirRef } from '@/utils/global'

// 创建影片状态管理实例
const store = useMoviesStore()

// 组件挂载后的初始化逻辑
onMounted(async () => {
  // 先设置全局 dataDir，用于封面图相对路径解析（必须在加载影片之前）
  if (window.api) {
    try {
      // 渲染进程 → 主进程：获取数据目录路径
      const dir = await window.api.getDataDir()
      // 设置响应式引用和全局变量
      dataDirRef.value = dir
      window.__dataDir = dir
    } catch {}
  }
  // 加载设置、标签分类、影片列表
  // 调用 Store 的初始化方法，按需加载应用数据
  await store.initIfNeeded()

  // 窗口打开/页面加载后，浏览器会自动聚焦首个可聚焦元素（顶部导航的「首页」），
  // 触发 :focus-visible 描边（按钮外一圈深色方框，需点别处才消失）。
  // 这里清除该「程序性初始焦点」；一旦用户已交互则不再干预（键盘 Tab 导航照常显示焦点环）。
  let userInteracted = false
  const markInteracted = () => { userInteracted = true }
  window.addEventListener('pointerdown', markInteracted, { once: true })
  window.addEventListener('keydown', markInteracted, { once: true })

  // 初始阶段（用户尚未交互）出现的任何焦点一律清除 ——
  // 这样无论自动聚焦发生在 rAF / load / 重载后的哪一帧，都能被拦住。
  // 用户一旦交互（点击/按键），本逻辑即失效，键盘导航的焦点环恢复常态。
  window.addEventListener('focusin', (e) => {
    if (userInteracted) return
    const el = e.target
    if (el instanceof HTMLElement && el !== document.body) el.blur()
  })
  window.addEventListener('focus', () => {
    // 窗口重新获得焦点时同样处理（切回应用时可能带出聚焦态）
    if (userInteracted) return
    const el = document.activeElement
    if (el instanceof HTMLElement && el !== document.body) el.blur()
  })

  // 注（2026-09-15）：此处原先有一段「弹窗遮罩同步窗口按钮区配色」的逻辑
  // （MutationObserver 监听 .el-overlay → 调 setTitleBarOverlay 切换颜色）。
  // 因 Windows 的 titleBarOverlay 忽略 alpha、且需处理 overlay 常驻 DOM 的可见性判断，
  // 复杂度高且效果不佳，已改为「遮罩只覆盖顶栏之下的页面区域」（见 global.css），
  // 顶栏与窗口按钮区保持常白，无需任何动态改色。
})
</script>

<!-- 路由入场动画：纯 CSS animation，挂载即播放，不阻塞渲染 -->
<style>
.route-anim {
  animation: route-in 0.18s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes route-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .route-anim { animation: none; }
}
</style>
