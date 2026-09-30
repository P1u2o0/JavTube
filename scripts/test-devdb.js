/**
 * _devdb.js 自检：证明「陈旧快照不可能被复用」与「拒绝写坏数据」真的成立。
 * ⚠️ 全程只用 tmp 下的假库，绝不触碰真实 dev 库。
 *
 * 背景：2026-09-30 真实事故 —— dev 库被 9 天前的旧快照覆盖。
 * 本测试要钉住修复后的四条不变量。
 */
const fs = require('fs')
const path = require('path')

const ROOT = process.cwd()
const devdb = require(path.join(ROOT, 'scripts', '_devdb.js'))

const SANDBOX = path.join(ROOT, 'tmp', '_devdb-selftest')
fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(SANDBOX, { recursive: true })

const LIVE = path.join(SANDBOX, 'live.db')
const HDR = Buffer.from('SQLite format 3\0', 'latin1')
const mkDb = (tag, size = 64) => Buffer.concat([HDR, Buffer.alloc(size, tag)])

let pass = 0, fail = 0
const ok = (l, c, d = '') => { if (c) { pass++; console.log('  [OK]   ' + l + (d ? '  ' + d : '')) } else { fail++; console.log('  [FAIL] ' + l + (d ? '  ' + d : '')) } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  // ── 用例 0：真库不存在 / 0 字节 / 不是 SQLite → 必须**抛错**而不是静默继续 ──
  console.log('\n=== 0. 拿不到有效快照时必须抛错（绝不放行） ===')
  const throws = (fn) => { try { fn(); return null } catch (e) { return e.message } }
  const e1 = throws(() => devdb.takeSnapshot('selftest', path.join(SANDBOX, 'nope.db')))
  ok('库不存在 → 抛错', !!e1 && /不存在/.test(e1), e1 || '(没抛错!)')

  fs.writeFileSync(LIVE, Buffer.alloc(0))
  const e2 = throws(() => devdb.takeSnapshot('selftest', LIVE))
  ok('库为 0 字节 → 抛错', !!e2 && /0 字节/.test(e2), e2 || '(没抛错!)')

  fs.writeFileSync(LIVE, Buffer.from('this is definitely not a sqlite file at all'))
  const e3 = throws(() => devdb.takeSnapshot('selftest', LIVE))
  ok('库不是 SQLite → 抛错', !!e3 && /不是有效/.test(e3), e3 || '(没抛错!)')

  // ── 用例 1：每次运行都产生**独有**快照，绝不复用任何既有文件 ──
  console.log('\n=== 1. 快照每次独有（陈旧快照不可能被复用） ===')
  fs.writeFileSync(LIVE, mkDb(0x11))
  // 故意在旧约定位置埋一个「毒快照」：内容是别的字节，模拟历史遗留的陈旧备份
  const POISON = path.join(ROOT, 'tmp', '_dev-app.db.selftest.bak')
  fs.writeFileSync(POISON, mkDb(0xee))
  const s1 = devdb.takeSnapshot('selftest', LIVE)
  fs.writeFileSync(LIVE, mkDb(0x22))
  const s2 = devdb.takeSnapshot('selftest', LIVE)
  ok('两次快照路径不同', s1.path !== s2.path, 'A=' + path.basename(s1.path))
  ok('快照内容 = 当次库内容（而非陈旧文件）', s1.content.equals(mkDb(0x11)) && s2.content.equals(mkDb(0x22)),
    `s1 首字节=${s1.content[16].toString(16)} s2 首字节=${s2.content[16].toString(16)}（陈旧毒快照是 ee）`)
  ok('快照落在 tmp/_devdb/ 且不再是固定文件名', /[\\/]tmp[\\/]_devdb[\\/]/.test(s1.path) && s1.path.includes('.pid'),
    path.basename(s1.path))
  ok('快照回读校验通过（sha256 一致）', devdb.sha256(fs.readFileSync(s1.path)) === s1.sha)

  // ── 用例 2：测试没改库 → 还原时**不写盘**（证明 mtime 不变） ──
  console.log('\n=== 2. 库未变更时不写盘（不制造无谓的 mtime 变动） ===')
  fs.writeFileSync(LIVE, mkDb(0x33))
  const s3 = devdb.takeSnapshot('selftest', LIVE)
  const mtBefore = fs.statSync(LIVE).mtimeMs
  await sleep(30)
  const r3 = devdb.restoreSnapshot(s3)
  const mtAfter = fs.statSync(LIVE).mtimeMs
  ok('报告为已一致', r3 === true)
  ok('磁盘文件 mtime 未被改动（确实没写）', mtBefore === mtAfter, `${mtBefore} → ${mtAfter}`)

  // ── 用例 3：库被改过 → 还原为快照内容，字节一致 ──
  console.log('\n=== 3. 库被改过 → 还原为快照内容 ===')
  fs.writeFileSync(LIVE, mkDb(0x44))
  const s4 = devdb.takeSnapshot('selftest', LIVE)
  fs.writeFileSync(LIVE, mkDb(0x55, 128))     // 模拟测试污染（内容与长度都变了）
  const r4 = devdb.restoreSnapshot(s4)
  ok('还原成功', r4 === true)
  ok('磁盘内容与快照字节一致', fs.readFileSync(LIVE).equals(s4.content), `${fs.readFileSync(LIVE).length} 字节`)

  // ── 用例 4：快照损坏 → **拒绝写回**，现场保持原样 ──
  console.log('\n=== 4. 快照损坏 → 拒绝写回（宁可不还原，也不写坏数据） ===')
  fs.writeFileSync(LIVE, mkDb(0x66))
  const s5 = devdb.takeSnapshot('selftest', LIVE)
  fs.writeFileSync(LIVE, mkDb(0x77))          // 现场有被改过的库
  // 还原用的真源是 pristine（不是调用方手里的 content），所以「损坏快照」要连它一起毁
  const corrupt = { ...s5, pristine: Buffer.from('garbage not sqlite...............') }
  const r5 = devdb.restoreSnapshot(corrupt)
  ok('返回值 false（还原被拒绝）', r5 === false)
  ok('现场未被写入（仍是 0x77 那份）', fs.readFileSync(LIVE).equals(mkDb(0x77)),
    '首字节=' + fs.readFileSync(LIVE)[16].toString(16))

  // ── 用例 4b：★ 调用方手里的 content 被就地改写（sql.js 血案）→ 还原仍须用原始字节 ──
  // 2026-09-30：`new SQL.Database(buf)` 会经 Emscripten MEMFS 直接拿这片内存当文件底层存储，
  // UPDATE 后 buf 被就地改写。旧实现把 snapshot 自己的 content 交出去 → 快照被自己改脏 →
  // 还原时把测试数据写回真库，且回读比对用的还是同一个脏 buffer，照样报「OK」。
  console.log('\n=== 4b. 调用方的 content 被就地改写 → 还原必须仍用原始字节 ===')
  fs.writeFileSync(LIVE, mkDb(0xAA))
  const s6 = devdb.takeSnapshot('selftest', LIVE)
  ok('content 与 pristine 是两片独立内存', !s6.content.equals(Buffer.alloc(0)) && s6.content !== s6.pristine)
  const before = devdb.sha256(s6.pristine)
  s6.content.fill(0xBB)                       // 模拟 sql.js 就地改写
  ok('改写 content 不影响 pristine', devdb.sha256(s6.pristine) === before)
  fs.writeFileSync(LIVE, mkDb(0xCC))          // 现场被测试改过
  const r6 = devdb.restoreSnapshot(s6)
  ok('还原成功', r6 === true)
  ok('★ 还原的是原始字节（0xAA），不是被改写的 content（0xBB）', fs.readFileSync(LIVE).equals(mkDb(0xAA)),
    '首字节=' + fs.readFileSync(LIVE)[16].toString(16))
  ok('同一份快照重复还原仍幂等', (devdb.restoreSnapshot(s6), fs.readFileSync(LIVE).equals(mkDb(0xAA))))

  // ── 用例 5：保留份数上限（避免 tmp 膨胀） ──
  console.log('\n=== 5. 同用途快照保留最近 5 份 ===')
  for (let i = 0; i < 8; i++) { fs.writeFileSync(LIVE, mkDb(0x10 + i)); devdb.takeSnapshot('prune-probe', LIVE) }
  const kept = fs.readdirSync(path.join(ROOT, 'tmp', '_devdb')).filter(f => f.startsWith('prune-probe.'))
  ok('prune-probe 用途只剩 ≤5 份', kept.length <= 5, kept.length + ' 份')

  // ── 收尾：清掉自检产物（含埋下的毒快照） ──
  fs.rmSync(SANDBOX, { recursive: true, force: true })
  try { fs.unlinkSync(POISON) } catch { }
  for (const f of fs.readdirSync(path.join(ROOT, 'tmp', '_devdb'))) {
    if (f.startsWith('selftest.') || f.startsWith('prune-probe.')) fs.unlinkSync(path.join(ROOT, 'tmp', '_devdb', f))
  }

  console.log(`\n==== 结果: 通过 ${pass} / 失败 ${fail} ====`)
  process.exit(fail ? 1 : 0)
})()
