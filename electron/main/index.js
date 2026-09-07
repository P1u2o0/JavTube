/**
 * @file index.js
 * @module electron/main
 * @description Electron 主进程入口文件。负责创建应用窗口、初始化数据库、注册所有 IPC 通信处理器，
 *              以及管理应用生命周期（启动、激活、关闭）。是整个 JavTube 应用的核心启动入口。
 * @dependencies electron (app, BrowserWindow, ipcMain, dialog, shell), path, fs, ./db/init, ./db/movies, ./db/settings, ./scraper
 * @keyAPI app.whenReady(), BrowserWindow, ipcMain.handle(), app.getPath(), app.disableHardwareAcceleration()
 */

// 引入 Electron 核心模块
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron')
const path = require('path')
const fs = require('fs')

// 引入数据库初始化模块
const { initDb } = require('./db/init')
// 引入影片和女优的 IPC 处理器注册函数
const { registerMovieIpc, registerActressIpc } = require('./db/movies')
// 引入设置相关的 IPC 处理器注册函数
const { registerSettingsIpc } = require('./db/settings')
// 引入刮削模块
const { scrapeMovie } = require('./scraper')

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

// ====== 注册 javtube-cover 自定义协议 ======
// 用途：让渲染进程的 <img> 能加载本地磁盘封面图。
// 不能直接用 file:// 的原因：在 Electron 默认 CSP 下，<img src="file://..."> 会报
// "Not allowed to load local resource"。注册成自定义协议后，CSP 只需放行 javtube-cover:，
// 主进程按规则解析图片字节流返回即可，跨平台/跨目录/带空格路径都安全。
// 设计：先调用 protocol.registerSchemesAsPrivileged 注册为 privileged+standard+bypassCSP，
//      这样 fetch/img 加载不需要再用 unsafe-inline 之类放宽。
// 然后在 app.whenReady 里调用 protocol.handle() 把路径解析交给 net.fetch 读磁盘。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'javtube-cover',
    privileges: {
      standard: true,     // 走标准 URL 解析（host 段、pathToFileURL 等都正常）
      secure: true,        // 允许当 https 一样看待（web security 不挡）
      supportFetchAPI: true,
      stream: true         // 大图流式输出，避免一次性读进内存
    }
  }
])

