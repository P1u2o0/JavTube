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
// 恢复数据库前用它试开来源文件（校验是不是可用的 SQLite）
const { getSQL } = require('./init')
// 清空数据库前收集图片引用、清空后清理孤儿文件（2026-09-29 审计）
const { collectAllRefs, purgeUnreferenced } = require('./cleanup')
// 清空后让首页轮播缓存失效（否则首页仍展示已清空的影片）
const { invalidateHomeCache } = require('../home')
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
  // 写 .tmp 再改名（2026-09-28 审计）：原实现直接覆盖写，写一半崩溃/磁盘满会留下坏 JSON，
  // 而 loadCats 解析失败是静默返回 []，用户的自定义分类会「无声消失」。
  const tmp = p + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ categories: cats }, null, 2), 'utf-8')
  fs.renameSync(tmp, p)
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
      // undefined 归一成空串（2026-10-02）：String(undefined) 会把字面量 "undefined" 写进库
      db.run(`INSERT INTO settings(key,value) VALUES (?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [String(key), String(value ?? '')])
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
      // 包在一次事务里（2026-09-29 审计）：注释一直声称「一次事务」，代码却没有 BEGIN/COMMIT，
      // 中途失败会留下半更新的设置。写法与 movies.js 的 BATCH_TAGS/APPLY_TAG_MAP 一致。
      db.run('BEGIN')
      try {
        for (const [key, value] of entries) {
          db.run(`INSERT INTO settings(key,value) VALUES (?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [String(key), String(value ?? '')])
          if (String(key).startsWith('proxy_')) proxyChanged = true
        }
        db.run('COMMIT')
      } catch (e) {
        db.run('ROLLBACK')
        throw e
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
      const saved = persist(db)
      // 落盘失败时不能再拷（2026-09-28 审计）：拷到的会是上一次成功落盘的旧库，
      // 而界面会提示「备份成功」——用户以为拿到的是最新数据。
      // 例外：恢复备份后的 _blockPersist 期间落盘是被有意拦住的，此时磁盘文件正是刚恢复的那份，可以拷。
      if (!saved && !db._blockPersist) {
        return { ok: false, error: '数据库落盘失败，未执行备份（请检查磁盘空间与 data 目录权限后重试）' }
      }
      // 复制数据库文件到目标路径
      fs.copyFileSync(db._dbPath, targetPath)
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: settings:restore — 渲染进程 → 主进程
  // 从备份文件恢复数据库
  ipcMain.handle(IPC.SETTINGS_RESTORE, async (_e, sourcePath) => {
    try {
      if (!sourcePath || !db._dbPath) return { ok: false, error: 'invalid path' }
      if (!fs.existsSync(sourcePath)) return { ok: false, error: 'source not found' }

      // ★ 2026-09-28 审计修复：覆盖前必须确认「这确实是一份能打开的 SQLite 数据库」。
      // 原实现只判断文件存在就 copyFileSync 覆盖 app.db —— 用户随手选个 jpg/zip（对话框
      // 只按扩展名过滤显示，文件名框可以绕开）就会把整库覆盖，重启后加载失败 → 界面全空，
      // 而 .bak 也会随后被顶替，等于一键把数据变成不可恢复状态。
      let head = ''
      try {
        head = fs.readFileSync(sourcePath).subarray(0, 16).toString('latin1')
      } catch (e) {
        return { ok: false, error: '读取来源文件失败：' + e.message }
      }
      if (!head.startsWith('SQLite format 3')) {
        return { ok: false, error: '选中的文件不是 SQLite 数据库（文件头不匹配），已取消恢复' }
      }
      try {
        const Sqlite = await getSQL()
        const probe = new Sqlite.Database(fs.readFileSync(sourcePath))
        const q = probe.exec('PRAGMA integrity_check')
        const verdict = q && q[0] && q[0].values[0] ? String(q[0].values[0][0]) : ''
        try { probe.close() } catch {}
        if (verdict && verdict.toLowerCase() !== 'ok') {
          return { ok: false, error: '数据库完整性校验未通过（' + verdict + '），已取消恢复' }
        }
      } catch (e) {
        return { ok: false, error: '该文件无法作为数据库打开（' + e.message + '），已取消恢复' }
      }

      // 覆盖前把当前库另存一份快照（不复用 .bak：那是正常落盘轮转用的槽位）
      try {
        fs.copyFileSync(db._dbPath, db._dbPath + '.pre-restore-' + Date.now())
      } catch (e) {
        console.warn('[db] 恢复前快照失败（继续）：', e.message)
      }

      // 将备份文件复制到当前数据库路径
      // ⚠️ 这里不能调用 db._forceSave()：那会把内存中的旧数据库导出并覆盖刚恢复的备份文件。
      // 同样地，**恢复之后必须禁止一切落盘**——关窗时的 _forceSave、10 秒定时落盘、
      // 以及后续任何写操作的 persistSoon 都会把内存里的旧库写回去，让恢复白做。
      // 故此处置 _blockPersist=true（由 init.js 的 saveDbToDisk 统一拦截），
      // 直到用户重启应用、重新从磁盘加载恢复后的数据库为止。
      fs.copyFileSync(sourcePath, db._dbPath)
      db._blockPersist = true
      console.log('[db] restored from', sourcePath, '— persist blocked until restart')
      // sql.js 数据库实例在内存中，替换磁盘文件后需要重启应用才能加载新数据
      return { ok: true, info: '请重启软件以加载恢复后的数据（重启前不会再写入数据库）' }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: settings:clear — 渲染进程 → 主进程
  // 清空所有数据（删除影片、女优记录，保留设置），并清理不再被引用的本地图片
  ipcMain.handle(IPC.SETTINGS_CLEAR, () => {
    try {
      // 删库前先收集全库图片引用；删库后所有候选文件都不再被引用 → 全部清掉（2026-09-29 审计）。
      // 注意只删图片目录（images/ 或旧 covers/）内、且确被这几部影片引用的文件，不会波及本来就是孤儿的文件。
      const refs = collectAllRefs(db)
      // 包在一次事务里（2026-09-29 审计）：原实现没有事务，第二步失败会留下「影片已清空、
      // 女优还在」的半清空状态，用户看到的是残缺数据。
      db.run('BEGIN')
      try {
        db.run('DELETE FROM movies')   // 清空影片表
        db.run('DELETE FROM actress')  // 清空女优表
        db.run('COMMIT')
      } catch (e) {
        db.run('ROLLBACK')
        throw e
      }
      const cleaned = purgeUnreferenced(db, dataDir, refs)
      persistSoon(db)
      // 首页轮播缓存存的是影片快照，清空后必须失效，否则首页仍展示已删除的影片
      try { invalidateHomeCache() } catch {}
      return { ok: true, cleaned }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: misc:dataDir — 渲染进程 → 主进程
  // 获取应用数据目录路径（渲染进程用于封面图等资源的路径解析）
  ipcMain.handle(IPC.MISC_DATA_DIR, () => dataDir)
}

module.exports = { registerSettingsIpc, applyProxySettings }
