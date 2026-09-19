/**
 * @file build-portable.js
 * @module scripts/build-portable
 * @description 生成 Windows x64 压缩包（解压后直接运行，覆盖旧文件即为升级）。
 *
 * 产物：release/JavTube-v<版本>-win-x64.zip
 * 解压后目录结构（data 与 exe 同级，实现「解压即用 + 覆盖即更新」）：
 *   JavTube/
 *   ├─ JavTube.exe
 *   ├─ data/                 ← 运行时自动生成，升级时不要覆盖
 *   ├─ 使用说明.txt
 *   ├─ resources/app.asar
 *   └─ ...(Electron 运行时文件)
 *
 * ============================================================================
 * ⚠️⚠️  exe 图标 / 版本信息是怎么写进去的（动这里之前必读）  ⚠️⚠️
 * ============================================================================
 * package.json 的 build.win 里 **必须保持 "signAndEditExecutable": false**，理由：
 *   一旦设为 true，electron-builder 会去解压 winCodeSign 归档，而该归档里含 macOS
 *   符号链接（darwin/10.12/lib/*.dylib）。普通权限的 Windows 解不开符号链接，直接报
 *     ERROR: Cannot create symbolic link : 客户端没有所需的特权。
 *   整个打包失败。（开启开发者模式或管理员权限能绕开，但要求所有开发机都开，不可靠。）
 *
 * 代价：这个开关同时也关掉了 electron-builder 往 exe 里写图标和版本信息的能力，
 *      所以 **必须由本脚本的 embedIcon() 用 rcedit 补上**，否则打出来的 exe 就是
 *      Electron 默认图标（历史上踩过：v1.0 的 JavTube.exe 与原生 electron.exe 字节数
 *      完全一致 = 图标压根没嵌进去，当时还专门写过 rcedit.exe + replace_icon.py 手动补，
 *      其实根因就是这个开关）。
 *
 * rcedit 不在本仓库里，按下面顺序找（embedIcon 内实现）：
 *   ① electron-builder 缓存里已有的 rcedit-x64.exe
 *   ② 从缓存的 winCodeSign/*.7z 里单独解出 rcedit-x64.exe（跳过 darwin，避开符号链接）
 *   ③ 都没有 → 调 app-builder prefetch-tools 拉一次归档，再回到 ②
 *   ④ 仍失败 → 打印醒目警告继续打包（exe 会是默认图标，但流程不中断）
 * ============================================================================
 *
 * 为什么还要在 electron-builder 之后「瘦身」app.asar：
 *   electron-builder 会把整个 node_modules 塞进 app.asar（实测 88MB），
 *   但运行时主进程只 require('sql.js')，渲染层已被 Vite 完整打包进 dist/，
 *   element-plus / vue / vite / electron-builder 等统统用不到。
 *   这里用 @electron/asar 重新打包，只保留 dist + electron + package.json + sql.js 两个文件，
 *   asar 从 88MB 降到约 3MB。
 *
 * @dependencies node:fs, node:path, node:child_process, @electron/asar, vite, electron-builder, 7zip-bin
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const asar = require('@electron/asar')

const ROOT = path.resolve(__dirname, '..')
// 输出根目录：默认 release/，可用环境变量 JAVTUBE_OUT 覆盖。
// 用途：某些环境里旧产物会被杀软/安全层长期占用句柄，导致删不掉也改不了名，
// 此时换个全新的输出根目录再跑一次即可（旧目录留着不影响）。
const OUT_ROOT = path.join(ROOT, process.env.JAVTUBE_OUT || 'release')
// 唯一的构建输出根就是 release/（electron-builder 的默认约定）。
// 每次构建都用「带时间戳的唯一临时目录」release/.build-<ts>：
// 教训：electron-builder 写出的 app.asar 常被系统句柄占住（杀软/安全层/上一次强杀的残留），
// 复用同一个临时目录时它会删不掉旧文件而直接失败：
//   remove ...\resources\app.asar: The process cannot access the file because it is being used by another process.
// 换唯一目录即可彻底避开，旧目录留给系统释放后再清。
let TMP_DIR = ''
let TMP_DIR_REL = ''
let UNPACKED = ''
const TMP_PREFIX = '.build-'
const STAGE = path.join(OUT_ROOT, '.asar-src')
const APP_NAME = 'JavTube'                    // 压缩包内的顶层目录名（保持稳定，便于覆盖更新）
const OUT_DIR = path.join(OUT_ROOT, APP_NAME)

const pkg = require(path.join(ROOT, 'package.json'))
const VERSION = pkg.version
const NODE_BIN = process.execPath
const SEVEN_ZIP = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')

/** 打印步骤标题 */
function step(msg) { console.log('\n=== ' + msg + ' ===') }

