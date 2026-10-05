/**
 * @file ipc-utils.js
 * @module electron/main/ipc-utils
 * @description 工具类 IPC 处理器注册模块：视频播放、目录扫描、视频时长解析、
 *              系统对话框封装（目录/视频/图片/可执行文件/数据库备份）、在线刮削。
 *              handler 代码自原 index.js 原样迁出（纯移动，逻辑零变更）。
 *              原先闭包引用的模块级变量（db / mainWindow / dataDirForGlobal）
 *              改为通过 ctx 参数注入；mainWindow 以 getter 注入，
 *              与原「运行时读取当前窗口实例」的语义一致。
 * @dependencies electron (dialog, shell, app), fs, path, ../constants, ../common/ipc-channels, ./scraper
 */

// ipcMain 由 registerUtilsIpc 的参数注入（index.js 传入的即同一对象），此处不再导入
const { dialog, shell, app } = require('electron')
const path = require('path')
const fs = require('fs')
const { VIDEO_EXTS } = require('./constants')
const IPC = require('../common/ipc-channels')
const { scrapeMovie } = require('./scraper')
const { readMp4DurationMinutes, readVideoSize, isVideoReadCooling, noteVideoReadResult } = require('./video-meta')
// 基于系统 curl 的 HTTP 客户端（检查更新要访问 api.github.com，需与刮削同一套代理/UA 逻辑）
const { curlGet } = require('./net-curl')

// 播放时拒绝的扩展名：shell.openPath 会「用系统默认程序打开」，
// 其中可执行/脚本类等于直接执行它（见 UTILS_PLAY_VIDEO）
const EXEC_EXTS = ['.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.msi', '.lnk', '.reg',
  '.ps1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.cpl', '.jar']

/**
 * 视频分辨率缓存（2026-10-04）：path → { size: {width,height}|null, ts }。
 * 正结果一旦拿到就不再过期（文件换分辨率的情况罕见）；负结果 5 分钟 TTL，
 * 避免 NAS 短暂离线时把「读不到」永久缓存、又避免反复重试拖慢。
 */
const videoSizeCache = new Map()
const NEG_TTL_MS = 5 * 60 * 1000

/**
 * 注册工具类 IPC 处理器。
 * @param {Object} ipcMain - Electron ipcMain 对象
 * @param {Object} ctx - 运行时依赖
 * @param {Object} ctx.db - sql.js 数据库实例（playVideo 读取自定义播放器路径）
 * @param {Function} ctx.getMainWindow - 返回当前主窗口实例（可能为 null）
 * @param {string} ctx.dataDir - 应用数据目录（刮削封面保存位置）
 */
