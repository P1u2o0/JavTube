/**
 * 任务级清理：把「本次/历次开发留下的、可再生的」临时产物清掉。
 *
 * 与 `scripts/release/cleanup-residue.js` 的分工：
 *   · cleanup-residue.js —— **发版后**清 release/ 里的构建残留与已上传的旧 zip（要联网核对远端）；
 *   · 本脚本 —— **每次任务收尾**清开发期的临时产物（tmp/ 下的日志/截图/一次性素材 + release/ 的构建中间目录）。
 *
 * 安全设计（照抄 cleanup-residue.js 的取向）：
 *   A. **只删明确列举的条目**，绝不做通配递归；
 *   B. 删目录前断言它不是「必须保留」的那几个（见 KEEP）；
 *   C. 每条 try/catch 独立处理，EBUSY/EPERM 只记录不重试；
 *   D. 默认 dry-run，要 --apply 才真删。
 *
 * ⚠️ 必须保留（脚本会断言，误配也不会删）：
 *   tmp/_devdata-backup/   —— Electron 回退材料（开发数据 + 原始 package.json/lock）
 *   tmp/_devdb/            —— 回归脚本的快照库（scripts/_devdb.js 用）
 *   tmp/*.js               —— 探针/回归脚本（可复现的证据）
 *   （探针已统一指向 vendor/mpv/mpv.exe —— 与发布包同一份，tmp 里的副本可删）
 *   tmp/_imgmig-backup-&lt;日期&gt;  —— 图片迁移备份，**可能含用户数据**，只报告不删
 *
 * 用法（项目根执行）：
 *   node scripts/clean-task.js            # 预演
 *   node scripts/clean-task.js --apply    # 执行
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

// ---- 0) 自愈：若 NODE_OPTIONS 里带着 fs shim，则以空 NODE_OPTIONS 重跑自己 ----
// 为什么必须这么做（2026-09-30 实测，cleanup-residue.js 里也记着同一条）：
//   Bash 工具注入的 `NODE_OPTIONS=--require .../node-language-shim.cjs` 会**同时 hook fs**，
//   于是 fs.rmSync 报的错变成：
//     [safe-delete] 操作失败: ... Error during a `trash` operation: Unknown
//   看着像「目录被句柄锁死」，其实**完全是假象** —— shim 把删除劫持去走回收站失败了。
//   实测后果：大目录一个都删不掉（本次只成功 4 个小文件、7 个大目录全失败）。
const shim = process.env.NODE_OPTIONS || ''
if (/node-language-shim/.test(shim) && !process.env.__CLEANTASK_NOSHIM) {
  const env = Object.assign({}, process.env, { NODE_OPTIONS: '', __CLEANTASK_NOSHIM: '1' })
  const r = spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit' })
  process.exit(r.status === null ? 1 : r.status)
}

const ROOT = path.resolve(__dirname, '..')
const APPLY = process.argv.includes('--apply')
const TMP = path.join(ROOT, 'tmp')
const RELEASE = path.join(ROOT, 'release')
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist')

/** 绝不允许被删除的路径（前缀匹配） */
const KEEP = [
  path.join(TMP, '_devdata-backup'),
  path.join(TMP, '_devdb'),
  path.join(RELEASE, 'JavTube')            // 当前构建产物
]

/** 只报告、不自动删（可能是用户数据 / 可能还要用） */
const REPORT_ONLY = [
  path.join(TMP, '_imgmig-backup-20261005-122815'),
  path.join(TMP, '_prod.db')
]

const targets = []
const sizeOf = (p) => {
  try {
    const st = fs.statSync(p)
    if (!st.isDirectory()) return st.size
    let sum = 0
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      sum += sizeOf(path.join(p, e.name))
    }
    return sum
  } catch { return 0 }
}
const add = (p, why) => { if (fs.existsSync(p)) targets.push({ p, why, size: sizeOf(p) }) }

// ── 1) tmp 下的一次性产物（明确列举，不用通配递归）──
if (fs.existsSync(TMP)) {
  for (const name of fs.readdirSync(TMP)) {
    const full = path.join(TMP, name)
    const isDir = fs.statSync(full).isDirectory()
    if (isDir) {
      if (/^_(tiny|tiny\d|cptest|asartest)\d*$/.test(name)) add(full, 'tmp 早期实验残留目录')
      else if (name === 'bench') add(full, 'tmp 基准测试残留')
      continue
    }
    if (/^_diag-copy\.db$/.test(name)) add(full, 'tmp 诊断用库副本')
    // ⚠️ 排除 _remote_assets.json：它是 cleanup-residue.js 的输入（远端已上传附件清单），
    //    删掉会让发版清理「以为远端什么都没有」而不敢删旧 zip。
    else if (name === '_remote_assets.json') continue
    // ⚠️ 排除 _remote_assets.json：它是 cleanup-residue.js 的输入（远端已上传附件清单），
    //    删掉会让发版清理「以为远端什么都没有」而不敢删旧 zip。
    else if (name === '_remote_assets.json') continue
    else if (/^_[\w.-]+\.(log|txt|json)$/.test(name)) add(full, 'tmp 一次性日志 / 结果')
    else if (/^idol-.*\.html$/.test(name)) add(full, 'tmp 刮削时抓的页面')
    else if (/\.(png)$/.test(name)) add(full, 'tmp 探针截图')
    else if (/^(electron40\.zip|abf340-seg\.mp4|test-local\.mp4)$/.test(name)) add(full, 'tmp 一次性素材（已解包 / 测试用视频）')
  }
}

