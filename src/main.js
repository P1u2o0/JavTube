/**
 * @file main.js
 * @module src/main
 * @description Vue 渲染进程入口文件。负责创建 Vue 应用实例，注册全局插件和组件，
 *              并将应用挂载到 DOM。是整个前端应用的启动入口。
 * @dependencies vue, pinia, element-plus, vue-router, @element-plus/icons-vue
 * @keyAPI createApp(), app.use(), app.component(), app.mount()
 */

// 引入 Vue 核心的 createApp 函数
import { createApp } from 'vue'
// 引入 Pinia 状态管理库
import { createPinia } from 'pinia'
// 引入 Element Plus UI 组件库
import ElementPlus from 'element-plus'
// 引入 Element Plus 的样式文件
import 'element-plus/dist/index.css'
// 引入 Element Plus 的中文语言包
import zhCn from 'element-plus/es/locale/lang/zh-cn'

// 引入根组件 App
import App from './App.vue'
// 引入路由配置
import router from './router'
// 引入全局样式
import './styles/global.css'

// 创建 Vue 应用实例，以 App 为根组件
const app = createApp(App)

// 注册 Pinia 状态管理（用于全局状态管理）
app.use(createPinia())

// 注册 Vue Router（用于前端路由导航）
app.use(router)

// 注册 Element Plus，并设置中文语言环境
app.use(ElementPlus, { locale: zhCn })

// 注：原实现用 `import * as ElementPlusIconsVue` 遍历注册了全部图标组件（约 300 个），
// 但本项目图标全部走自研 AppIcon.vue（内联 SVG），模板里从未使用过 `el-icon-*`
// （2026-09-21 全仓 grep 确认）→ 注册属纯开销，已移除：少解析一个图标包、少注册 300 个组件。

// 将应用挂载到 index.html 中 id 为 "app" 的 DOM 元素上
app.mount('#app')
