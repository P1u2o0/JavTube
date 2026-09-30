/**
 * @file movies.js
 * @module electron/main/db/movies
 * @description 影片数据的 IPC 处理器注册模块。使用 sql.js 风格 API 操作数据库。
 *              包含影片的增删改查、批量操作（收藏/标签）、搜索。
 *              女优的 IPC 位于 actress.js（轮次 3 拆分）。
 *              所有 IPC 通道均为：渲染进程 → 主进程（ipcMain.handle）。
 *
 * @dependencies electron (ipcMain), ../constants, ./util
 * @keyAPI db.exec(sql, params) => [{columns, values}] 查询；db.run(sql, params) 执行写操作
 *         db.exec('SELECT last_insert_rowid() id')[0].values[0][0] 获取最后插入的 ID
 */

// 标签分隔符、收藏标记等共享常量（集中定义于 constants.js）
const { TAG_DELIM, FAV_Y, FAV_N, SORTABLE_COLUMNS } = require('../constants')
// Node 文件系统：导入去重时校验已有视频路径是否仍有效（失效则回填）
const fs = require('fs')
// db 层通用工具（查询结果转换 / 时间格式 / 落盘收口 persistSoon 等）
const { rows, firstRow, firstScalar, nowLocal, persistSoon } = require('./util')
// IPC 通道名常量（preload 与 main 共享，定义于 common/ipc-channels.js）
const IPC = require('../../common/ipc-channels')
// 标签映射函数：直接复用刮削时用的那一个（单一事实来源，避免两处实现随时间漂移）
// scraper.js 只依赖 net-curl / fs / path / url / constants，不反向依赖 db 层，无循环引用
const { applyTagMapping } = require('../scraper')
// 影片的 cast_json/yid 被改写后需要让演员侧缓存失效（见本文件 MOVIES_UPDATE 里的调用）；
// fillCastAvatars 用于 movies:getOne 返回前补齐 cast_json 里的空头像（只改返回值，不写库）
const { invalidateActorCaches, fillCastAvatars } = require('./actress')
// 删除影片后清理不再被引用的本地图片（cover / previews / 演员头像）
const { collectMovieRefs, purgeUnreferenced } = require('./cleanup')
// 删除影片后让首页轮播缓存失效（否则首页仍展示已删除的影片，点进去空白）
const { invalidateHomeCache } = require('../home')

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
  ['play_count', N('play_count')], // 观看次数（recordPlay 累加，供排序）
  // 2026-09-14 新增（演员头像）：演员列表 JSON [{name,gender,avatar}]
  ['cast_json',  S('cast_json')]
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
 * @param {string} [dataDir] - 数据目录（删除影片时清理 covers/ 内的孤儿图片）
 */
