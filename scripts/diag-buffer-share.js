/**
 * 证实/证伪：`new SQL.Database(snap.content)` 是否会**就地改写**传入的 Buffer
 * （Emscripten MEMFS 的 createDataFile 可能直接拿这个 Uint8Array 当文件底层存储）
 *
 * 背景（2026-09-30 血案）：scripts/test-restore.js 曾把 `snap.content` 交给 sql.js 造
 * 「带标记的备份库」→ 快照自己被改脏 → 收尾还原把测试标记写回了真库，
 * 且还原函数内部「写回后回读比对」用的还是同一片脏内存，于是照样报 OK。
 * 本脚本是当时的决定性取证，留着用于回归验证「content / pristine 必须两片内存」这条约定。
 *
 * 只读真实 dev 库（不改盘），仅在内存里做一次 UPDATE 观察 Buffer 是否变化。
 *
 * 用法：node scripts/diag-buffer-share.js
 */
const fs = require('fs')
const path = require('path')
const devdb = require('./_devdb.js')
const initSqlJs = require('sql.js')

const LIVE = path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'data', 'app.db')

;(async () => {
  const SQL = await initSqlJs({ locateFile: () => path.join('node_modules', 'sql.js', 'dist', 'sql-wasm.wasm') })
  const snap = devdb.takeSnapshot('diag2', LIVE)

  const before = devdb.sha256(snap.content)
  console.log('快照后 sha256(snap.content) =', before)
  console.log('snap.sha                   =', snap.sha)
  console.log('一致?                      =', before === snap.sha)

  console.log('\n--- new SQL.Database(snap.content) + UPDATE + export ---')
  const db = new SQL.Database(snap.content)
  // 目标行动态取，避免 dev 库 id 漂移导致「改了 0 行」而结论失真
  const tid = db.exec('SELECT MIN(id) FROM movies')[0].values[0][0]
  console.log('UPDATE 目标 id              =', tid)
  db.run('UPDATE movies SET pm=? WHERE id=?', ['DIAG-MARK', tid])
  const exp = db.export()
  console.log('export() 长度              =', exp.length)

  const after = devdb.sha256(snap.content)
  console.log('\n操作后 sha256(snap.content) =', after)
  console.log('★ 被就地改写?              =', after !== before ? '是 ← 根因确认' : '否')

  // 顺带看：Buffer 是否与 sql.js 内部共享同一块内存
  console.log('snap.content 是 Buffer?     =', Buffer.isBuffer(snap.content))
  console.log('snap.content 是 Uint8Array? =', snap.content instanceof Uint8Array)

  db.close()
})().catch((e) => console.error(e))
