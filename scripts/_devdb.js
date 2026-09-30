/**
 * 文件名：_devdb.js
 * 所属模块：scripts（回归测试基础设施，非产品代码）
 * 功能描述：dev 库「备份 → 测试 → 还原」的安全助手。
 *
 * ── 为什么需要它（2026-09-30 真实事故） ─────────────────────────────────────
 * 修性能问题时在 dev 库里造了 500 条测试影片，随后跑回归脚本，包里的 500 条全没了。
 * 根因是三个 Electron 回归脚本各自写的一段「备份还原」：
 *
 *     const BAK = path.join(ROOT,'tmp','_dev-app.db.persist-test.bak')
 *     if (!fs.existsSync(BAK)) fs.copyFileSync(LIVE, BAK)   // ← 只在备份不存在时才备份
 *     const backupContent = fs.readFileSync(BAK)
 *     ...
 *     fs.writeFileSync(LIVE, backupContent)                 // ← 结束无条件写回
 *
 * 固定文件名 + 「有就复用」意味着：**只要历史运行留下过这个文件，之后每一次运行都会拿
 * 陈旧快照去覆盖真实库**，哪怕本次运行根本没改过库。实测当场就抓到了这个状态：
 *     tmp/_dev-app.db.persist-test.bak   45056 字节  (9 天前)
 *     tmp/_dev-app.db.restore-test.bak   45056 字节  (9 天前)
 *     node_modules/electron/dist/data/app.db  610304 字节 (当前真库)
 * 也就是说：任何人此刻重跑一次 test-persist.js，真库会直接从 610KB 退回 9 天前的 45KB。
 *
 * ── 本模块的约定（四条，缺一不可） ─────────────────────────────────────────
 *   ① 每次运行都新建**本次独有**的快照（文件名带时间戳 + pid），绝不复用既有文件；
 *   ② 快照落盘后立刻按 SHA-256 回读校验，写坏了一个字节也不放行；
 *   ③ 还原前先验快照是不是有效的 SQLite 文件（16 字节头魔法），不像就**拒绝写回**并报警；
 *   ④ 若本次运行的真实库内容与快照完全一致（说明测试没改到库），则**不写盘** ——
 *      避免无谓地改 mtime、白白触发杀软扫描与文件索引。
 *
 * 用法：
 *     const devdb = require('./_devdb.js')
 *     const snap = devdb.takeSnapshot('persist-test', LIVE)   // 一定会抛错而不是静默降级
 *     try { ...测试... } finally { devdb.restoreSnapshot(snap) }
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = process.cwd()

/** 每个用途保留的快照份数（更老的自动清理，避免 tmp 无限膨胀） */
const KEEP_PER_LABEL = 5

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

function backupDir() {
  const d = path.join(ROOT, 'tmp', '_devdb')
  fs.mkdirSync(d, { recursive: true })
  return d
}

/**
 * 取一份本次运行独有的 dev 库快照。
 *
 * 刻意「宁可抛错也不静默降级」：拿不到可用快照时，测试**必须**停下来，
 * 而不是继续拿真实库去试 —— 原实现就是在这里静默复用了陈旧文件。
 *
 * @param {string} label   用途名（persist-test / restore-test / fill-scrape …）
 * @param {string} livePath 真实库路径
 * @returns {{path:string, content:Buffer, sha:string, livePath:string}}
 */
function takeSnapshot(label, livePath) {
  if (!fs.existsSync(livePath)) throw new Error('dev 库不存在，拒绝运行: ' + livePath)
  const content = fs.readFileSync(livePath)
  if (!content.length) throw new Error('dev 库是 0 字节，拒绝运行: ' + livePath)
  if (!isSqlite(content)) throw new Error('dev 库不是有效的 SQLite 文件，拒绝运行: ' + livePath)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(backupDir(), `${label}.${stamp}.pid${process.pid}.bak`)
  fs.writeFileSync(dest, content)

  // 回读校验：磁盘上必须是刚才那份内容（防止写一半/杀软拦截等静默损坏）
  const sha = sha256(content)
  const written = fs.readFileSync(dest)
  if (written.length !== content.length || sha256(written) !== sha) {
    throw new Error('快照写入后校验不一致，拒绝继续: ' + dest)
  }

  prune(label, dest)
  console.log(`已快照 dev 库（本次独有）→ ${dest}`)
  console.log(`  ${content.length} 字节  sha256=${sha.slice(0, 16)}…`)
  return { path: dest, content, sha, livePath }
}

/**
 * 还原：把快照写回真实库。
 * @param {{path:string, content:Buffer, sha:string, livePath:string}} snap
 * @returns {boolean} 是否处于「库已等于快照」的状态
 */
function restoreSnapshot(snap) {
  const live = snap.livePath
  const cur = fs.existsSync(live) ? fs.readFileSync(live) : Buffer.alloc(0)

  // ④ 内容没变就别写盘
  if (cur.length === snap.content.length && sha256(cur) === snap.sha) {
    console.log('\ndev 库未被本次运行改动，保持原文件不写盘 ✅')
    return true
  }

  // ③ 快照有效性校验：宁可留着被改过的库并报警，也不写回一份坏数据
  if (!isSqlite(snap.content)) {
    console.error('\n❌ 快照不是有效的 SQLite 文件，**拒绝写回真实库**（现场保持原样）')
    console.error('   快照:', snap.path)
    return false
  }

  fs.writeFileSync(live, snap.content)
  const okNow = fs.readFileSync(live).compare(snap.content) === 0
  console.log('\ndev 库已还原:', okNow ? 'OK（字节一致）' : '❌ 失败')
  if (!okNow) console.error('   请人工用这份快照恢复:', snap.path)
  else console.log('   快照留存:', snap.path)
  return okNow
}

/** SQLite 文件头魔法（前 15 字节 ASCII + 1 字节 NUL） */
function isSqlite(buf) {
  return buf.length > 16 && buf.slice(0, 15).toString('latin1') === 'SQLite format 3'
}

/** 只保留同一用途最近 KEEP_PER_LABEL 份快照 */
function prune(label, keepPath) {
  try {
    const dir = backupDir()
    const mine = fs.readdirSync(dir)
      .filter(f => f.startsWith(label + '.') && f.endsWith('.bak'))
      .map(f => path.join(dir, f))
      .sort()                       // 文件名带 ISO 时间戳 → 字典序即时间序
    const keep = new Set([path.resolve(keepPath)])
    for (const f of mine.slice(-KEEP_PER_LABEL)) keep.add(path.resolve(f))
    for (const f of mine) if (!keep.has(path.resolve(f))) fs.unlinkSync(f)
  } catch { /* 清理失败不影响测试 */ }
}

module.exports = { takeSnapshot, restoreSnapshot, isSqlite, sha256 }
