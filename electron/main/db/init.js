/**
 * @file init.js
 * @module electron/main/db/init
 * @description SQLite 数据库初始化模块。使用 sql.js（纯 JavaScript/WASM 实现，无需编译原生模块）来管理数据库。
 *              负责数据库的加载/创建、表结构定义、默认设置写入、封面目录创建，以及脏标记定时持久化机制。
 *              注意：initSqlJs() 是异步 Promise，因为需要加载 WASM 文件。
 * @dependencies fs, path, sql.js
 * @keyAPI initSqlJs(), db.run(), db.exec(), db.export(), saveDbToDisk()
 */

const fs = require('fs')
const path = require('path')
// 封面目录名等共享常量（集中定义于 constants.js）
const { COVER_DIR } = require('../constants')

// sql.js 实例缓存，避免重复初始化
let SQL = null

/**
 * 查找 sql.js 的 WASM 文件路径。
 * WASM 文件是 sql.js 运行所需的核心二进制模块。
 * @param {string} cwdBase - 查找的基准目录（默认为当前工作目录）
 * @returns {string} WASM 文件路径，找不到返回空字符串
 */
function findWasm(cwdBase) {
  const candidates = [
    path.join(cwdBase || process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return ''
}

/**
 * 异步获取 sql.js 实例（带缓存）。
 * 首次调用会加载 WASM 文件并初始化 SQL 模块，后续调用直接返回缓存实例。
 * @returns {Promise<Object>} sql.js 的 SQL 构造器
 */
async function getSQL() {
  if (SQL) return SQL  // 返回缓存实例
  const initSqlJs = require('sql.js')
  const wasm = findWasm()
  const options = {}
  // 配置 WASM 文件定位器：当加载 .wasm 文件时使用指定路径
  if (wasm) options.locateFile = (f) => f.endsWith('.wasm') ? wasm : f
  SQL = await initSqlJs(options)
  return SQL
}

/**
 * 将内存中的数据库导出并写入磁盘文件。
 * sql.js 的数据库存在于内存中，需要手动调用 export() 导出二进制数据并写入文件。
 * 采用「双 rename」策略确保任意时刻崩溃都不丢数据：
 *   1. 写入临时文件 .tmp（不触碰现有数据库）
 *   2. 旧库 rename 为 .bak（原子操作，旧数据完整保留）
 *   3. .tmp rename 为正式文件（原子操作）
 * 任意一步中途崩溃，磁盘上至少存在一份完整的旧数据库（.bak 或原文件）。
 * @param {Object} db - sql.js 数据库实例
 * @param {string} dbPath - 数据库文件路径
 */
function saveDbToDisk(db, dbPath) {
  try {
    const data = db.export()          // 导出数据库为 Uint8Array
    const buf = Buffer.from(data)     // 转为 Node.js Buffer
    const tmp = dbPath + '.tmp'       // 临时文件路径
    const bak = dbPath + '.bak'       // 旧库备份路径
    fs.writeFileSync(tmp, buf)        // 先写入临时文件
    if (fs.existsSync(dbPath)) {
      if (fs.existsSync(bak)) fs.unlinkSync(bak)
      fs.renameSync(dbPath, bak)      // 旧库改名保留（原子，不经过"无文件"状态）
    }
    fs.renameSync(tmp, dbPath)        // 新库就位（原子操作）
  } catch (e) { console.error('[db] save failed:', e) }
}

/**
 * 初始化数据库。
 * 加载或创建 SQLite 数据库，创建所有表结构，写入默认设置，并设置自动持久化机制。
 * @param {string} dataDir - 数据目录路径
 * @returns {Promise<Object>} 数据库实例（带有自定义属性 _dbPath, _dataDir, _forceSave）
 */
async function initDb(dataDir) {
  const Sqlite = await getSQL()
  const dbPath = path.join(dataDir, 'app.db')
  let db

  // 尝试加载已有数据库文件
  if (fs.existsSync(dbPath)) {
    try {
      const buf = fs.readFileSync(dbPath)
      db = new Sqlite.Database(buf)  // 从文件数据创建数据库实例
    } catch (e) {
      console.warn('[db] load failed, creating new DB:', e.message)
      db = new Sqlite.Database()  // 加载失败则创建空数据库
    }
  } else {
    db = new Sqlite.Database()  // 文件不存在则创建新的空数据库
  }

  // === 创建表结构 ===

  // 影片表：存储每部影片的完整元数据
  db.run(`CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- 自增主键
    ph TEXT,               -- 番号（如 ABC-123）
    pm TEXT,               -- 片名
    cover TEXT,            -- 封面图片路径
    yid TEXT,              -- 演员ID/名称（多演员用中文逗号分隔）
    yy TEXT,               -- 演员名称（冗余字段，用于显示）
    fxrq TEXT,             -- 发行日期
    fl TEXT DEFAULT '全部', -- 分类（有码/无码/欧美/全部）
    zz TEXT DEFAULT 'n',    -- 中字标记 (y/n)，详情页「类型」展示用
    lc TEXT DEFAULT 'n',    -- 流出标记 (y/n)
    pj TEXT DEFAULT 'n',    -- 破解标记 (y/n)
    dt TEXT DEFAULT 'n',    -- 单体标记 (y/n)
    dm TEXT DEFAULT 'n',    -- 动漫标记 (y/n)
    vr TEXT DEFAULT 'n',    -- VR 影片标记 (y/n)
    sd TEXT DEFAULT 'n',    -- 3D 标记 (y/n)
    hj TEXT DEFAULT 'n',    -- 合集标记 (y/n)
    pfs REAL DEFAULT 0,     -- 评分（满分制）
    yz REAL DEFAULT 0,      -- 硬度值
    zb TEXT DEFAULT 'A',    -- 资源质量等级 (A/B/C/D)
    tix TEXT DEFAULT '正常', -- 体型标记
    bq TEXT,                -- 标签（多个用中文逗号分隔）
    jt TEXT,                -- 简介
    py TEXT,                -- 视频文件路径
    cl TEXT DEFAULT 'n',    -- 是否收藏 (y/n)
    tjrq TEXT,              -- 添加日期（格式 YYYY-MM-DD HH:mm:ss）
    dx INTEGER DEFAULT 0,  -- 文件大小（字节）
    dy TEXT,                -- 导演
    sc TEXT,                -- 时长（秒）
    ps TEXT,                -- 制作商
    fx TEXT,                -- 发行商
    xl TEXT                 -- 系列
  )`)

  // 女优表：存储演员的基本信息和身体数据
  db.run(`CREATE TABLE IF NOT EXISTS actress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- 自增主键
    name TEXT UNIQUE,      -- 女优名称（唯一约束）
    img TEXT,              -- 女优头像路径
    height INTEGER,        -- 身高（cm）
    bust INTEGER,           -- 胸围（cm）
    waist INTEGER,          -- 腰围（cm）
    hip INTEGER,            -- 臀围（cm）
    zb TEXT,                -- 罩杯（如 A/B/C/D）
    birthday TEXT,          -- 生日
    debut TEXT,             -- 出道日期
    remark TEXT             -- 备注
  )`)

  // 网址表：存储相关网站收藏
  db.run(`CREATE TABLE IF NOT EXISTS websites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- 自增主键
    name TEXT,             -- 网站名称
    url TEXT,              -- 网站地址
    grp TEXT,              -- 分组
    img TEXT               -- 网站图标
  )`)

  // 设置表：键值对形式存储应用设置
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,  -- 设置项键名（主键）
    value TEXT             -- 设置项值
  )`)

  // 兼容旧库：添加 play_time 列（最近播放时间，ISO 8601 格式，见 movies:recordPlay）
  // 如果列已存在，ALTER TABLE 会报错，用 try-catch 忽略
  try { db.run('ALTER TABLE movies ADD COLUMN play_time TEXT') } catch {}

  // 2026-09-09 新增列（刮削增强功能，均为 ALTER 兼容旧库，列已存在时忽略）：
  //   previews — 预览图本地相对路径的 JSON 数组（如 ["covers/previews/IPX-1-1.jpg",...]）
  //   want     — 想看人数（来源 JAVDB）
  //   watched  — 看过人数（来源 JAVDB）
  //   score    — 评分（来源 JAVDB，如 4.53）
  try { db.run("ALTER TABLE movies ADD COLUMN previews TEXT") } catch {}
  try { db.run("ALTER TABLE movies ADD COLUMN want INTEGER DEFAULT 0") } catch {}
  try { db.run("ALTER TABLE movies ADD COLUMN watched INTEGER DEFAULT 0") } catch {}
  try { db.run("ALTER TABLE movies ADD COLUMN score REAL DEFAULT 0") } catch {}
  // 2026-09-09 下午新增（详情页改版）：
  //   duration   — 影片时长（分钟）：刮削到「長度/時長」时写入；无刮削值时由视频文件解析补齐
  //   play_count — 观看次数：recordPlay 每次播放 +1（供「观看次数」排序）
  try { db.run("ALTER TABLE movies ADD COLUMN duration INTEGER DEFAULT 0") } catch {}
  try { db.run("ALTER TABLE movies ADD COLUMN play_count INTEGER DEFAULT 0") } catch {}

  // 写入默认设置项（仅在不存在时插入）
  const defaults = [
    ['player_path',''],      // 自定义播放器路径
    ['page_size','20'],      // 每页显示数量
    ['theme','light'],       // 主题
    ['video_paths','[]'],    // 视频文件路径列表（JSON 数组）
    ['cover_dir', COVER_DIR],  // 封面目录名
    ['click_action','detail'], // 点击影片时的行为（详情/播放）
    // === 刮削与网络（2026-09-09 新增） ===
    ['scrape_source','auto'],   // 刮削来源：auto=JAVBUS优先JAVDB兜底 / javbus=仅JAVBUS / javdb=仅JAVDB
    ['scrape_previews','n'],    // 是否下载影片预览图 (y/n)
    ['preview_count','0'],      // 下载预览图数量（0 = 全部下载）
    ['scrape_stats','y'],       // 是否抓取想看/看过人数与评分 (y/n，来源 JAVDB)
    ['proxy_enabled','n'],      // 是否使用本机代理访问刮削站（JAVDB 需科学上网）
    ['proxy_url','http://127.0.0.1:7890'], // 代理服务器地址（HTTP 代理规则）
    // === 标签设置（2026-09-09 新增） ===
    ['tag_mapping','[]'],       // 标签映射规则（JSON 数组 [[原标签,新标签],...]，刮削后自动替换）
    // === 界面（2026-09-09 新增） ===
    ['show_tips','y']           // 设置对话框是否显示选项注释小字 (y/n)
  ]
  for (const [k, v] of defaults) {
    // INSERT OR IGNORE：如果 key 已存在则跳过，不报错
    db.run(`INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)`, [k, v])
  }

  // 创建封面图片存放目录
  const coversDir = path.join(dataDir, COVER_DIR)
  try { if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true }) } catch {}

  // === 脏标记 + 定时持久化机制 ===
  // sql.js 的数据库在内存中操作，需要定期写盘。
  // 通过拦截 db.run() 方法，任何写操作都会标记 dirty=true。
  let dirty = false
  const origRun = db.run.bind(db)  // 保存原始 run 方法
  // 重写 run 方法：每次执行写操作时设置脏标记
  db.run = function(sql, params) {
    dirty = true
    return origRun(sql, params)
  }

  // sql.js 的 exec/prepare/run 不返回修改记录（没有 ROWID hooks via run API）
  // 保守策略：任何 run() 触发 dirty，10 秒后写盘。
  // 每 10 秒检查一次，如果有脏数据则写入磁盘
  setInterval(() => {
    if (dirty) { saveDbToDisk(db, dbPath); dirty = false }
  }, 10000)

  // 手动强制保存函数：立即将数据库写入磁盘
  const force = () => { saveDbToDisk(db, dbPath); dirty = false }
  // 进程退出时强制保存
  process.on('exit', force)

  // 在数据库实例上附加自定义属性，供其他模块使用
  db._dbPath = dbPath       // 数据库文件路径
  db._dataDir = dataDir     // 数据目录路径
  db._forceSave = force     // 强制保存方法

  return db
}

module.exports = { initDb }
