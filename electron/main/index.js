/**
 * @file index.js
 * @module electron/main
 * @description Electron 主进程入口文件。负责应用启动时序编排：性能开关、数据目录定位与迁移、
 *              数据库初始化、各 IPC 模块注册、窗口创建与生命周期管理。
 *              具体职责已拆分：封面协议 → cover-protocol.js；工具/对话框/刮削 IPC → ipc-utils.js；
 *              影片/女优/网址/设置 IPC → db/ 下各模块。
 * @dependencies electron (app, BrowserWindow, ipcMain), path, fs, ./db/init, ./db/movies, ./db/actress, ./db/websites, ./db/settings, ./ipc-utils, ./cover-protocol
 * @keyAPI app.whenReady(), BrowserWindow, ipcMain.handle(), app.getPath()
 */

// 引入 Electron 核心模块
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

// 引入数据库初始化模块
const { initDb } = require('./db/init')
// 影片 / 女优 / 网址 / 设置 的 IPC 处理器注册函数（各领域独立模块）
const { registerMovieIpc } = require('./db/movies')
const { registerActressIpc } = require('./db/actress')
const { registerWebsitesIpc } = require('./db/websites')
const { registerSettingsIpc, applyProxySettings } = require('./db/settings')
// 工具类 / 对话框 / 刮削 IPC（自本文件拆出）
const { registerUtilsIpc } = require('./ipc-utils')
// 首页推荐数据（轮播 / 类别按钮 / 近期上新）
const { registerHomeIpc } = require('./home')
// javtube-cover 封面协议（自本文件拆出）
const { registerCoverScheme, setupCoverProtocol } = require('./cover-protocol')

// ====== 渲染性能相关 ======
// 关闭 Chromium 沙箱：在部分 Windows 环境下沙箱会导致 GPU 进程反复崩溃，
// 进而触发 "GPU process isn't usable. Goodbye." 的致命退出，应用根本打不开。
app.commandLine.appendSwitch('no-sandbox')

// 默认启用硬件加速：动画、滚动、图片缩放交由 GPU 合成，切换页面才顺滑。
// 若你的机器 GPU 驱动异常，设置环境变量 JAVTUBE_DISABLE_GPU=1 即可降级为软件渲染。
// 注意：降级时也不追加 disable-software-rasterizer，否则会禁掉 SwiftShader 软件 GL，
// 使大窗口渲染退化成纯 CPU 光栅，反而更卡。
if (process.env.JAVTUBE_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
}

// 必须在 app ready 之前注册 privileged scheme（Electron 硬性要求）
registerCoverScheme()

// 全局变量：主窗口实例
let mainWindow = null
// 全局变量：数据库实例
let db = null
// 全局变量：数据目录路径，供刮削等模块使用
let dataDirForGlobal = ''

// 应用标题
const APP_TITLE = 'JavTube'

/**
 * 获取应用数据存储目录，并处理数据库迁移逻辑。
 * 数据目录位于 exe 同级的 data 文件夹下，包含数据库文件 app.db 和封面图片目录 covers。
 * 如果数据库文件不存在，会尝试从旧版本（Javlibrary）或打包资源中迁移数据。
 * @returns {string} 数据目录的绝对路径
 */