/** 同步执行命令并透传输出 */
function run(cmd, args, opts = {}) {
  console.log('$ ' + [cmd, ...args].join(' '))
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts })
}

/** 简单延时 */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

/**
 * 移动目录。刚写出的 exe 常被杀软/索引器短暂占用，rename 会报 EPERM，
 * 因此重试若干次，仍失败则退化为复制（copy 走的是另一套系统调用，通常能过）。
 */
async function moveDir(src, dest) {
  for (let i = 1; i <= 5; i++) {
    try {
      fs.renameSync(src, dest)
      return
    } catch (e) {
      console.warn(`[warn] rename 第 ${i}/5 次失败：${e.code}`)
      await sleep(1500)
    }
  }
  console.warn('[warn] rename 始终失败，改用复制（源目录请稍后手动清理）')
  fs.cpSync(src, dest, { recursive: true })
}

/** 同步阻塞等待（不依赖异步上下文） */
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

/**
 * 删除目录/文件。分两种情况兜底：
 *  1. 刚写出的 exe/dll 常被杀软或索引器短暂占用 → 重试几次；
 *  2. 某些受管环境下 rm 会被安全策略拦截 → 退化为「改名到 .old-<时间戳>」，保证流程不中断。
 */
function remove(p) {
  if (!fs.existsSync(p)) return
  for (let i = 1; i <= 4; i++) {
    try {
      fs.rmSync(p, { recursive: true, force: true })
      return
    } catch (e) {
      if (i < 4) { console.warn(`[warn] 删除 ${path.basename(p)} 第 ${i}/4 次失败（${e.code}），重试…`); sleepSync(1500) }
      else {
        try {
          const alt = p + '.old-' + Date.now()
          fs.renameSync(p, alt)
          console.warn(`[warn] 无法删除 ${p}（${e.code}），已改名到 ${alt}`)
        } catch (e2) {
          console.warn(`[warn] 无法删除也无法改名 ${p}（${e.code} / ${e2.code}），跳过`)
        }
      }
    }
  }
}

/** 递归复制目录（node 16.7+ 自带 cpSync） */
function copyDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(src, dest, { recursive: true })
}

/**
 * 把 app.asar 重建为最小集合。
 * 必须保留的内容：
 *   dist/        渲染层产物（Vite 已把 Vue / Element Plus 全部打进去）
 *   electron/    主进程 + preload + IPC 通道常量
 *   package.json 主进程读 main 字段与版本号
 *   node_modules/sql.js/dist/{sql-wasm.js,sql-wasm.wasm}  数据库引擎（其余变体用不到）
 */
async function slimAsar() {
  step('瘦身 app.asar')
  const asarPath = path.join(UNPACKED, 'resources', 'app.asar')
  if (!fs.existsSync(asarPath)) throw new Error('找不到 app.asar: ' + asarPath)

  remove(STAGE)
  fs.mkdirSync(STAGE, { recursive: true })

  copyDir(path.join(ROOT, 'dist'), path.join(STAGE, 'dist'))
  copyDir(path.join(ROOT, 'electron'), path.join(STAGE, 'electron'))
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(STAGE, 'package.json'))

  const sqljsDist = path.join(STAGE, 'node_modules', 'sql.js', 'dist')
  fs.mkdirSync(sqljsDist, { recursive: true })
  for (const f of ['sql-wasm.js', 'sql-wasm.wasm']) {
    fs.copyFileSync(path.join(ROOT, 'node_modules', 'sql.js', 'dist', f), path.join(sqljsDist, f))
  }
  // sql.js 的 package.json 里 main 指向 dist/sql-wasm.js，require 解析需要它
  fs.copyFileSync(
    path.join(ROOT, 'node_modules', 'sql.js', 'package.json'),
    path.join(STAGE, 'node_modules', 'sql.js', 'package.json')
  )

  const before = fs.statSync(asarPath).size
  remove(asarPath)
  await asar.createPackage(STAGE, asarPath)
  const after = fs.statSync(asarPath).size
  console.log(`app.asar: ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB`)
  remove(STAGE)
}

