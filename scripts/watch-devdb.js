/**
 * @file watch-devdb.js
 * @module scripts/watch-devdb
 * @description dev 库看门狗：每 250ms 记录 `sha16 / 字节数 / mtime`，只打印**变化点**。
 *
 * 什么时候用它：怀疑「有进程在偷偷改 dev 库」但说不清是谁、什么时候改的。
 *
 * 判据（2026-09-30 靠它定位到 sql.js 就地改写 Buffer 那条血案）：
 *   - `sha` 变了 → 确实有人写了内容；
 *   - **`mtime` 变了但 `sha` 一直不变** → 写回的内容本身就是脏的（还原写入了同一份污染数据）。
 *
 * 只读，不改库；日志同时写入 tmp/_watch.log（目录会自动创建）。
 * 默认跑 45 秒后自动退出。
 *
 * 用法：node scripts/watch-devdb.js
 */
const fs = require('fs')
const crypto = require('crypto')
const path = require('path')
const LIVE = path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'data', 'app.db')
const OUT = path.join(process.cwd(), 'tmp', '_watch.log')
fs.mkdirSync(path.dirname(OUT), { recursive: true })
const T0 = Date.now()
fs.writeFileSync(OUT, '')
let last = ''
const t = setInterval(() => {
  let line
  try {
    const st = fs.statSync(LIVE)
    const b = fs.readFileSync(LIVE)
    const sha = crypto.createHash('sha256').update(b).digest('hex').slice(0, 16)
    line = `+${((Date.now() - T0) / 1000).toFixed(2)}s sha=${sha} len=${b.length} mtime=${st.mtime.toISOString().slice(11, 23)}`
  } catch (e) { line = `+${((Date.now() - T0) / 1000).toFixed(2)}s ERR ${e.code}` }
  if (line.slice(line.indexOf('sha=')) !== last) {
    last = line.slice(line.indexOf('sha='))
    fs.appendFileSync(OUT, line + '\n')
    console.log(line)
  }
}, 250)
setTimeout(() => { clearInterval(t); console.log('看门狗结束'); process.exit(0) }, 45000)
