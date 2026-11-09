/**
 * @file dup-scan.js
 * @module electron/main/dup-scan
 * @description 目录查重（2026-11-08，2026-11-09 按用户澄清收窄语义）：
 *              **只找「同一个目录里出现两次以上同番号」的视频** —— 不与片库比对。
 *              主进程只读扫描，把文件清单交给渲染层按番号分组；由用户逐条决定处置
 *              （在资源管理器定位 / 移入回收站）。
 *
 * 安全边界：
 *   · 主进程**只读**，不删、不改、不移动任何文件；
 *   · 唯一写操作 `dup:trash` 走 `shell.trashItem`（系统回收站，可恢复），
 *     且必须由用户逐条确认；库内 py 正在使用的那份文件一律拒绝处置（第二道闸）。
 *   · 番号解析放在渲染层（`utils/global.extractCode`），避免两处正则漂移。
 */
const fs = require('fs')
const path = require('path')
const { shell } = require('electron')
const IPC = require('../common/ipc-channels')
const { VIDEO_EXTS } = require('./constants')
// 路径归一化与媒体闸门共用同一实现（见 video-gate.js 的说明：两处必须同口径）
const { normPath } = require('./video-gate')

/** 一次扫描最多收集多少个视频文件（防止误选 C:\ 之类的超大目录卡死） */
const MAX_FILES = 8000
/** 递归深度上限 */
const MAX_DEPTH = 8
/** 目录遍历与 stat 的并发度：NAS/SMB 上串行往返是扫描慢的主因，16 路并发把吞吐放大 */
const CONCURRENCY = 16

/**
 * 递归收集目录下的视频文件（只读）。
 * 并发模型（2026-11-09 P2 审计）：原来是 await 逐目录串行递归 + 逐文件串行 stat，
 * NAS/SMB 上每个往返几毫秒到几十毫秒，大目录的总耗时 ≈ 文件数 × 往返延迟。
 * 现在分两段各开 CONCURRENCY 路并发：① 工作池遍历目录树（只 readdir），
 * ② 并发 stat 拿大小/mtime。返回结构不变，组内排序在渲染层按 size 做，顺序无影响。
 * @param {string} root - 扫描根目录
 * @returns {Promise<{files: Array, scanned: number, truncated: boolean}>}
 */
async function collectVideos(root) {
  const files = []
  let truncated = false
  let truncatedBy = ''      // 'count' | 'depth'：让界面能说清"为什么没扫全"

  // ---- 阶段一：并发遍历目录，收集视频文件路径（只 readdir，不 stat）----
  const found = []
  const queue = [{ dir: root, depth: 0 }]
  await new Promise((resolve) => {
    let active = 0
    const pump = () => {
      if (!queue.length && active === 0) return resolve()
      while (active < CONCURRENCY && queue.length && !truncated) {
        const { dir, depth } = queue.shift()
        active++
        fs.promises.readdir(dir, { withFileTypes: true }).then((entries) => {
          for (const e of entries) {
            if (truncated) break
            if (e.name.startsWith('.')) continue
            if (e.isDirectory()) {
              // 跳过常见无关目录，减少无意义的 IO
              if (/^(\$RECYCLE\.BIN|System Volume Information|node_modules)$/i.test(e.name)) continue
              // 深度上限：与原递归版同一判位（子目录深度超过 MAX_DEPTH 即截断）
              if (depth + 1 > MAX_DEPTH) { truncated = true; truncatedBy = truncatedBy || 'depth'; continue }
              queue.push({ dir: path.join(dir, e.name), depth: depth + 1 })
            } else if (e.isFile() && VIDEO_EXTS.includes(path.extname(e.name).toLowerCase())) {
              // 上限判断放在入列之前：达到上限就整批停止（原实现先计数再判断会多算 1）
              if (found.length >= MAX_FILES) { truncated = true; truncatedBy = truncatedBy || 'count'; break }
              found.push({ path: path.join(dir, e.name), name: e.name })
            }
          }
        }).catch(() => { /* 无权限/目录消失：跳过，不中断整次扫描 */ }).finally(() => {
          active--
          pump()
        })
      }
      if (truncated && active === 0) resolve()
    }
    pump()
  })

  // ---- 阶段二：并发 stat（大小/mtime 供渲染层分组排序）----
  const scanned = found.length
  let idx = 0
  const worker = async () => {
    while (idx < found.length) {
      const f = found[idx++]
      try {
        const st = await fs.promises.stat(f.path)
        files.push({ path: f.path, name: f.name, size: st.size, mtime: Math.round(st.mtimeMs) })
      } catch { /* stat 失败（文件消失/无权限）：跳过，与原行为一致 */ }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(CONCURRENCY, found.length)) }, worker))

  return { files, scanned, truncated, truncatedBy, maxFiles: MAX_FILES }
}

