<!--
  文件名：TopNav.vue
  所属模块：公共组件 / 顶部导航栏
  功能描述：应用的顶部导航栏组件，包含 Logo、页面导航标签（首页、片库、喜欢、观看记录）、
           搜索框、导入按钮和设置入口。通过 router-link 实现页面路由跳转，
           搜索功能调用全局搜索工具函数，导入按钮打开添加影片对话框。
  视觉规范：图标统一使用 AppIcon；激活标签以底部墨黑指示条标识；
           所有颜色/圆角/阴影均取自 global.css 设计令牌。
-->
<template>
  <!-- 顶部导航栏主体 -->
  <div class="topnav">
    <!-- 左侧区域：Logo + 导航标签 -->
    <div class="left">
      <!-- Logo 图标，点击跳转到片库页面 -->
      <div class="logo" @click="goLibrary">
        <img src="/app-icon.png" class="app-icon" alt="JavTube" />
      </div>
      <!-- 导航标签区域 -->
      <nav class="tabs">
        <router-link to="/" class="tab" active-class="active" :class="{ active: route.path === '/' }">
          <AppIcon name="home" :size="19" />
          <span>首页</span>
        </router-link>
        <router-link to="/library" class="tab" active-class="active">
          <AppIcon name="library" :size="19" />
          <span>片库</span>
        </router-link>
        <router-link to="/favorite" class="tab" active-class="active">
          <AppIcon name="heart" :size="19" />
          <span>喜欢</span>
        </router-link>
        <router-link to="/history" class="tab" active-class="active">
          <AppIcon name="history" :size="19" />
          <span>观看记录</span>
        </router-link>
      </nav>
    </div>

    <!-- 右侧区域：搜索框 + 导入按钮 + 设置按钮 -->
    <div class="right">
      <!-- 搜索框区域 -->
      <div class="search-box">
        <input v-model="q" class="search-input" type="text" placeholder="搜索番号、标题、女优…"
               @keyup.enter="onSearch" />
        <button class="search-btn" @click="onSearch" aria-label="搜索">
          <AppIcon name="search" :size="17" />
        </button>
      </div>
      <!-- 导入按钮，点击打开添加影片对话框 -->
      <button class="add-btn" @click="onAdd">
        <AppIcon name="import" :size="16" />
        <span>导入</span>
      </button>
      <!-- 设置按钮，点击跳转到设置页面 -->
      <el-tooltip content="设置" placement="bottom">
        <button class="settings-btn" :class="{ 'is-active': route.path === '/settings' }" @click="goSettings" aria-label="设置">
          <AppIcon name="settings" :size="18" />
        </button>
      </el-tooltip>
    </div>
  </div>

  <!-- 添加影片对话框（必须挂在根模板里才能显示） -->
  <AddMovieDialog v-model="showAdd" @created="onCreated" />
</template>

<script setup>
// 引入 Vue 的响应式 API
import { ref } from 'vue'
// 引入 Vue Router 的路由实例和当前路由信息
import { useRouter, useRoute } from 'vue-router'
// 引入 Element Plus 的消息提示组件
import { ElMessage } from 'element-plus'
// 引入影片数据仓库（Pinia store）
import { useMoviesStore } from '@/store/movies'
// 引入添加影片对话框组件
import AddMovieDialog from '@/components/AddMovieDialog.vue'
// 引入统一图标组件
import AppIcon from '@/components/AppIcon.vue'

// 获取路由实例，用于编程式导航跳转
const router = useRouter()
// 获取当前路由信息，用于判断当前页面路径
const route = useRoute()
// 获取影片数据仓库实例
const store = useMoviesStore()

// 搜索关键字，双向绑定到搜索输入框
const q = ref('')
// 控制添加影片对话框的显示/隐藏状态
const showAdd = ref(false)

// 跳转到片库页面
function goLibrary() { router.push('/library') }
// 跳转到设置页面
function goSettings() { router.push('/settings') }
// 打开添加影片对话框
function onAdd() { showAdd.value = true }

