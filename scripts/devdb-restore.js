/**
 * @file devdb-restore.js
 * @module scripts/devdb-restore
 * @description 把 dev 库逐字节回滚到指定快照，并做**独立于 _devdb 结论**的第二次校验。
 *
 * 用途：探针 / 回归脚本跑完，若发现库被应用自己写脏（如播放记录），用它可以精确回到跑之前的状态。
 *
 * 安全闸门（缺一不可，任一不过就拒绝写盘）：
 *   ① 快照必须存在、非空、SQLite 文件头正确；
 *   ② 回滚后重新读盘比对字节，必须与快照逐字节一致；
 *   ③ 同时打印前后 sha256，便于与基线核对。
 *
 * 用法：
 *   node scripts/devdb-restore.js tmp/_devdb/<label>.<时间戳>.pid<pid>.bak
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const devdb = require('./_devdb.js')

const LIVE = path.resolve(__dirname, '..', 'node_modules', 'electron', 'dist', 'data', 'app.db')
const SNAP = process.argv[2]
if (!SNAP) { console.error('用法: node scripts/devdb-restore.js <快照.bak 路径>'); process.exit(1) }
if (!fs.existsSync(SNAP)) { console.error('快照不存在: ' + SNAP); process.exit(1) }

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')
const isSqlite = (b) => b.length > 16 && b.slice(0, 15).toString('latin1') === 'SQLite format 3'

const content = fs.readFileSync(SNAP)
const snapSha = sha256(content)
console.log('快照: ' + SNAP)
console.log('  字节 ' + content.length + '  sha256=' + snapSha)

if (!content.length) { console.error('❌ 快照是 0 字节，拒绝写回'); process.exit(1) }
if (!isSqlite(content)) { console.error('❌ 快照不是有效 SQLite（文件头不对），拒绝写回'); process.exit(1) }

const before = fs.readFileSync(LIVE)
console.log('现库: 字节 ' + before.length + '  sha256=' + sha256(before))

const ok = devdb.restoreSnapshot({ path: SNAP, content, sha: snapSha, livePath: LIVE })

const after = fs.readFileSync(LIVE)
console.log('回滚后: 字节 ' + after.length + '  sha256=' + sha256(after))
const same = after.compare(content) === 0
console.log('与快照逐字节一致: ' + (same ? '✅' : '❌'))
if (!same || !ok) { console.error('回滚未达预期，请人工检查'); process.exit(1) }
