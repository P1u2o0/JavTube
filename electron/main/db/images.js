/**
 * @file images.js
 * @module electron/main/db/images
 * @description 失效图片的检查与修复（封面 / 预览图）。
 *
 * 背景：下载失败时旧实现会把「全零的截断写入」「图床返回的 HTML 拦截页」当成图片存下来，
 * 界面就显示成灰色空块或空缩略图。scraper 现在已做内容校验（不会再产生新的假文件），
 * 这里负责**扫出并修好已经存在的坏文件**：
 *   ① 扫描全库，找出「数据库里引用了、但文件缺失或内容不是有效图片」的条目；
 *   ② 按影片重新刮削，把有效图片写回**原路径** —— 因此不需要改动数据库，
 *      软件运行中也能修，界面刷新后立刻可见。
 * @dependencies electron (ipcMain), fs, path, ../../common/ipc-channels, ../scraper
 * @keyAPI scrapeMovie(), isImageFile()
 */
const fs = require('fs')
const path = require('path')
const IPC = require('../../common/ipc-channels')
const { scrapeMovie, isImageFile, isGifRenamed, inspectImage } = require('../scraper')
const { PREVIEW_MIN_BYTES } = require('../constants')
// 图片目录归属校验：与 cleanup.js 同一套门控（库内路径可能含 `..` 等异常值，
// 修复要写文件/删文件，必须先确认目标在 dataDir 的图片目录（images/ 或旧 covers/）之内）
const { underImageDir } = require('./cleanup')

/**
 * 文件存在且内容是**可用图片**才算可用。
 * 注意「GIF 内容 + 非 .gif 文件名」要判为不可用（2026-09-28 审计合并判据）：
 * 那是来源站占位图（JAVBUS 的 nowprinting.gif）被按 .jpg 存下来的形态 —— 魔数校验会放行、
 * 界面也能渲染，但它不是真实内容；女优头像那边一直按「占位图」清理，封面/预览图
 * 之前漏了这条，会显示成一张假的「Now Printing」海报。
 */
function usable(abs, minBytes = 0) {
  try {
    if (!fs.existsSync(abs)) return false
    // 一次读取拿到两个结论（2026-09-29 审计：原实现分别调 isImageFile + isGifRenamed，
    // 每张图重复 open/read 一次；全库 3,000+ 张时是可测量的同步 I/O 开销）
    const r = inspectImage(abs)
    if (!r.ok || r.gif) return false
    // 过小的图（预览图 <10KB）同样视为不可用：打开根本看不清，用户要求宁缺毋滥（2026-10-05）
    return !minBytes || r.size >= minBytes
  } catch { return false }
}

/**
 * 取一部影片的图片现状（封面 + 预览图各自的路径与坏图清单）。
 * 修复前后各调一次，用「坏图张数的差额」上报修复结果 —— 因为刮削本身就会把图片
 * 写到库引用的同一路径上，只看「我复制过几次」会漏报（实测显示「已修复 0 张」）。
 */
function movieImages(db, dataDir, id) {
  const row = db.exec('SELECT ph, cover, previews FROM movies WHERE id=?', [Number(id)])[0]
  if (!row) return null
  const [ph, cover, previewsJson] = row.values[0]
  const dbCover = cover ? String(cover).replace(/\\/g, '/') : ''
  let dbPrevs = []
  try { const p = JSON.parse(previewsJson || '[]'); if (Array.isArray(p)) dbPrevs = p.map(x => String(x).replace(/\\/g, '/')) } catch {}
  const brokenCover = !!dbCover && !usable(path.join(dataDir, dbCover))
  const brokenPrevs = dbPrevs.filter(rel => !usable(path.join(dataDir, rel), PREVIEW_MIN_BYTES))
  return {
    id: Number(id), ph: String(ph || ''), dbCover, dbPrevs,
    brokenCover, brokenPrevs,
    badCount: (brokenCover ? 1 : 0) + brokenPrevs.length
  }
}

/**
 * 扫描全库失效图片（数据库引用了、但文件缺失或内容不是图片）。
 *
 * ★ 2026-09-30 性能审计：本函数改为**分片让出事件循环**（原为纯同步）。
 *   原实现在本机 3,215 个封面/预览文件上同步跑 **1,770~1,790ms** —— 期间主进程事件循环
 *   完全停摆（实测 lag 峰值 **1,771ms**，正常 <5ms）。它由渲染层在启动约 4s 后触发，
 *   恰好覆盖「刚打开软件、用户开始点页面」的时段：此时任何 IPC、任何图片请求全部排队，
 *   表现为「刚启动后第一次切页特别卡」。
 *   修法不是把 fs 全改异步（`inspectImage` 需要同步读文件头，改动面太大且收益有限），
 *   而是**每处理 SCAN_YIELD_EVERY 张图就 await 一次 setImmediate**，把一次 1.8s 的
 *   连续阻塞切成小片：事件循环每片之间都能处理用户交互。
 *   实测结果：lag 峰值 **1,771ms → 99ms**，>100ms 的样本从 1 个（1771ms）降到 **0 个**。
 *   阈值依据（由实测反推）：3215 张 / 1770ms ≈ 0.55ms/张 → 24 张一片 ≈ 13ms 量级，
 *   低于「可感知卡顿」的 25ms 门限。
 *   ⚠️ 注意：**扫描总耗时不会因此变短**（I/O 量没变，yield 还多了一点调度开销）；
 *   单独静置测量时约 1.8s，与其他 I/O 任务（如图片修复）并发时会更长。
 *
 * @param {Object} db - sql.js 数据库
 * @param {string} dataDir - 数据目录
 * @returns {Promise<{coverCount:number, previewCount:number, movies:Array<{id:number, ph:string, cover:boolean, preview:boolean}>}>}
 *          movies 为去重后的受影响影片（修复以影片为单位，一次刮削把它的图都补齐）
 */