/** 写入面向使用者的说明文件（随包分发） */
function writeReadme(targetDir) {
  const txt = [
    'JavTube v' + VERSION + ' — Windows x64',
    '='.repeat(52),
    '',
    '【使用】',
    '  1. 把整个 JavTube 文件夹解压到任意位置（建议避开 C:\\Program Files，',
    '    因为该目录写入需要管理员权限）。',
    '  2. 双击 JavTube.exe 运行。',
    '',
    '【数据存放位置】',
    '  所有数据都在软件同目录的 data 文件夹里：',
    '    data\\app.db      数据库（影片、标签、设置、Cookie 等）',
    '    data\\covers\\     封面与女优头像缓存',
    '  首次运行会自动创建 data 文件夹。整个文件夹拷走 = 数据一起搬走。',
    '',
    '【升级到新版本】',
    '  1. 把新版本的 zip 解压到任意临时位置。',
    '  2. 把解压出来的内容**全部覆盖**到旧版的 JavTube 文件夹里（同名覆盖）。',
    '     覆盖到的就是程序文件：JavTube.exe、resources\\、locales\\、',
    '     各 .dll / .pak / .dat，以及 LICENSE 开头的说明文本、使用说明.txt。',
    '  3. ⚠️ 唯一要保住的是 data\\ 文件夹 —— 那是你的数据（影片库、标签、',
    '     设置、Cookie、封面缓存）。新版 zip 里的 data\\ 是个**空目录**，',
    '     直接覆盖不会删掉你已有的文件，但升级前仍建议先把 data\\ 复制一份留底。',
    '  4. 双击 JavTube.exe 就是新版本了。',
    '',
    '  · 数据库结构在 1.x 版本之间保持兼容：旧库首次打开会**自动补齐新增字段**，',
    '    不需要手动迁移，也不会丢失已有数据。',
    '  · 想回退旧版本：用旧版程序文件再覆盖回来即可，data\\ 不用动。',
    '',
    '【常见问题】',
    '  · 首次运行 Windows 可能提示"已保护你的电脑"（未做数字签名，属正常）：',
    '    点「更多信息」→「仍要运行」。',
    '  · 刮削需要联网；访问部分站点需要自备代理，可在 设置 → 刮削 中配置。',
    '  · 需要 Windows 10 1803 或更高版本（依赖系统自带 curl 做刮削请求）。',
    '',
    '【卸载】',
    '  直接删除整个 JavTube 文件夹即可，不留任何残留。',
    ''
  ].join('\r\n')
  fs.writeFileSync(path.join(targetDir, '使用说明.txt'), txt, 'utf8')
}

// ============================================================================
// exe 图标 / 版本信息（详见文件头注释 —— 这块是最容易踩坑的地方）
// ============================================================================

/** electron-builder 的工具缓存根目录 */
function winCodeSignCache() {
  return path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign')
}

/** ① 缓存里已经解好的 rcedit-x64.exe */
function findRcedit() {
  const root = winCodeSignCache()
  if (!fs.existsSync(root)) return ''
  for (const d of fs.readdirSync(root)) {
    const p = path.join(root, d, 'rcedit-x64.exe')
    if (fs.existsSync(p)) return p
  }
  return ''
}

/**
 * ② 从缓存里的 winCodeSign/*.7z 单独解出 rcedit-x64.exe。
 * 只取这一个文件，不碰 darwin 目录 —— 那里的 .dylib 是符号链接，
 * 普通权限的 Windows 解压会报「客户端没有所需的特权」。
 */
