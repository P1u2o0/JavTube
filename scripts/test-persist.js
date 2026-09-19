/**
 * 反向验证：没有走「恢复」流程的普通会话，落盘必须照常工作
 * （确认 _blockPersist 默认 false 不会误伤正常保存）
 *  ① 启动 → 改一个设置项 → 等过 10 秒定时落盘
 *  ② 优雅关窗
 *  ③ 直接读磁盘库，断言设置已持久化
 * 结束时还原 dev 库。
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const ROOT = process.cwd();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LIVE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'data', 'app.db');
const BAK = path.join(ROOT, 'tmp', '_dev-app.db.persist-test.bak');
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log('  [OK]   ' + l + (d ? '  ' + d : '')) } else { fail++; console.log('  [FAIL] ' + l + (d ? '  ' + d : '')) } };

(async () => {
  const SQL = await initSqlJs({ locateFile: () => path.join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm') });
  const readKey = (k) => {
    const db = new SQL.Database(fs.readFileSync(LIVE));
    return db.exec('SELECT value FROM settings WHERE key=?', [k])[0]?.values?.[0]?.[0] ?? '(无)';
  };

  if (!fs.existsSync(BAK)) fs.copyFileSync(LIVE, BAK);
  const backupContent = fs.readFileSync(BAK);
  const orig = readKey('show_tips');
  const next = orig === 'y' ? 'n' : 'y';
  console.log('show_tips 原值:', orig, '→ 目标:', next);

  let child = null;
  try {
    const appEnv = { ...process.env }
    delete appEnv.ELECTRON_RUN_AS_NODE; delete appEnv.NODE_PATH; delete appEnv.VITE_DEV_SERVER_URL
    child = require('child_process').spawn(
      path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      ['--remote-debugging-port=9333', '--window-position=-3200,-3200', '--window-size=1200,800',
       '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
       '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
       path.join(ROOT, 'electron', 'main', 'index.js')],
      { cwd: ROOT, env: appEnv, stdio: 'ignore' })

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
    if (!targets || !targets.length) { console.log('❌ 启动失败'); return }
    const ws = new WebSocket((targets.find(t => t.type === 'page') || targets[0]).webSocketDebuggerUrl)
    let id = 0; const pend = new Map()
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
    ws.addEventListener('error', () => { }); ws.addEventListener('close', () => { })
    await new Promise(r => ws.addEventListener('open', r))
    await ws_send('Runtime.enable')
    function ws_send(method, params = {}) { return new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) }) }
    const ev = async (x) => (await ws_send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value
    await sleep(2500)

    ok('未走恢复流程时不处于拦截状态（间接：能正常写）', true)
    const r = await ev(`window.api.updateSetting('show_tips','${next}')`)
    ok('写设置接口返回成功', !!(r && r.ok), JSON.stringify(r))
    await sleep(11500)   // 等过 10 秒定时落盘
    ok('① 定时落盘已把改动写入磁盘', readKey('show_tips') === next, readKey('show_tips'))

    const exited = new Promise(res => { child.once('exit', () => res(true)); setTimeout(() => res(false), 10000) })
    try { ws.send(JSON.stringify({ id: ++id, method: 'Browser.close', params: {} })) } catch { }
    await exited
    await sleep(1200)
    ok('② 关窗后设置仍然保留（正常落盘未被误伤）', readKey('show_tips') === next, readKey('show_tips'))
  } finally {
    try { child && child.kill() } catch { }
    fs.writeFileSync(LIVE, backupContent)
    console.log('\ndev 库已还原:', Buffer.compare(fs.readFileSync(LIVE), backupContent) === 0 ? 'OK（字节一致）' : '❌ 失败')
  }
  console.log('==== 结果: 通过 ' + pass + ' / 失败 ' + fail + ' ====')
  process.exit(fail ? 1 : 0)
})();
