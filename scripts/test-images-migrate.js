/**
 * test-images-migrate.js — 图片存储布局迁移（2026-10-05）回归测试
 *
 * 在系统临时目录里搭一套**沙盒假数据**（假 app.db + 假旧 covers/ 目录），
 * 直接调用 electron/main/db/migrate-images.js，验证：
 *   ① 海报/预览搬进 images/<番号>/，库内路径同步更新（含反斜杠旧值）；
 *   ② <10KB 的预览：删文件 + 从库中移除；文件缺失的预览：仅从库中移除；
 *   ③ 头像按显示名重命名到 images/actress/（同名取出现最多者；不同来源同名加 -2）；
 *   ④ cast_json 引用被统一重写；⑤ 空旧目录被清理、未识别遗留文件原地保留；
 *   ⑥ 幂等（第二次运行跳过）；⑦ 迁移前自动备份 app.db。
 *
 * 用法（项目根）: node scripts/test-images-migrate.js
 * 全程只操作临时目录，跑完自动清理（失败时保留现场并打印路径）。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const { migrateImageLayout } = require(path.join(ROOT, 'electron', 'main', 'db', 'migrate-images.js'))

let failed = 0
const ok = (cond, label) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failed++ }

async function main() {
  const initSqlJs = require(path.join(ROOT, 'node_modules', 'sql.js'))
  const SQL = await initSqlJs()

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'javtube-imgmig-'))
  const dataDir = path.join(sandbox, 'data')
  const dbPath = path.join(dataDir, 'app.db')
  const mk = (rel, bytes) => {
    const p = path.join(dataDir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, Buffer.alloc(bytes, 1))
    return p
  }

  // ---- 沙盒假数据 ----
  mk('covers/IPX-247.jpg', 30000)                       // 海报（旧式反斜杠路径入库）
  mk('covers/previews/IPX-247-1.jpg', 20480)            // 合格预览（20KB）
  mk('covers/previews/IPX-247-2.jpg', 4096)             // 小图（4KB，应剔除）
  // IPX-247-3 不落盘（缺失，应仅从库中移除）
  mk('covers/ABF-002.jpg', 30000)
  mk('covers/previews/ABF-002-1.jpg', 51200)
  mk('covers/actress/rsv.jpg', 8000)                    // 岬ななみ（出现 2 次）
  mk('covers/actress/ZX4x6.png', 8000)                  // 七嶋舞
  mk('covers/actress/w44.jpg', 8000)                    // 松岡すず（与 abc 同名，应加 -2）
  mk('covers/actress/abc.jpg', 8000)
  mk('covers/readme-left.txt', 10)                      // 非图片遗留文件（应原地保留）
  mk('covers/orphan-old.jpg', 20000)                    // 孤儿图片（无任何影片引用，应删除）

  const db = new SQL.Database()
  db.run('CREATE TABLE settings(key TEXT, value TEXT)')
  db.run('CREATE TABLE movies(id INTEGER, ph TEXT, cover TEXT, previews TEXT, cast_json TEXT)')
  const ins = (id, ph, cover, previews, cast) =>
    db.run('INSERT INTO movies VALUES (?,?,?,?,?)', [id, ph, cover, JSON.stringify(previews), JSON.stringify(cast)])
  ins(1, 'IPX-247', 'covers\\IPX-247.jpg',
    ['covers/previews/IPX-247-1.jpg', 'covers/previews/IPX-247-2.jpg', 'covers/previews/IPX-247-3.jpg'],
    [{ name: '岬ななみ', avatar: 'covers/actress/rsv.jpg' }])
  ins(2, 'ABF-002', 'covers\\ABF-002.jpg',
    ['covers/previews/ABF-002-1.jpg'],
    [{ name: '岬ななみ', avatar: 'covers/actress/rsv.jpg' }, { name: '七嶋舞', avatar: 'covers/actress/ZX4x6.png' }])
  ins(3, 'ABC-001', '', [],
    [{ name: '松岡すず', avatar: 'covers/actress/w44.jpg' }, { name: '松岡すず', avatar: 'covers/actress/abc.jpg' }])
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
  db.close()

  // ---- 执行迁移 ----
  console.log('沙盒: ' + sandbox)
  const db2 = new SQL.Database(Buffer.from(fs.readFileSync(dbPath)))
  const sum = migrateImageLayout(db2, dataDir, dbPath)
  console.log('统计: ' + JSON.stringify(sum))

  // ① 海报与合格预览
  ok(fs.existsSync(path.join(dataDir, 'images/IPX-247/IPX-247.jpg')), '海报搬入 images/<番号>/')
  ok(fs.existsSync(path.join(dataDir, 'images/IPX-247/IPX-247-1.jpg')), '合格预览搬入 images/<番号>/')
  const m1 = db2.exec("SELECT cover, previews FROM movies WHERE id=1")[0].values[0]
  ok(m1[0] === 'images/IPX-247/IPX-247.jpg', '库内海报路径已更新（正斜杠）：' + m1[0])
  const p1 = JSON.parse(m1[1])
  ok(p1.length === 1 && p1[0] === 'images/IPX-247/IPX-247-1.jpg', '预览数组只剩合格项：' + JSON.stringify(p1))

  // ② 小图剔除 / 缺失剔除
  ok(!fs.existsSync(path.join(dataDir, 'covers/previews/IPX-247-2.jpg')), '4KB 小图文件已删除')
  ok(sum.previewsDropped === 1 && sum.previewsMissing === 1, '统计：剔除小图 1 / 缺失 1')

  // ③ 头像按显示名 + 同名冲突
  ok(fs.existsSync(path.join(dataDir, 'images/actress/岬ななみ.jpg')), '头像按显示名重命名（岬ななみ.jpg）')
  ok(fs.existsSync(path.join(dataDir, 'images/actress/七嶋舞.png')), '头像保留原扩展名（七嶋舞.png）')
  ok(fs.existsSync(path.join(dataDir, 'images/actress/松岡すず.jpg')) && fs.existsSync(path.join(dataDir, 'images/actress/松岡すず-2.jpg')), '不同来源同名加序号（松岡すず / -2）')

  // ④ cast_json 引用重写
  const c1 = JSON.parse(db2.exec("SELECT cast_json FROM movies WHERE id=1")[0].values[0][0])
  ok(c1[0].avatar === 'images/actress/岬ななみ.jpg', 'cast_json 已重写：' + c1[0].avatar)
  const c3 = JSON.parse(db2.exec("SELECT cast_json FROM movies WHERE id=3")[0].values[0][0])
  ok(c3[0].avatar !== c3[1].avatar && c3[1].avatar.endsWith('-2.jpg'), '同名两人的引用分别指向 -2：' + c3[0].avatar + ' / ' + c3[1].avatar)

  // ⑤ 空目录清理 + 孤儿图片删除 + 非图片遗留保留
  ok(!fs.existsSync(path.join(dataDir, 'covers/previews')), '空的 covers/previews 已清理')
  ok(!fs.existsSync(path.join(dataDir, 'covers/orphan-old.jpg')) && sum.orphansRemoved === 1, '孤儿图片已删除（covers/orphan-old.jpg）')
  ok(fs.existsSync(path.join(dataDir, 'covers/readme-left.txt')) && sum.leftovers >= 1, '非图片遗留文件原地保留（covers/readme-left.txt）')

  // ⑥ 幂等（标记已写为 v2，再跑一次应跳过）
  const sum2 = migrateImageLayout(db2, dataDir, dbPath)
  ok(sum2.skipped === true, '第二次运行按标记跳过（幂等）')

  // ⑦ 备份
  ok(fs.existsSync(dbPath + '.pre-images-migrate.bak'), '迁移前已备份 app.db（.pre-images-migrate.bak）')

  db2.close()
  if (failed) {
    console.log('\n❌ 失败 ' + failed + ' 项；沙盒保留在: ' + sandbox)
  } else {
    fs.rmSync(sandbox, { recursive: true, force: true })
    console.log('\n✅ 全部通过（沙盒已清理）')
  }
  process.exitCode = failed ? 1 : 0
}
main().catch((e) => { console.error('ERR', e); process.exitCode = 1 })