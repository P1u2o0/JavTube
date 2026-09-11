/**
 * @file movies.js
 * @module electron/main/db/movies
 * @description 影片数据的 IPC 处理器注册模块。使用 sql.js 风格 API 操作数据库。
 *              包含影片的增删改查、批量操作（收藏/标签）、搜索。
 *              女优与网址的 IPC 分别位于 actress.js / websites.js（轮次 3 拆分）。
 *              所有 IPC 通道均为：渲染进程 → 主进程（ipcMain.handle）。
 *
 * @dependencies electron (ipcMain), ../constants, ./util
 * @keyAPI db.exec(sql, params) => [{columns, values}] 查询；db.run(sql, params) 执行写操作
 *         db.exec('SELECT last_insert_rowid() id')[0].values[0][0] 获取最后插入的 ID
 */

// 标签分隔符、收藏标记等共享常量（集中定义于 constants.js）
const { TAG_DELIM, FAV_Y, FAV_N, SORTABLE_COLUMNS } = require('../constants')
// db 层通用工具（查询结果转换 / 时间格式 / 落盘收口 persistSoon 等）
const { rows, firstRow, firstScalar, nowLocal, persistSoon } = require('./util')
// IPC 通道名常量（preload 与 main 共享，定义于 common/ipc-channels.js）
const IPC = require('../../common/ipc-channels')

// === 影片表字段元数据 ===
/**
 * movies 表可写列元数据（按 INSERT 列顺序排列）。
 * 用于统一生成 INSERT 与 UPDATE 语句及其参数（见下方 INSERT_MOVIE_SQL 等），
 * 替代原先两份手工维护的字段清单——新增字段只需在此追加一行。
 * 取值器语义与原实现逐字段一致：
 *   S(k, def)  字符串字段，空值回退默认（等价于原来的 d[k] || def）
 *   N(k)       数字字段（等价于原来的 Number(d[k] || 0)）
 * 注意：tjrq（添加日期）仅在 INSERT 时写入，UPDATE 生成时会过滤此列，
 *       保持原「更新不改动添加日期」的业务行为。
 */
const S = (k, def = '') => d => d[k] || def
const N = (k) => d => Number(d[k] || 0)
const MOVIE_COLUMNS = [
  ['ph',    S('ph')],
  ['pm',    S('pm')],
  ['cover', S('cover')],
  ['yid',   S('yid')],
  ['yy',    S('yy')],
  ['fxrq',  S('fxrq')],
  ['fl',    S('fl', '全部')],
  ['zz',    S('zz', 'n')],
  ['lc',    S('lc', 'n')],
  ['pj',    S('pj', 'n')],
  ['dt',    S('dt', 'n')],
  ['dm',    S('dm', 'n')],
  ['vr',    S('vr', 'n')],
  ['sd',    S('sd', 'n')],
  ['hj',    S('hj', 'n')],
  ['pfs',   N('pfs')],
  ['yz',    N('yz')],
  ['zb',    S('zb', 'A')],
  ['tix',   S('tix', '正常')],
  ['bq',    S('bq')],
  ['jt',    S('jt')],
  ['py',    S('py')],
  ['cl',    S('cl', 'n')],
  ['tjrq',  d => d.tjrq || nowLocal()],
  ['dx',    N('dx')],
  ['dy',    S('dy')],
  // 注：旧字段 sc（时长·秒）已于 2026-09-11 移除——全库无写入也无读取，
  // 时长统一使用 duration（分钟）。DB 列保留不动，仅不再参与读写。
  ['ps',    S('ps')],
  ['fx',    S('fx')],
  ['xl',    S('xl')],
  // 2026-09-09 刮削增强新增列（init.js 已 ALTER 兼容旧库）
  ['previews', S('previews')],  // 预览图本地路径 JSON 数组
  ['want',     N('want')],      // 想看人数（JAVDB）
  ['watched',  N('watched')],   // 看过人数（JAVDB）
  ['score',    N('score')],     // 评分（JAVDB）
  // 2026-09-09 下午新增（详情页改版）
  ['duration',   N('duration')],   // 影片时长（分钟）：刮削優先，无值时由视频文件解析补齐
  ['play_count', N('play_count')]  // 观看次数（recordPlay 累加，供排序）
]

// INSERT 语句与参数构造器（全部 30 列）
const INSERT_MOVIE_SQL =
  `INSERT INTO movies (${MOVIE_COLUMNS.map(([c]) => c).join(',')}) ` +
  `VALUES (${MOVIE_COLUMNS.map(() => '?').join(',')})`
const buildMovieInsertParams = (d) => MOVIE_COLUMNS.map(([, get]) => get(d))

// UPDATE 语句与参数构造器（过滤 tjrq：更新不改动添加日期）
const UPDATE_COLS = MOVIE_COLUMNS.filter(([c]) => c !== 'tjrq')
const UPDATE_MOVIE_SQL =
  `UPDATE movies SET ${UPDATE_COLS.map(([c]) => `${c}=?`).join(',')} WHERE id=?`
