/**
 * @file devdb-diff.js
 * @module scripts/devdb-diff
 * @description dev 库字段级差异比对：把「现库」与指定快照逐行比对，只报**真正变化的字段**。
 *
 * 为什么需要它（2026-09-30 立的规矩）：
 *   跑探针 / 回归脚本后，库的 sha 变了并不等于数据被写坏 —— SQLite 每次整库导出都会
 *   产生不同的字节（页面布局、空闲页），所以「sha 变了」只能说明「有人写过」。
 *   要知道「写了什么」，必须落到**行 + 字段**级别。实测一次播放页 UI 回归只改了
 *   3 部影片的 play_count/play_time/play_pos，属应用正常行为，而不是损坏。
 *
 * 用法：
 *   node scripts/devdb-diff.js tmp/_devdb/<label>.<时间戳>.pid<pid>.bak
 *   （不带参数时，取 tmp/_devdb/ 里最新的一份快照）
 */
const fs = require('fs')
const path = require('path')
const initSqlJs = require('sql.js')

const LIVE = path.resolve(__dirname, '..', 'node_modules', 'electron', 'dist', 'data', 'app.db')
const SNAP_DIR = path.resolve(__dirname, '..', 'tmp', '_devdb')

/** 找出要比对的快照：显式传入 > 目录里最新的 .bak */
function pickSnapshot() {
  if (process.argv[2]) return path.resolve(process.argv[2])
  if (!fs.existsSync(SNAP_DIR)) return null
  const list = fs.readdirSync(SNAP_DIR).filter((f) => f.endsWith('.bak'))
    .map((f) => ({ f, m: fs.statSync(path.join(SNAP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  return list.length ? path.join(SNAP_DIR, list[0].f) : null
}

;(async () => {
  const SNAP = pickSnapshot()
  if (!SNAP || !fs.existsSync(SNAP)) { console.error('找不到快照（可用参数指定 .bak 路径）'); process.exit(1) }
  console.log('快照: ' + SNAP)
  console.log('现库: ' + LIVE + '\n')

  const SQL = await initSqlJs({ locateFile: (f) => path.join('node_modules', 'sql.js', 'dist', f) })
  const a = new SQL.Database(fs.readFileSync(SNAP))
  const b = new SQL.Database(fs.readFileSync(LIVE))

  const tables = (db) => {
    const r = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    return r[0] ? r[0].values.map((v) => v[0]) : []
  }
  const ta = tables(a), tb = tables(b)
  console.log('表清单一致: ' + (JSON.stringify(ta) === JSON.stringify(tb)) + '（快照 ' + ta.length + ' 张 / 现库 ' + tb.length + ' 张）')

  let diffTables = 0
  for (const t of ta) {
    const dump = (db) => {
      const r = db.exec('SELECT * FROM "' + t + '"')
      if (!r[0]) return { cols: [], rows: [] }
      return { cols: r[0].columns, rows: r[0].values }
    }
    const da = dump(a), db_ = dump(b)
    if (da.cols.length && db_.cols.length && JSON.stringify(da.cols) !== JSON.stringify(db_.cols)) {
      console.log('  ' + t + ': ✱ 列结构不同\n    快照 ' + da.cols.join(',') + '\n    现库 ' + db_.cols.join(','))
      diffTables++
      continue
    }
    const key = (row) => row.map((x) => (x === null ? '\u0000NULL' : String(x))).join('\u0001')
    const ma = new Map(da.rows.map((r) => [String(r[0]), r]))
    const mb = new Map(db_.rows.map((r) => [String(r[0]), r]))
    const changed = []
    for (const [k, rowA] of ma) {
      const rowB = mb.get(k)
      if (!rowB) { changed.push([k, rowA, null, ['<整行缺失>']]); continue }
      const cols = da.cols
      const f = cols.filter((c, i) => String(rowA[i] ?? '') !== String(rowB[i] ?? ''))
      if (f.length) changed.push([k, rowA, rowB, f])
    }
    for (const k of mb.keys()) if (!ma.has(k)) changed.push([k, null, mb.get(k), ['<新增行>']])

    if (!changed.length) { console.log('  ' + t + ': 行数 ' + ma.size + ' → ' + mb.size + '，无差异'); continue }
    diffTables++
    console.log('  ' + t + ': 行数 ' + ma.size + ' → ' + mb.size + '  ✱ ' + changed.length + ' 行有差异')
    const cols = da.cols.length ? da.cols : db_.cols
    for (const [k, rowA, rowB, f] of changed.slice(0, 12)) {
      console.log('      id=' + k + ' 字段: ' + f.join(', '))
      for (const c of f) {
        if (c === '<整行缺失>' || c === '<新增行>') continue
        const i = cols.indexOf(c)
        console.log('        ' + c + ': ' + JSON.stringify(rowA && rowA[i]) + '  →  ' + JSON.stringify(rowB && rowB[i]))
      }
    }
    if (changed.length > 12) console.log('      …还有 ' + (changed.length - 12) + ' 行')
  }

  console.log('\n有差异的表数: ' + diffTables)
  console.log('（只看字段级差异下结论；sha 变了不等于数据坏了，SQLite 整库导出字节天然不稳定）')
})()