function getDataDir() {
  let dir
  try {
    // 获取可执行文件路径，取其所在目录，拼接 data 子目录
    const exePath = app.getPath('exe')
    const exeDir = path.dirname(exePath)
    dir = path.join(exeDir, 'data')
  } catch (e) {
    // 如果获取 exe 路径失败（开发模式下可能如此），回退到当前工作目录下的 data 文件夹
    console.warn('exePath failed, fallback to cwd/data:', e.message)
    dir = path.join(process.cwd(), 'data')
  }
  try {
    // 如果数据目录不存在则创建
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (mk) {
    console.warn('mkdir err:', mk.message)
  }

  // 数据库文件路径
  const dbPath = path.join(dir, 'app.db')

  // === 从旧版本 (Javlibrary) 迁移数据 ===
  // 只搬真正的数据：app.db（影片/标签/设置）与 covers/（封面、头像）。
  // 不搬 Chromium 的 Profile 垃圾（Cache / GPUCache / blob_storage / Local Storage …），
  // 它们对新的 sql.js 版本毫无用处。
  //
  // 历史 bug：这里原先用 readdirSync + copyFileSync 遍历整个目录，
  // 遇到子目录（blob_storage、Cache…）会抛 EPERM，而异常被外层 catch 吞掉后
  // **整轮迁移直接中断** —— 表现为旧库搬不过来或只搬了一半。
  // 现在改为「按需项 + 逐项独立容错」：任何一项失败都不影响其余项与启动。
  if (!fs.existsSync(dbPath)) {
    const oldDir = path.join(app.getPath('home'), 'AppData', 'Roaming', 'Javlibrary')
    if (fs.existsSync(path.join(oldDir, 'app.db'))) {
      for (const name of ['app.db', 'covers']) {
        const src = path.join(oldDir, name)
        const dst = path.join(dir, name)
        if (!fs.existsSync(src) || fs.existsSync(dst)) continue  // 不存在或已迁移过 → 跳过，绝不覆盖
        try {
          fs.cpSync(src, dst, { recursive: true, force: false, errorOnExist: false })
          console.log('[main] migrated from Javlibrary:', name)
        } catch (e) {
          console.warn(`[main] 迁移 ${name} 失败（跳过，不影响启动）:`, e.message)
        }
      }
    }
  }

  // === 从打包资源迁移数据 ===
  // 如果数据库文件仍不存在，尝试从 electron-builder 打包的 resources/data 目录复制
  if (!fs.existsSync(dbPath)) {
    const bundledData = path.join(process.resourcesPath || '', 'data')
    if (fs.existsSync(bundledData)) {
      try {
        const files = fs.readdirSync(bundledData)
        for (const f of files) {
          const src = path.join(bundledData, f)
          const dst = path.join(dir, f)
          if (!fs.existsSync(dst)) {
            fs.copyFileSync(src, dst)
            console.log('[main] migrated:', f)
          }
        }
      } catch (e) {
        console.warn('[main] migration failed:', e.message)
      }
    }
  }

  console.log('[main] dataDir =', dir)
  return dir
}

/**
 * 创建主窗口 (BrowserWindow)。
 * 配置窗口大小、标题、图标、预加载脚本和安全选项。
 * 根据环境变量决定加载开发服务器 URL 还是打包后的静态文件。
 */
function createWindow() {
  console.log('[main] createWindow start')
  try {
    mainWindow = new BrowserWindow({
      width: 1400,        // 窗口初始宽度
      height: 900,        // 窗口初始高度
      minWidth: 1000,     // 窗口最小宽度
      minHeight: 700,     // 窗口最小高度
      title: APP_TITLE,   // 窗口标题
      // 标题栏与顶栏统一为白色（2026-09-15）：
      //   hidden 隐藏系统原生标题栏；titleBarOverlay 绘制白色覆盖层，
      //   右上角保留最小化/最大化/关闭（符号用墨黑），高度与 TopNav 一致
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#ffffff',        // 底色：与 TopNav 的 --surface 白一致
        symbolColor: '#22211f',  // 按钮符号：墨黑（--text）
        height: 48               // 与 .topnav 高度一致
      },
      backgroundColor: '#fafafa', // 背景色，避免加载白屏
      autoHideMenuBar: true,      // 自动隐藏菜单栏
      show: true,         // 窗口创建后立即显示
      center: true,       // 窗口居中显示
      icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'), // 应用图标
      webPreferences: {
        // 预加载脚本路径，在页面加载前注入，用于暴露安全的 API 给渲染进程
        preload: path.join(__dirname, '..', 'preload', 'index.js'),
        contextIsolation: true,  // 开启上下文隔离（安全最佳实践）
        nodeIntegration: false, // 禁止渲染进程直接使用 Node.js（安全最佳实践）
        sandbox: false           // 关闭沙箱，预加载脚本需要部分 Node 能力
      }
    })
    console.log('[main] BrowserWindow constructed. id=', mainWindow.id)

  } catch (e) {
    console.error('[main] FAILED BrowserWindow constructor:', e?.stack || e)
    throw e
  }

  try {
    // 窗口准备好显示时的回调：显示窗口并置顶一次以确保在最前
    mainWindow.once('ready-to-show', () => {
      console.log('[main] ready-to-show')
      mainWindow.show()
      mainWindow.focus()
      mainWindow.setAlwaysOnTop(true)   // 短暂置顶
      mainWindow.setAlwaysOnTop(false)  // 立即取消置顶，使窗口弹到最前但不固定置顶
      mainWindow.moveTop()
      // 仅开发模式自动打开 DevTools（生产打包后不弹出，避免用户困惑）
      if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.webContents.openDevTools({ mode: 'detach' })
      }
    })
    // 窗口关闭时清理引用
    mainWindow.on('closed', () => { console.log('[main] window closed'); mainWindow = null })

    // 监听渲染进程的 console 消息，转发到主进程控制台（方便调试）
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      console.log(`[renderer][${level}] ${message} (${sourceId}:${line})`)
    })
    // 渲染进程崩溃时的处理
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      console.error('[main] render-process-gone:', JSON.stringify(details))
    })
    // 页面加载失败时的处理
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error(`[main] did-fail-load: ${code} ${desc} url=${url}`)
    })

    // 根据环境变量决定加载开发服务器 URL 还是打包后的 index.html
    const devUrl = process.env.VITE_DEV_SERVER_URL
    if (devUrl) {
      // 开发模式：加载 Vite 开发服务器地址
      console.log(`[main] loading dev URL: ${devUrl}`)
      mainWindow.loadURL(devUrl)
        .then(() => console.log('[main] loadURL SUCCESS'))
        .catch(err => console.error('[main] loadURL FAILED:', err.message))
    } else {
      // 生产模式：加载打包后的本地 HTML 文件
      const distPath = path.join(__dirname, '..', '..', 'dist', 'index.html')
      console.log(`[main] loading file: ${distPath}`)
      mainWindow.loadFile(distPath)
        .then(() => console.log('[main] loadFile SUCCESS'))
        .catch(err => console.error('[main] loadFile FAILED:', err.message))
    }
    console.log('[main] createWindow end')
  } catch (e) {
    console.error('[main] createWindow mid FAILED:', e?.stack || e)
  }
}

