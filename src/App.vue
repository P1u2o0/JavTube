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
// 空闲预热内置播放器用（详见文件末尾 prewarmPlayer 注释）
import Artplayer from 'artplayer'
// 引入 Vue 的 onMounted 生命周期钩子
import { onMounted } from 'vue'
// 引入影片状态管理 Store
import { useMoviesStore } from '@/store/movies'
// 引入全局数据目录引用（用于封面图等资源的路径解析）
import { dataDirRef } from '@/utils/global'
// 失效图片检查/修复（启动自动检查用；设置页按钮共用同一段逻辑）
import { useImageRepair } from '@/composables/useImageRepair'

// 创建影片状态管理实例
const store = useMoviesStore()

// ====== 空闲预热内置播放器（2026-09-30）======
// 背景（CDP 实测，相对「路由切到播放页」的增量）：
//   路由切换 → Player.vue setup 3ms → onMounted 4ms → new Artplayer() 首轮 129ms / 热态 3ms
//   → video 元素出现 137ms → loadedmetadata 239ms → 首帧 241ms
// 也就是说「首次」点播放时，Artplayer 的构造独占约一半耗时：它的一次性开销是
// 注入内置样式表 + 构建控制条 DOM + 首次布局，之后再构造任何实例都只要 3ms。
// 这里在启动流程跑完后的空闲时段构造一个离屏实例并立即销毁，把这份一次性开销
// 提前到「用户还在首页浏览」的时候 —— 首次点播放时构造就是热态的 3ms。
// 注：只是提前付账，不增加总量；放在空闲回调里，且延迟 1.5s 起跑，避免和首屏抢主线程。
let playerPrewarmed = false
function prewarmPlayer() {
  if (playerPrewarmed) return
  // 关闭了内置播放器（设置→播放设置→使用内置播放器=关）就没有预热的意义
  if ((store.settings?.use_builtin_player ?? 'y') === 'n') return
  playerPrewarmed = true
  let box = null
  let art = null
  try {
    box = document.createElement('div')
    box.dataset.jtPrewarm = '1'
    // 离屏 + 不参与交互：不会被看到，也不会挡住/接收任何事件
    box.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;height:360px;pointer-events:none;'
    document.body.appendChild(box)
    // 不给 url：只做 UI 初始化，不触发任何媒体加载
    art = new Artplayer({ container: box, autoplay: false, muted: true, hotkey: false })
  } catch {
    // 预热失败不影响任何功能：首次进播放页照原样付那 129ms
  } finally {
    try { art?.destroy(false) } catch {}
    try { box?.remove() } catch {}
  }
}

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

  // 启动后自动检查失效图片（2026-09-27）：历史版本下载失败会留下打不开的假文件
  // （空文件 / 全零 / 站点拦截页），表现为海报灰色空块、缩略图空白。
  // 设置里「启动时自动检查」默认开（键缺失也按开处理）；延迟几秒避开启动高峰，
  // 静默模式：没坏图就不打扰，修好了才提示一条。
  // 只在「设置确实加载成功」时才自动检查：settings 为空说明设置没拉回来，
  // 这时无法区分「用户关了」和「加载失败」，不擅自跑（2026-09-29 审计）
  const settingsLoaded = Object.keys(store.settings || {}).length > 0
  if (settingsLoaded && store.settings.auto_check_images !== 'n') {
    window.setTimeout(() => {
      useImageRepair().checkAndRepair({ silent: true }).catch(() => {})
    }, 4000)
  }

  // 空闲预热内置播放器（见上方 prewarmPlayer 注释）：延后 1.5s 再登记空闲回调，
  // 避开首屏渲染 + 首屏图片解码的高峰；requestIdleCallback 不可用时退化为定时器。
  const onIdle = window.requestIdleCallback
    ? (cb) => window.requestIdleCallback(cb, { timeout: 3000 })
    : (cb) => window.setTimeout(cb, 1000)
  if (settingsLoaded) window.setTimeout(() => onIdle(prewarmPlayer), 1500)
})
</script>

<!-- 路由入场动画：纯 CSS animation，挂载即播放，不阻塞渲染 -->
<style>
.route-anim {
  /* 时长用 --dur-route（120ms）而不是 --dur-base（220ms）（2026-09-30 性能审计）：
     容器是从 opacity:0 起步的，它的时长**直接等于「点击后屏幕上什么都没有」的时长**。
     实测旧值 220ms 下，切页后前 200ms 可见卡片数为 0/40 —— 用户把这段空白读成"卡了"。
     改用令牌而非裸值，保持与令牌体系一致；只允许继续调短。 */
  animation: route-in var(--dur-route) var(--ease-out) both;
}
@keyframes route-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
/* 减少动态效果：与 global.css 的策略保持一致 —— 只降级"位移"，保留"淡入"这类低强度反馈。
   此前这里是 `animation: none`（连淡入也取消），与全局策略不一致。
   !important 的作用：global.css 的 `* { animation-duration: .01ms !important }` 会覆盖本行，
   必须提升优先级，否则淡入依旧会被压成瞬时。 */
@media (prefers-reduced-motion: reduce) {
  .route-anim { animation: route-in-soft var(--dur-press) var(--ease-out) both !important; }
}
@keyframes route-in-soft {
  from { opacity: 0; }
  to   { opacity: 1; }
}
</style>