/**
 * 注册查重 IPC。
 * @param {Object} ipcMain - Electron ipcMain
 * @param {Object} db - sql.js 数据库实例
 */
function registerDupIpc(ipcMain, db) {
  // 扫描目录（只读）
  ipcMain.handle(IPC.DUP_SCAN, async (_e, payload) => {
    try {
      const dir = String(payload?.dir || '')
      if (!dir) return { ok: false, error: '未指定目录' }
      let st = null
      try { st = await fs.promises.stat(dir) } catch { return { ok: false, error: '目录不存在或无权限' } }
      if (!st.isDirectory()) return { ok: false, error: '不是目录' }
      const out = await collectVideos(dir)
      console.log(`[dup] 扫描 ${dir} → 视频 ${out.files.length} 个（${out.truncated ? '已截断' : '完整'}）`)
      return { ok: true, data: out }
    } catch (e) {
      console.warn('[dup] 扫描失败:', e.message)
      return { ok: false, error: e.message }
    }
  })

  // 在资源管理器中定位（安全，不修改文件）
  ipcMain.handle(IPC.DUP_REVEAL, (_e, payload) => {
    try {
      const p = String(payload?.path || '')
      if (!p || !fs.existsSync(p)) return { ok: false, error: '文件不存在' }
      shell.showItemInFolder(p)
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })

  // 移入回收站（可恢复；绝不永久删除）
  ipcMain.handle(IPC.DUP_TRASH, async (_e, payload) => {
    try {
      const p = String(payload?.path || '')
      if (!p) return { ok: false, error: '未指定文件' }
      if (!fs.existsSync(p)) return { ok: false, error: '文件不存在（可能已被移动）' }
      if (!VIDEO_EXTS.includes(path.extname(p).toLowerCase())) return { ok: false, error: '只允许处置视频文件' }
      // 第二道闸：库里正在用的那个视频文件不允许从这里删（避免把唯一的可播文件清掉）
      // 用归一化后的比较（大小写 / 斜杠 / \\?\ 前缀都不影响），而不是 SQL 里的精确字符串比对。
      const usedSet = new Set()
      try {
        const rr = db.exec('SELECT py FROM movies')[0]
        for (const v of (rr ? rr.values : [])) {
          const k = normPath(v[0])
          if (k) usedSet.add(k)
        }
      } catch { /* 读不到库就退化为"不做占用判断"，后面还有回收站可还原 */ }
      if (usedSet.has(normPath(p))) return { ok: false, error: '这是库内正在使用的视频文件，请先在片库里处理' }
      // ⚠️ shell.trashItem 偶发抛 `Operation was aborted`（Explorer 回收站操作被系统重试/取消），
      //    但文件其实已经被移走 —— 此时若按失败返回，界面不会把它标成「已移入回收站」，
      //    用户再点一次又会收到「文件不存在」。所以异常后再确认一次磁盘状态。
      try {
        await shell.trashItem(p)
      } catch (e) {
        if (!fs.existsSync(p)) {
          console.log('[dup] 回收站返回异常但文件已移走，按成功处理:', e.message)
          return { ok: true }
        }
        throw e
      }
      console.log('[dup] 已移入回收站:', p)
      return { ok: true }
    } catch (e) {
      console.warn('[dup] 移入回收站失败:', e.message)
      return { ok: false, error: e.message }
    }
  })
}

module.exports = { registerDupIpc }