/** 每处理这么多张图让出一次事件循环（调小=更丝滑但总耗时略增；调大反之） */
const SCAN_YIELD_EVERY = 24

async function scanBroken(db, dataDir) {
  const res = db.exec('SELECT id, ph, cover, previews FROM movies')[0]
  const byMovie = new Map()
  let coverCount = 0
  let previewCount = 0
  // 已检查过的图片计数：每满 SCAN_YIELD_EVERY 张就让出一次事件循环
  let checked = 0
  const tick = () => (++checked % SCAN_YIELD_EVERY === 0)
    ? new Promise(r => setImmediate(r))
    : null
  for (const [id, ph, cover, previewsJson] of (res ? res.values : [])) {
    const touch = (isCover) => {
      const key = String(id)
      const e = byMovie.get(key) || { id, ph: String(ph || ''), cover: false, preview: false }
      if (isCover) e.cover = true; else e.preview = true
      byMovie.set(key, e)
    }
    if (cover) {
      const rel = String(cover).replace(/\\/g, '/')
      if (!usable(path.join(dataDir, rel))) { coverCount++; touch(true) }
      const y = tick(); if (y) await y
    }
    let arr = []
    try { const p = JSON.parse(previewsJson || '[]'); if (Array.isArray(p)) arr = p } catch {}
    for (const rel0 of arr) {
      const rel = String(rel0).replace(/\\/g, '/')
      if (!usable(path.join(dataDir, rel), PREVIEW_MIN_BYTES)) { previewCount++; touch(false) }
      const y = tick(); if (y) await y
    }
  }
  return { coverCount, previewCount, movies: [...byMovie.values()] }
}

/**
 * 修复一部影片的失效图片：重新刮削，把有效图片写回数据库引用的原路径。
 * 只写图片文件，**不改数据库**。
 * @param {Object} db
 * @param {string} dataDir
 * @param {number} id - 影片 id
 * @param {{proxy?:string, cookie?:string}} opts
 * @returns {Promise<{ok:boolean, fixed?:number, still?:number, error?:string}>}
 */
