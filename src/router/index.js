/**
 * ============================================================
 * 文件名：index.js
 * 功能：Vue Router 路由配置。定义应用所有页面路由，
 *      使用 Hash 模式（适配 Electron 环境）。
 *      所有路由组件均采用懒加载（动态 import）以优化首屏性能。
 * 依赖：vue-router（createRouter, createWebHashHistory）
 * ============================================================
 */
import { createRouter, createWebHashHistory } from 'vue-router'

// 路由表定义
const routes = [
  // 首页 - 应用启动后的默认页面（当前为占位页）
  { path: '/', component: () => import('@/views/Home.vue'), meta: { title: '首页' } },

  // 片库 - 影片管理主界面，支持标签筛选、批量操作等
  { path: '/library', component: () => import('@/views/Library.vue'), meta: { title: '片库' } },

  // 收藏 - 仅展示已收藏的影片
  { path: '/favorite', component: () => import('@/views/Favorite.vue'), meta: { title: '喜欢' } },

  // 观看记录 - 按播放时间倒序展示观看历史
  { path: '/history', component: () => import('@/views/History.vue'), meta: { title: '观看记录' } },

  // 女优管理 - 管理女优信息、查看参演影片
  { path: '/actress', component: () => import('@/views/Actress.vue'), meta: { title: '女优' } },

  // 网址导航 - 管理收藏的网址链接
  { path: '/website', component: () => import('@/views/Website.vue'), meta: { title: '网址' } },

  // 设置 - 基础设置、标签分类、数据库管理、关于
  { path: '/settings', component: () => import('@/views/Settings.vue'), meta: { title: '设置' } },

  // 影片详情 - 展示单部影片完整信息，:id 为路由参数，props: true 将参数作为 props 传入
  { path: '/detail/:id', component: () => import('@/views/Detail.vue'), meta: { title: '详情' }, props: true }
]

// 创建路由实例，使用 Hash 模式（Electron 应用中避免文件协议路径冲突）
const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
