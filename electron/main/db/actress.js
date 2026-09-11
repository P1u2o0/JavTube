/**
 * @file actress.js
 * @module electron/main/db/actress
 * @description 女优数据的 IPC 处理器注册模块。提供女优的列表查询、
 *              详情查询（含参演影片，通过 movies.yid 演员名匹配）、增删改。
 *              handler 代码自原 movies.js 原样移入（轮次 3 按领域拆分），
 *              IPC 通道名保持不变：actress:list / get / create / update / delete。
 * @dependencies electron (ipcMain), ./util
 * @keyAPI db.exec(), db.run(), persist()
 */

// db 层通用工具（查询结果转换 / 落盘收口）
const { rows, firstRow, firstScalar, persistSoon } = require('./util')
// IPC 通道名常量（preload 与 main 共享，定义于 common/ipc-channels.js）
const IPC = require('../../common/ipc-channels')

/**
 * 注册女优相关的 IPC 处理器。
 * @param {Object} ipcMain - Electron ipcMain 对象
 * @param {Object} db - sql.js 数据库实例
 */
function registerActressIpc(ipcMain, db) {

  // IPC: actress:list — 渲染进程 → 主进程
  // 获取所有女优列表（按名称排序）
  ipcMain.handle(IPC.ACTRESS_LIST, () => {
    try { return { ok: true, data: rows(db.exec('SELECT * FROM actress ORDER BY name ASC')[0]) } }
    catch (e) { return { ok: false, error: e.message, data: [] } }
  })

  // IPC: actress:get — 渲染进程 → 主进程
  // 获取女优详情，并附带该女优参演的影片列表
  ipcMain.handle(IPC.ACTRESS_GET, (_e, id) => {
    try {
      // 查询女优基本信息
      const m = firstRow(db.exec('SELECT * FROM actress WHERE id=?', [Number(id)])[0])
      if (!m) return { ok: false, error: 'not found' }
      m.movies = []
      // 查询该女优参演的影片：通过 movies.yid 字段（中文逗号分隔的演员名）匹配
      // 需要匹配四种位置关系：开头、中间、结尾、独占
      const nm = m.name
      const patterns = [
        `${nm}，%`,    // 名字在开头
        `%，${nm}，%`, // 名字在中间
        `%，${nm}`,     // 名字在结尾
        nm              // 名字独占（唯一演员）
      ]
      const q = `SELECT id,ph,pm,cover,fxrq,cl FROM movies WHERE
        yid LIKE ? OR yid LIKE ? OR yid LIKE ? OR yid=? ORDER BY fxrq DESC LIMIT 50`
      m.movies = rows(db.exec(q, patterns)[0])
      return { ok: true, data: m }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: actress:create — 渲染进程 → 主进程
  // 创建女优记录
  ipcMain.handle(IPC.ACTRESS_CREATE, (_e, data) => {
    try {
      const d = data || {}
      db.run(`INSERT INTO actress (name,img,height,bust,waist,hip,zb,birthday,debut,remark)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, [
        d.name||'', d.img||'',
        Number(d.height||0), Number(d.bust||0), Number(d.waist||0), Number(d.hip||0),
        d.zb||'', d.birthday||'', d.debut||'', d.remark||''
      ])
      const id = Number(firstScalar(db.exec('SELECT last_insert_rowid()')[0]))
      persistSoon(db); return { ok: true, id }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: actress:update — 渲染进程 → 主进程
  // 更新女优信息
  ipcMain.handle(IPC.ACTRESS_UPDATE, (_e, { id, data }) => {
    try {
      const d = data || {}
      db.run(`UPDATE actress SET name=?,img=?,height=?,bust=?,waist=?,hip=?,zb=?,birthday=?,debut=?,remark=? WHERE id=?`, [
        d.name||'', d.img||'',
        Number(d.height||0), Number(d.bust||0), Number(d.waist||0), Number(d.hip||0),
        d.zb||'', d.birthday||'', d.debut||'', d.remark||'', Number(id)
      ])
      persistSoon(db); return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: actress:delete — 渲染进程 → 主进程
  // 删除女优
  ipcMain.handle(IPC.ACTRESS_DELETE, (_e, id) => {
    try { db.run('DELETE FROM actress WHERE id=?', [Number(id)])
      persistSoon(db); return { ok: true } }
    catch (e) { return { ok: false, error: e.message } }
  })
}

module.exports = { registerActressIpc }
