/**
 * @file index.js
 * @module electron/main
 * @description Electron 主进程入口文件。负责应用启动时序编排：性能开关、数据目录定位与迁移、
 *              数据库初始化、各 IPC 模块注册、窗口创建与生命周期管理。
 *              具体职责已拆分：封面协议 → cover-protocol.js；工具/对话框/刮削 IPC → ipc-utils.js；
 *              影片/女优/设置 IPC → db/ 下各模块。
 * @dependencies electron (app, BrowserWindow, ipcMain), path, fs, ./db/init, ./db/movies, ./db/actress, ./db/settings, ./ipc-utils, ./cover-protocol
 * @keyAPI app.whenReady(), BrowserWindow, ipcMain.handle(), app.getPath()
 */

// 引入 Electron 核心模块
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

// 引入数据库初始化模块
const { initDb } = require('./db/init')
// 影片 / 女优 / 设置 的 IPC 处理器注册函数（各领域独立模块）
const { registerMovieIpc } = require('./db/movies')
const { registerActressIpc } = require('./db/actress')
const { registerImageIpc } = require('./db/images')
const { registerSettingsIpc, applyProxySettings } = require('./db/settings')
// 工具类 / 对话框 / 刮削 IPC（自本文件拆出）
const { registerUtilsIpc } = require('./ipc-utils')
// 首页推荐数据（轮播 / 类别按钮 / 近期上新）
const { registerHomeIpc } = require('./home')
// 播放页 IPC（进度记忆 + 相关推荐）
const { registerPlayerIpc } = require('./db/player')
// javtube-cover 封面协议（自本文件拆出）
const { registerCoverScheme, setupCoverProtocol } = require('./cover-protocol')
// javtube-media 视频流协议（内置播放页，2026-09-29）
const { registerMediaScheme, setupMediaProtocol } = require('./media-protocol')
// mpv 播放内核（内置播放页「高兼容模式」，2026-10-08）：进程管理 + JSON IPC 桥
const { registerMpvIpc, disposeMpv } = require('./mpv')

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
registerMediaScheme()

