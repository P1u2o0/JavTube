/**
 * @file movies.js
 * @module electron/main/db/movies
 * @description 影片和女优数据的 IPC 处理器注册模块。使用 sql.js 风格 API 操作数据库。
 *              包含影片的增删改查、批量操作（收藏/标签）、搜索，以及女优和网址的 CRUD 操作。
 *              所有 IPC 通道均为：渲染进程 → 主进程（ipcMain.handle）。
 *
 * @dependencies electron (ipcMain)
 * @keyAPI db.exec(sql, params) => [{columns, values}] 查询；db.run(sql, params) 执行写操作
 *         db.exec('SELECT last_insert_rowid() id')[0].values[0][0] 获取最后插入的 ID
 */

// 标签分隔符：使用中文逗号（全角）
const DELIM = '\uff0c'
// 收藏标记常量：'y' 表示已收藏，'n' 表示未收藏
const FAV_Y = 'y', FAV_N = 'n'

/**
 * 将 sql.js 查询结果（{columns, values} 格式）转换为对象数组。
 * @param {Object} r - sql.js exec 返回的结果对象，包含 columns 和 values
 * @returns {Object[]} 对象数组，每个对象的键为列名，值为对应数据
 */
function rows(r) {
  if (!r || !r.values || !r.values.length) return []
  return r.values.map(row => {
    const o = {}
    for (let i = 0; i < r.columns.length; i++) o[r.columns[i]] = row[i]
    return o
  })
}

/**
 * 获取查询结果的第一行（转换为对象）。
 * @param {Object} r - sql.js 查询结果
 * @returns {Object|undefined} 第一行数据对象，无结果时返回 undefined
 */
function firstRow(r) { return rows(r)[0] }

/**
 * 获取查询结果的第一个标量值（第一行第一列）。
 * @param {Object} r - sql.js 查询结果
 * @returns {*} 第一个值，无结果时返回 undefined
 */
function firstScalar(r) { return r?.values?.[0]?.[0] }

/**
 * 生成当前时间的 ISO 格式字符串（本地时间，精确到秒）。
 * 格式：YYYY-MM-DD HH:mm:ss
 * @returns {string} 格式化的时间字符串
 */
function nowIso() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')  // 补零函数
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// === 影片 IPC 处理器注册 ===
/**
 * 注册影片相关的 IPC 处理器。
 * 包括分页查询、单条查询、创建、更新、删除、批量收藏/标签、播放记录和搜索。
 * @param {Object} ipcMain - Electron ipcMain 对象
 * @param {Object} db - sql.js 数据库实例
 */
