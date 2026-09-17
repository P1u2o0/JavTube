/**
 * ============================================================
 * 文件名：index.js
 * 功能：Vue Router 路由配置。定义应用所有页面路由，
 *      使用 Hash 模式（适配 Electron 环境）。
 *      所有路由组件均采用静态引入（非懒加载）：桌面应用从本地磁盘加载，
 *      拆包带来的体积收益远小于首次切换页面时的模块加载延迟，
 *      静态引入可让导航切换立即渲染，避免"点击后卡一下"的观感。
 * 依赖：vue-router（createRouter, createWebHashHistory）
 * ============================================================
 */
import { createRouter, createWebHashHistory } from 'vue-router'

// 引入各页面视图组件（静态引入，避免首次切换时的动态加载延迟）
import Home from '@/views/Home.vue'
import Library from '@/views/Library.vue'
import Favorite from '@/views/Favorite.vue'
import History from '@/views/History.vue'
import Actress from '@/views/Actress.vue'
import Detail from '@/views/Detail.vue'
import ActorFilms from '@/views/ActorFilms.vue'

// 路由表定义
const routes = [
  // 首页 - 应用启动后的默认页面（当前为占位页）
  { path: '/', component: Home, meta: { title: '首页' } },

  // 片库 - 影片管理主界面，支持标签筛选、批量操作等
  { path: '/library', component: Library, meta: { title: '片库' } },

  // 收藏 - 仅展示已收藏的影片
  { path: '/favorite', component: Favorite, meta: { title: '喜欢' } },

  // 观看记录 - 按播放时间倒序展示观看历史
  { path: '/history', component: History, meta: { title: '观看记录' } },

  // 女优管理 - 管理女优信息、查看参演影片
  { path: '/actress', component: Actress, meta: { title: '女优' } },

  // 影片详情 - 展示单部影片完整信息，:id 为路由参数，props: true 将参数作为 props 传入
  { path: '/detail/:id', component: Detail, meta: { title: '详情' }, props: true },

  // 演员影片页（2026-09-14）- 某演员出演的全部影片，:name 为演员名
  { path: '/actor/:name', component: ActorFilms, meta: { title: '演员' }, props: true }
]

// 创建路由实例，使用 Hash 模式（Electron 应用中避免文件协议路径冲突）
const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