// === 应用生命周期 ===
// app.whenReady() 在 Electron 完成初始化后触发，是应用启动的正式入口
app.whenReady().then(async () => {
  console.log('[main] ====== APP READY ======')
  try {
    // 获取数据目录路径
    const dataDir = getDataDir()
    dataDirForGlobal = dataDir
    console.log('[main] calling initDb async...')
    const t0 = Date.now()
    // 初始化数据库（异步加载 sql.js WASM）
    db = await initDb(dataDir)
    console.log(`[main] initDb DONE in ${Date.now()-t0}ms path=${db?._dbPath}`)
    // 注册 javtube-cover 协议处理器（scheme 已在文件顶部注册为 privileged）
    setupCoverProtocol(dataDir)
    // 启动时按数据库设置应用本机代理（JAVDB 等站点需科学上网时使用）
    await applyProxySettings(db)
  } catch (e) {
    console.error('[main] DB init FAILED:', e?.stack || e)
  }

  console.log('[main] registering IPC...')
  try {
    // 注册所有 IPC 通道处理器
    registerUtilsIpc(ipcMain, {
      db,
      getMainWindow: () => mainWindow,   // 运行时读取当前窗口，与原闭包语义一致
      dataDir: dataDirForGlobal
    })                                                              // 工具类 IPC
    registerMovieIpc(ipcMain, db)                                   // 影片数据 IPC
    registerActressIpc(ipcMain, db)                                 // 女优数据 IPC
    registerWebsitesIpc(ipcMain, db)                                // 网址数据 IPC
    registerSettingsIpc(ipcMain, db, dataDirForGlobal)              // 设置数据 IPC
    registerHomeIpc(ipcMain, db)                                    // 首页推荐 IPC
    console.log('[main] IPC OK')
  } catch (e) {
    console.error('[main] IPC reg FAILED:', e?.stack || e)
  }

  console.log('[main] will call createWindow NOW')
  try { createWindow() }
  catch (e) { console.error('[main] createWindow FAILED:', e?.stack || e) }

  // macOS 激活事件：当点击 Dock 图标且没有窗口时重新创建窗口
  app.on('activate', () => {
    console.log('[main] app.activate')
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  console.log('[main] ====== startup sequence complete ======')
}).catch(err => {
  console.error('[main] whenReady REJECTED:', err?.stack || err)
})

// 所有窗口关闭时的事件处理
app.on('window-all-closed', () => {
  try { db?._forceSave?.() } catch {}  // 强制将数据库写入磁盘
  // macOS 上应用保持活跃，其他平台退出
  if (process.platform !== 'darwin') app.quit()
})

// 捕获未处理的异常，防止应用崩溃
process.on('uncaughtException', (e) => console.error('[main] uncaughtException:', e?.stack || e))
// 捕获未处理的 Promise 拒绝
process.on('unhandledRejection', (r) => console.error('[main] unhandledRejection:', r?.stack || r))
