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

  // 弹窗遮罩同步到窗口按钮区（2026-09-15）：
  // titleBarOverlay 属窗口装饰层、位于页面之上，页面内的 .el-overlay 盖不到它，
  // 所以弹窗打开/关闭时通知主进程切换该区域配色，避免「整屏压暗、唯独右上角仍发白」。
  let titleBarDimmed = false
  /**
   * 是否存在「可见的」弹窗遮罩。
   * 注意：Element Plus 的 el-dialog 关闭后 overlay 元素会留在 DOM 里（display:none），
   * 因此不能只判断存在性 —— 否则关掉弹窗后会被误判为仍在遮罩态，窗口按钮一直发黑。
   */
  const hasVisibleOverlay = () => Array.from(document.querySelectorAll('.el-overlay')).some((el) => {
    const st = getComputedStyle(el)
    return st.display !== 'none' && st.visibility !== 'hidden'
  })
  const syncTitleBar = () => {
    const next = hasVisibleOverlay()
    if (next === titleBarDimmed) return                     // 状态未变则跳过，避免频繁 IPC
    titleBarDimmed = next
    // 遮罩态用 EP 遮罩同值同材质（--el-overlay-color-lighter = #00000080，半透明黑）：
    // 之前写不透明墨黑 #1d1c1a，视觉上是一块死黑，与页面遮罩（半透明、内容隐约可见）对不上。
    // 半透明色会与窗口底色叠加，观感与页面遮罩保持一致。
    window.api?.setTitleBarOverlay?.(next
      ? { color: 'rgba(0, 0, 0, 0.5)', symbolColor: '#ffffff' }   // 遮罩态：半透明黑 + 白符号
      : { color: '#ffffff', symbolColor: '#22211f' })             // 常态：白底 + 墨黑符号（与顶栏一致）
  }
  // 先同步一次，确保初始态为「白底墨符号」
  syncTitleBar()
  // 监听范围必须同时包含 childList 与 attributes：
  //   - 弹窗挂载/卸载 → childList
  //   - 遮罩显隐（EP 通过改 style/class 切换 display）→ attributes
  // 若只监听 childList，会漏掉「遮罩从可见变隐藏」这一步，
  // 导致打开过一次弹窗后永远停在遮罩态（窗口按钮一直发黑）。
  const mo = new MutationObserver(syncTitleBar)
  mo.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class']   // 只关心这两个，控制开销
  })
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
