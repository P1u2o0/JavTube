#!/usr/bin/env node
/**
 * ============================================================
 * 文件名：scrape-smoke.js
 * 功能：刮削冒烟测试——直接在当前 Node 环境调用 scrapeMovie 全链路
 *      （页面请求 → 字段提取 → 封面/预览图下载），无需启动 Electron。
 *
 * 背景：2026-09-13 引入 curl 网络层（net-curl.js）后，刮削不再依赖
 * Electron 的 net/session，因此可脱离 Electron 做端到端回归。
 * 改动 scraper.js / net-curl.js 后建议跑一次本脚本。
 *
 * 用法：
 *   node scripts/scrape-smoke.js            # 默认番号 WAAA-661
 *   node scripts/scrape-smoke.js NPJS-268   # 指定番号
 *
 * 依赖：数据目录中存在 app.db（读取用户的 JAVDB Cookie 与代理设置）
 * 退出码：0 = 全链路成功；1 = 任一环节失败
 * ============================================================
 */
const fs = require('fs')
const path = require('path')

const PH = process.argv[2] || 'WAAA-661'
const ROOT = path.resolve(__dirname, '..')
const DB_PATH = path.join(ROOT, 'node_modules', 'electron', 'dist', 'data', 'app.db')
const DATA_DIR = path.join(ROOT, 'node_modules', 'electron', 'dist', 'data')

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('✗ 未找到数据库:', DB_PATH)
    process.exit(1)
  }
  const initSqlJs = require(path.join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.js'))
  const SQL = await initSqlJs()
  const db = new SQL.Database(fs.readFileSync(DB_PATH))
  const get = (k) => {
    const r = db.exec('SELECT value FROM settings WHERE key=?', [k])[0]
    return r ? r.values[0][0] : ''
  }
  const cookie = get('javdb_cookie')
  const proxy = get('proxy_enabled') === 'y' ? get('proxy_url') : ''
  console.log(`番号=${PH} 代理=${proxy || '(直连)'} Cookie长度=${cookie.length}\n`)

  const { scrapeMovie } = require(path.join(ROOT, 'electron', 'main', 'scraper.js'))
  const t0 = Date.now()
  const r = await scrapeMovie(PH, {
    source: 'auto',
    coverDir: 'covers',
    dataDir: DATA_DIR,
    downloadPreviews: true,
    previewCount: 3,
    fetchStats: true,
    javdbCookie: cookie,
    proxy
  })
  const ms = Date.now() - t0

  if (!r.ok) {
    console.error(`✗ 刮削失败（${ms}ms）:`, r.error)
    process.exit(1)
  }
  const d = r.data
  const checks = [
    ['来源', r.source],
    ['时长(分钟)', d.duration || '(空)'],
    ['想看人数', d.want || '(空)'],
    ['看过人数', d.watched || '(空)'],
    ['评分', d.score || '(空)'],
    ['预览图', `${(d.previews || []).length} 张`],
    ['封面', d.cover ? '已下载' : '(空)'],
    ['演员', d.yy || '(空)'],
    ['标签数', String(d.bq || '').split('，').filter(Boolean).length]
  ]
  console.log(`✓ 刮削成功（${ms}ms）`)
  for (const [k, v] of checks) console.log(`   ${k}: ${v}`)

  // 关键字段缺失即视为失败（预览图/统计依赖站点数据，可能本身为空，这里只校验主体字段）
  const fatal = !d.pm && !d.cover
  if (fatal) {
    console.error('✗ 主体字段（标题/封面）缺失')
    process.exit(1)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('✗ 异常:', e.message)
  process.exit(1)
})
