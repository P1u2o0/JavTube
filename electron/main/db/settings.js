/**
 * @file settings.js
 * @module electron/main/db/settings
 * @description 应用设置 IPC 处理器注册模块。提供设置的读写、标签分类管理（JSON 文件存储）、
 *              数据库备份与恢复、数据清空，以及数据目录路径获取。
 *              所有 IPC 通道均为：渲染进程 → 主进程（ipcMain.handle）。
 * @dependencies fs, path
 * @keyAPI db.exec(), db.run(), fs.copyFileSync(), fs.existsSync()
 */

const fs = require('fs')
const path = require('path')
const { session } = require('electron')
// db 层通用工具（落盘收口）
const { persistSoon, persist } = require('./util')
// IPC 通道名常量（preload 与 main 共享，定义于 common/ipc-channels.js）
const IPC = require('../../common/ipc-channels')

/**
 * 从 JSON 文件加载标签分类数据。
 * 标签分类存储在数据目录下的 tag-categories.json 文件中。
 * @param {string} dataDir - 数据目录路径
 * @returns {Array} 标签分类数组，加载失败返回空数组
 */
function loadCats(dataDir) {
  const p = path.join(dataDir, 'tag-categories.json')
  try {
    if (fs.existsSync(p)) {
      // 读取 JSON 文件并解析 categories 字段
      return JSON.parse(fs.readFileSync(p, 'utf-8')).categories || []
    }
  } catch (e) { console.warn('loadCats err', e.message) }
  return []
}

/**
 * 保存标签分类数据到 JSON 文件。
 * @param {string} dataDir - 数据目录路径
 * @param {Array} cats - 标签分类数组
 */
function saveCats(dataDir, cats) {
  const p = path.join(dataDir, 'tag-categories.json')
  // 将分类数组包装为 { categories: [...] } 格式并格式化输出
  fs.writeFileSync(p, JSON.stringify({ categories: cats }, null, 2), 'utf-8')
}

/**
 * 应用代理设置到 Electron 默认 session（2026-09-09 新增）。
 * 开启（proxy_enabled='y'）时使用用户配置的 proxy_url 作为 HTTP 代理规则，
 * 关闭时恢复跟随系统代理。Electron 的 net.fetch（刮削请求）走 defaultSession，
 * 因此设置后刮削 JAVDB 等站点会自动经过本机代理，无需改动 scraper 代码。
 * @returns {Promise<void>}
 */
async function applyProxySettings(db) {
  try {
    const r = db.exec("SELECT key, value FROM settings WHERE key IN ('proxy_enabled','proxy_url')")[0]
    const map = {}
    if (r) for (const row of r.values) map[row[0]] = row[1]
    if (map.proxy_enabled === 'y') {
      const rules = map.proxy_url || 'http://127.0.0.1:7890'
      await session.defaultSession.setProxy({ proxyRules: rules })
      console.log('[proxy] enabled:', rules)
    } else {
      await session.defaultSession.setProxy({ mode: 'system' })
      console.log('[proxy] disabled (follow system)')
    }
  } catch (e) { console.warn('[proxy] apply failed:', e.message) }
}

/**
 * 注册设置相关的 IPC 处理器。
 * @param {Object} ipcMain - Electron ipcMain 对象
 * @param {Object} db - sql.js 数据库实例
 * @param {string} dataDir - 数据目录路径
 */