function extractRcedit() {
  const root = winCodeSignCache()
  if (!fs.existsSync(root)) return ''
  const out = path.join(root, '_rcedit')
  fs.mkdirSync(out, { recursive: true })
  for (const f of fs.readdirSync(root)) {
    if (!f.endsWith('.7z')) continue
    try {
      execFileSync(SEVEN_ZIP, ['x', path.join(root, f), '-o' + out, 'rcedit-x64.exe', '-y'], { stdio: 'ignore' })
      const p = path.join(out, 'rcedit-x64.exe')
      if (fs.existsSync(p)) return p
    } catch { /* 换下一个归档再试 */ }
  }
  return ''
}

/** ③ 缓存里连归档都没有时，让 app-builder 拉一次（它会把 .7z 落到上面那个缓存目录） */
function prefetchTools() {
  const ab = path.join(ROOT, 'node_modules', 'app-builder-bin', 'win', 'x64', 'app-builder.exe')
  if (!fs.existsSync(ab)) return false
  try {
    execFileSync(ab, ['prefetch-tools', '--osName=windows'], { stdio: 'ignore', timeout: 180000 })
    return true
  } catch { return false }
}

/** 解析出可用的 rcedit 路径；返回空字符串表示拿不到 */
function resolveRcedit() {
  return findRcedit() || extractRcedit() || (prefetchTools() ? (findRcedit() || extractRcedit()) : '')
}

/**
 * 把 build/icon.ico 与版本信息写进 JavTube.exe。
 * electron-builder 的 exe 编辑被 signAndEditExecutable=false 关掉了（原因见文件头），
 * 所以这一步必须由本脚本补上，否则打出来的就是 Electron 默认图标。
 */
function embedIcon() {
  step('写入 exe 图标与版本信息 (rcedit)')
  const exe = path.join(OUT_DIR, 'JavTube.exe')
  const ico = path.join(ROOT, 'build', 'icon.ico')
  if (!fs.existsSync(exe)) throw new Error('找不到产物 exe: ' + exe)
  if (!fs.existsSync(ico)) throw new Error('找不到图标: ' + ico)

  const rcedit = resolveRcedit()
  if (!rcedit) {
    console.warn('  ⚠️  找不到 rcedit-x64.exe，跳过图标写入 —— 打出来的 exe 会是 Electron 默认图标！')
    console.warn('     修复：在有网环境跑一次 `npx electron-builder --win --x64`（会下载 winCodeSign），或手动放一份 rcedit-x64.exe 到：')
    console.warn('     ' + winCodeSignCache())
    return false
  }

  const v = pkg.version
  const args = [
    exe,
    '--set-icon', ico,
    '--set-version-string', 'ProductName', APP_NAME,
    '--set-version-string', 'FileDescription', APP_NAME,
    '--set-version-string', 'CompanyName', APP_NAME,
    '--set-version-string', 'LegalCopyright', 'MIT License',
    '--set-file-version', `${v}.0`,
    '--set-product-version', v
  ]
  const before = fs.statSync(exe).size
  execFileSync(rcedit, args, { stdio: 'inherit' })
  const after = fs.statSync(exe).size
  if (before === after) {
    // 大小没变基本等于没写进去（正常写入会改变资源段）
    console.warn(`  ⚠️  rcedit 执行了但 exe 大小未变（${before}），请确认 ${ico} 是否有效`)
  }
  console.log(`  rcedit: ${rcedit}`)
  console.log(`  exe: ${before} → ${after} bytes，已写入图标 + 版本 ${v}`)
  return true
}

/** 用 7-Zip 打包（zip 格式，最大压缩） */
function makeZip() {
  step('打包 zip')
  if (!fs.existsSync(SEVEN_ZIP)) throw new Error('找不到 7za.exe: ' + SEVEN_ZIP)
  const zipName = `${APP_NAME}-v${VERSION}-win-x64.zip`
  const zipPath = path.join(OUT_ROOT, zipName)
  remove(zipPath)
  // -mcu=on：强制以 UTF-8 写入文件名（否则中文「使用说明.txt」会按本机代码页存储，
  //          在非中文 Windows 上解压会乱码）
  run(SEVEN_ZIP, ['a', '-tzip', '-mx=5', '-mcu=on', zipName, APP_NAME], { cwd: OUT_ROOT })
  const size = fs.statSync(zipPath).size
  console.log(`\n✅ ${zipPath}\n   ${(size / 1048576).toFixed(1)} MB`)
  return zipPath
}

