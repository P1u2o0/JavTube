/**
 * @file ipc-utils.js
 * @module electron/main/ipc-utils
 * @description 工具类 IPC 处理器注册模块：视频播放、目录扫描、文件读取（Base64）、
 *              系统对话框封装（目录/视频/图片/可执行文件/数据库备份）、在线刮削。
 *              handler 代码自原 index.js 原样迁出（纯移动，逻辑零变更）。
 *              原先闭包引用的模块级变量（db / mainWindow / dataDirForGlobal）
 *              改为通过 ctx 参数注入；mainWindow 以 getter 注入，
 *              与原「运行时读取当前窗口实例」的语义一致。
 * @dependencies electron (ipcMain, dialog, shell), fs, path, ../constants, ../common/ipc-channels, ./scraper
 */

const { ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { VIDEO_EXTS, COVER_DIR } = require('./constants')
const IPC = require('../common/ipc-channels')
const { scrapeMovie } = require('./scraper')
const { readMp4DurationMinutes } = require('./video-meta')

/**
 * 注册工具类 IPC 处理器。
 * @param {Object} ipcMain - Electron ipcMain 对象
 * @param {Object} ctx - 运行时依赖
 * @param {Object} ctx.db - sql.js 数据库实例（playVideo 读取自定义播放器路径）
 * @param {Function} ctx.getMainWindow - 返回当前主窗口实例（可能为 null）
 * @param {string} ctx.dataDir - 应用数据目录（刮削封面保存位置）
 */
function registerUtilsIpc(ipcMain, { db, getMainWindow, dataDir }) {
  // === 播放视频 ===
  // 渲染进程 → 主进程：根据设置中的自定义播放器路径播放视频，否则用系统默认程序打开
  ipcMain.handle(IPC.UTILS_PLAY_VIDEO, async (_e, filePath) => {
    try {
      // 先校验视频文件存在——不存在时明确报错（此前静默失败，用户以为「点击无反应」）
      if (!filePath || !fs.existsSync(filePath)) {
        return { ok: false, error: '视频文件不存在，请检查影片的视频路径设置' }
      }
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
  ipcMain.handle(IPC.UTILS_SCAN_DIR, async (_e, dirPath) => {
    try {
      // 支持的视频文件扩展名列表（定义于 constants.js）
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

  // === 读取文件并返回 Base64 ===
  // 渲染进程 → 主进程：读取文件二进制数据并转为 Base64 字符串（用于图片预览等）
  ipcMain.handle(IPC.UTILS_READ_FILE_BASE64, (_e, filePath) => {
    try {
      const buf = fs.readFileSync(filePath)
      return { ok: true, data: buf.toString('base64') }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // === 读取视频文件时长（分钟，2026-09-09 新增） ===
  // 渲染进程 → 主进程：解析 MP4/M4V/MOV 容器的 mvhd 得到时长；
  // AVI/MKV 等容器返回 data=0（前端显示为未知）
  ipcMain.handle(IPC.UTILS_READ_DURATION, (_e, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: '文件不存在' }
      const minutes = readMp4DurationMinutes(filePath)
      return { ok: true, data: minutes || 0 }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // === 系统对话框封装 ===
  const mainWindow = getMainWindow  // getter：与原「运行时读取当前窗口」语义一致
  // 通用打开对话框函数：封装 dialog.showOpenDialog，返回选中路径
  const doOpen = (props, multi = false) => dialog.showOpenDialog(mainWindow(), props).then(r => r.canceled ? null : (multi ? r.filePaths : r.filePaths[0]))
  // 打开目录选择对话框
  ipcMain.handle(IPC.DIALOG_OPEN_DIR, () => doOpen({ properties: ['openDirectory'] }))
  // 打开视频文件选择对话框
  ipcMain.handle(IPC.DIALOG_OPEN_VIDEO, () => doOpen({ properties: ['openFile'], filters: [{ name: '视频文件', extensions: ['mp4','avi','mkv','mov','flv','wmv','rmvb','m4v','mpg','mpeg','ts','webm','*'] }] }))
  // 打开图片文件选择对话框
  ipcMain.handle(IPC.DIALOG_OPEN_IMAGE, () => doOpen({ properties: ['openFile'], filters: [{ name: '图片文件', extensions: ['jpg','jpeg','png','gif','webp','bmp'] }] }))
  // 打开可执行文件选择对话框
  ipcMain.handle(IPC.DIALOG_OPEN_FILE, () => doOpen({ properties: ['openFile'], filters: [{ name: '可执行文件', extensions: ['exe','bat','cmd'] }, { name: '所有文件', extensions: ['*'] }] }))
  // 保存数据库备份文件对话框
  ipcMain.handle(IPC.DIALOG_SAVE_DB, () => dialog.showSaveDialog(mainWindow(), { defaultPath: `library-backup-${Date.now()}.db`, filters: [{ name: 'SQLite', extensions: ['db','sqlite'] }] }).then(r => r.canceled ? null : r.filePath))
  // 打开数据库文件选择对话框
  ipcMain.handle(IPC.DIALOG_OPEN_DB, () => doOpen({ properties: ['openFile'], filters: [{ name: 'SQLite', extensions: ['db','sqlite'] }] }))

  // === 刮削功能 ===
  // 渲染进程 → 主进程：根据番号从网络刮削影片信息
  // 参数：ph（番号）、source（刮削来源：auto/javbus/javdb）、coverDir（封面保存目录名）
  // 刮削选项（预览图下载开关/数量、统计开关）从 settings 表读取，前端无需逐次传递
  ipcMain.handle(IPC.SCRAPER_SCRAPE, async (_e, { ph, source, coverDir }) => {
    try {
      // 一次性取出全部刮削相关设置（原实现逐键 6 次 db.exec，合并为单次 IN 查询）
      const settings = {}
      try {
        const rs = db.exec(`SELECT key, value FROM settings WHERE key IN
          ('tag_mapping','scrape_previews','preview_count','scrape_stats','javdb_cookie',
           'proxy_enabled','proxy_url')`)
        for (const row of (rs[0]?.values || [])) settings[row[0]] = row[1]
      } catch {}
      // 标签映射规则（settings.tag_mapping 为 JSON 数组 [[原标签,新标签],...]）
      let tagMapping = []
      try { tagMapping = JSON.parse(settings.tag_mapping || '[]') } catch { tagMapping = [] }
      if (!Array.isArray(tagMapping)) tagMapping = []
      const r = await scrapeMovie(ph, {
        source: source || 'auto',
        coverDir: coverDir || COVER_DIR,
        dataDir,
        downloadPreviews: settings.scrape_previews === 'y',
        previewCount: Number(settings.preview_count || 0),
        fetchStats: settings.scrape_stats !== 'n',
        javdbCookie: settings.javdb_cookie || '',
        // 代理（curl 的 -x）：页面请求走代理；图片下载由 net-curl 默认直连
        proxy: settings.proxy_enabled === 'y' ? (settings.proxy_url || '') : '',
        tagMapping
      })
      return r
    } catch (e) { return { ok: false, error: e.message } }
  })
}

module.exports = { registerUtilsIpc }