function registerMovieIpc(ipcMain, db) {

  // IPC: movies:get — 渲染进程 → 主进程
  // 分页查询影片列表，支持过滤、排序、分页、只看收藏等
  ipcMain.handle('movies:get', (_e, params) => {
    try {
      params = params || {}
      // 解构参数：过滤条件、排序、分页、是否只看收藏
      const { filter = {}, sort = { by: 'tjrq', order: 'DESC', random: false }, page = 1, pageSize = 20, onlyFavorite = false } = params
      // 构建 WHERE 条件，初始为恒真
      const where = ['1=1']
      const args = []

      // 分类过滤
      if (filter.fl && filter.fl !== '全部') { where.push('fl = ?'); args.push(filter.fl) }
      // 只看收藏
      if (onlyFavorite || filter.onlyFavorite) { where.push('cl = ?'); args.push(FAV_Y) }
      // 按演员过滤（模糊匹配 yid 字段）
      if (filter.actress) { where.push('yid LIKE ?'); args.push(`%${filter.actress}%`) }
      // 按制作商/发行商过滤
      if (filter.studio) { where.push('(ps LIKE ? OR fx LIKE ?)'); args.push(`%${filter.studio}%`, `%${filter.studio}%`) }
      // 按系列过滤
      if (filter.series) { where.push('xl LIKE ?'); args.push(`%${filter.series}%`) }
      // 只看有播放记录的
      if (filter.historyOnly) { where.push('play_time IS NOT NULL') }

      // 标签筛选：支持多组标签，所有选中的标签均按 AND 叠加过滤（精准定位目标影片）
      const sel = filter.tagSelected || []
      for (let ci = 0; ci < sel.length; ci++) {
        const tags = sel[ci]
        if (Array.isArray(tags) && tags.length) {
          // 同组内、不同组间的标签都使用 AND 连接（必须全部同时匹配）
          const ors = tags.map(() => 'bq LIKE ?')
          for (const t of tags) args.push(`%${t}%`)
          where.push('(' + ors.join(' AND ') + ')')
        }
      }
      // 关键词搜索（在番号、片名、标签中模糊匹配）
      if (filter.q && filter.q.trim()) {
        const q = `%${filter.q.trim()}%`
        where.push('(ph LIKE ? OR pm LIKE ? OR bq LIKE ?)')
        args.push(q, q, q)
      }

      const whereSql = 'WHERE ' + where.join(' AND ')

      // 查询总数（用于分页）
      const totalR = db.exec(`SELECT COUNT(*) FROM movies ${whereSql}`, args)[0]
      const total = Number(firstScalar(totalR)) || 0

      // 构建排序子句
      let orderSql = ''
      if (sort.random) {
        // 随机排序
        orderSql = 'ORDER BY RANDOM()'
      } else {
        // 白名单列名排序，防止 SQL 注入
        const allowed = ['id','ph','pm','pfs','yz','tjrq','fxrq','zb','tix','cl','play_time']
        const col = allowed.includes(sort.by) ? sort.by : 'tjrq'
        const dir = String(sort.order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
        orderSql = `ORDER BY ${col} ${dir}`
      }
      // 分页参数计算
      const ps = Math.max(1, Number(pageSize) || 20)  // 每页条数
      const pg = Math.max(1, Number(page) || 1)        // 当前页码
      const off = (pg - 1) * ps                         // 偏移量

      // 查询当前页数据
      const dataR = db.exec(`SELECT * FROM movies ${whereSql} ${orderSql} LIMIT ? OFFSET ?`, [...args, ps, off])
      const data = rows(dataR[0])
      return { ok: true, data, total }
    } catch (e) {
      console.error('[ipc movies:get]', e)
      return { ok: false, error: e.message, data: [], total: 0 }
    }
  })

  // IPC: movies:getOne — 渲染进程 → 主进程
  // 根据 ID 查询单条影片详情
  ipcMain.handle('movies:getOne', (_e, id) => {
    try {
      const r = db.exec('SELECT * FROM movies WHERE id=?', [Number(id)])
      const m = firstRow(r[0])
      return m ? { ok: true, data: m } : { ok: false, error: 'not found' }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:create — 渲染进程 → 主进程
  // 创建新影片记录，番号重复时跳过
  ipcMain.handle('movies:create', (_e, data) => {
    try {
      const d = data || {}
      // 设置添加日期，默认为当前时间
      const tjrq = d.tjrq || nowIso()
      // 标签标准化：将中文/英文逗号分隔的标签统一为中文逗号分隔
      if (d.bq) d.bq = d.bq.split(/[，,]/).map(s => s.trim()).filter(Boolean).join(DELIM)
      // 番号去重：已存在则跳过，返回已有 ID
      if (d.ph) {
        const exist = db.exec('SELECT id FROM movies WHERE ph=?', [d.ph])
        const existId = exist[0] ? firstScalar(exist[0]) : null
        if (existId) {
          return { ok: true, id: Number(existId), skipped: true }
        }
      }
      // 插入新记录
      const sql = `INSERT INTO movies
        (ph,pm,cover,yid,yy,fxrq,fl,zz,lc,pj,dt,dm,vr,sd,hj,pfs,yz,zb,tix,bq,jt,py,cl,tjrq,dx,dy,sc,ps,fx,xl)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      const vals = [
        d.ph||'', d.pm||'', d.cover||'', d.yid||'', d.yy||'', d.fxrq||'',
        d.fl||'全部', d.zz||'n', d.lc||'n', d.pj||'n',
        d.dt||'n', d.dm||'n', d.vr||'n', d.sd||'n', d.hj||'n',
        Number(d.pfs||0), Number(d.yz||0), d.zb||'A', d.tix||'正常',
        d.bq||'', d.jt||'', d.py||'', d.cl||'n', tjrq,
        Number(d.dx||0), d.dy||'', d.sc||'', d.ps||'', d.fx||'', d.xl||''
      ]
      db.run(sql, vals)
      // 获取自增主键 ID
      const id = firstScalar(db.exec('SELECT last_insert_rowid()')[0])
      if (db._forceSave) db._forceSave()  // 立即持久化
      return { ok: true, id: Number(id) }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:update — 渲染进程 → 主进程
  // 更新指定 ID 的影片记录（先读取现有数据，再合并更新）
  ipcMain.handle('movies:update', (_e, { id, data }) => {
    try {
      // 先查询当前记录
      const r0 = db.exec('SELECT * FROM movies WHERE id=?', [Number(id)])
      const cur = firstRow(r0[0])
      if (!cur) return { ok: false, error: 'not found' }
      // 合并：用传入数据覆盖现有数据
      const d = { ...cur, ...(data||{}) }
      // 标签标准化
      if (d.bq) d.bq = d.bq.split(/[，,]/).map(s => s.trim()).filter(Boolean).join(DELIM)
      // 执行更新
      db.run(`UPDATE movies SET
        ph=?,pm=?,cover=?,yid=?,yy=?,fxrq=?,fl=?,zz=?,lc=?,pj=?,dt=?,dm=?,vr=?,sd=?,hj=?,
        pfs=?,yz=?,zb=?,tix=?,bq=?,jt=?,py=?,cl=?,dx=?,dy=?,sc=?,ps=?,fx=?,xl=? WHERE id=?`, [
        d.ph||'', d.pm||'', d.cover||'', d.yid||'', d.yy||'', d.fxrq||'',
        d.fl||'全部', d.zz||'n', d.lc||'n', d.pj||'n',
        d.dt||'n', d.dm||'n', d.vr||'n', d.sd||'n', d.hj||'n',
        Number(d.pfs||0), Number(d.yz||0), d.zb||'A', d.tix||'正常',
        d.bq||'', d.jt||'', d.py||'', d.cl||'n',
        Number(d.dx||0), d.dy||'', d.sc||'', d.ps||'', d.fx||'', d.xl||'', Number(id)
      ])
      if (db._forceSave) db._forceSave()  // 立即持久化
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:delete — 渲染进程 → 主进程
  // 删除单条影片
  ipcMain.handle('movies:delete', (_e, id) => {
    try { db.run('DELETE FROM movies WHERE id=?', [Number(id)]); if(db._forceSave) db._forceSave(); return { ok: true } }
    catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:deleteMany — 渲染进程 → 主进程
  // 批量删除影片
  ipcMain.handle('movies:deleteMany', (_e, ids) => {
    try {
      for (const id of (ids||[])) db.run('DELETE FROM movies WHERE id=?', [Number(id)])
      if(db._forceSave) db._forceSave(); return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:batchFav — 渲染进程 → 主进程
  // 批量设置收藏状态
  ipcMain.handle('movies:batchFav', (_e, { ids, isFav }) => {
    try {
      const val = isFav ? FAV_Y : FAV_N
      for (const id of (ids||[])) db.run('UPDATE movies SET cl=? WHERE id=?', [val, Number(id)])
      if(db._forceSave) db._forceSave(); return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:batchTags — 渲染进程 → 主进程
  // 批量追加标签（不覆盖原有标签，在原有基础上追加）
  ipcMain.handle('movies:batchTags', (_e, { ids, tags }) => {
    try {
      const list = Array.isArray(tags) ? tags : []
      if (!list.length) return { ok: true }
      for (const id of (ids||[])) {
        // 获取当前标签
        const r0 = db.exec('SELECT bq FROM movies WHERE id=?', [Number(id)])
        const cur = firstScalar(r0[0]) || ''
        // 解析现有标签为 Set（去重）
        const existing = new Set(cur.split(/[，,]/).map(s => s.trim()).filter(Boolean))
        // 追加新标签
        for (const t of list) existing.add(t)
        // 拼接为字符串并更新（不要额外追加尾部分隔符，避免 bq 字段尾部残留逗号）
        const newBq = Array.from(existing).join(DELIM)
        db.run('UPDATE movies SET bq=? WHERE id=?', [newBq, Number(id)])
      }
      if(db._forceSave) db._forceSave(); return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:getAllTags — 渲染进程 → 主进程
  // 获取所有影片中使用过的标签列表（按使用频率降序排列）
  ipcMain.handle('movies:getAllTags', () => {
    try {
      // 查询所有非空的标签字段
      const r = db.exec("SELECT bq FROM movies WHERE bq IS NOT NULL AND bq != ''")[0]
      const counts = {}
      if (r) for (const row of r.values) {
        // 拆分标签并统计出现次数
        const parts = (row[0] || '').split(/[，,]/).map(s => s.trim()).filter(Boolean)
        for (const p of parts) counts[p] = (counts[p] || 0) + 1
      }
      // 按频率降序排序后提取标签名
      const tags = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([tag]) => tag)
      return { ok: true, tags }
    } catch (e) { return { ok: false, error: e.message, tags: [] } }
  })

  // IPC: movies:recordPlay — 渲染进程 → 主进程
  // 记录影片播放时间（更新 play_time 字段）
  ipcMain.handle('movies:recordPlay', (_e, id) => {
    try {
      const now = new Date().toISOString()
      db.run('UPDATE movies SET play_time = ? WHERE id = ?', [now, Number(id)])
      if (db._forceSave) db._forceSave()
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:search — 渲染进程 → 主进程
  // 全局搜索：支持在影片、女优、网址三个范围内搜索
  ipcMain.handle('movies:search', (_e, { scope, q }) => {
    try {
      q = (q || '').trim()
      if (!q) return { ok: true, scope, data: [] }
      const like = `%${q}%`
      let sql, args
      if (scope === 'actress') {
        // 搜索女优：按名称模糊匹配
        sql = 'SELECT * FROM actress WHERE name LIKE ? ORDER BY id DESC LIMIT 50'; args = [like]
      } else if (scope === 'website') {
        // 搜索网址：按名称或 URL 模糊匹配
        sql = 'SELECT * FROM websites WHERE name LIKE ? OR url LIKE ? ORDER BY id DESC LIMIT 50'; args = [like, like]
      } else {
        // 默认搜索影片：在番号、片名、标签中模糊匹配
        sql = 'SELECT * FROM movies WHERE ph LIKE ? OR pm LIKE ? OR bq LIKE ? ORDER BY id DESC LIMIT 50'; args = [like, like, like]
      }
      const r = db.exec(sql, args)
      return { ok: true, scope, data: rows(r[0]) }
    } catch (e) { return { ok: false, error: e.message } }
  })
}

// === 女优 + 网址 IPC 处理器注册 ===
/**
 * 注册女优和网址相关的 IPC 处理器。
 * 包括女优的列表、详情（含参演影片）、增删改，以及网址的 CRUD。
 * @param {Object} ipcMain - Electron ipcMain 对象
 * @param {Object} db - sql.js 数据库实例
 */
function registerActressIpc(ipcMain, db) {

  // IPC: actress:list — 渲染进程 → 主进程
  // 获取所有女优列表（按名称排序）
  ipcMain.handle('actress:list', () => {
    try { return { ok: true, data: rows(db.exec('SELECT * FROM actress ORDER BY name ASC')[0]) } }
    catch (e) { return { ok: false, error: e.message, data: [] } }
  })

  // IPC: actress:get — 渲染进程 → 主进程
  // 获取女优详情，并附带该女优参演的影片列表
  ipcMain.handle('actress:get', (_e, id) => {
    try {
      // 查询女优基本信息
      const m = firstRow(db.exec('SELECT * FROM actress WHERE id=?', [Number(id)])[0])
      if (!m) return { ok: false, error: 'not found' }
      m.movies = []
      // 查询该女优参演的影片：通过 yid 字段（中文逗号分隔的演员名）匹配
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
  ipcMain.handle('actress:create', (_e, data) => {
    try {
      const d = data || {}
      db.run(`INSERT INTO actress (name,img,height,bust,waist,hip,zb,birthday,debut,remark)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, [
        d.name||'', d.img||'',
        Number(d.height||0), Number(d.bust||0), Number(d.waist||0), Number(d.hip||0),
        d.zb||'', d.birthday||'', d.debut||'', d.remark||''
      ])
      const id = Number(firstScalar(db.exec('SELECT last_insert_rowid()')[0]))
      if(db._forceSave) db._forceSave(); return { ok: true, id }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: actress:update — 渲染进程 → 主进程
  // 更新女优信息
  ipcMain.handle('actress:update', (_e, { id, data }) => {
    try {
      const d = data || {}
      db.run(`UPDATE actress SET name=?,img=?,height=?,bust=?,waist=?,hip=?,zb=?,birthday=?,debut=?,remark=? WHERE id=?`, [
        d.name||'', d.img||'',
        Number(d.height||0), Number(d.bust||0), Number(d.waist||0), Number(d.hip||0),
        d.zb||'', d.birthday||'', d.debut||'', d.remark||'', Number(id)
      ])
      if(db._forceSave) db._forceSave(); return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: actress:delete — 渲染进程 → 主进程
  // 删除女优
  ipcMain.handle('actress:delete', (_e, id) => {
    try { db.run('DELETE FROM actress WHERE id=?', [Number(id)])
      if(db._forceSave) db._forceSave(); return { ok: true } }
    catch (e) { return { ok: false, error: e.message } }
  })

  // === 网址管理 ===

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
      if(db._forceSave) db._forceSave(); return { ok: true, id }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: websites:update — 渲染进程 → 主进程
  // 更新网址信息
  ipcMain.handle('websites:update', (_e, { id, data }) => {
    try {
      const d = data || {}
      db.run(`UPDATE websites SET name=?,url=?,grp=?,img=? WHERE id=?`,
        [d.name||'', d.url||'', d.grp||'', d.img||'', Number(id)])
      if(db._forceSave) db._forceSave(); return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: websites:delete — 渲染进程 → 主进程
  // 删除网址
  ipcMain.handle('websites:delete', (_e, id) => {
    try { db.run('DELETE FROM websites WHERE id=?', [Number(id)])
      if(db._forceSave) db._forceSave(); return { ok: true } }
    catch (e) { return { ok: false, error: e.message } }
  })
}

module.exports = { registerMovieIpc, registerActressIpc }