function registerUtilsIpc(ipcMain, { db, getMainWindow, dataDir }) {
  // === 应用控制 ===
  // 渲染进程 → 主进程：立即重启应用。
  // 使用场景：settings:restore 只替换了磁盘上的数据库文件，内存里仍是旧库，
  // 必须重启才能加载恢复后的数据。这里先 relaunch（带上原命令行参数）再退出，
  // 避免用户「手动关窗」时误触发落盘逻辑（恢复后落盘已被 _blockPersist 拦掉，
  // 但自动重启体验更明确、也不会留下"以为恢复了其实没生效"的状态）。
  ipcMain.handle(IPC.APP_RELAUNCH, () => {
    try { app.relaunch(); app.exit(0); return { ok: true } }
    catch (e) { return { ok: false, error: e.message } }
  })

  // === 播放视频 ===
  // 渲染进程 → 主进程：根据设置中的自定义播放器路径播放视频，否则用系统默认程序打开
  ipcMain.handle(IPC.UTILS_PLAY_VIDEO, async (_e, filePath) => {
    try {
      // 先校验视频文件存在——不存在时明确报错（此前静默失败，用户以为「点击无反应」）。
      // ⚠️ 2026-10-04：用异步 stat（原 fs.existsSync）——影片在 NAS 上，NAS 离线/慢时
      //    同步 existsSync 会把主进程卡 ~40s（整窗口未响应）。异步只让这次调用等待。
      if (!filePath) return { ok: false, error: '视频文件不存在，请检查影片的视频路径设置' }
      // 存储根刚失败过（如 NAS 离线）：直接快速失败，不再发起会挂 ~40s 的 stat（2026-10-04）
      if (isVideoReadCooling(filePath)) return { ok: false, error: '视频所在的网络存储暂时不可用，请稍后重试' }
      try { await fs.promises.stat(filePath); noteVideoReadResult(filePath, true) } catch {
        noteVideoReadResult(filePath, false)
        return { ok: false, error: '视频文件不存在，请检查影片的视频路径设置' }
      }
      // 只拦可执行/脚本类：正常调用都来自影片记录的 py 字段（视频文件），
      // 但这条 IPC 的入参由渲染层给出，不做限制时它就是一个「打开任意文件」的原语
      const ext = path.extname(filePath).toLowerCase()
      if (EXEC_EXTS.includes(ext)) {
        return { ok: false, error: `拒绝打开可执行文件（${ext}）` }
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
      const fsp = fs.promises
      // 读不了的子目录要如实上报（2026-09-30 审计）：原实现 catch 后静默 return，
      // 于是「NAS 掉线 / 权限不足 / 路径写错」全都表现为「扫描完成，0 个文件」，
      // 用户以为目录里真的没有片子。这里收集前几条失败原因随结果一起返回。
      const skipped = []
      const noteSkip = (p, e) => { if (skipped.length < 5) skipped.push(`${p}（${e?.code || e?.message || '读取失败'}）`) }
      // 并发上限（2026-09-30 审计）：原实现对本层所有条目无上限 Promise.all
      // —— NAS/SMB 上一次性打出几千个并发请求会拖垮共享会话，反而更慢甚至超时。
      //
      // 这里用「按层广度遍历 + 层内固定 24 路并发」：
      //   · 并发恒定、递归不嵌套 → 不存在「限流池被等待子任务的父目录占满」的死锁；
      //   · 一层全部处理完再进下一层 → 不会出现「worker 看到队列瞬时为空就提前退出」
      //     （那种写法在起始队列只有 1 项时，其余 worker 会立刻退出，退化成单线程串行）。
      const WORKERS = 24
      let level = [dirPath]
      while (level.length) {
        const next = []
        let cursor = 0
        const consume = async () => {
          while (cursor < level.length) {
            const dir = level[cursor++]
            let entries
            try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch (e) { noteSkip(dir, e); continue }
            for (const f of entries) {
              const full = path.join(dir, f.name)
              if (f.isDirectory()) { next.push(full); continue }   // 子目录 → 下一层
              if (!f.isFile()) continue
              const ext = path.extname(f.name).toLowerCase()
              if (!VIDEO_EXTS.includes(ext)) continue
              // 文件大小单独容错：stat 失败（权限/被占用）不丢条目，大小记 0 并记录原因
              let sz = 0
              try { sz = (await fsp.stat(full)).size } catch (e) { noteSkip(full, e) }
              results.push({ path: full, name: f.name, ext: ext.slice(1), size: sz })
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(WORKERS, level.length) }, consume))
        level = next
      }
      // 一个文件都没扫到且存在读失败的目录 → 明确报失败，避免被当成「空目录」
      if (!results.length && skipped.length) {
        return { ok: false, error: `目录读取失败：${skipped[0]}`, skipped }
      }
      return { ok: true, data: results, skipped }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // === 读取视频文件时长（分钟，2026-09-09 新增） ===
  // 渲染进程 → 主进程：解析 MP4/M4V/MOV 容器的 mvhd 得到时长；
  // AVI/MKV 等容器返回 data=0（前端显示为未知）。
  // ⚠️ 2026-10-04：读取改为**异步**（原来是 fs.existsSync + 同步读）—— 影片在 NAS 上，
  //    NAS 离线时同步 open 会把主进程事件循环卡 ~40s，详情页一打开整窗口就「未响应」（实测）。
  //    异步失败也返回 data=0（语义同「无法解析」），前端只在 data 非 0 时写库。
  ipcMain.handle(IPC.UTILS_READ_DURATION, async (_e, filePath) => {
    try {
      if (!filePath) return { ok: false, error: '文件不存在' }
      const minutes = await readMp4DurationMinutes(filePath)
      return { ok: true, data: minutes || 0 }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // === 读取视频真实分辨率（2026-10-04 播放页「4K」标签） ===
  // 渲染进程 → 主进程：批量传入 py 列表，返回 { [path]: {width,height}|null }。
  // 影片都在 NAS/SMB 上（实测用户库 376 部全部是 UNC 路径），三条硬约束：
  //  ① I/O 走 fs.promises（video-meta.readVideoSize）—— NAS 离线时同步 open 会把主进程
  //     事件循环卡 ~40s（实测），异步版阻塞在 libuv 线程池，界面照常响应；
  //  ② 结果按路径缓存（见 videoSizeCache：正结果不过期、负结果 5 分钟 TTL）；
  //  ③ 批量上限 40，防调用方误传整库。
  ipcMain.handle(IPC.UTILS_READ_VIDEO_SIZE, async (_e, paths) => {
    try {
      const list = [...new Set((Array.isArray(paths) ? paths : [paths])
        .filter(p => typeof p === 'string' && p.trim()))].slice(0, 40)
      const data = {}
      for (const p of list) {
        const hit = videoSizeCache.get(p)
        if (hit && (hit.size !== null || Date.now() - hit.ts < NEG_TTL_MS)) {
          data[p] = hit.size
          continue
        }
        const size = await readVideoSize(p).catch(() => null)
        videoSizeCache.set(p, { size, ts: Date.now() })
        data[p] = size
      }
      return { ok: true, data }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // === 系统对话框封装 ===
  const mainWindow = getMainWindow  // getter：与原「运行时读取当前窗口」语义一致
  // 通用打开对话框函数：封装 dialog.showOpenDialog，返回选中路径
  // 2026-09-28 审计：原实现直接把 dialog 的 promise 返回给渲染层，一旦抛错（如窗口已销毁时
  // mainWindow() 为 null）就变成 invoke reject，调用处没 .catch 就是 unhandled rejection、
  // 用户侧表现为「点了没反应」。这里统一兜底为 null（等价于「用户取消」），语义不变。
  const doOpen = (props, multi = false) => {
    try {
      const win = mainWindow()
      const p = win ? dialog.showOpenDialog(win, props) : dialog.showOpenDialog(props)
      return p.then(r => r.canceled ? null : (multi ? r.filePaths : r.filePaths[0]))
        .catch(e => { console.error('[dialog] showOpenDialog failed:', e?.message || e); return null })
    } catch (e) {
      console.error('[dialog] showOpenDialog threw:', e?.message || e)
      return Promise.resolve(null)
    }
  }
  // 打开目录选择对话框
  ipcMain.handle(IPC.DIALOG_OPEN_DIR, () => doOpen({ properties: ['openDirectory'] }))
  // 打开视频文件选择对话框
  ipcMain.handle(IPC.DIALOG_OPEN_VIDEO, () => doOpen({ properties: ['openFile'], filters: [{ name: '视频文件', extensions: ['mp4','avi','mkv','mov','flv','wmv','rmvb','m4v','mpg','mpeg','ts','webm','*'] }] }))
  // 打开可执行文件选择对话框
  ipcMain.handle(IPC.DIALOG_OPEN_FILE, () => doOpen({ properties: ['openFile'], filters: [{ name: '可执行文件', extensions: ['exe','bat','cmd'] }, { name: '所有文件', extensions: ['*'] }] }))
  // 保存数据库备份文件对话框
  ipcMain.handle(IPC.DIALOG_SAVE_DB, () => {
    try {
      const win = mainWindow()
      const p = win
        ? dialog.showSaveDialog(win, { defaultPath: `library-backup-${Date.now()}.db`, filters: [{ name: 'SQLite', extensions: ['db','sqlite'] }] })
        : dialog.showSaveDialog({ defaultPath: `library-backup-${Date.now()}.db`, filters: [{ name: 'SQLite', extensions: ['db','sqlite'] }] })
      return p.then(r => r.canceled ? null : r.filePath)
        .catch(e => { console.error('[dialog] showSaveDialog failed:', e?.message || e); return null })
    } catch (e) {
      console.error('[dialog] showSaveDialog threw:', e?.message || e)
      return null
    }
  })
  // 打开数据库文件选择对话框
  ipcMain.handle(IPC.DIALOG_OPEN_DB, () => doOpen({ properties: ['openFile'], filters: [{ name: 'SQLite', extensions: ['db','sqlite'] }] }))

  // === 检查更新 / 打开外部链接（2026-10-05，设置「关于」页） ===
  // 渲染进程 → 主进程：查最新版本号并与当前版本比较。仅用户点「检查更新」时联网（不自动检查）。
  // 实现走 `github.com/.../releases/latest` 的**重定向目标**（/releases/tag/vX.Y.Z）——
  // 不用 api.github.com：匿名 API 在共享出口 IP 下会被限流 403（实测）；该页面同样需要代理，
  // 复用刮削设置里的代理开关（GitHub 在部分网络下直连超时）。
  ipcMain.handle(IPC.UPDATE_CHECK, async () => {
    try {
      const settings = {}
      try {
        const rs = db.exec("SELECT key, value FROM settings WHERE key IN ('proxy_enabled','proxy_url')")
        for (const row of (rs[0]?.values || [])) settings[row[0]] = row[1]
      } catch {}
      const proxy = settings.proxy_enabled === 'y' ? (settings.proxy_url || '') : ''
      const r = await curlGet('https://github.com/P1u2o0/JavTube/releases/latest', {
        proxy, follow: true, withUrl: true, referer: 'https://github.com/P1u2o0/JavTube', timeout: 20000
      })
      if (!r.ok) return { ok: false, error: r.error || ('HTTP ' + r.status) }
      const m = String(r.url || '').match(/\/releases\/tag\/(v?[0-9][0-9.]*)/i)
      if (!m) return { ok: false, error: '未找到版本信息（可能是网络拦截页）' }
      const latest = m[1].replace(/^v/i, '')
      const current = app.getVersion()
      // 数字段逐级比较（1.2.10 > 1.2.9），避免字符串比较把 3.10 判得比 3.9 旧
      const pa = latest.split('.').map(n => parseInt(n, 10) || 0)
      const pb = current.split('.').map(n => parseInt(n, 10) || 0)
      let hasUpdate = false
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0, y = pb[i] || 0
        if (x !== y) { hasUpdate = x > y; break }
      }
      return { ok: true, latest, current, hasUpdate, url: r.url || '' }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // 渲染进程 → 主进程：用系统浏览器打开外部链接（仅 http/https —— 渲染层拿到的参数不完全可信，
  // 不允许借它打开任意本地协议/文件）
  ipcMain.handle(IPC.UTILS_OPEN_EXTERNAL, (_e, url) => {
    try {
      const s = String(url || '')
      if (!/^https?:\/\//i.test(s)) return { ok: false, error: '仅支持 http(s) 链接' }
      shell.openExternal(s)
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // === 刮削功能 ===
  // 渲染进程 → 主进程：根据番号从网络刮削影片信息
  // 参数：ph（番号）、source（刮削来源：auto/javbus/javdb）
  // 图片保存路径由 constants.js 的新布局助手决定、不接受渲染层指定 ——
  // 此前允许渲染层传 coverDir，而它会与番号一起拼进保存路径，等于给了个「往任意位置写文件」的口子
  // 刮削选项（预览图下载开关/数量、统计开关）从 settings 表读取，前端无需逐次传递
  ipcMain.handle(IPC.SCRAPER_SCRAPE, async (_e, { ph, source, skipPreviews }) => {
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
        // 图片落盘到 dataDir（子路径由 scraper 按新布局助手生成）
        dataDir,
        // skipPreviews：补全字段模式且该影片已有预览图时，不必重复下载（10 张/部，批量补全时差别很大）
        downloadPreviews: settings.scrape_previews === 'y' && !skipPreviews,
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