function registerSettingsIpc(ipcMain, db, dataDir) {

  // IPC: settings:get — 渲染进程 → 主进程
  // 获取所有设置项（键值对形式）
  ipcMain.handle(IPC.SETTINGS_GET, () => {
    try {
      // 查询 settings 表中的所有记录
      const r = db.exec('SELECT key, value FROM settings')[0]
      const out = {}
      // 将二维数组转换为对象 { key: value }
      if (r) for (const row of r.values) out[row[0]] = row[1]
      return { ok: true, data: out }
    } catch (e) { return { ok: false, error: e.message, data: {} } }
  })

  // IPC: settings:update — 渲染进程 → 主进程
  // 更新单个设置项（不存在则插入，存在则更新）
  ipcMain.handle(IPC.SETTINGS_UPDATE, (_e, { key, value }) => {
    try {
      // 使用 INSERT ... ON CONFLICT 实现 upsert 语义
      // 如果 key 不存在则插入，已存在则更新 value
      db.run(`INSERT INTO settings(key,value) VALUES (?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [String(key), String(value)])
      persistSoon(db)
      // 代理相关设置变更时，即时应用到 Electron session（异步执行不阻塞返回）
      if (String(key).startsWith('proxy_')) applyProxySettings(db)
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: settings:updateBatch — 渲染进程 → 主进程（2026-09-10 新增）
  // 批量更新设置项：一次事务写入多条、只做一次整库持久化。
  // 此前渲染端逐键调用 SETTINGS_UPDATE（每键一次 persist），保存时明显卡顿。
  ipcMain.handle(IPC.SETTINGS_UPDATE_BATCH, (_e, obj) => {
    try {
      const entries = Object.entries(obj || {})
      if (!entries.length) return { ok: true }
      let proxyChanged = false
      for (const [key, value] of entries) {
        db.run(`INSERT INTO settings(key,value) VALUES (?,?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [String(key), String(value)])
        if (String(key).startsWith('proxy_')) proxyChanged = true
      }
      persistSoon(db)  // 全部写完后只持久化一次（延迟落盘）
      if (proxyChanged) applyProxySettings(db)
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: settings:getTagCats — 渲染进程 → 主进程
  // 获取标签分类列表（从 JSON 文件读取）
  ipcMain.handle(IPC.SETTINGS_GET_TAG_CATS, () => {
    return { ok: true, data: loadCats(dataDir) }
  })

  // IPC: settings:saveTagCats — 渲染进程 → 主进程
  // 保存标签分类列表（写入 JSON 文件）
  ipcMain.handle(IPC.SETTINGS_SAVE_TAG_CATS, (_e, cats) => {
    try {
      saveCats(dataDir, Array.isArray(cats) ? cats : [])
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: settings:backup — 渲染进程 → 主进程
  // 备份数据库到指定路径
  ipcMain.handle(IPC.SETTINGS_BACKUP, (_e, targetPath) => {
    try {
      if (!targetPath || !db._dbPath) return { ok: false, error: 'invalid path' }
      // 必须先「同步」落盘再拷贝：
      // persistSoon 只是把落盘推迟到本轮事件循环之后（setImmediate），
      // 紧接着 copyFileSync 拷到的仍是磁盘上的旧库 → 备份会丢最近操作。
      persist(db)
      // 复制数据库文件到目标路径
      fs.copyFileSync(db._dbPath, targetPath)
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: settings:restore — 渲染进程 → 主进程
  // 从备份文件恢复数据库
  ipcMain.handle(IPC.SETTINGS_RESTORE, (_e, sourcePath) => {
    try {
      if (!sourcePath || !db._dbPath) return { ok: false, error: 'invalid path' }
      if (!fs.existsSync(sourcePath)) return { ok: false, error: 'source not found' }
      // 将备份文件复制到当前数据库路径
      // 注意：这里不能调用 db._forceSave()！那会把内存中的旧数据库导出并覆盖刚恢复的备份文件，
      // 导致恢复操作失效（复制进去的新数据被旧内存数据覆盖回去）。
      fs.copyFileSync(sourcePath, db._dbPath)
      // sql.js 数据库实例在内存中，替换磁盘文件后需要重启应用才能加载新数据
      return { ok: true, info: 'Please restart app to load restored DB' }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: settings:clear — 渲染进程 → 主进程
  // 清空所有数据（删除影片、女优记录，保留设置）
  ipcMain.handle(IPC.SETTINGS_CLEAR, () => {
    try {
      db.run('DELETE FROM movies')   // 清空影片表
      db.run('DELETE FROM actress')  // 清空女优表
      persistSoon(db)
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: misc:dataDir — 渲染进程 → 主进程
  // 获取应用数据目录路径（渲染进程用于封面图等资源的路径解析）
  ipcMain.handle(IPC.MISC_DATA_DIR, () => dataDir)
}

module.exports = { registerSettingsIpc, applyProxySettings }