const buildMovieUpdateParams = (d, id) => [...UPDATE_COLS.map(([, get]) => get(d)), Number(id)]

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
  ipcMain.handle(IPC.MOVIES_GET, (_e, params) => {
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
      // 导演筛选（2026-09-09 新增：详情页点击导演跳转）
      if (filter.director) { where.push('dy LIKE ?'); args.push(`%${filter.director}%`) }
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
        // 白名单列名排序，防止 SQL 注入（白名单定义于 constants.js）
        const col = SORTABLE_COLUMNS.includes(sort.by) ? sort.by : 'tjrq'
        const dir = String(sort.order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
        // 次级唯一键 id DESC：排序值相同（如同批添加的影片 tjrq 一致）时
        // 保证跨查询顺序稳定，否则 LIMIT/OFFSET 分页会出现影片在页间跳动
        orderSql = `ORDER BY ${col} ${dir}, id DESC`
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
  ipcMain.handle(IPC.MOVIES_GET_ONE, (_e, id) => {
    try {
      const r = db.exec('SELECT * FROM movies WHERE id=?', [Number(id)])
      const m = firstRow(r[0])
      return m ? { ok: true, data: m } : { ok: false, error: 'not found' }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:create — 渲染进程 → 主进程
  // 创建新影片记录，番号重复时跳过
  ipcMain.handle(IPC.MOVIES_CREATE, (_e, data) => {
    try {
      const d = data || {}
      // 标签标准化：将中文/英文逗号分隔的标签统一为中文逗号分隔
      if (d.bq) d.bq = d.bq.split(/[，,]/).map(s => s.trim()).filter(Boolean).join(TAG_DELIM)
      // 番号去重：已存在则跳过，返回已有 ID
      if (d.ph) {
        const exist = db.exec('SELECT id FROM movies WHERE ph=?', [d.ph])
        const existId = exist[0] ? firstScalar(exist[0]) : null
        if (existId) {
          return { ok: true, id: Number(existId), skipped: true }
        }
      }
      // 插入新记录（SQL 与参数由 MOVIE_COLUMNS 元数据统一生成；tjrq 缺省时由取值器写入当前时间）
      db.run(INSERT_MOVIE_SQL, buildMovieInsertParams(d))
      // 获取自增主键 ID
      const id = firstScalar(db.exec('SELECT last_insert_rowid()')[0])
      persistSoon(db)
      return { ok: true, id: Number(id) }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:update — 渲染进程 → 主进程
  // 更新指定 ID 的影片记录（先读取现有数据，再合并更新）
  ipcMain.handle(IPC.MOVIES_UPDATE, (_e, { id, data }) => {
    try {
      // 先查询当前记录
      const r0 = db.exec('SELECT * FROM movies WHERE id=?', [Number(id)])
      const cur = firstRow(r0[0])
      if (!cur) return { ok: false, error: 'not found' }
      // 合并：用传入数据覆盖现有数据
      const d = { ...cur, ...(data||{}) }
      // 标签标准化
      if (d.bq) d.bq = d.bq.split(/[，,]/).map(s => s.trim()).filter(Boolean).join(TAG_DELIM)
      // 执行更新（SQL 与参数由 MOVIE_COLUMNS 元数据统一生成；tjrq 不在更新列中，添加日期保持不变）
      db.run(UPDATE_MOVIE_SQL, buildMovieUpdateParams(d, id))
      persistSoon(db)
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:delete — 渲染进程 → 主进程
  // 删除单条影片
  ipcMain.handle(IPC.MOVIES_DELETE, (_e, id) => {
    try { db.run('DELETE FROM movies WHERE id=?', [Number(id)]); persistSoon(db); return { ok: true } }
    catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:deleteMany — 渲染进程 → 主进程
  // 批量删除影片
  ipcMain.handle(IPC.MOVIES_DELETE_MANY, (_e, ids) => {
    try {
      for (const id of (ids||[])) db.run('DELETE FROM movies WHERE id=?', [Number(id)])
      persistSoon(db); return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:batchFav — 渲染进程 → 主进程
  // 批量设置收藏状态
  ipcMain.handle(IPC.MOVIES_BATCH_FAV, (_e, { ids, isFav }) => {
    try {
      const val = isFav ? FAV_Y : FAV_N
      for (const id of (ids||[])) db.run('UPDATE movies SET cl=? WHERE id=?', [val, Number(id)])
      persistSoon(db); return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:batchTags — 渲染进程 → 主进程
  // 批量追加标签（不覆盖原有标签，在原有基础上追加）
  ipcMain.handle(IPC.MOVIES_BATCH_TAGS, (_e, { ids, tags }) => {
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
        const newBq = Array.from(existing).join(TAG_DELIM)
        db.run('UPDATE movies SET bq=? WHERE id=?', [newBq, Number(id)])
      }
      persistSoon(db); return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:getAllTags — 渲染进程 → 主进程
  // 获取所有影片中使用过的标签列表（按使用频率降序排列）
  ipcMain.handle(IPC.MOVIES_GET_ALL_TAGS, () => {
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
  // 时间格式说明：与 tjrq 统一为本地格式 YYYY-MM-DD HH:mm:ss（原先混用 UTC ISO 格式，
  // 两种格式字符串排序规则不同，混排会导致观看记录排序偏差）
  ipcMain.handle(IPC.MOVIES_RECORD_PLAY, (_e, id) => {
    try {
      // play_time 更新最近播放时间；play_count 累加观看次数（供「观看次数」排序）。
      // persist 延迟到本轮事件循环之后执行：同步整库导出会阻塞主进程，
      // 拖慢并发的播放请求（播放窗口弹出延迟）。计数属低敏感数据，可接受延迟落盘。
      db.run('UPDATE movies SET play_time = ?, play_count = COALESCE(play_count, 0) + 1 WHERE id = ?',
        [nowLocal(), Number(id)])
      persistSoon(db)
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:search — 渲染进程 → 主进程
  // 全局搜索：支持在影片、女优、网址三个范围内搜索
  ipcMain.handle(IPC.MOVIES_SEARCH, (_e, { scope, q }) => {
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


module.exports = { registerMovieIpc }