// 影片添加成功后的回调：重新加载标签库和影片列表
// 触发时机：AddMovieDialog 组件 emit('created') 事件时
async function onCreated() {
  // 重新加载数据库中所有标签
  await store.loadAllDbTags()
  // 重置分页为第一页
  store.page = 1
  // 清空当前影片列表
  store.movies = []
  // 重新加载影片数据（非追加模式，覆盖已有列表）
  await store.loadMovies({ append: false })
}

// 搜索处理函数：跳转到片库并携带搜索关键词
// 2026-09-09 按用户要求：搜索始终展示结果列表页（哪怕只有一条匹配），
// 不再唯一结果直达详情；列表由片库页按 q 参数过滤（番号/片名/标签模糊匹配）
function onSearch() {
  const kw = q.value.trim()
  if (!kw) { ElMessage.info('请输入搜索关键词'); return }
  router.push({ path: '/library', query: { q: kw } })
}
</script>

<style scoped>
/* 顶部导航栏主体：左右两端对齐，底部分隔发丝线 */
.topnav {
  display: flex; align-items: stretch; justify-content: space-between;
  padding: 0 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  height: 60px;
  flex-shrink: 0;
}
/* 左侧区域容器 */
.left { display: flex; align-items: center; gap: 28px; }
/* Logo 容器，可点击 */
.logo { display: flex; align-items: center; cursor: pointer; }
/* 应用图标样式 */
.app-icon { height: 34px; width: auto; object-fit: contain; border-radius: 9px; }
/* 导航标签容器：撑满高度，让激活指示条贴合导航栏底边 */
.tabs { display: flex; align-items: stretch; gap: 4px; height: 100%; }
/* 单个导航标签 */
.tab {
  font-size: 14px; color: var(--muted); position: relative; cursor: pointer;
  padding: 0 12px;
  display: flex; align-items: center; gap: 6px;
  text-decoration: none;
  transition: color var(--dur-fast) ease;
}
.tab:hover { color: var(--text); }
/* 激活状态标签 */
.tab.active { color: var(--primary); font-weight: 600; }
/* 激活状态底部指示条：贴齐导航栏底边 */
.tab.active::after {
  content: ''; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 3px;
  background: var(--primary); border-radius: 3px 3px 0 0;
}
/* 右侧区域容器 */
.right { display: flex; align-items: center; gap: 10px; }
/* 搜索框容器：胶囊形 */
.search-box {
  display: flex; align-items: center;
  width: 260px; height: 38px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-pill);
  overflow: hidden;
  background: var(--surface);
  transition: border-color var(--dur-fast) ease, box-shadow var(--dur-fast) ease;
}
/* 聚焦时整框高亮 */
.search-box:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(29, 28, 26, .08);
}
/* 搜索输入框 */
.search-input {
  flex: 1; border: none; outline: none;
  padding: 0 4px 0 16px; height: 100%;
  font-size: 13.5px; color: var(--text);
  background: transparent;
  font-family: var(--font-body);
}
.search-input::placeholder { color: var(--muted); }
/* 搜索按钮 */
.search-btn {
  flex-shrink: 0; width: 42px; height: 100%;
  border: none; background: transparent;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--text-2);
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
}
.search-btn:hover { background: var(--surface-2); color: var(--text); }
/* 导入按钮：墨黑胶囊 */
.add-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 0 16px; height: 38px;
  border: none; border-radius: var(--r-pill);
  background: var(--primary); color: #fff;
  font-size: 13.5px; font-weight: 500; cursor: pointer;
  transition: background var(--dur-fast) ease, transform var(--dur-fast) ease;
}
.add-btn:hover { background: var(--primary-hover); }
.add-btn:active { transform: scale(0.97); }
/* 设置按钮：圆形描边 */
.settings-btn {
  width: 38px; height: 38px;
  border: 1px solid var(--border-strong); border-radius: 50%;
  background: var(--surface); color: var(--muted);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: all var(--dur-fast) ease;
}
.settings-btn:hover { background: var(--surface-2); color: var(--text); }
/* 设置按钮激活状态（当前处于设置页面时） */
.settings-btn.is-active { color: var(--primary); border-color: var(--primary); }
</style>