async function repairMovie(db, dataDir, id, { proxy = '', cookie = '' } = {}) {
  const info = movieImages(db, dataDir, id)
  if (!info) return { ok: false, error: '影片不存在' }
  const { ph, dbCover, dbPrevs } = info

  const needPrev = info.brokenPrevs.length > 0
  const r = await scrapeMovie(ph, {
    source: 'auto', dataDir, downloadPreviews: needPrev, previewCount: 0,
    fetchStats: false, tagMapping: [], javdbCookie: cookie, proxy
  }).catch(e => ({ ok: false, error: e.message }))
  if (!r || !r.ok) return { ok: false, error: (r && r.error) || '刮削失败' }
  const d = r.data || {}

  // 封面：若原路径仍坏，而本次新封面有效 → 复制过去（新封面扩展名不同时同样适用）
  // 两侧都必须在 covers/ 内（2026-10-02 补门控，与 cleanup.js 口径一致）：库内路径异常时
  // 不允许把文件写到 dataDir 之外、也不允许从之外读文件进 covers
  if (dbCover && underImageDir(dataDir, dbCover) && !usable(path.join(dataDir, dbCover)) && underImageDir(dataDir, String(d.cover || ''))) {
    const src = path.join(dataDir, String(d.cover).replace(/\\/g, '/'))
    const dst = path.join(dataDir, dbCover)
    if (isImageFile(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.copyFileSync(src, dst)
    }
  }

  // 预览图：库里每个仍坏的槽位，用本次新下载的有效图逐个填回**原路径**
  // 同样双侧门控（目标=库内路径，来源=本次下载产物，均应在 covers/ 内）
  const fresh = (Array.isArray(d.previews) ? d.previews : [])
    .map(p => String(p).replace(/\\/g, '/'))
    .filter(rel => underImageDir(dataDir, rel) && usable(path.join(dataDir, rel)))
    .map(rel => path.join(dataDir, rel))
  let fi = 0
  for (const rel of dbPrevs) {
    if (!underImageDir(dataDir, rel)) continue
    const dst = path.join(dataDir, rel)
    if (usable(dst, PREVIEW_MIN_BYTES)) continue
    if (fi >= fresh.length) continue
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(fresh[fi++], dst)
  }

  // 以「坏图张数的变化」上报，见 movieImages 注释
  const after = movieImages(db, dataDir, id)

  // 清理该片不再被引用的预览图（2026-09-29 审计修正）：
  // 原实现拿「数据库里的 ph + '-'」当文件前缀去匹配，但文件名是抓取时用 cleanPh 生成的，
  // 两者可能不一致（大小写/连字符/去前导零）→ 既清不掉自己的孤儿，又可能误删番号前缀相近的
  // 其它影片的预览图。改为：① 前缀直接取自本片仍在引用的文件名（不猜）；
  // ② 删除前确认该文件不被任何影片引用。
  try {
    const keep = new Set(dbPrevs.map(rel => path.basename(rel)))
    const prevDir = path.join(dataDir, COVER_DIR, 'previews')
    if (keep.size && fs.existsSync(prevDir)) {
      const sample = [...keep][0]
      const prefix = sample.replace(/-\d+\.[A-Za-z0-9]+$/, '')
      if (prefix && prefix !== sample) {
        const referenced = new Set()
        const all = db.exec('SELECT previews FROM movies')[0]
        for (const [pj] of (all ? all.values : [])) {
          try { for (const x of (JSON.parse(pj || '[]') || [])) referenced.add(path.basename(String(x))) } catch {}
        }
        const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-\\d+\\.[A-Za-z0-9]+$')
        for (const f of fs.readdirSync(prevDir)) {
          if (re.test(f) && !keep.has(f) && !referenced.has(f)) {
            try { fs.unlinkSync(path.join(prevDir, f)) } catch {}
          }
        }
      }
    }
  } catch {}

  // 仍然不可用的：把垃圾文件删掉（空文件 / 全零 / 覆盖为站内资源的 SVG 等）。
  // 留着只会是一张打不开的图；删掉不损失任何数据，源站恢复后下次检查会自动补上。
  // 注意：删掉后数据库里仍留着路径（指向不存在的文件），界面回落「暂无封面 / 空缩略图」，
  // 这正是我们要的干净状态。
  if (after) {
    const leftovers = [...(after.brokenCover ? [after.dbCover] : []), ...after.brokenPrevs]
    for (const rel of leftovers) {
      // 只删图片目录（images/ 或旧 covers/）内的文件（2026-10-02 补门控）：库内路径异常时绝不越界删文件
      if (!rel || !underImageDir(dataDir, rel)) continue
      try { const p = path.join(dataDir, rel); if (fs.existsSync(p)) fs.unlinkSync(p) } catch {}
    }
  }

  return {
    ok: true, ph,
    fixed: Math.max(0, info.badCount - (after ? after.badCount : 0)),
    still: after ? after.badCount : 0
  }
}

/**
 * 注册图片完整性相关 IPC。
 * @param {Object} ipcMain
 * @param {Object} db
 * @param {string} dataDir
 */
function registerImageIpc(ipcMain, db, dataDir) {
  // IPC: images:scan — 扫描失效图片（只读，不写任何文件）
  // ⚠️ 必须保持 async：scanBroken 现在是分片让出事件循环的（见其注释）。
  //    渲染层用 ipcRenderer.invoke 调用、本来就在 await 一个 Promise，签名变化对调用方透明。
  ipcMain.handle(IPC.IMAGES_SCAN, async () => {
    try {
      if (!dataDir) return { ok: false, error: '未取到数据目录' }
      const s = await scanBroken(db, dataDir)
      return { ok: true, data: s }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // IPC: images:repair — 修复一部影片的失效图片（重新刮削 + 写回原路径）
  // 由渲染层按影片逐条调用（与批量刮削、补全头像同一套约定），便于显示进度
  ipcMain.handle(IPC.IMAGES_REPAIR, async (_e, id) => {
    try {
      if (!dataDir) return { ok: false, error: '未取到数据目录' }
      const st = {}
      const rs = db.exec(`SELECT key, value FROM settings WHERE key IN ('javdb_cookie','proxy_enabled','proxy_url')`)[0]
      for (const r of (rs ? rs.values : [])) st[r[0]] = r[1]
      const proxy = st.proxy_enabled === 'y' ? (st.proxy_url || '') : ''
      const r = await repairMovie(db, dataDir, id, { proxy, cookie: st.javdb_cookie || '' })
      // 与其它 handler 保持同一返回结构：{ ok, data, error }（渲染层按 r.data.fixed 取数）
      if (!r.ok) return { ok: false, error: r.error }
      return { ok: true, data: { fixed: r.fixed, still: r.still, ph: r.ph } }
    } catch (e) { return { ok: false, error: e.message } }
  })
}

module.exports = { registerImageIpc, scanBroken }
