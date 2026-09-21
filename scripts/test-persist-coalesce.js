/**
 * persistSoon 合并窗口单测（纯 Node，无需 Electron）
 * 目标：证明「同一突发内的多次写只落盘 1~2 次」，且「间隔够久的单次写仍然立即落盘」。
 * 背景：persist = 整库 db.export() + 同步写盘，N 次落盘 = N 次主进程阻塞。
 */
const path = require('path')
const { persistSoon } = require(path.join(__dirname, '..', 'electron', 'main', 'db', 'util.js'))

let pass = 0, fail = 0
const ok = (l, c, d = '') => { if (c) { pass++; console.log('  [OK]   ' + l + (d ? '  ' + d : '')) } else { fail++; console.log('  [FAIL] ' + l + (d ? '  ' + d : '')) } }

const mk = () => { const s = { n: 0 }; return { db: { _forceSave: () => { s.n++ } }, s } }

;(async () => {
  // ① 同一 tick 内 20 次写（原实现 = 20 次整库导出）
  {
    const { db, s } = mk()
    for (let i = 0; i < 20; i++) persistSoon(db)
    await new Promise(r => setTimeout(r, 400))
    ok('同一 tick 20 次写 → 落盘 ≤2 次（原实现 20 次）', s.n <= 2, '实际 ' + s.n + ' 次')
  }

  // ② 单次写：应当立即落盘（延迟不变，保持"毫秒级"语义）
  {
    const { db, s } = mk()
    const t0 = Date.now()
    persistSoon(db)
    const immediate = s.n            // 同 tick 内就应已落盘
    ok('单次写在同一 tick 内立即落盘（未引入延迟）', immediate === 1, `同步命中 ${immediate} 次，用时 ${Date.now() - t0}ms`)
    await new Promise(r => setTimeout(r, 200))
    ok('单次写不会再多落一次', s.n === 1, '实际 ' + s.n)
  }

  // ③ 跨越窗口的连续写：每 300ms 一次，应每次都落盘（不丢更新）
  {
    const { db, s } = mk()
    for (let i = 0; i < 5; i++) { persistSoon(db); await new Promise(r => setTimeout(r, 300)) }
    ok('间隔 300ms 的 5 次写 → 落盘 5 次', s.n === 5, '实际 ' + s.n)
  }

  // ④ 爆发后仍有"尾部落盘"：窗口内的最后一批写不会丢
  {
    const { db, s } = mk()
    persistSoon(db)                                  // 立即 1 次
    for (let i = 0; i < 10; i++) persistSoon(db)     // 窗口内 → 合并
    await new Promise(r => setTimeout(r, 300))
    ok('爆发结束后有一次尾部落盘（最新数据已落盘）', s.n === 2, '实际 ' + s.n + ' 次')
  }

  console.log(`\n==== 结果: 通过 ${pass} / 失败 ${fail} ====`)
  process.exit(fail ? 1 : 0)
})()