function registerMovieIpc(ipcMain, db, dataDir) {

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
      // LIKE 通配符转义（2026-09-29 审计）：与 filter.q 同一套做法，用户输入含 `%`/`_` 时
      // 不当通配符处理，避免「输入单个 _ 匹配到几乎所有影片」这类失真。
      const likeEsc = (s) => String(s).replace(/[\\%_]/g, (m) => '\\' + m)
      // 按演员过滤：yid 是「，」分隔的演员名列表，需整名匹配（子串匹配会把「三上」带到「三上悠亚」）
      // 做法与标签筛选一致：分隔符统一成英文逗号、前后补逗号，再按 `,名字,` 匹配。
      if (filter.actress) {
        where.push("(','||REPLACE(yid,'，',',')||',') LIKE ? ESCAPE '\\'")
        args.push(`%,${likeEsc(filter.actress)},%`)
      }
      // 按制作商/发行商过滤（保持子串匹配，补转义）
      if (filter.studio) {
        where.push("(ps LIKE ? ESCAPE '\\' OR fx LIKE ? ESCAPE '\\')")
        args.push(`%${likeEsc(filter.studio)}%`, `%${likeEsc(filter.studio)}%`)
      }
      // 导演筛选（2026-09-09 新增：详情页点击导演跳转）
      if (filter.director) { where.push("dy LIKE ? ESCAPE '\\'"); args.push(`%${likeEsc(filter.director)}%`) }
      // 按系列过滤
      if (filter.series) { where.push("xl LIKE ? ESCAPE '\\'"); args.push(`%${likeEsc(filter.series)}%`) }
      // 只看有播放记录的
      if (filter.historyOnly) { where.push('play_time IS NOT NULL') }

      // 标签筛选：支持多组标签，所有选中的标签均按 AND 叠加过滤（精准定位目标影片）
      const sel = filter.tagSelected || []
      for (let ci = 0; ci < sel.length; ci++) {
        const tags = sel[ci]
        if (Array.isArray(tags) && tags.length) {
          // 整标签精确匹配（2026-09-28 审计）：原实现 `bq LIKE '%标签%'` 是子串匹配，
          // 选「素人」会把打了「素人娘」「超素人」的影片也带出来，与标签栏的精确计数对不上。
          // 做法：把分隔符统一成英文逗号再前后补逗号，按 `,标签,` 匹配。
          // （REPLACE 兼容历史数据里可能存在的英文逗号分隔）
          const ors = tags.map(() => "(','||REPLACE(bq,'，',',')||',') LIKE ? ESCAPE '\\'")
          for (const t of tags) args.push(`%,${String(t).replace(/[\\%_]/g, (m) => '\\' + m)},%`)
          where.push('(' + ors.join(' AND ') + ')')
        }
      }
      // 关键词搜索（在番号、片名、标签中模糊匹配）
      if (filter.q && filter.q.trim()) {
        // 转义 LIKE 通配符（2026-09-28 审计）：用户输入 `_` 或 `%` 时不转义会被当通配符 ——
        // 输入单个 `_` 会匹配到几乎所有影片（`_` 匹配任意单字符），搜索行为完全失真
        const esc = filter.q.trim().replace(/[\\%_]/g, (m) => '\\' + m)
        const q = `%${esc}%`
        where.push("(ph LIKE ? ESCAPE '\\' OR pm LIKE ? ESCAPE '\\' OR bq LIKE ? ESCAPE '\\')")
        args.push(q, q, q)
      }

      const whereSql = 'WHERE ' + where.join(' AND ')

      // 查询总数（用于分页）
      const totalR = db.exec(`SELECT COUNT(*) FROM movies ${whereSql}`, args)[0]
      const total = Number(firstScalar(totalR)) || 0

      // 构建排序子句
      let orderSql = ''
      let orderArgs = []
      if (sort.random) {
        // 随机排序（2026-09-28 审计修正）：原实现 `ORDER BY RANDOM()`，每翻一页都重新随机，
        // 第 1 页的影片可能在第 2 页重复出现、另一些永远刷不到。
        // 改用「确定性置换」：key = (id²·K + id·B) mod P，K/B 都由渲染层传入的 seed 派生，
        // P 取大质数。同一 seed 下顺序完全确定 → 分页稳定；换 seed（重新点随机）→ 重新洗牌。
        // ★ 用二次型而不是线性 (id·K)%P：后者对连续的 id 会产出「等差」顺序
        //   （实测 33,66,99,132…），一眼就能看出不随机。
        // 万一出现 key 相同（极少数），次级键 id DESC 保证顺序仍然确定，不会跨页跳动。
        // 2026-09-29 审计：原实现 K/B/P 直接拼进字符串，且 seed 非法（NaN/Infinity）时会
        // 拼出 `id * NaN` → SQL 报错、列表整页空白。此处对 seed 钳制为非 NaN/有限值，
        // K/B/P 一律改为绑定参数（顺带杜绝拼接注入）。
        const P = 999983
        const seed = Math.min(999983, Math.max(1, Math.floor(Number(sort.seed) || 1)))
        const K = (seed % 99991) + 2
        const B = ((seed * 7919) % 99989) + 3
        orderSql = 'ORDER BY (id * id * ? + id * ?) % ? ASC, id DESC'
        orderArgs = [K, B, P]
      } else {
        // 白名单列名排序，防止 SQL 注入（白名单定义于 constants.js）
        const col = SORTABLE_COLUMNS.includes(sort.by) ? sort.by : 'tjrq'
        const dir = String(sort.order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
        // 次级唯一键 id DESC：排序值相同（如同批添加的影片 tjrq 一致）时
        // 保证跨查询顺序稳定，否则 LIMIT/OFFSET 分页会出现影片在页间跳动
        orderSql = `ORDER BY ${col} ${dir}, id DESC`
      }
      // 分页参数计算
      // 上界（2026-09-30 性能审计补）：UI 只允许 10~200，但主进程此前只有下界 —— 任何
      // 调用方（包括将来新增的）传 pageSize=100000 都会让 sql.js 一次性物化整库并跨 IPC
      // 序列化整库，主进程被同步阻塞数秒。这里钳到 UI 的上限，行为对现有调用方零变化。
      const ps = Math.min(200, Math.max(1, Number(pageSize) || 20))  // 每页条数
      const pg = Math.max(1, Number(page) || 1)        // 当前页码
      const off = (pg - 1) * ps                         // 偏移量

      // 查询当前页数据（绑定参数顺序：WHERE args → ORDER BY orderArgs → LIMIT/OFFSET）
      const dataR = db.exec(`SELECT * FROM movies ${whereSql} ${orderSql} LIMIT ? OFFSET ?`, [...args, ...orderArgs, ps, off])
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
      if (!m) return { ok: false, error: 'not found' }
      // 演员头像跨影片共享、但入库是逐片写入的（见 actress.js actorAvatarMap 注释）：
      // 只返回本片的 cast_json 会让「演员页有头像、播放页没有」。这里按名字把空头像补成
      // 库内已知头像 —— 只改返回给渲染层的值，不写库（避免读一次影片就改动别的影片数据）。
      try { m.cast_json = fillCastAvatars(db, m.cast_json, m.yid) } catch {}
      return { ok: true, data: m }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:create — 渲染进程 → 主进程
  // 创建新影片记录，番号重复时跳过
  ipcMain.handle(IPC.MOVIES_CREATE, (_e, data) => {
    try {
      const d = data || {}
      // 标签标准化：将中文/英文逗号分隔的标签统一为中文逗号分隔
      if (d.bq) d.bq = d.bq.split(/[，,]/).map(s => s.trim()).filter(Boolean).join(TAG_DELIM)
      // 番号去重：已存在时不重复新建。但若本次传入了有效的视频路径，
      // 而库中该记录的路径为空或文件已失效（移动/改名/换盘），则回填路径——
      // 修复「扫描导入后播放提示路径不对、需手动到编辑里重选视频文件」的问题
      if (d.ph) {
        const exist = db.exec('SELECT id, py FROM movies WHERE ph=?', [d.ph])
        const existRow = exist[0]?.values?.[0]
        if (existRow) {
          const existId = Number(existRow[0])
          const oldPy = existRow[1] || ''
          const newPy = d.py || ''
          if (newPy && (!oldPy || !fs.existsSync(oldPy))) {
            db.run('UPDATE movies SET py=? WHERE id=?', [newPy, existId])
            persistSoon(db)
            return { ok: true, id: existId, updated: true }  // 已回填视频路径
          }
          return { ok: true, id: existId, skipped: true }    // 路径有效，无需处理
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
      // 演员/性别等字段变了要让演员侧缓存立即失效（2026-09-28 审计）：
      // 演员总览与热度排名的缓存键只含 COUNT/MAX(id)，改 cast_json 不会让它失效 ——
      // 结果是演员页最长 60 秒仍显示旧名单（新增/删除演员看不到）。
      if (data && ('cast_json' in data || 'yy' in data || 'yid' in data)) {
        try { invalidateActorCaches() } catch {}
      }
      // 首页轮播缓存里存的是影片快照（含封面/标签），改库后同样要失效
      // （2026-09-30 审计：DELETE / DELETE_MANY / BATCH_TAGS 都调了，只有 UPDATE 漏了，
      //  表现为「重新刮削换了封面，首页轮播还是旧图，重启才更新」）
      try { invalidateHomeCache() } catch {}
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:delete — 渲染进程 → 主进程
  // 删除单条影片，并清理其不再被引用的本地图片（2026-09-29 审计）
  ipcMain.handle(IPC.MOVIES_DELETE, (_e, id) => {
    try {
      // 顺序：删库前先收集该片的图片引用，删库后据「剩余引用」清理孤儿文件
      const refs = collectMovieRefs(db, [Number(id)])
      db.run('DELETE FROM movies WHERE id=?', [Number(id)])
      const cleaned = purgeUnreferenced(db, dataDir, refs)
      persistSoon(db)
      // 首页轮播缓存存的是影片快照，删除后必须失效，否则轮播仍展示已删影片
      try { invalidateHomeCache() } catch {}
      return { ok: true, cleaned }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:deleteMany — 渲染进程 → 主进程
  // 批量删除影片，并清理其不再被引用的本地图片（2026-09-29 审计）
  ipcMain.handle(IPC.MOVIES_DELETE_MANY, (_e, ids) => {
    try {
      // 单条 IN 替代逐条 DELETE（sql.js 无批量 API，IN 可一次完成）
      const list = (ids || []).map(Number).filter(Number.isFinite)
      if (!list.length) return { ok: true, cleaned: 0 }
      const refs = collectMovieRefs(db, list)
      db.run(`DELETE FROM movies WHERE id IN (${list.map(() => '?').join(',')})`, list)
      const cleaned = purgeUnreferenced(db, dataDir, refs)
      persistSoon(db)
      try { invalidateHomeCache() } catch {}
      return { ok: true, cleaned }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:batchFav — 渲染进程 → 主进程
  // 批量设置收藏状态
  ipcMain.handle(IPC.MOVIES_BATCH_FAV, (_e, { ids, isFav }) => {
    try {
      const val = isFav ? FAV_Y : FAV_N
      // 单条 IN 替代逐条 UPDATE
      const list = (ids || []).map(Number).filter(Number.isFinite)
      if (!list.length) return { ok: true }
      db.run(`UPDATE movies SET cl=? WHERE id IN (${list.map(() => '?').join(',')})`, [val, ...list])
      persistSoon(db); return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:batchTags — 渲染进程 → 主进程
  // 批量追加标签（不覆盖原有标签，在原有基础上追加）
  ipcMain.handle(IPC.MOVIES_BATCH_TAGS, (_e, { ids, tags }) => {
    try {
      const list = Array.isArray(tags) ? tags : []
      if (!list.length) return { ok: true }
      const idList = (ids || []).map(Number).filter(Number.isFinite)
      if (!idList.length) return { ok: true }
      // 一次批量取回现有标签（原实现是每个 id 各查一次 SELECT）
      const r0 = db.exec(
        `SELECT id, bq FROM movies WHERE id IN (${idList.map(() => '?').join(',')})`,
        idList
      )
      const cur = rows(r0 ? r0[0] : undefined)
      // UPDATE 包在事务里，避免逐条提交的开销
      db.run('BEGIN')
      try {
        for (const row of cur) {
          // 解析现有标签为 Set（去重）
          const existing = new Set(String(row.bq || '').split(/[，,]/).map(s => s.trim()).filter(Boolean))
          // 追加新标签
          for (const t of list) existing.add(t)
          // 拼接为字符串并更新（不要额外追加尾部分隔符，避免 bq 字段尾部残留逗号）
          db.run('UPDATE movies SET bq=? WHERE id=?', [Array.from(existing).join(TAG_DELIM), row.id])
        }
        db.run('COMMIT')
      } catch (e) {
        db.run('ROLLBACK')
        throw e
      }
      // 标签是首页类别的数据源，批量改标签后让它重算（2026-09-29 审计）
      try { invalidateHomeCache() } catch {}
      persistSoon(db); return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: movies:applyTagMap — 渲染进程 → 主进程（2026-09-17 新增）
  // 把设置里的「标签映射」规则套用到已有影片上。
  // 背景：映射此前只在 scrapeMovie() 刮削那一刻应用（scraper.js 成功返回前那一行），
  //       改完规则不会重算已有记录，用户会以为功能坏了。这里补一个显式入口。
  // 复用 applyTagMapping 而非重写，保证与刮削路径的替换/删除/去重语义完全一致。
  // @param {Object}  [opts]
  // @param {boolean} [opts.dryRun=true] true 只返回影响预览（不写库）；false 才真正落库
  // @returns {Object} { ok, total, changed:[{id,ph,pm,from,to}], applied, empty? }
  ipcMain.handle(IPC.MOVIES_APPLY_TAG_MAP, (_e, { dryRun = true } = {}) => {
    try {
      // 读 settings.tag_mapping（与 ipc-utils.js 刮削入口读的是同一份配置）
      const sRows = rows(db.exec("SELECT value FROM settings WHERE key='tag_mapping'")[0])
      let mapping = []
      try { mapping = JSON.parse((sRows[0] && sRows[0].value) || '[]') } catch { mapping = [] }
      if (!Array.isArray(mapping)) mapping = []
      // 过滤掉「原标签为空」的无效行：否则空 key 无意义，且防御脏数据把整库标签清空
      const usable = mapping.filter(p => Array.isArray(p) && String(p[0] || '').trim())
      if (!usable.length) return { ok: true, total: 0, changed: [], applied: 0, empty: true }

      const all = rows(db.exec('SELECT id, ph, pm, bq FROM movies')[0])
      const changed = []
      for (const row of all) {
        const from = String(row.bq || '')
        const to = applyTagMapping(from, usable)
        if (to !== from) changed.push({ id: row.id, ph: row.ph, pm: row.pm, from, to })
      }
      // 预览模式：只报告影响面，不写库
      if (dryRun) return { ok: true, total: all.length, changed, applied: 0 }

      if (changed.length) {
        // 与 MOVIES_BATCH_TAGS 同一套事务写法
        db.run('BEGIN')
        try {
          for (const c of changed) db.run('UPDATE movies SET bq=? WHERE id=?', [c.to, c.id])
          db.run('COMMIT')
        } catch (e) {
          db.run('ROLLBACK')
          throw e
        }
        persistSoon(db)
        // 批量替换标签同样会改 bq，首页轮播的「共同兴趣」判定基于标签快照 → 一并失效
        // （2026-09-30 审计：BATCH_TAGS 调了，applyTagMap 漏了）
        try { invalidateHomeCache() } catch {}
      }
      return { ok: true, total: all.length, changed, applied: changed.length }
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
      // counts 一并返回：前端按「含该标签的影片数量」排序标签（含分类内部），
      // 不依赖数组顺序，避免列表陈旧时新标签被排到最后
      return { ok: true, tags, counts }
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

}


module.exports = { registerMovieIpc }
