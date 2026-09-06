/**
 * @file actress.js
 * @module electron/main/db/actress
 * @description 女优和网址数据的 IPC 处理器注册模块。提供女优的列表查询、详情查询（含参演影片）、
 *              增删改查操作，以及网址（收藏网站）的 CRUD 操作。
 *              注意：此文件与 movies.js 中的 registerActressIpc 功能相似，是独立版本。
 *              所有 IPC 通道均为：渲染进程 → 主进程（ipcMain.handle）。
 * @dependencies electron (ipcMain)
 * @keyAPI db.exec(sql, params) 查询；db.run(sql, params) 写操作
 */

/**
 * 将 sql.js 查询结果（{columns, values} 格式）转换为对象数组。
 * @param {Object} param0 - 解构对象，包含 columns（列名数组）和 values（行数据二维数组）
 * @param {string[]} param0.columns - 列名数组
 * @param {Array[]} param0.values - 行数据二维数组
 * @returns {Object[]} 对象数组，每个对象的键为列名，值为对应数据
 */
function rowsToObj({ columns, values }) {
  return values.map(row => {
    const o = {}
    for (let i = 0; i < columns.length; i++) o[columns[i]] = row[i]
    return o
  })
}

/**
 * 注册女优和网址相关的 IPC 处理器。
 * @param {Object} ipcMain - Electron ipcMain 对象
 * @param {Object} db - sql.js 数据库实例
 */
function registerActressIpc(ipcMain, db) {

  // IPC: actress:list — 渲染进程 → 主进程
  // 获取所有女优列表，按名称升序排列
  ipcMain.handle('actress:list', () => {
    try {
      // 查询全部女优记录，按名称排序
      const r = db.exec('SELECT * FROM actress ORDER BY name ASC')[0]
      return { ok: true, data: r ? rowsToObj(r) : [] }
    } catch (e) { return { ok: false, error: e.message, data: [] } }
  })

  // IPC: actress:get — 渲染进程 → 主进程
  // 获取女优详情，并附带该女优参演的影片列表
  ipcMain.handle('actress:get', (_e, id) => {
    try {
      // 查询女优基本信息
      const r = db.exec('SELECT * FROM actress WHERE id=?', [Number(id)])[0]
      if (!r || !r.values.length) return { ok: false, error: 'not found' }
      const obj = rowsToObj(r)[0]
      // 附带参演影片列表：通过 yid 字段（中文逗号分隔的演员名）匹配
      // 匹配四种位置关系：名字在开头、中间、结尾、独占
      const m = db.exec(`
        SELECT id,ph,pm,cover,fxrq,cl FROM movies
        WHERE yid LIKE ? OR yid LIKE ? OR yid LIKE ? OR yid=?
        ORDER BY fxrq DESC LIMIT 50`,
        [`${obj.name}，%`, `%，${obj.name}，%`, `%，${obj.name}`, obj.name]
      )[0]
      obj.movies = m ? rowsToObj(m) : []
      return { ok: true, data: obj }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: actress:create — 渲染进程 → 主进程
  // 创建女优记录
  ipcMain.handle('actress:create', (_e, data) => {
    try {
      const d = data || {}
      const sql = `INSERT INTO actress (name,img,height,bust,waist,hip,zb,birthday,debut,remark)
        VALUES (?,?,?,?,?,?,?,?,?,?)`
      db.run(sql, [
        d.name||'', d.img||'',
        Number(d.height||0), Number(d.bust||0), Number(d.waist||0), Number(d.hip||0),
        d.zb||'', d.birthday||'', d.debut||'', d.remark||''
      ])
      // 获取自增主键 ID
      const id = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]
      if (db._forceSave) db._forceSave()  // 立即持久化
      return { ok: true, id }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: actress:update — 渲染进程 → 主进程
  // 更新女优信息（全量更新所有字段）
  ipcMain.handle('actress:update', (_e, { id, data }) => {
    try {
      const d = data || {}
      db.run(`UPDATE actress SET name=?,img=?,height=?,bust=?,waist=?,hip=?,zb=?,birthday=?,debut=?,remark=?
        WHERE id=?`, [
        d.name||'', d.img||'',
        Number(d.height||0), Number(d.bust||0), Number(d.waist||0), Number(d.hip||0),
        d.zb||'', d.birthday||'', d.debut||'', d.remark||'',
        Number(id)
      ])
      if (db._forceSave) db._forceSave()  // 立即持久化
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: actress:delete — 渲染进程 → 主进程
  // 删除女优记录
  ipcMain.handle('actress:delete', (_e, id) => {
    try {
      db.run('DELETE FROM actress WHERE id=?', [Number(id)])
      if (db._forceSave) db._forceSave()  // 立即持久化
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // === 网址管理 ===

  // IPC: websites:list — 渲染进程 → 主进程
  // 获取所有网址列表，按分组升序、ID 升序排列
  ipcMain.handle('websites:list', () => {
    try {
      const r = db.exec('SELECT * FROM websites ORDER BY grp ASC, id ASC')[0]
      return { ok: true, data: r ? rowsToObj(r) : [] }
    } catch (e) { return { ok: false, error: e.message, data: [] } }
  })

  // IPC: websites:create — 渲染进程 → 主进程
  // 创建网址记录
  ipcMain.handle('websites:create', (_e, d) => {
    try {
      d = d || {}
      const sql = `INSERT INTO websites (name,url,grp,img) VALUES (?,?,?,?)`
      db.run(sql, [d.name||'', d.url||'', d.grp||'', d.img||''])
      // 获取自增主键 ID
      const id = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0]
      if (db._forceSave) db._forceSave()  // 立即持久化
      return { ok: true, id }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: websites:update — 渲染进程 → 主进程
  // 更新网址信息
  ipcMain.handle('websites:update', (_e, { id, data }) => {
    try {
      const d = data || {}
      db.run(`UPDATE websites SET name=?,url=?,grp=?,img=? WHERE id=?`,
        [d.name||'', d.url||'', d.grp||'', d.img||'', Number(id)])
      if (db._forceSave) db._forceSave()  // 立即持久化
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: websites:delete — 渲染进程 → 主进程
  // 删除网址记录
  ipcMain.handle('websites:delete', (_e, id) => {
    try {
      db.run('DELETE FROM websites WHERE id=?', [Number(id)])
      if (db._forceSave) db._forceSave()  // 立即持久化
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })
}

module.exports = { registerActressIpc }
