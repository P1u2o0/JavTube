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
// 引入 Element Plus 的所有图标组件
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

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

// 遍历并全局注册所有 Element Plus 图标组件
// 这样在模板中可以直接使用图标组件名引用图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

// 将应用挂载到 index.html 中 id 为 "app" 的 DOM 元素上
app.mount('#app')
