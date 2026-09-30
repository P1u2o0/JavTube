/**
 * 🔴 修复回归测试：恢复数据库后关窗，恢复结果不能被内存旧库覆盖
 *
 * 数据目录 = electron.exe 同级 data（应用不支持用环境变量覆盖，见 index.js getDataDir），
 * 因此本测试作用于 dev 库：脚本自己先备份、结束时自己还原（无论断言成败都会还原）。
 *
 * 步骤：
 *  ① 造「带标记」的备份库（影片 8 的 pm 改成 RESTORED-MARKER-xxx）
 *  ② 启动应用 → 调 restoreDb(标记库)
 *  ③ 断言磁盘库已含标记
 *  ④ 做一次写操作并等过 10 秒定时落盘 → 断言标记仍在（落盘被拦）
 *  ⑤ 优雅关窗（window-all-closed → _forceSave）→ 断言标记仍在 ← 修复前这里会被覆盖
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const devdb = require('./_devdb.js');

const ROOT = process.cwd();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DATA_DIR = path.join(ROOT, 'node_modules', 'electron', 'dist', 'data');
const LIVE = path.join(DATA_DIR, 'app.db');
const MARKER = 'RESTORED-MARKER-' + Date.now();
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log('  [OK]   ' + l + (d ? '  ' + d : '')) } else { fail++; console.log('  [FAIL] ' + l + (d ? '  ' + d : '')) } };

(async () => {
  const SQL = await initSqlJs({ locateFile: () => path.join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm') });
  // 被标记 / 被断言的目标行：**不能写死 id**。dev 库每次重建后 id 会整体漂移
  // （当前是 10..318），写死的 8 早已不存在 → `UPDATE ... WHERE id=8` 改动 0 行、
  // 断言恒返回「无该行」，③④⑤ 变成**永远假失败**（2026-09-30 实测发现）。
  // 改为从快照里取真实存在的最小 id。
  let TID = null;
  const readPm = (file) => {
    if (!fs.existsSync(file)) return '(不存在)'
    if (TID == null) return '(未确定目标行)'
    try { return new SQL.Database(fs.readFileSync(file)).exec('SELECT pm FROM movies WHERE id=' + TID)[0]?.values?.[0]?.[0] ?? '(无该行)' }
    catch (e) { return '(读取失败)' }
  }

  // 本次运行独有的快照（原实现「有就复用」固定文件名 → 会拿陈旧快照覆盖真库，见 _devdb.js）
  const snap = devdb.takeSnapshot('restore-test', LIVE)
  try { TID = new SQL.Database(snap.content).exec('SELECT MIN(id) FROM movies')[0].values[0][0] } catch { }
  if (TID == null) {
    console.log('❌ 快照库里查不到任何影片行，无法定位断言目标 → 跳过（dev 库不写盘）')
    devdb.restoreSnapshot(snap)
    process.exit(1)
  }
  console.log('被标记/被断言的目标行 id =', TID)

  let child = null, ws = null
  try {
    // ① 带标记的备份库
    const mk = new SQL.Database(snap.content)
    mk.run('UPDATE movies SET pm=? WHERE id=?', [MARKER, TID])
    const markedPath = path.join(ROOT, 'tmp', '_marked-backup.db')
    fs.writeFileSync(markedPath, Buffer.from(mk.export()))
    console.log('标记库:', markedPath, '| 标记:', MARKER)

    // ② 启动应用
    // 注意：本会话注入了 ELECTRON_RUN_AS_NODE=1，会让 electron.exe 退化成纯 Node 直接崩，
    // 必须在子进程环境里显式删掉（不只是自己 unset）。
    const appEnv = { ...process.env }
    delete appEnv.ELECTRON_RUN_AS_NODE
    delete appEnv.NODE_PATH
    delete appEnv.VITE_DEV_SERVER_URL
    const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
    child = require('child_process').spawn(electron, [
      '--remote-debugging-port=9333', '--window-position=-3200,-3200', '--window-size=1200,800',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
      path.join(ROOT, 'electron', 'main', 'index.js')
    ], { cwd: ROOT, env: appEnv, stdio: 'ignore' })

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
    const page = targets.find(t => t.type === 'page') || targets[0]
    ws = new WebSocket(page.webSocketDebuggerUrl)
    let id = 0; const pend = new Map()
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
    // 关窗后 socket 会断开并抛 error 事件；没有监听会变成未捕获异常把脚本杀掉
    // （上一轮就死在这，导致第 ⑤ 步没跑到）
    ws.addEventListener('error', () => { })
    ws.addEventListener('close', () => { })
    const send = (me, pa = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: me, params: pa })) })
    await new Promise(r => ws.addEventListener('open', r))
    await send('Runtime.enable')
    const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value
    await sleep(2500)

    ok('数据目录已是 exe 同级 data', String(await ev('window.__dataDir')).endsWith('electron\\dist\\data'))
    ok(`测试前影片 ${TID} 为原内容`, readPm(LIVE) !== MARKER, String(readPm(LIVE)).slice(0, 18))
    ok('relaunchApp 已暴露', (await ev('typeof window.api.relaunchApp')) === 'function')

    // ③ 执行恢复
    const r3 = await ev(`window.api.restoreDb(${JSON.stringify(markedPath.replace(/\//g, '\\'))})`)
    await sleep(800)
    console.log('  恢复返回:', JSON.stringify(r3))
    ok('恢复接口返回成功', !!(r3 && r3.ok))
    ok('③ 磁盘库已替换为恢复内容', readPm(LIVE) === MARKER, String(readPm(LIVE)).slice(0, 30))

    // ④ 恢复后写操作 + 等过定时落盘
    await ev(`window.api.updateSetting('show_tips','n')`)
    await sleep(13000)
    ok('④ 写操作/定时落盘后未被覆盖', readPm(LIVE) === MARKER, String(readPm(LIVE)).slice(0, 30))

    // ⑤ 优雅关窗
    console.log('\n关闭应用（window-all-closed → _forceSave）…')
    const exited = new Promise(res => { child.once('exit', () => res(true)); setTimeout(() => res(false), 10000) })
    try { ws.send(JSON.stringify({ id: ++id, method: 'Browser.close', params: {} })) } catch { }
    const gotExit = await exited
    console.log('  进程已退出:', gotExit ? '是' : '否（超时）')
    await sleep(1200)   // 给 _forceSave 落盘留时间
    ok('⑤ 关窗后恢复内容仍在（修复生效）', readPm(LIVE) === MARKER, String(readPm(LIVE)).slice(0, 30))
  } finally {
    try { child && child.kill() } catch { }
    // 无论成败都还原 dev 库（校验 + 拒绝写坏数据 + 未变更则不写盘，见 _devdb.js）
    devdb.restoreSnapshot(snap)
    try { fs.rmSync(path.join(ROOT, 'tmp', '_marked-backup.db'), { force: true }) } catch { }
  }
  console.log('==== 结果: 通过 ' + pass + ' / 失败 ' + fail + ' ====')
  process.exit(fail ? 1 : 0)
})();
