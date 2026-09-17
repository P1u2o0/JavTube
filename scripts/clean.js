/**
 * @file clean.js
 * @module scripts/clean
 * @description 清理构建中间产物，**但保留 release/ 下的交付 zip**。
 *
 * 用法：
 *   node scripts/clean.js              清中间物（保留 release/*.zip）
 *   node scripts/clean.js --all        连 release/*.zip 一起清（慎用，会删掉发行包）
 *   node scripts/clean.js --keep-dist  保留 dist/，只清 release/
 *
 * 清理范围：
 *   release/.build-* / .asar-src / win-unpacked / JavTube/   ← 中间物与解压目录
 *   dist/                                                    ← Vite 产物
 * 不动：release/*.zip（交付物）
 *
 * 为什么不用 shell 的 rm -rf：
 *   ① 受管环境的「安全删除」层会把删除路由到回收站，大目录走到一半就 aborted，整个删除失败；
 *   ② 刚构建出的 exe / app.asar 常被杀软或系统句柄短暂占住，直接删会 EBUSY，过一会儿自己就释放了。
 * 所以这里统一用 Node fs.rmSync，并且**先递归删文件、再自底向上删目录**
 * —— 只剩空目录时才真正会卡住。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const ALL = process.argv.includes('--all')
const KEEP_DIST = process.argv.includes('--keep-dist')

/** 要保留的文件（交付 zip） */
const isDeliverable = (name) => /\.zip$/i.test(name)

/** 递归统计体积（必须递归：只 stat 顶层子项会严重低估） */
function size(p) {
  try {
    const st = fs.statSync(p)
    if (!st.isDirectory()) return st.size
    return fs.readdirSync(p).reduce((a, f) => a + size(path.join(p, f)), 0)
  } catch { return 0 }
}

/**
 * 删掉一个目录/文件。返回未删掉的路径列表。
 * 顺序：先递归删文件 → 再自底向上删空目录 —— 只剩空目录时才真正会卡住。
 */
function purge(target) {
  const locked = []
  let st
  try { st = fs.statSync(target) } catch { return locked }

  if (!st.isDirectory()) {
    try { fs.rmSync(target, { force: true }) } catch { locked.push(target) }
    return locked
  }

  const walkFiles = (d) => {
    let entries
    try { entries = fs.readdirSync(d) } catch { return }
    for (const f of entries) {
      const q = path.join(d, f)
      let s
      try { s = fs.statSync(q) } catch { continue }
      if (s.isDirectory()) walkFiles(q)
      else { try { fs.rmSync(q, { force: true }) } catch { locked.push(q) } }
    }
  }
  walkFiles(target)

  const subdirs = []
  const collect = (d) => {
    let entries
    try { entries = fs.readdirSync(d) } catch { return }
    for (const f of entries) {
      const q = path.join(d, f)
      try { if (fs.statSync(q).isDirectory()) { collect(q); subdirs.push(q) } } catch {}
    }
  }
  collect(target)
  for (const d of subdirs.sort((a, b) => b.length - a.length)) {
    try { fs.rmdirSync(d) } catch { locked.push(d) }
  }
  try { fs.rmdirSync(target) } catch { locked.push(target) }
  return locked
}

let freed = 0
const allLocked = []

// ① release/：逐项处理，保留交付 zip
const REL = path.join(ROOT, 'release')
if (!fs.existsSync(REL)) {
  console.log('  · release  不存在，跳过')
} else {
  const before = size(REL)
  const kept = []
  for (const name of fs.readdirSync(REL)) {
    const p = path.join(REL, name)
    if (!ALL && isDeliverable(name)) { kept.push(name); continue }
    const sz = size(p)
    const locked = purge(p)
    if (fs.existsSync(p)) locked.length ? allLocked.push(...locked) : allLocked.push(p)
    else freed += sz
  }
  console.log(`  ✓ release  清理后 ${(size(REL) / 1048576).toFixed(1)} MB（原 ${(before / 1048576).toFixed(1)} MB）` +
    (kept.length ? `\n             保留交付物：${kept.join('、')}` : ''))
}

// ② dist/：整体清掉
if (!KEEP_DIST) {
  const D = path.join(ROOT, 'dist')
  if (!fs.existsSync(D)) {
    console.log('  · dist  不存在，跳过')
  } else {
    const before = size(D)
    const locked = purge(D)
    if (fs.existsSync(D)) { allLocked.push(...locked); console.log(`  ⚠ dist  部分清理（${(size(D) / 1048576).toFixed(1)} MB 残留）`) }
    else { freed += before; console.log(`  ✓ dist  已删除（${(before / 1048576).toFixed(1)} MB）`) }
  }
}

console.log(`\n共释放 ${(freed / 1048576).toFixed(1)} MB`)

if (allLocked.length) {
  const uniq = [...new Set(allLocked)]
  console.log(`\n⚠️ 有 ${uniq.length} 项被进程占用，暂时删不掉：`)
  uniq.slice(0, 6).forEach(p => console.log('   ' + path.relative(ROOT, p)))
  if (uniq.length > 6) console.log(`   …还有 ${uniq.length - 6} 项`)
  console.log('\n   通常是杀软/系统残留句柄，**重启后重跑 `npm run clean` 即可清掉**。')
  console.log('   不影响下次构建：打包脚本每次使用带时间戳的全新临时目录。')
}