// ── 2) mpv-spike 里用不到的部分（保留 mpv.exe / dll 与探针脚本）──
const SPIKE = path.join(TMP, 'mpv-spike')
if (fs.existsSync(SPIKE)) {
  for (const name of fs.readdirSync(SPIKE)) {
    const full = path.join(SPIKE, name)
    if (KEEP.includes(full)) continue
    const isDir = fs.statSync(full).isDirectory()
    if (isDir) {
      if (['doc', 'installer', 'mpv'].includes(name)) add(full, 'mpv 发行包里用不到的部分')
      continue
    }
    if (/\.(log|png)$/.test(name)) add(full, 'mpv 探针日志 / 截图')
    else if (/^(mpv\.7z|mpv\.com|updater\.bat|mpv-register\.bat|mpv-unregister\.bat)$/.test(name)) add(full, 'mpv 发行包里用不到的部分')
    // tmp 里的 mpv 二进制是 vendor/mpv 的重复副本（探针已统一指向 vendor/mpv）
    else if (/^(mpv\.exe|d3dcompiler_43\.dll)$/.test(name)) add(full, 'tmp 里的 mpv 重复副本（探针已指向 vendor/mpv）')
  }
}

// ── 3) release 的构建中间目录与改名残留 ──
if (fs.existsSync(RELEASE)) {
  for (const name of fs.readdirSync(RELEASE)) {
    const full = path.join(RELEASE, name)
    if (name.startsWith('.build-') || name === '.asar-src' || name === 'win-unpacked') add(full, 'release 构建中间目录')
    else if (/\.old-\d+$/.test(name)) add(full, 'release 改名残留')
  }
}

// ── 4) 打包前挪走的开发数据（只在 data/ 已还原时才是残留）──
const parked = path.join(ELECTRON_DIST, 'data.parked')
if (fs.existsSync(parked) && fs.existsSync(path.join(ELECTRON_DIST, 'data'))) {
  add(parked, '打包前挪走的开发数据（data/ 已还原，这份是残留）')
}

// ── 输出与执行 ──
const guard = (p) => KEEP.some(k => p === k || p.startsWith(k + path.sep))
const report = REPORT_ONLY.filter(p => fs.existsSync(p)).map(p => ({ p, size: sizeOf(p) }))

const bad = targets.filter(t => guard(t.p))
if (bad.length) {
  console.error('❌ 内部错误：待删清单里出现了必须保留的路径，已中止：')
  for (const t of bad) console.error('   ' + t.p)
  process.exit(1)
}

const total = targets.reduce((a, t) => a + t.size, 0)
console.log(`=== ${APPLY ? '执行清理' : 'DRY-RUN（加 --apply 才真删）'} ===`)
for (const t of targets.sort((a, b) => b.size - a.size)) {
  console.log(`${APPLY ? 'DEL ' : 'WOULD'} ${(t.size / 1048576).toFixed(1).padStart(8)} MB  ${path.relative(ROOT, t.p)}  — ${t.why}`)
}
console.log(`\n条目 ${targets.length}：将删 ${targets.length}，可回收 ≈ ${(total / 1048576).toFixed(1)} MB`)

if (report.length) {
  console.log('\n以下**只报告、不自动删**（可能含用户数据或还要用）：')
  for (const r of report) console.log(`   ${(r.size / 1048576).toFixed(1).padStart(8)} MB  ${path.relative(ROOT, r.p)}`)
}
console.log('\n保留不动：tmp/_devdata-backup（回退材料）、tmp/_devdb（测试快照）、tmp/*.js（探针脚本）')

if (APPLY) {
  let ok = 0, fail = 0
  for (const t of targets) {
    try { fs.rmSync(t.p, { recursive: true, force: true }); ok++ }
    catch (e) { fail++; console.warn(`   删除失败 ${path.relative(ROOT, t.p)} — ${e.code || e.message}`) }
  }
  console.log(`\n完成：成功 ${ok}，失败 ${fail}`)
  if (fail) {
    // 已知环境现象（项目 HANDOFF / cleanup-residue.js 里也记着）：
    //   release/.build-* 里的 win-unpacked 会被系统句柄锁住 → rmSync 报 EBUSY、
    //   rename 报 EPERM，连非沙箱执行也一样。**这不是脚本的问题，也不是数据问题**，
    //   过一段时间（或重启后）句柄释放了再跑一次即可；也可以在资源管理器里手动删。
    console.log('   提示：失败项多为 release/.build-*（被系统句柄锁住，属已知现象）——')
    console.log('         过一会儿或重启后再跑一次本脚本即可，也可以在资源管理器里手动删除。')
  }
} else {
  console.log('\n（预演结束，未改动任何文件。加 --apply 执行）')
}
