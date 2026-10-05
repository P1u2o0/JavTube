/**
 * @file migrate-images.js
 * @module electron/main/db/migrate-images
 * @description 图片存储布局迁移（2026-10-05 用户要求）：把旧 `covers/` 布局一次性整理成新
 *              `images/` 布局，老版本 data 目录在升级后**自动完成**，界面图片照常显示。
 *
 * 旧布局：covers/<番号>.<ext>（海报）、covers/previews/<番号>-N.<ext>（预览）、
 *         covers/actress/<来源ID>.<ext>（头像，文件名是来源站 ID）
 * 新布局：images/<番号>/<番号>.<ext> 与 images/<番号>/<番号>-N.<ext>（海报+预览同放一个文件夹）、
 *         images/actress/<女优名>.<ext>（头像集中一个文件夹，文件名用软件内显示的名字）
 *
 * 行为约定（与用户确认过）：
 *   ① 搬移而非复制；完成后清理旧目录 —— **孤儿图片**（搬迁后仍留在 covers/、不被任何影片引用的
 *      遗留缓存）直接删除（2026-10-05 用户明确要求）；**非图片的未知文件保留**（宁可不删）；
 *   ② **小于 PREVIEW_MIN_BYTES 的预览图**被剔除（删文件 + 从库中移除该条）——用户明确
 *      「宁缺毋滥」：宁可没有预览图，也不要打不开的小图；缺失的文件同样移除该条；
 *   ③ 迁移前自动备份 app.db（app.db.pre-images-migrate.bak，只备一份，不覆盖已有备份）；
 *   ④ 幂等：以 settings.image_layout='v2' 为标记，重复启动直接跳过；
 *   ⑤ 头像同名冲突：取出现次数最多的名字做文件名，冲突者按顺序加 -2 / -3 …（确定性）。
 *
 * 落盘时序（关键）：本函数由 initDb 在**落盘机制安装之后**调用，所有 db.run 都会打 dirty，
 * 由调用方紧接着 force() 落盘 —— 不允许出现「文件已搬但 DB 路径没写盘」的中间状态。
 * 若 db._blockPersist（恢复备份后禁止落盘）则整体跳过，等用户重启后再迁移。
 *
 * @dependencies fs, path, ../constants, ./util
 * @keyAPI migrateImageLayout(db, dataDir, dbPath) → { skipped, changed, ...统计 }
 */

const fs = require('fs')
const path = require('path')
const { PREVIEW_MIN_BYTES, posterRelPath, previewRelPath, actressRelPath } = require('../constants')