/**
 * 自包含性自检：确认产物在一台「什么都没装」的 Windows 上解压即用。
 *
 * 为什么需要这一步：开发机上 `node_modules/electron` 就在旁边，即便产物漏了
 * Chromium 运行时文件（icudtl.dat / *.pak / 各 dll）也能跑起来，问题只在
 * 别人机器上暴露 —— 那边表现是「双击没反应」且没有错误弹窗，极难排查。
 * 实测基线：v1.4.0 的 zip 解压后共 73 个文件（本清单 + locales/*.pak + 使用说明）。
 *
 * 也可独立运行（用于复核已发布的包）：
 *   node scripts/build-portable.js --check-only release/JavTube
 *
 * @param {string} outDir - 解压后的产物目录（含 JavTube.exe）
 * @returns {{problems: string[], warnings: string[]}}
 */
function checkSelfContained(outDir) {
  const problems = [], warnings = []
  // Electron 运行时必需文件（缺任何一个都会在别的机器上起不来）
  const RUNTIME_FILES = [
    'JavTube.exe', 'resources/app.asar',
    'chrome_100_percent.pak', 'chrome_200_percent.pak', 'resources.pak',
    'icudtl.dat', 'snapshot_blob.bin', 'v8_context_snapshot.bin',
    'd3dcompiler_47.dll', 'ffmpeg.dll', 'libEGL.dll', 'libGLESv2.dll',
    'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll',
    'LICENSE.electron.txt', 'LICENSES.chromium.html'
  ]
  const miss = RUNTIME_FILES.filter(f => !fs.existsSync(path.join(outDir, f)))
  if (miss.length) problems.push('缺少 Electron 运行时文件（新电脑上无法启动）: ' + miss.join(', '))
  const localesDir = path.join(outDir, 'locales')
  if (!fs.existsSync(localesDir) || !fs.readdirSync(localesDir).some(f => /\.pak$/.test(f))) {
    problems.push('缺少 locales/*.pak（Chromium 本地化资源）')
  }
  // 应用自身必需：空 data 目录（数据落点）、使用说明、asar 内的两个关键文件
  for (const m of ['data', '使用说明.txt']) {
    if (!fs.existsSync(path.join(outDir, m))) problems.push('缺少 ' + m)
  }
  const asarPath = path.join(outDir, 'resources', 'app.asar')
  if (fs.existsSync(asarPath)) {
    let appFiles = []
    try { appFiles = asar.listPackage(asarPath) } catch (e) { problems.push('app.asar 无法解析: ' + e.message) }
    if (appFiles.length) {
      if (!appFiles.some(f => /sql-wasm\.wasm$/.test(f))) problems.push('asar 内缺少 sql-wasm.wasm（开库必需）')
      if (!appFiles.some(f => /dist[\\/]index\.html$/.test(f))) problems.push('asar 内缺少 dist/index.html（界面必需）')
    }
    // 开发机绝对路径泄漏：打包时若把项目路径写进 asar，换机器后会指向不存在的目录
    try {
      const buf = fs.readFileSync(asarPath)
      for (const s of [ROOT.replace(/\\/g, '/'), ROOT]) {
        if (buf.includes(Buffer.from(s, 'utf8'))) { warnings.push('asar 内出现开发机绝对路径 ' + s); break }
      }
    } catch { }
  }
  return { problems, warnings }
}

