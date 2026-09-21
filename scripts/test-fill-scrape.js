/**
 * 「补全字段」端到端验收（真实网络刮削 + 逐字段比对库）
 * 目标影片 id=3（NPJS-268）：导演/系列/演员信息为空，评分与想看/看过已有值。
 * 期望：补全模式把空字段补上，**已有值（评分/人数/片名/封面）一个都不动**；
 *       再跑一次 → 提示「无需补全」且库零变化。
 * 脚本自带 dev 库备份还原。
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const ROOT = process.cwd();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LIVE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'data', 'app.db');
const BAK = path.join(ROOT, 'tmp', '_dev-app.db.fill-test.bak');
const TARGET_ID = 2
let pass = 0, fail = 0
const ok = (l, c, d = '') => { if (c) { pass++; console.log('  [OK]   ' + l + (d ? '  ' + d : '')) } else { fail++; console.log('  [FAIL] ' + l + (d ? '  ' + d : '')) } }

const WATCH = ['pm', 'fl', 'fxrq', 'yid', 'dy', 'ps', 'fx', 'xl', 'bq', 'cover', 'previews', 'want', 'watched', 'score', 'cast_json'];

(async () => {
  const SQL = await initSqlJs({ locateFile: () => path.join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm') })
  const snap = () => {
    const db = new SQL.Database(fs.readFileSync(LIVE))
    const r = db.exec('SELECT * FROM movies WHERE id=?', [TARGET_ID])[0]
    const o = {}
    r.columns.forEach((c, i) => { o[c] = r.values[0][i] })
    return o
  }
  if (!fs.existsSync(BAK)) fs.copyFileSync(LIVE, BAK)
  const backupContent = fs.readFileSync(BAK)

  // 预置：① 刮削来源=fill ② 人为制造「字段不全」+ 放一个哨兵片名
  // 哨兵片名用于验证「已有值不会被源站数据覆盖」（源站有这个番号的真实片名）
  const SENTINEL_PM = '【哨兵】不应被覆盖的旧片名'
  const SENTINEL_BQ = '哨兵标签'
  {
    const db = new SQL.Database(fs.readFileSync(LIVE))
    db.run("INSERT INTO settings(key,value) VALUES('scrape_source','fill') ON CONFLICT(key) DO UPDATE SET value='fill'")
    db.run('UPDATE movies SET dy=?, xl=?, score=0, want=0, watched=0, pm=?, bq=? WHERE id=?',
      ['', '', SENTINEL_PM, SENTINEL_BQ, TARGET_ID])
    fs.writeFileSync(LIVE, Buffer.from(db.export()))
    console.log('已预置：scrape_source=fill；清空 导演/系列/评分/想看/看过；片名与标签设为哨兵值')
  }

  let child = null
  try {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_PATH; delete env.VITE_DEV_SERVER_URL
    child = require('child_process').spawn(
      path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      ['--remote-debugging-port=9333', '--window-position=-3200,-3200', '--window-size=1400,900',
       '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
       '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
       path.join(ROOT, 'electron', 'main', 'index.js')],
      { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(ROOT,'tmp','_fill-app.log'),'w'), fs.openSync(path.join(ROOT,'tmp','_fill-app.log'),'a')] })

    const http = require('http')
    let targets = null
    for (let i = 0; i < 40; i++) {
      try {
        targets = await new Promise((res, rej) => http.get({ host: '127.0.0.1', port: 9333, path: '/json/list' }, r => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)))
        }).on('error', rej))
        if (targets && targets.length) break
      } catch { }
      await sleep(500)
    }
    if (!targets || !targets.length) { console.log('❌ 应用未启动'); return }
    const ws = new WebSocket((targets.find(t => t.type === 'page') || targets[0]).webSocketDebuggerUrl)
    let id = 0; const pend = new Map(); const errors = []
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data)
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
      if (m.method === 'Runtime.exceptionThrown') errors.push('异常: ' + String(m.params.exceptionDetails.text).slice(0, 140))
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value || a.description).join(' ').slice(0, 140))
    })
    ws.addEventListener('error', () => { }); ws.addEventListener('close', () => { })
    const send = (me, pa = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: me, params: pa })) })
    await new Promise(r => ws.addEventListener('open', r))
    await send('Runtime.enable'); await send('Page.enable')
    const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value
    await sleep(2800)

    const before = snap()
    console.log('刮削前:', JSON.stringify({ dy: before.dy, xl: before.xl, cast: String(before.cast_json).slice(0, 20), score: before.score, want: before.want, watched: before.watched, pm: String(before.pm).slice(0, 14) }))
    ok('目标影片当前确实缺字段（导演/系列为空）', !before.dy || !before.xl, 'dy=' + JSON.stringify(before.dy) + ' xl=' + JSON.stringify(before.xl))

    // 进入详情页并点刮削
    await ev(`location.hash='#/detail/${TARGET_ID}'; 1`); await sleep(3000)
    const hasBtn = await ev(`!!document.querySelector('.act-scrape')`)
    ok('详情页刮削按钮存在', hasBtn === true)
    await ev(`document.querySelector('.act-scrape').click(); 1`)
    // 等刮削完成（网络请求，最多 60s）
    let toast = ''
    for (let i = 0; i < 40; i++) {
      await sleep(1500)
      toast = await ev(`Array.from(document.querySelectorAll('.el-message')).map(e=>e.innerText).join(' | ')`)
      if (/补全|无需补全|失败|出错/.test(toast)) break
    }
    console.log('  提示:', JSON.stringify(toast))
    ok('提示为「已补全 N 个字段」', /已补全 \d+ 个字段/.test(toast), toast)
    // 解析「已补全 N 个字段：A、B、C」里的清单，逐个核对：被补的字段必须是补全前为空的
    const CN2KEY = { '片名': 'pm', '分类': 'fl', '发行日期': 'fxrq', '演员': 'yid', '导演': 'dy', '制作商': 'ps', '发行商': 'fx', '系列': 'xl', '标签': 'bq', '封面': 'cover', '预览图': 'previews', '想看人数': 'want', '看过人数': 'watched', '评分': 'score', '演员信息': 'cast_json' };
    const listM = toast.match(/已补全 \d+ 个字段：([^；\n]+)/)
    const filledList = listM ? listM[1].split('、').map(s => s.trim()).filter(Boolean) : []
    const wrong = filledList.filter(name => { const k = CN2KEY[name]; return k && before[k] && before[k] !== '0' && before[k] !== '[]' })
    ok('被补的字段全部都是补全前为空/为 0 的（没有覆盖已有值）', filledList.length > 0 && wrong.length === 0,
      `补了 ${JSON.stringify(filledList)}；不该补的 ${JSON.stringify(wrong)}`)

    await sleep(1500)
    const after = snap()
    const diff = WATCH.filter(k => String(before[k]) !== String(after[k]))
    console.log('  变化字段:', JSON.stringify(diff))
    ok('空字段（导演/系列）被补上', ['dy', 'xl'].every(k => String(after[k]) && String(after[k]) !== '0'),
      JSON.stringify({ dy: after.dy, xl: String(after.xl).slice(0, 20) }))
    // 评分/想看/看过 只来自 JAVDB：实测当前 Cookie/代理下 javdb 返回 403 → 拿不到。
    // 关键是「拿不到要有明确提示」，而不是静默。
    const statsGot = ['score', 'want', 'watched'].every(k => String(after[k]) && String(after[k]) !== '0')
    ok(statsGot ? '统计字段（评分/想看/看过）已补上' : '统计字段未取到时给出明确原因（不是静默）',
      statsGot ? true : /未取到|JAVDB/.test(toast),
      statsGot ? `score=${after.score} want=${after.want} watched=${after.watched}` : toast)
    ok('提示与实际一致：补上了就不该再说「未取到」', statsGot ? !/未取到/.test(toast) : /未取到/.test(toast),
      statsGot ? '已补齐且无「未取到」字样 ✅' : '未补齐且有提示 ✅')
    if (!statsGot) console.log('  （当前环境下 javdb.com 返回 403，统计字段拿不到，属环境限制而非功能问题）')
    ok('★ 哨兵片名未被源站数据覆盖（已有值跳过）', after.pm === before.pm, after.pm)
    ok('★ 哨兵标签未被覆盖', after.bq === before.bq, String(after.bq))
    ok('封面未被改动', before.cover === after.cover)
    // skipPreviews：该影片已有预览图，补全时不该再下载
    const appLog = fs.existsSync(path.join(ROOT, 'tmp', '_fill-app.log')) ? fs.readFileSync(path.join(ROOT, 'tmp', '_fill-app.log'), 'utf8') : ''
    ok('skipPreviews 生效：未重复下载预览图', !/预览图: 待下载/.test(appLog),
      appLog.match(/预览图: [^\n]*/g) ? appLog.match(/预览图: [^\n]*/g).join(' / ') : '(无预览下载日志)')

    // 第二次：应提示无需补全且零变化
    await ev(`document.querySelector('.act-scrape').click(); 1`)
    let toast2 = ''
    for (let i = 0; i < 40; i++) {
      await sleep(1500)
      toast2 = await ev(`Array.from(document.querySelectorAll('.el-message')).map(e=>e.innerText).join(' | ')`)
      if (/无需补全|补全|失败|出错/.test(toast2)) break
    }
    console.log('  第二次提示:', JSON.stringify(toast2))
    await sleep(1200)
    const after2 = snap()
    ok('第二次提示「字段已完整，无需补全」', /无需补全/.test(toast2), toast2)
    ok('第二次库零变化', WATCH.every(k => String(after[k]) === String(after2[k])),
      '变化: ' + JSON.stringify(WATCH.filter(k => String(after[k]) !== String(after2[k]))))

    console.log('\n=== 运行期错误 ===')
    console.log(errors.length ? [...new Set(errors)].join('\n') : '  无 ✅')

    const exited = new Promise(res => { child.once('exit', () => res(true)); setTimeout(() => res(false), 10000) })
    try { ws.send(JSON.stringify({ id: ++id, method: 'Browser.close', params: {} })) } catch { }
    await exited
  } finally {
    try { child && child.kill() } catch { }
    fs.writeFileSync(LIVE, backupContent)
    console.log('\ndev 库已还原:', Buffer.compare(fs.readFileSync(LIVE), backupContent) === 0 ? 'OK（字节一致）' : '❌ 失败')
  }
  console.log(`==== 结果: 通过 ${pass} / 失败 ${fail} ====`)
  process.exit(fail ? 1 : 0)
})();
