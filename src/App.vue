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