// ====== 单实例锁（2026-09-28 审计补）======
// 没有它时双击两次图标会起两个进程各自持有同一份 app.db：内存各一份、退出时互相覆盖，
// .tmp/.bak 轮转也会打架（两个进程写同一个 app.db.tmp），表现为「最近的操作莫名丢失」
// 或「库里出现另一个窗口的数据」。拿不到锁就直接退出，并把已有窗口拉到前台。
// 注意：Electron 的锁粒度是 userData（全机一份），而数据目录是 exe 同级 ——
// 所以「绿色版复制多份分别放不同目录」这种用法会被误伤（2026-09-29 审计已记录）；
// 开发调试（npm run dev）直接跳过这把锁，避免被已安装版挡住。
const gotSingleLock = app.isPackaged ? app.requestSingleInstanceLock() : true
if (!gotSingleLock) {
  console.warn('[main] 已有实例在运行，本次启动退出')
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

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
 * 数据目录位于 exe 同级的 data 文件夹下，包含数据库文件 app.db 和图片目录 images（每片一个文件夹的海报+预览、actress 头像；旧版本为 covers）。
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
  // 只搬真正的数据：app.db（影片/标签/设置）与图片目录（images/ 新布局、covers/ 旧布局）。
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
      for (const name of ['app.db', 'images', 'covers']) {
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
      // ===== 透明窗口（2026-10-08，mpv 播放内核的前提）=====
      // 内置播放页的「高兼容模式」把播放内核换成 mpv，做法是让页面把视频区域**镂空**、
      // mpv 的画面从洞里透出来（详见 docs/MPV_INTEGRATION_PLAN.md）。
      // 这要求窗口本身是透明的 —— 否则页面底下的那层底色会挡住 mpv。
      //
      // ⚠️ 透明是**窗口级**属性，不能在运行时切换，所以常开。代价与对策：
      //   · 非播放页：页面自己把整屏画满 --bg（见 global.css 的 html/body/#app 背景），
      //     观感与不透明窗口完全一致（已逐页截图比对）。
      //   · 播放页且 mpv 生效时：给 <html> 加 .mpv-hole，让底色交给「挖洞遮罩」去画
      //     （src/views/Player.vue），只有视频那一块真正透明。
      //   · 退回 Chromium 内核时同样是安全的：<video> 自身画黑底，洞被它填满。
      transparent: true,
      backgroundColor: '#00000000', // 透明窗口必须给全透明底色，否则透明度不生效
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
    // ⚠️ 签名兼容（2026-10-07）：Electron 36+ 把回调参数并成 (event, details)，旧版是
    //    (event, level, message, line, sourceId)，旧形式已弃用。
    //    **必须用 rest 参数**：Electron 是按「回调声明的形参个数」判断新旧式的，
    //    写成 5 个具名参数即使不用也会被判成旧式、照样打弃用警告（实测）。
    //    `(event, ...rest)` 声明数为 1 → 走新式；运行时再按 rest[0] 的类型兼容旧式，
    //    这样将来升级 / 回退 Electron 这段日志都不会失效。
    mainWindow.webContents.on('console-message', (_e, ...rest) => {
      const det = (rest[0] && typeof rest[0] === 'object')
        ? rest[0]
        : { level: rest[0], message: rest[1], lineNumber: rest[2], sourceId: rest[3] }
      console.log(`[renderer][${det.level}] ${det.message} (${det.sourceId}:${det.lineNumber})`)
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
  // 没拿到单实例锁就直接结束（否则 quit() 是异步的，后续仍会 initDb —— 正好是这把锁要防的竞争）
  if (!gotSingleLock) {
    console.warn('[main] 未获得单实例锁，跳过初始化')
    return
  }
  console.log('[main] ====== APP READY ======')
  let dataDir = ''
  try {
    // 获取数据目录路径
    dataDir = getDataDir()
    dataDirForGlobal = dataDir
    console.log('[main] calling initDb async...')
    const t0 = Date.now()
    // 初始化数据库（异步加载 sql.js WASM）
    db = await initDb(dataDir)
    console.log(`[main] initDb DONE in ${Date.now()-t0}ms path=${db?._dbPath}`)
    // 启动时按数据库设置应用本机代理（JAVDB 等站点需科学上网时使用）
    await applyProxySettings(db)
  } catch (e) {
    // ★ 2026-09-28 审计修复：原来这里只 console.error 就继续往下跑，结果是
    // 「所有 handler 里的 db 都是 null → 界面片库全空、封面全破」，而用户侧**没有任何提示**，
    // 极易被误判成「数据丢了」，进而去点「清空所有数据」把可恢复状态变成真丢数据。
    // 现在：明确弹窗告知原因与处置建议，然后退出（不带着未知状态继续跑）。
    console.error('[main] DB init FAILED:', e?.stack || e)
    try {
      dialog.showErrorBox('数据库初始化失败',
        `软件无法加载数据目录中的数据库，已停止启动以避免破坏数据。\n\n数据目录：${dataDir || '(未取到)'}\n原因：${e?.message || e}\n\n` +
        '建议：① 检查该目录是否可读写；② 用「data/app.db.bak」或你手工备份的 app.db 覆盖 app.db 后重试。')
    } catch {}
    app.exit(1)
    return
  }

  // 封面协议不依赖数据库成功：只要拿到了数据目录就注册
  // （原来它被放在上面的 try 里，DB 一失败连封面协议都没注册 → 所有 <img> 报 ERR_UNKNOWN_URL_SCHEME）
  try {
    setupCoverProtocol(dataDirForGlobal)
  } catch (e) {
    console.error('[main] setupCoverProtocol FAILED:', e?.message || e)
  }
  // 视频流协议（内置播放页 <video> 用，同上不依赖 DB）
  try {
    setupMediaProtocol()
  } catch (e) {
    console.error('[main] setupMediaProtocol FAILED:', e?.message || e)
  }

  // 数据库降级恢复告知（2026-09-28 审计）：从 .bak/.tmp 恢复或最终建了空库时必须让用户知道
  if (db && db._recoveredFrom) {
    const map = {
      bak: ['已从备份恢复数据库', 'app.db 无法读取（可能被写坏），已自动改用上一份备份 app.db.bak。\n\n损坏的文件已保留为 app.db.corrupt-*，确认数据无误后可自行删除。'],
      tmp: ['已从临时文件恢复数据库', 'app.db 缺失，已用上次未完成写入的 app.db.tmp 恢复。\n\n请核对数据是否完整。'],
      // 2026-10-02：app.db 缺失、从遗留的 .tmp/.bak 改名恢复的常规崩溃恢复路径
      rescue: ['已从遗留文件恢复数据库', 'app.db 缺失（上次退出时落盘未完成），已自动从临时/备份文件恢复。\n\n请核对数据是否完整。'],
      empty: ['数据库无法读取，已新建空库', 'app.db 及其备份都无法加载。\n\n原始损坏文件已保留为 app.db.corrupt-*，请勿继续录入数据，先尝试用备份文件修复。']
    }
    const [title, body] = map[db._recoveredFrom] || map.bak
    console.warn('[main] DB recovered from:', db._recoveredFrom)
    try { dialog.showMessageBox({ type: 'warning', title, message: title, detail: body }) } catch {}
  }

  console.log('[main] registering IPC...')
  // 每个领域模块各自 try（2026-09-30 审计）：原实现 7 个注册调用共用一个 try ——
  // 任何一个模块在注册期抛错（典型是通道重复注册），其后所有模块的 IPC 都不会注册，
  // 而用户只看到「某些功能点了没反应」，控制台里才有线索。逐个包起来后，
  // 单个模块出问题不影响其余模块，且失败数量会被汇总上报。
  const ipcFailures = []
  const reg = (name, fn) => {
    try { fn(); console.log(`[main] IPC OK: ${name}`) }
    catch (e) { ipcFailures.push(`${name}: ${e?.message || e}`); console.error(`[main] IPC reg FAILED (${name}):`, e?.stack || e) }
  }
  reg('utils', () => registerUtilsIpc(ipcMain, {
    db,
    getMainWindow: () => mainWindow,   // 运行时读取当前窗口，与原闭包语义一致
    dataDir: dataDirForGlobal
  }))                                                              // 工具类 IPC
  reg('movies', () => registerMovieIpc(ipcMain, db, dataDirForGlobal))     // 影片数据 IPC（删除时要清理图片目录内的孤儿图片）
  reg('actress', () => registerActressIpc(ipcMain, db, dataDirForGlobal))  // 女优数据 IPC（含补全头像：要写 images/actress）
  reg('images', () => registerImageIpc(ipcMain, db, dataDirForGlobal))     // 图片完整性 IPC（扫描/修复失效封面与预览图）
  reg('settings', () => registerSettingsIpc(ipcMain, db, dataDirForGlobal)) // 设置数据 IPC
  reg('home', () => registerHomeIpc(ipcMain, db))                         // 首页推荐 IPC
  reg('player', () => registerPlayerIpc(ipcMain, db))                     // 播放页 IPC（进度 + 相关推荐，2026-09-29）
  reg('mpv', () => registerMpvIpc(ipcMain, { getMainWindow: () => mainWindow }))  // mpv 播放内核控制通道（2026-10-08）
  if (ipcFailures.length) {
    console.error('[main] IPC 部分模块注册失败:', ipcFailures.join(' | '))
    // 让用户知道「有些功能不可用」，而不是遇到奇怪的半残界面。
    // 只在打包后的正式版弹：开发/自动化环境（未打包）里控制台日志已足够，
    // 且原生消息框会弹到桌面最前、可能把无人值守的验证脚本挂住。
    if (app.isPackaged) {
      try {
        dialog.showErrorBox('部分功能初始化失败',
          `以下模块的 IPC 未能注册：\n${ipcFailures.join('\n')}\n\n` +
          '对应功能（如片库、刮削、播放页）可能无法使用。请保留此信息并反馈。')
      } catch {}
    }
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
  try { disposeMpv() } catch {}        // 确保 mpv 子进程一起退出（否则会变成孤儿进程占着窗口句柄）
  // macOS 上应用保持活跃，其他平台退出
  if (process.platform !== 'darwin') app.quit()
})

// 退出前也要收一次 mpv：window-all-closed 在个别路径（如 app.quit() 由别处触发）不会走到
app.on('before-quit', () => { try { disposeMpv() } catch {} })

// 捕获未处理的异常，防止应用崩溃
process.on('uncaughtException', (e) => console.error('[main] uncaughtException:', e?.stack || e))
// 捕获未处理的 Promise 拒绝
process.on('unhandledRejection', (r) => console.error('[main] unhandledRejection:', r?.stack || r))
