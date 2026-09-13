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
      <!-- 刮削进度铃铛：始终显示，角标实时显示待刮削任务总数（排队 + 进行中），点击展开进度面板 -->
      <div class="bell-wrap">
        <button class="bell-btn" :class="{ 'has-task': scrape.todoCount }" @click="bellOpen = !bellOpen" aria-label="刮削进度">
          <AppIcon name="bell" :size="18" />
          <span v-if="scrape.todoCount" class="bell-badge">{{ scrape.todoCount }}</span>
        </button>
        <!-- 刮削进度下拉面板 -->
        <transition name="bell-pop">
          <div v-if="bellOpen" class="bell-panel">
            <div class="bp-head">
              <span>刮削进度</span>
              <button v-if="scrape.failedCount" class="bp-clear" @click="scrape.clear()">清除失败</button>
            </div>
            <div class="bp-list">
              <!-- 正在刮削 -->
              <template v-if="scrape.runningTasks.length">
                <div class="bp-group">正在刮削</div>
                <div v-for="t in scrape.runningTasks" :key="t.key" class="bp-item">
                  <span class="bp-dot running"></span>
                  <div class="bp-main">
                    <div class="bp-title">{{ t.ph }}<template v-if="t.pm"> · {{ t.pm }}</template></div>
                    <div class="bp-sub">刮削中…</div>
                  </div>
                </div>
              </template>
              <!-- 待刮削 -->
              <template v-if="scrape.pendingTasks.length">
                <div class="bp-group">待刮削</div>
                <div v-for="t in scrape.pendingTasks" :key="t.key" class="bp-item">
                  <span class="bp-dot pending"></span>
                  <div class="bp-main">
                    <div class="bp-title">{{ t.ph }}<template v-if="t.pm"> · {{ t.pm }}</template></div>
                    <div class="bp-sub">排队中…</div>
                  </div>
                </div>
              </template>
              <!-- 刮削失败 -->
              <template v-if="scrape.failedTasks.length">
                <div class="bp-group">刮削失败</div>
                <div v-for="t in scrape.failedTasks" :key="t.key" class="bp-item">
                  <span class="bp-dot fail"></span>
                  <div class="bp-main">
                    <div class="bp-title">{{ t.ph }}<template v-if="t.pm"> · {{ t.pm }}</template></div>
                    <div class="bp-sub bp-fail">{{ t.error || '刮削失败' }}</div>
                  </div>
                </div>
              </template>
              <div v-if="!scrape.tasks.length" class="bp-empty">暂无刮削任务</div>
            </div>
          </div>
        </transition>
      </div>
      <!-- 设置按钮，点击弹出设置对话框 -->
      <el-tooltip content="设置" placement="bottom">
        <button class="settings-btn" @click="showSettings = true" aria-label="设置">
          <AppIcon name="settings" :size="18" />
        </button>
      </el-tooltip>
    </div>
  </div>

  <!-- 设置对话框（弹出窗口形式） -->
  <SettingsDialog v-model="showSettings" />

  <!-- 添加影片对话框（必须挂在根模板里才能显示） -->
  <AddMovieDialog v-model="showAdd" @created="onCreated" />
</template>

<script setup>
// 引入 Vue 的响应式 API
import { ref, onMounted, onBeforeUnmount } from 'vue'
// 引入 Vue Router 的路由实例和当前路由信息
import { useRouter, useRoute } from 'vue-router'
// 引入 Element Plus 的消息提示组件
import { ElMessage } from 'element-plus'
// 引入影片数据仓库（Pinia store）
import { useMoviesStore } from '@/store/movies'
import { useScrapeStore } from '@/store/scrape'
// 引入添加影片对话框组件
import AddMovieDialog from '@/components/AddMovieDialog.vue'
// 引入设置对话框组件
import SettingsDialog from '@/components/SettingsDialog.vue'
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
// 控制设置对话框的显示/隐藏状态
const showSettings = ref(false)
// 刮削进度面板显隐
const bellOpen = ref(false)
// 刮削任务 store（角标与面板数据源）
const scrape = useScrapeStore()

// 点击面板外部时收起进度面板
function onDocClick(e) {
  if (bellOpen.value && !e.target.closest('.bell-wrap')) bellOpen.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

// 跳转到片库页面
function goLibrary() { router.push('/library') }
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
/* ====== 刮削进度铃铛 ====== */
.bell-wrap { position: relative; }
.bell-btn {
  position: relative;
  width: 38px; height: 38px;
  border: 1px solid var(--border-strong); border-radius: 50%;
  background: var(--surface); color: var(--muted);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: all var(--dur-fast) ease;
}
.bell-btn:hover { background: var(--surface-2); color: var(--text); }
.bell-btn.has-task { color: var(--accent); border-color: var(--accent); }
/* 红色圆形角标：进行中的刮削数量 */
.bell-badge {
  position: absolute; top: -4px; right: -4px;
  min-width: 17px; height: 17px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--accent);
  color: #fff;
  font-size: 11px; font-weight: 600;
  line-height: 17px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  box-shadow: var(--sh-1);
}
/* 进度面板：铃铛下方右对齐弹出 */
.bell-panel {
  position: absolute; top: 46px; right: 0;
  width: 320px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--sh-3);
  overflow: hidden;
  z-index: 100;
}
.bp-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  font-size: 13px; font-weight: 600; color: var(--text);
}
.bp-clear {
  border: none; background: transparent;
  color: var(--muted); font-size: 12px;
  cursor: pointer;
}
.bp-clear:hover { color: var(--accent); }
.bp-list { max-height: 320px; overflow-y: auto; }
/* 分组标题：正在刮削 / 待刮削 / 刮削失败 */
.bp-group {
  padding: 9px 14px 5px;
  font-size: 11.5px; font-weight: 600; color: var(--muted);
  letter-spacing: 0.03em;
}
.bp-item {
  display: flex; align-items: flex-start; gap: 9px;
  padding: 9px 14px;
  border-bottom: 1px dashed var(--border);
}
.bp-item:last-child { border-bottom: none; }
/* 状态圆点：进行中朱柿红呼吸 / 成功绿 / 失败红 */
.bp-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  margin-top: 5px;
  flex-shrink: 0;
  background: var(--muted);
}
.bp-dot.running { background: var(--accent); animation: bp-pulse 1.2s ease-in-out infinite; }
.bp-dot.pending { background: var(--muted); }
.bp-dot.ok { background: var(--success); }
.bp-dot.fail { background: var(--danger); }
@keyframes bp-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.bp-main { min-width: 0; }
.bp-title {
  color: var(--text); font-size: 13px; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bp-sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
.bp-fail { color: var(--danger); word-break: break-all; }
.bp-ok { color: var(--success); }
.bp-empty { padding: 22px 0; text-align: center; color: var(--muted); font-size: 12.5px; }
/* 面板弹出过渡：向下展开 + 淡入 */
.bell-pop-enter-active, .bell-pop-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.bell-pop-enter-from, .bell-pop-leave-to { opacity: 0; transform: translateY(-6px); }

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