async function main() {
  // 先扫掉历史遗留的临时目录（被句柄占住的删不掉也不影响本次构建）
  if (fs.existsSync(OUT_ROOT)) {
    for (const d of fs.readdirSync(OUT_ROOT)) {
      const legacy = d.startsWith(TMP_PREFIX) || d.startsWith('.tmp-build') ||
        d === '.asar-src' || d === 'win-unpacked'
      if (legacy) remove(path.join(OUT_ROOT, d))
    }
  }

  step('1/6 构建渲染层 (vite build)')
  run(NODE_BIN, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build'])

  step('2/6 打包 Electron 应用 (electron-builder --dir)')
  TMP_DIR = path.join(OUT_ROOT, TMP_PREFIX + Date.now())
  TMP_DIR_REL = path.relative(ROOT, TMP_DIR).replace(/\\/g, '/')
  UNPACKED = path.join(TMP_DIR, 'win-unpacked')
  run(NODE_BIN, [
    path.join('node_modules', 'electron-builder', 'cli.js'),
    '--win', '--x64',
    '--config.directories.output=' + TMP_DIR_REL
  ])
  if (!fs.existsSync(UNPACKED)) throw new Error('electron-builder 未产出 ' + UNPACKED)

  step('3/6 瘦身 app.asar')
  await slimAsar()

  step('4/6 整理输出目录')
  remove(OUT_DIR)
  await moveDir(UNPACKED, OUT_DIR)
  remove(TMP_DIR)                                                 // 清理本次临时目录（失败不致命，系统释放后可手动删）
  fs.mkdirSync(path.join(OUT_DIR, 'data'), { recursive: true })   // 空 data，明确告诉用户数据放这
  writeReadme(OUT_DIR)

  // 图标必须在 exe 落到最终位置之后再写（electron-builder 那步写不了，见文件头注释）
  const iconOk = embedIcon()

  step('5/6 自检')
  const sc = checkSelfContained(OUT_DIR)
  if (sc.problems.length) throw new Error(sc.problems.join('；'))
  sc.warnings.forEach(w => console.warn('  ⚠️  ' + w))
  console.log(`自检通过：解压即用（Electron 运行时 + locales + data + 使用说明 + asar 内 sql-wasm/dist 齐备）`)
  const appFiles = asar.listPackage(path.join(OUT_DIR, 'resources', 'app.asar'))
  if (!appFiles.some(f => /sql-wasm\.wasm$/.test(f))) throw new Error('asar 内缺少 sql-wasm.wasm')
  if (!appFiles.some(f => /dist[\\/]index\.html$/.test(f))) throw new Error('asar 内缺少 dist/index.html')
  if (!iconOk) {
    console.warn('  ⚠️  自检：exe 未写入自定义图标（默认 Electron 图标）')
  } else {
    // 复核：从 exe 里读回版本信息，确认 rcedit 真的写进去了
    const rcedit = resolveRcedit()
    const got = execFileSync(rcedit, [path.join(OUT_DIR, 'JavTube.exe'), '--get-version-string', 'ProductName']).toString().trim()
    if (got !== APP_NAME) throw new Error(`图标/版本信息写入失败：exe 内 ProductName = "${got}"，期望 "${APP_NAME}"`)
    console.log(`自检通过：exe 图标 + 版本信息已写入（ProductName = ${got}）`)
  }
  console.log('自检通过：exe / asar / sql-wasm.wasm / dist/index.html / data / 使用说明.txt 均在位')

  step('6/6 生成压缩包')
  makeZip()
}

// 独立复核模式（不构建，只检查已有产物能否「解压即用」）：
//   node scripts/build-portable.js --check-only [目录]     # 默认 release/JavTube
const argv = process.argv.slice(2)
const ci = argv.indexOf('--check-only')
if (ci >= 0) {
  const dir = path.resolve(argv[ci + 1] || OUT_DIR)
  console.log('复核目录:', dir)
  if (!fs.existsSync(dir)) { console.error('❌ 目录不存在'); process.exit(1) }
  const r = checkSelfContained(dir)
  r.warnings.forEach(w => console.warn('  ⚠️  ' + w))
  if (r.problems.length) {
    r.problems.forEach(p => console.error('  ❌ ' + p))
    console.error('\n❌ 复核未通过：该包在干净电脑上可能无法直接运行')
    process.exit(1)
  }
  console.log('✅ 复核通过：运行时文件齐备、无外部依赖，可在新电脑解压即用')
  process.exit(0)
}

main().catch(e => { console.error('\n❌ 打包失败:', e.message); process.exit(1) })
