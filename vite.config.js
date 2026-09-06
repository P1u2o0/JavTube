/**
 * @file vite.config.js
 * @module vite.config
 * @description Vite 构建配置文件。配置 Vue 插件、路径别名、构建选项，
 *              并包含一个自定义插件用于在开发模式下自动启动 Electron 主进程。
 *              是前端开发与 Electron 集成的核心配置。
 * @dependencies vite, @vitejs/plugin-vue, path, fs, url, child_process
 * @keyAPI defineConfig(), resolve.alias, build.outDir, server.port, spawn()
 */

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve, dirname } from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

// 在 ESM 环境中获取 __dirname（Vite 配置使用 ESM 语法）
const __dirname = dirname(fileURLToPath(import.meta.url))
// Electron 子进程实例引用（开发模式下启动）
let electronProc = null

/**
 * 解析 Electron 可执行文件路径。
 * 尝试从 electron 包的安装位置查找 electron.exe。
 * @returns {string} electron.exe 的绝对路径
 */
function resolveElectronBin() {
  try {
    const p = require.resolve('electron')
    // electron package exposes index.js which returns path to exe
    // 获取 electron 包的目录
    const electronModuleDir = dirname(require.resolve('electron/package.json'))
    // 拼接 electron.exe 路径
    const exe = resolve(electronModuleDir, 'dist', 'electron.exe')
    if (fs.existsSync(exe)) return exe
  } catch {}
  // 回退：从当前目录的 node_modules 中查找
  return resolve(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe')
}

/**
 * 在开发模式下启动 Electron 主进程。
 * 将 Vite 开发服务器 URL 通过环境变量传递给 Electron，使其加载开发服务器页面。
 * @param {string} viteDevUrl - Vite 开发服务器的 URL（如 http://localhost:5173/）
 */
function startElectron(viteDevUrl) {
  const exe = resolveElectronBin()
  if (!fs.existsSync(exe)) {
    console.error('[launch] Cannot find electron.exe at', exe)
    return
  }
  // Electron 主进程入口文件路径
  const mainEntry = resolve(__dirname, 'electron', 'main', 'index.js')
  console.log(`[launch] spawning: ${exe} ${mainEntry}`)
  console.log(`[launch] VITE_DEV_SERVER_URL = ${viteDevUrl}`)
  // 设置环境变量，将开发服务器 URL 传递给 Electron 主进程
  const env = { ...process.env, VITE_DEV_SERVER_URL: viteDevUrl }
  // 启动 Electron 进程，继承标准输入输出
  electronProc = spawn(exe, [mainEntry], { env, stdio: 'inherit' })
  // 监听 Electron 进程退出事件
  electronProc.on('exit', (code) => {
    console.log(`[launch] electron exited code=${code}`)
  })
}

// Vite 配置主入口
export default defineConfig({
  plugins: [
    // Vue 单文件组件插件，支持 .vue 文件的编译
    vue(),
    {
      // 自定义插件：在 Vite 开发服务器启动后自动启动 Electron
      name: 'start-electron-after-vite',
      // 开发服务器配置钩子：监听 HTTP 服务器启动事件
      configureServer(server) {
        server.httpServer?.once('listening', () => {
          // 获取服务器监听地址和端口
          const addr = server.httpServer.address()
          const url = `http://localhost:${addr.port || 5173}/`
          // 延迟 500ms 启动 Electron，确保 Vite 完全就绪
          setTimeout(() => startElectron(url), 500)
        })
      },
      // 生产构建完成后的钩子（预留，可用于触发 electron-builder）
      closeBundle() {
        // 生产构建完成后，这里可以触发 electron-builder
      }
    }
  ],
  // 路径别名配置：@ 指向 src 目录，方便模块导入
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  // 基础路径：使用相对路径，确保 Electron 加载本地文件时资源路径正确
  base: './',
  // 构建配置
  build: {
    outDir: 'dist',       // 输出目录
    emptyOutDir: true     // 构建前清空输出目录
  },
  // 开发服务器配置
  server: { port: 5173 }  // 固定端口 5173
})