// 全局变量：主窗口实例
let mainWindow = null
// 全局变量：数据库实例
let db = null
// 全局变量：数据库文件路径，供其他模块使用
let dbPathForGlobal = ''
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
  // 如果当前目录没有数据库文件，检查旧版本数据目录是否存有数据
  if (!fs.existsSync(dbPath)) {
    const oldDir = path.join(app.getPath('home'), 'AppData', 'Roaming', 'Javlibrary')
    if (fs.existsSync(path.join(oldDir, 'app.db'))) {
      try {
        const files = fs.readdirSync(oldDir)
        for (const f of files) {
          const src = path.join(oldDir, f)
          const dst = path.join(dir, f)
          // 仅在目标文件不存在时复制，避免覆盖
          if (!fs.existsSync(dst)) {
            fs.copyFileSync(src, dst)
            console.log('[main] migrated from Javlibrary:', f)
          }
        }
      } catch (e) {
        console.warn('[main] old version migration failed:', e.message)
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
 * 注册 javtube-cover 自定义协议，把本地图片文件暴露给渲染进程的 <img>。
 *
 * 协议格式：javtube-cover:///<base64url 编码后的绝对路径>
 * - 用 base64url 是为了兼容任意字符（包括空格、中文、Windows 反斜杠等），避免 URL 解析问题。
 * - 仅放行白名单扩展名（图片），且必须解析为绝对路径，防止被恶意页面利用读任意文件。
 * - 不存在的文件直接返回 404，避免无谓的系统开销。
 *
 * @param {string} dataDir - 应用数据目录（用于路径校验，限定在数据目录或系统临时目录内）
 */
function registerCoverProtocol(dataDir) {
  // 白名单扩展名：仅图片可走该协议，避免被滥用来加载本地视频或文档
  const IMG_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.bmp'])
  const isImg = (p) => IMG_EXTS.has(path.extname(p).toLowerCase())

  // 路径白名单：必须在这些目录之一，才允许读取
  //   1. 数据目录（封面、上传图等都存在这里）
  //   2. 系统临时目录（兼容旧版刮削缓存）
  //   3. EXE 同级目录（兼容用户把数据放在 exe 旁的场景）
  const allowedRoots = [
    path.resolve(dataDir),
    path.resolve(process.cwd()),
    path.resolve(path.dirname(app.getPath('exe'))),
    path.resolve(require('os').tmpdir())
  ]

  protocol.handle('javtube-cover', async (request) => {
    try {
      const u = new URL(request.url)
      // 占位 host = "0"，编码段在 pathname 的第一段（如 javtube-cover://0/QzxhelBh...）
      // 解码前缀 /，去掉可能的尾部 /（浏览器偶尔会加）
      const segs = u.pathname.split('/').filter(s => s.length > 0)
      const enc = segs[0] || ''
      if (!enc) return new Response('bad request', { status: 400 })
      // base64url 解码为文件绝对路径
      const abs = Buffer.from(enc, 'base64').toString('utf-8')
      // 解析为标准绝对路径
      const resolved = path.resolve(abs)
      // 白名单校验：必须落在允许的根目录之一
      const ok = allowedRoots.some(root => {
        const rel = path.relative(root, resolved)
        return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
      })
      if (!ok) return new Response('forbidden', { status: 403 })
      // 必须是图片扩展名
      if (!isImg(resolved)) return new Response('not an image', { status: 415 })
      // 文件必须存在且是文件
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return new Response('not found', { status: 404 })
      }
      // 用 net.fetch 走本地文件协议交给 Electron 处理，返回标准 Response
      // URL 用 pathToFileURL 来正确编码（处理中文、空格、# 等字符）
      const fileUrl = require('url').pathToFileURL(resolved).href
      return await net.fetch(fileUrl)
    } catch (e) {
      console.warn('[cover-protocol] err:', e.message)
      return new Response('error: ' + e.message, { status: 500 })
    }
  })
  console.log('[main] javtube-cover protocol registered')
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
      // 调试模式自动打开 DevTools，便于排查渲染端问题
      mainWindow.webContents.openDevTools({ mode: 'detach' })
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

/**
 * 注册工具类 IPC 处理器。
 * 包括视频播放、目录扫描、文件读取、系统对话框（打开目录/文件/图片等）和刮削功能。
 * 这些 IPC 通道均为：渲染进程 → 主进程（ipcMain.handle）。
 */
function registerUtilsIpc() {
  // === 播放视频 ===
  // 渲染进程 → 主进程：根据设置中的自定义播放器路径播放视频，否则用系统默认程序打开
  ipcMain.handle('utils:playVideo', async (_e, filePath) => {
    try {
      // 查找自定义播放器路径（从数据库 settings 表读取）
      let custom = ''
      try {
        const r = db.exec('SELECT value FROM settings WHERE key = ?', ['player_path'])[0]
        custom = r?.values?.[0]?.[0] || ''
      } catch {}
      if (custom && fs.existsSync(custom)) {
        // 使用自定义播放器播放
        const { execFile } = require('child_process')
        execFile(custom, [filePath], (err) => {
          if (err) { console.warn('custom player err:', err.message); shell.openPath(filePath) }
        })
      } else {
        // 无自定义播放器，使用系统默认程序打开
        await shell.openPath(filePath)
      }
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // === 扫描目录中的视频文件 ===
  // 渲染进程 → 主进程：递归扫描指定目录，返回所有视频文件信息
  ipcMain.handle('utils:scanDir', async (_e, dirPath) => {
    try {
      // 支持的视频文件扩展名列表
      const VIDEO_EXTS = ['.mp4','.avi','.mkv','.mov','.flv','.wmv','.rmvb','.m4v','.mpg','.mpeg','.ts','.webm']
      const results = []
      // 递归遍历目录
      function walk(dir) {
        let files
        try { files = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
        for (const f of files) {
          const full = path.join(dir, f.name)
          if (f.isDirectory()) walk(full)  // 递归进入子目录
          else if (f.isFile()) {
            const ext = path.extname(f.name).toLowerCase()
            // 检查是否为视频文件
            if (VIDEO_EXTS.includes(ext)) {
              let sz = 0
              try { sz = fs.statSync(full).size } catch {}
              // 返回文件路径、文件名、扩展名（不含点）和文件大小
              results.push({ path: full, name: f.name, ext: ext.slice(1), size: sz })
            }
          }
        }
      }
      walk(dirPath)
      return { ok: true, data: results }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // === 读取文本文件 ===
  // 渲染进程 → 主进程：以 UTF-8 编码读取文件文本内容
  ipcMain.handle('utils:readFileText', (_e, filePath) => {
    try {
      const txt = fs.readFileSync(filePath, 'utf-8')
      return { ok: true, data: txt }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // === 读取文件并返回 Base64 ===
  // 渲染进程 → 主进程：读取文件二进制数据并转为 Base64 字符串（用于图片预览等）
  ipcMain.handle('utils:readFileBase64', (_e, filePath) => {
    try {
      const buf = fs.readFileSync(filePath)
      return { ok: true, data: buf.toString('base64') }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // === 系统对话框封装 ===
  // 通用打开对话框函数：封装 dialog.showOpenDialog，返回选中路径
  const doOpen = (props, multi = false) => dialog.showOpenDialog(mainWindow, props).then(r => r.canceled ? null : (multi ? r.filePaths : r.filePaths[0]))
  // 打开目录选择对话框
  ipcMain.handle('dialog:openDir', () => doOpen({ properties: ['openDirectory'] }))
  // 打开视频文件选择对话框
  ipcMain.handle('dialog:openVideo', () => doOpen({ properties: ['openFile'], filters: [{ name: '视频文件', extensions: ['mp4','avi','mkv','mov','flv','wmv','rmvb','m4v','mpg','mpeg','ts','webm','*'] }] }))
  // 打开图片文件选择对话框
  ipcMain.handle('dialog:openImage', () => doOpen({ properties: ['openFile'], filters: [{ name: '图片文件', extensions: ['jpg','jpeg','png','gif','webp','bmp'] }] }))
  // 打开可执行文件选择对话框
  ipcMain.handle('dialog:openFile', () => doOpen({ properties: ['openFile'], filters: [{ name: '可执行文件', extensions: ['exe','bat','cmd'] }, { name: '所有文件', extensions: ['*'] }] }))
  // 打开 NFO 文件选择对话框（支持多选）
  ipcMain.handle('dialog:openNfo', () => dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'NFO', extensions: ['nfo','xml'] }] }).then(r => r.canceled ? null : r.filePaths))
  // 保存数据库备份文件对话框
  ipcMain.handle('dialog:saveDb', () => dialog.showSaveDialog(mainWindow, { defaultPath: `library-backup-${Date.now()}.db`, filters: [{ name: 'SQLite', extensions: ['db','sqlite'] }] }).then(r => r.canceled ? null : r.filePath))
  // 打开数据库文件选择对话框
  ipcMain.handle('dialog:openDb', () => doOpen({ properties: ['openFile'], filters: [{ name: 'SQLite', extensions: ['db','sqlite'] }] }))

  // === 刮削功能 ===
  // 渲染进程 → 主进程：根据番号从网络刮削影片信息
  // 参数：ph（番号）、source（刮削来源）、coverDir（封面保存目录名）
  ipcMain.handle('scraper:scrape', async (_e, { ph, source, coverDir }) => {
    try {
      const r = await scrapeMovie(ph, { source: source || 'auto', coverDir: coverDir || 'covers', dataDir: dataDirForGlobal })
      return r
    } catch (e) { return { ok: false, error: e.message } }
  })
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
    dbPathForGlobal = db?._dbPath || ''
    // 注册 javtube-cover 自定义协议（必须在创建窗口之前，依赖 scheme 在文件顶部已注册为 privileged）
    registerCoverProtocol(dataDir)
  } catch (e) {
    console.error('[main] DB init FAILED:', e?.stack || e)
  }

  console.log('[main] registering IPC...')
  try {
    // 注册所有 IPC 通道处理器
    registerUtilsIpc()                                              // 工具类 IPC
    registerMovieIpc(ipcMain, db)                                   // 影片数据 IPC
    registerActressIpc(ipcMain, db)                                 // 女优数据 IPC
    registerSettingsIpc(ipcMain, db, dataDirForGlobal)              // 设置数据 IPC
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