/** 文件/文件夹名净化：去掉 Windows 非法字符与结尾的「.」，并规避保留设备名 */
function safeSeg(s) {
  let out = String(s || '').replace(/[\\/:*?"<>|\r\n\t]/g, '').replace(/[. ]+$/, '').trim().slice(0, 120)
  if (!out) return ''
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(out)) out = '_' + out
  return out
}

/** 库内旧头像路径 → 来源文件名（sid）：covers/actress/<sid>.<ext> */
function actressSidOf(rel) {
  const m = String(rel || '').replace(/\\/g, '/').match(/(?:^|\/)covers\/actress\/([^/]+)$/i)
  if (!m) return null
  const ext = (m[1].match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase()
  return { sid: m[1].replace(/\.[a-z0-9]+$/i, ''), ext }
}

/** 移动文件（同盘 rename，跨盘回落 copy+unlink）；目标已存在则视为重复、删源。
 *  @returns {'moved'|'dup'|'none'} */
function moveFile(src, dst) {
  try {
    if (!fs.existsSync(src)) return 'none'
    if (fs.existsSync(dst)) { try { fs.unlinkSync(src) } catch {} ; return 'dup' }
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    try { fs.renameSync(src, dst) } catch { fs.copyFileSync(src, dst); fs.unlinkSync(src) }
    return 'moved'
  } catch { return 'none' }
}

/**
 * 执行迁移。返回值统计用于日志与上层提示；出错不抛（迁移失败不应阻止应用启动）。
 * @param {Object} db - sql.js 数据库实例（此时落盘机制已安装）
 * @param {string} dataDir - 数据目录
 * @param {string} dbPath - app.db 路径（用于备份）
 * @returns {{skipped:boolean, changed:boolean, posters:number, previewsMoved:number,
 *            previewsDropped:number, previewsMissing:number, avatarFiles:number,
 *            avatarEntries:number, collisions:number, orphansRemoved:number,
 *            leftovers:number, error?:string}}
 */
function migrateImageLayout(db, dataDir, dbPath) {
  const sum = {
    skipped: false, changed: false, posters: 0, previewsMoved: 0, previewsDropped: 0,
    previewsMissing: 0, avatarFiles: 0, avatarEntries: 0, collisions: 0, orphansRemoved: 0, leftovers: 0
  }
  try {
    if (!dataDir) { sum.skipped = true; return sum }
    if (db._blockPersist) { sum.skipped = true; sum.error = 'persist-blocked'; return sum }
    const mk = db.exec("SELECT value FROM settings WHERE key='image_layout'")[0]
    if (mk && String(mk.values[0][0]) === 'v2') { sum.skipped = true; return sum }

    // 迁移前备份数据库（只备一份；失败不阻止迁移——迁移本身幂等，db 写入由调用方 force 落盘）
    try {
      const bak = `${dbPath}.pre-images-migrate.bak`
      if (fs.existsSync(dbPath) && !fs.existsSync(bak)) fs.copyFileSync(dbPath, bak)
    } catch {}

    const r = db.exec('SELECT id, ph, cover, previews, cast_json FROM movies')[0]
    const rows = r ? r.values : []

    // ---- 1) 女优头像映射：sid → 显示名（出现次数最多者；冲突加序号）----
    const nameCount = new Map()   // sid -> Map<name, count>
    const sidExt = new Map()      // sid -> ext（首个出现的扩展名为准）
    for (const [, , , , castJson] of rows) {
      let cast = []
      try { cast = JSON.parse(castJson || '[]') } catch {}
      for (const c of cast) {
        const hit = actressSidOf(c && c.avatar)
        if (!hit) continue
        if (!sidExt.has(hit.sid)) sidExt.set(hit.sid, hit.ext)
        const nm = String((c && c.name) || '').trim() || hit.sid
        if (!nameCount.has(hit.sid)) nameCount.set(hit.sid, new Map())
        const mm = nameCount.get(hit.sid)
        mm.set(nm, (mm.get(nm) || 0) + 1)
      }
    }
    const sidNewName = new Map()  // sid -> { file, ext }
    const usedNames = new Set()
    for (const [sid, mm] of nameCount) {
      let best = '', bc = -1
      for (const [nm, c] of mm) if (c > bc) { bc = c; best = nm }
      const base = safeSeg(best) || safeSeg(sid) || sid
      let file = base
      let n = 2
      while (usedNames.has(file.toLowerCase())) { sum.collisions++; file = `${base}-${n++}` }
      usedNames.add(file.toLowerCase())
      sidNewName.set(sid, { file, ext: sidExt.get(sid) || '.jpg' })
    }

    // ---- 2) 逐片搬移海报与预览图（小图剔除、缺失剔除）----
    const updates = []
    for (const [id, ph, cover, previewsJson] of rows) {
      const phSeg = safeSeg(String(ph || '')) || `id-${id}`
      let newCover = null
      const cRel = String(cover || '').replace(/\\/g, '/')
      if (cRel && !/^[a-z]+:/i.test(cRel) && !cRel.startsWith('images/')) {
        const abs = path.join(dataDir, cRel)
        if (fs.existsSync(abs)) {
          const ext = (cRel.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase()
          const dstRel = posterRelPath(phSeg, ext)
          const st = moveFile(abs, path.join(dataDir, dstRel))
          if (st === 'moved' || st === 'dup') { newCover = dstRel; sum.posters++ }
        }
        // 文件不存在：不动作、不改库（库内原值保持，交给图片检查/修复流程处理）
      }
      let prevArr = []
      try { const p = JSON.parse(previewsJson || '[]'); if (Array.isArray(p)) prevArr = p } catch {}
      const newPrev = []
      for (const p of prevArr) {
        const rel = String(p || '').replace(/\\/g, '/')
        if (!rel || /^[a-z]+:/i.test(rel)) continue
        if (rel.startsWith('images/')) { newPrev.push(rel); continue }   // 已是新布局（理论不可达，防御）
        const abs = path.join(dataDir, rel)
        const ext = (rel.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase()
        const num = (path.basename(rel).match(/-(\d+)\.[a-z0-9]+$/i) || [])[1] || String(newPrev.length + 1)
        if (!fs.existsSync(abs)) { sum.previewsMissing++; continue }     // 文件本就缺失 → 移除该条
        let sz = 0
        try { sz = fs.statSync(abs).size } catch {}
        if (sz < PREVIEW_MIN_BYTES) {                                    // 小于 10KB 的小图 → 剔除
          try { fs.unlinkSync(abs) } catch {}
          sum.previewsDropped++
          continue
        }
        const dstRel = previewRelPath(phSeg, num, ext)
        const st = moveFile(abs, path.join(dataDir, dstRel))
        if (st === 'moved' || st === 'dup') { newPrev.push(dstRel); sum.previewsMoved++ }
        else sum.previewsMissing++
      }
      const coverChanged = newCover !== null && newCover !== cRel
      const prevChanged = prevArr.length !== newPrev.length
        || prevArr.some((x, i) => String(x).replace(/\\/g, '/') !== newPrev[i])
      if (coverChanged || prevChanged) {
        updates.push([id, newCover !== null ? newCover : String(cover || ''), JSON.stringify(newPrev)])
      }
    }
    for (const [id, cover, prevJson] of updates) {
      db.run('UPDATE movies SET cover=?, previews=? WHERE id=?', [cover, prevJson, Number(id)])
    }
    if (updates.length) sum.changed = true

    // ---- 3) 女优头像：重写 cast_json 路径 + 搬文件 ----
    const actUpdates = []
    for (const [id, , , , castJson] of rows) {
      let cast = []
      try { cast = JSON.parse(castJson || '[]') } catch {}
      let touched = false
      for (const c of cast) {
        const hit = actressSidOf(c && c.avatar)
        if (!hit) continue
        const nm = sidNewName.get(hit.sid)
        if (!nm) continue
        const newRel = actressRelPath(nm.file, nm.ext)
        if (String(c.avatar).replace(/\\/g, '/') !== newRel) {
          c.avatar = newRel
          touched = true
          sum.avatarEntries++
        }
      }
      if (touched) actUpdates.push([id, JSON.stringify(cast)])
    }
    for (const [id, cj] of actUpdates) db.run('UPDATE movies SET cast_json=? WHERE id=?', [cj, Number(id)])
    for (const [sid, nm] of sidNewName) {
      const dirOld = path.join(dataDir, 'covers', 'actress')
      let srcAbs = path.join(dirOld, `${sid}${nm.ext}`)
      if (!fs.existsSync(srcAbs)) {
        // 扩展名兜底：历史上可能按 URL 正则存成了别的扩展名，按「主名相同」扫一遍
        try {
          const hit = fs.readdirSync(dirOld).find(f => f.replace(/\.[a-z0-9]+$/i, '') === sid)
          if (hit) srcAbs = path.join(dirOld, hit)
        } catch {}
      }
      if (!fs.existsSync(srcAbs)) continue   // 文件本就缺失：路径已重写，交给修复流程补图
      const st = moveFile(srcAbs, path.join(dataDir, actressRelPath(nm.file, nm.ext)))
      if (st === 'moved' || st === 'dup') sum.avatarFiles++
    }

    // ---- 4) 清理旧目录：搬迁后留在 covers/ 的**孤儿图片**（不被任何影片引用的遗留缓存）
    //          按用户要求删除；非图片的未知文件保留（宁可不删）；空目录一并移除 ----
    let orphansRemoved = 0
    const ORPHAN_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'])
    const sweep = (dir) => {
      let entries = []
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) {
          sweep(p)
          try { if (fs.readdirSync(p).length === 0) fs.rmdirSync(p) } catch {}
        } else if (ORPHAN_IMAGE_EXTS.has(path.extname(e.name).toLowerCase())) {
          try { fs.unlinkSync(p); orphansRemoved++ } catch {}
        }
      }
    }
    const coversDirNow = path.join(dataDir, 'covers')
    try { if (fs.existsSync(coversDirNow)) sweep(coversDirNow) } catch {}
    try { if (fs.existsSync(coversDirNow) && fs.readdirSync(coversDirNow).length === 0) fs.rmdirSync(coversDirNow) } catch {}
    sum.orphansRemoved = orphansRemoved
    try {
      if (fs.existsSync(coversDirNow)) sum.leftovers = fs.readdirSync(coversDirNow, { recursive: true }).filter(Boolean).length
    } catch {}

    // ---- 5) 写迁移标记（幂等依据）----
    db.run("INSERT OR REPLACE INTO settings(key,value) VALUES ('image_layout','v2')")
    sum.changed = true

    console.log('[images] 布局迁移完成：海报 ' + sum.posters + ' 张、预览 ' + sum.previewsMoved
      + ' 张（剔除小图 ' + sum.previewsDropped + '、剔除缺失 ' + sum.previewsMissing + '）；头像文件 '
      + sum.avatarFiles + ' 个 / 重写引用 ' + sum.avatarEntries + ' 条；清理孤儿图片 '
      + sum.orphansRemoved + ' 个'
      + (sum.leftovers ? '；covers/ 内非图片遗留 ' + sum.leftovers + ' 个（已原地保留）' : ''))
    return sum
  } catch (e) {
    sum.error = e.message
    console.warn('[images] 布局迁移失败：' + e.message)
    return sum
  }
}

module.exports = { migrateImageLayout, safeSeg }