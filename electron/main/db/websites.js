/**
 * @file websites.js
 * @module electron/main/db/websites
 * @description 网址（收藏网站）数据的 IPC 处理器注册模块。提供网址的列表查询与增删改。
 *              handler 代码自原 movies.js 原样移入（轮次 3 按领域拆分），
 *              IPC 通道名保持不变：websites:list / create / update / delete。
 * @dependencies electron (ipcMain), ./util
 * @keyAPI db.exec(), db.run(), persist()
 */

// db 层通用工具（查询结果转换 / 落盘收口）
const { rows, firstScalar, persist } = require('./util')

/**
 * 注册网址相关的 IPC 处理器。
 * @param {Object} ipcMain - Electron ipcMain 对象
 * @param {Object} db - sql.js 数据库实例
 */
function registerWebsitesIpc(ipcMain, db) {

  // IPC: websites:list — 渲染进程 → 主进程
  // 获取所有网址列表（按分组和 ID 排序）
  ipcMain.handle('websites:list', () => {
    try { return { ok: true, data: rows(db.exec('SELECT * FROM websites ORDER BY grp ASC, id ASC')[0]) } }
    catch (e) { return { ok: false, error: e.message, data: [] } }
  })

  // IPC: websites:create — 渲染进程 → 主进程
  // 创建网址记录
  ipcMain.handle('websites:create', (_e, d) => {
    try {
      d = d || {}
      db.run(`INSERT INTO websites (name,url,grp,img) VALUES (?,?,?,?)`, [d.name||'', d.url||'', d.grp||'', d.img||''])
      const id = Number(firstScalar(db.exec('SELECT last_insert_rowid()')[0]))
      persist(db); return { ok: true, id }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: websites:update — 渲染进程 → 主进程
  // 更新网址信息
  ipcMain.handle('websites:update', (_e, { id, data }) => {
    try {
      const d = data || {}
      db.run(`UPDATE websites SET name=?,url=?,grp=?,img=? WHERE id=?`,
        [d.name||'', d.url||'', d.grp||'', d.img||'', Number(id)])
      persist(db); return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: websites:delete — 渲染进程 → 主进程
  // 删除网址
  ipcMain.handle('websites:delete', (_e, id) => {
    try { db.run('DELETE FROM websites WHERE id=?', [Number(id)])
      persist(db); return { ok: true } }
    catch (e) { return { ok: false, error: e.message } }
  })
}

module.exports = { registerWebsitesIpc }
