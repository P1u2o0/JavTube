/**
 * ============================================================
 * 文件名：audit-wiring.js
 * 用途：机械化排查「按钮点了没反应」这一类接线问题（不依赖人工点界面）。
 *       2026-09-21 新增。发现过 4 个真实死按钮，故固化为常规检查。
 *
 * 三类检查：
 *   ① 渲染层调用的 window.api.X 是否都在 preload 中暴露
 *   ② preload 暴露的接口 → IPC 通道 → 主进程 ipcMain.handle 是否三方对齐
 *   ③ 组件声明了 emit 但某个使用处没监听（死事件）
 *   ④ safeCall(...) 误传函数（Promise.resolve(函数) 会直接 resolve，函数永不执行）
 *
 * 用法：node scripts/audit-wiring.js      （package.json: npm run audit:wiring）
 * 退出码：发现问题 → 1，全部通过 → 0
 * ============================================================
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const problems = []
const notes = []

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const walk = (dir, exts, out = []) => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name).replace(/\\/g, '/')
    if (e.isDirectory()) walk(rel, exts, out)
    else if (exts.some(x => e.name.endsWith(x))) out.push(rel)
  }
  return out
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length

// ===== ① 渲染层用到的 window.api.X vs preload 暴露 =====
{
  const preload = read('electron/preload/index.js')
  const exposed = new Set([...preload.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)].map(m => m[1]))
  const used = new Map()
  for (const f of walk('src', ['.vue', '.js', '.mjs'])) {
    const t = read(f)
    for (const m of t.matchAll(/window\.api\.([a-zA-Z][a-zA-Z0-9]*)/g)) {
      if (!used.has(m[1])) used.set(m[1], [])
      used.get(m[1]).push(`${f}:${lineOf(t, m.index)}`)
    }
  }
  for (const [name, where] of used) {
    if (!exposed.has(name)) problems.push(`① window.api.${name} 未在 preload 暴露（会静默失败）← ${where.join(', ')}`)
  }
  for (const name of exposed) {
    if (!used.has(name)) notes.push(`① preload 暴露但渲染层未使用：${name}（可能是遗留别名/死代码）`)
  }
}

// ===== ② preload 接口 → IPC 通道 → 主进程 handler =====
{
  const channels = read('electron/common/ipc-channels.js')
  const constToChannel = {}
  for (const m of channels.matchAll(/^\s*([A-Z0-9_]+)\s*:\s*'([^']+)'/gm)) constToChannel[m[1]] = m[2]
  const preload = read('electron/preload/index.js')
  const invoked = new Set()
  for (const m of preload.matchAll(/IPC\.([A-Z0-9_]+)/g)) invoked.add(m[1])
  const mainText = walk('electron/main', ['.js']).map(read).join('\n')
  const handled = new Set([...mainText.matchAll(/ipcMain\.handle\(\s*IPC\.([A-Z0-9_]+)/g)].map(m => m[1]))
  for (const key of invoked) {
    if (!(key in constToChannel)) { problems.push(`② preload 用到的通道常量 ${key} 在 ipc-channels.js 里不存在`); continue }
    if (!handled.has(key)) problems.push(`② 通道 ${key}（${constToChannel[key]}）被 preload 调用，但主进程没有 ipcMain.handle → 点了没反应`)
  }
  for (const key of handled) {
    if (!invoked.has(key)) notes.push(`② 主进程注册了 ${key}（${constToChannel[key]}）但 preload 未暴露调用`)
  }
}

// ===== ③ 组件 emit vs 使用处监听（含"父级转发是否完整"）=====
{
  const compDir = 'src/components'
  const emitsOf = (file) => {
    const m = read(file).match(/defineEmits\(\[([^\]]*)\]\)/)
    return m ? [...m[1].matchAll(/'([a-zA-Z]+)'/g)].map(x => x[1]) : []
  }
  const comps = fs.readdirSync(path.join(ROOT, compDir)).filter(f => f.endsWith('.vue'))
  // 已知误报：MovieCard 的 toggle 只在多选模式下渲染勾选框；StatusBar 的 toggle 由 store 直写
  const knownFalse = { MovieCard: ['toggle'], StatusBar: ['toggle'] }
  for (const f of walk('src', ['.vue'])) {
    const t = read(f)
    for (const c of comps) {
      const name = c.replace('.vue', '')
      const es = emitsOf(path.join(compDir, c))
      if (!es.length) continue
      const m = t.match(new RegExp('<' + name + '(?=[\\s/>])[^>]*>', 's'))
      if (!m) continue
      const missing = es.filter(e => !new RegExp('@' + e + '[=.]').test(m[0]) && !(knownFalse[name] || []).includes(e))
      if (missing.length) problems.push(`③ ${f} 使用 ${name} 但未监听：${missing.join(',')}`)
    }
  }
}

// ===== ④ safeCall 误传函数 =====
{
  for (const f of walk('src', ['.vue', '.js', '.mjs'])) {
    const t = read(f)
    for (const m of t.matchAll(/safeCall\(([^\n]*)/g)) {
      // 跳过注释行（文档里举例说明 safeCall 用法时会命中，属噪音）
      const lineStart = t.lastIndexOf('\n', m.index) + 1
      const lineText = t.slice(lineStart, m.index).trimStart()
      if (lineText.startsWith('*') || lineText.startsWith('//')) continue
      const arg = m[1].trim()
      if (/^\(\)\s*=>|^function/.test(arg)) {
        // safeCall 现已兼容函数入参（不会再不执行），此处仅提示统一风格
        notes.push(`④ ${f}:${lineOf(t, m.index)} safeCall 传的是函数（已兼容，推荐直接传 Promise）：${arg.slice(0, 50)}`)
      }
    }
  }
}

// ===== 输出 =====
console.log('===== 接线审计（audit-wiring）=====')
if (problems.length) {
  console.log('\n❌ 发现 ' + problems.length + ' 个问题：')
  for (const p of problems) console.log('  ' + p)
} else {
  console.log('\n✅ 未发现接线问题（死按钮/死事件/未暴露接口）')
}
if (notes.length) {
  console.log('\nℹ️ 提示（不一定需要改）：')
  for (const n of notes) console.log('  ' + n)
}
process.exit(problems.length ? 1 : 0)
