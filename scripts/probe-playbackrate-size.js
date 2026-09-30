/**
 * 实测：播放器设置面板「倍速」项，展开前（设置项视图）与展开后（选择列表视图）的尺寸差
 *
 * 背景（源码级推断，待实测确认）：
 *   ArtPlayer 5.4.0 设置面板 resize() 里
 *     const n = this.active[0]?.$parent?.width || SETTING_WIDTH(250)
 *     w($setting, 'width', `${n}px`)
 *   根面板  active === option，active[0] 是 builtin 的 playback-rate，其 $parent 为 undefined
 *           → 宽度回落 250
 *   子面板  active === selector 数组，active[0].$parent 就是 playback-rate（width: SETTING_ITEM_WIDTH=200）
 *           → 宽度 200
 *   ⇒ 推断「展开时面板整体从 250 缩到 200」。本探针负责证实/证伪，并给出条目级量值。
 *
 * ⚠️ 会写 dev 库（进播放页触发 recordPlay）：用 scripts/_devdb.js 快照 + 还原。
 *
 * 用法：node scripts/probe-playbackrate-size.js
 *       （截图输出到 tmp/shot-playbackrate-*.png，目录会自动创建）
 */
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const devdb = require('./_devdb.js')

const ROOT = path.resolve(__dirname, '..')
const LIVE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'data', 'app.db')
const PORT = 9200 + Math.floor(Math.random() * 90)
const GOOD_ID = 60
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------- 页面侧：测量器（访问器全部兜底，不抛异常） ---------------- */
const MEASURE = function () {
  const g = (n) => {
    if (!n) return null
    const r = n.getBoundingClientRect()
    const c = getComputedStyle(n)
    return {
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      x: +r.left.toFixed(1), y: +r.top.toFixed(1),
      fs: c.fontSize, disp: c.display, vis: c.visibility,
      pad: c.padding, mar: c.margin, gap: c.gap
    }
  }
  const measureItem = (el) => {
    if (!el) return null
    const c = getComputedStyle(el)
    return {
      name: el.dataset.name || '', value: el.dataset.value || '',
      cls: el.className,
      rect: g(el),
      inlineH: el.style.height || '(none)',
      cssH: c.height, pad: c.padding, fs: c.fontSize, ovf: c.overflow,
      text: (el.textContent || '').trim().slice(0, 34),
      left: g(el.querySelector('.art-setting-item-left')),
      leftIcon: g(el.querySelector('.art-setting-item-left-icon')),
      leftText: g(el.querySelector('.art-setting-item-left-text')),
      right: g(el.querySelector('.art-setting-item-right')),
      rightTip: g(el.querySelector('.art-setting-item-right-tooltip')),
      rightIcon: g(el.querySelector('.art-setting-item-right-icon')),
      check: g(el.querySelector('.art-icon-check')),
      arrowR: el.querySelector('svg') ? true : false
    }
  }

  const out = { hash: '', settingShow: null, panels: [] }
  try { out.hash = location.hash } catch (e) { }
  const pl = document.querySelector('.art-video-player')
  try { out.settingShow = pl ? pl.classList.contains('art-setting-show') : null } catch (e) { }

  const st = document.querySelector('.art-settings')
  if (st) {
    const c = getComputedStyle(st)
    out.settings = Object.assign(g(st), { cssW: c.width, cssH: c.height, right: c.right, bottom: c.bottom, maxH: c.maxHeight })
  } else out.settings = null

  // 控制条上的按钮（用于确认哪个是「设置」）
  out.controlsRight = Array.from(document.querySelectorAll('.art-controls-right > *')).map((b, i) => ({
    i, cls: b.className, svg: /viewBox="0 0 22 22"/.test(b.innerHTML || '')
  }))

  const panes = Array.from(document.querySelectorAll('.art-settings .art-setting-panel'))
  out.panels = panes.map((p) => ({
    current: p.classList.contains('art-current'),
    disp: getComputedStyle(p).display,
    rect: g(p),
    items: Array.from(p.children).filter((x) => x.classList.contains('art-setting-item')).map(measureItem)
  }))
  // 只保留可见面板
  out.visiblePanels = out.panels.filter((p) => p.disp !== 'none')
  return out
}

const CLICK_ITEM = function (name) {
  const el = document.querySelector(`.art-setting-item[data-name="${name}"]`)
  if (!el) return 'no-item:' + name
  el.click()
  return 'clicked:' + name
}

const CLICK_SETTING_BTN = function () {
  const btns = Array.from(document.querySelectorAll('.art-controls-right > *'))
  const b = btns.find((x) => /viewBox="0 0 22 22"/.test(x.innerHTML || ''))
  if (!b) return 'no-btn'
  b.click()
  return 'clicked-btn'
}

async function main() {
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true })   // 截图落点
  const snap = devdb.takeSnapshot('probe-playbackrate-size', LIVE)
  const appEnv = { ...process.env }
  delete appEnv.ELECTRON_RUN_AS_NODE; delete appEnv.NODE_PATH
  delete appEnv.VITE_DEV_SERVER_URL; delete appEnv.NODE_OPTIONS

  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['--remote-debugging-port=' + PORT, '--window-position=-3200,-3200', '--window-size=1500,1250',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
      path.join(ROOT, 'scripts', 'probe-launch.js')],
    { cwd: ROOT, env: appEnv, stdio: 'ignore' })

  let ws = null
  try {
    const http = require('http')
    let targets = null
    for (let i = 0; i < 60; i++) {
      try {
        targets = await new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' },
          (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(JSON.parse(d))) }).on('error', rej))
        if (targets && targets.length) break
      } catch { }
      await sleep(500)
    }
    if (!targets || !targets.length) { console.log('应用未启动'); process.exitCode = 1; return }

    ws = new WebSocket((targets.find((t) => t.type === 'page') || targets[0]).webSocketDebuggerUrl)
    let mid = 0; const pend = new Map()
    const send = (m, p = {}, to = 60000) => new Promise((res, rej) => {
      const i = ++mid; pend.set(i, { res, rej })
      ws.send(JSON.stringify({ id: i, method: m, params: p }))
      setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('TO ' + m)) } }, to)
    })
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && pend.has(m.id)) { pend.get(m.id).res(m.result); pend.delete(m.id) }
    })
    await new Promise((r) => ws.addEventListener('open', r))
    await send('Page.enable'); await send('Runtime.enable')

    const raw = async (expr, to) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, to || 60000)
      if (r.exceptionDetails) throw new Error('page EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 500))
      return r.result.value
    }
    const shot = async (tag) => {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      const p = path.join(ROOT, 'tmp', `shot-playbackrate-${tag}.png`)
      fs.writeFileSync(p, Buffer.from(r.data, 'base64'))
      console.log(`  [截图] ${p}`)
      return p
    }

    for (let i = 0; i < 60; i++) { if (await raw('!!window.__dataDir')) break; await sleep(500) }
    console.log('应用就绪')
    const vw = await raw('JSON.stringify({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})')
    console.log('视口:', vw)

    // ---- 进播放页 ----
    await raw(`location.hash = '#/play/${GOOD_ID}'`)
    for (let i = 0; i < 60; i++) {
      const ok = await raw(`(() => { const v=document.querySelector('video'); return !!(v && v.readyState>=2 && v.currentTime>0.5) })()`)
      if (ok) break
      await sleep(600)
    }
    console.log('视频已就绪:', await raw(`(() => { const v=document.querySelector('video'); return v? JSON.stringify({rs:v.readyState,ct:+v.currentTime.toFixed(2)}) : 'no-video' })()`))

    // ---- 打开设置面板 ----
    console.log('\n===== 打开设置面板 =====')
    console.log('点击:', await raw('(' + CLICK_SETTING_BTN.toString() + ')()'))
    await sleep(900)
    let m = await raw('(' + MEASURE.toString() + ')()')
    console.log('setting-show =', m.settingShow)
    console.log('\n----- 【展开前】设置项视图 -----')
    console.log('面板 .art-settings 矩形 :', JSON.stringify(m.settings))
    for (const p of m.visiblePanels) {
      console.log(`  可见面板 current=${p.current} rect=${JSON.stringify(p.rect)}`)
      for (const it of p.items) {
        console.log(`    · name="${it.name}" cls="${it.cls}"`)
        console.log(`      rect=${JSON.stringify(it.rect)}  inlineH=${it.inlineH}  cssH=${it.cssH}  pad=${it.pad}  fs=${it.fs}`)
        console.log(`      text="${it.text}"`)
        console.log(`      left=${JSON.stringify(it.left)}`)
        console.log(`      leftIcon=${JSON.stringify(it.leftIcon)}`)
        console.log(`      leftText=${JSON.stringify(it.leftText)}`)
        console.log(`      right=${JSON.stringify(it.right)}`)
        console.log(`      rightTip=${JSON.stringify(it.rightTip)}`)
        console.log(`      rightIcon=${JSON.stringify(it.rightIcon)}`)
        console.log(`      check=${JSON.stringify(it.check)}`)
      }
    }
    await shot('before')

    // ---- 展开倍速 ----
    console.log('\n===== 点「播放速度」项 → 展开选择列表 =====')
    console.log('点击:', await raw('(' + CLICK_ITEM.toString() + ')("playback-rate")'))
    await sleep(900)
    m = await raw('(' + MEASURE.toString() + ')()')
    console.log('setting-show =', m.settingShow)
    console.log('\n----- 【展开后】选择列表视图 -----')
    console.log('面板 .art-settings 矩形 :', JSON.stringify(m.settings))
    for (const p of m.visiblePanels) {
      console.log(`  可见面板 current=${p.current} rect=${JSON.stringify(p.rect)}`)
      for (const it of p.items) {
        console.log(`    · name="${it.name}" value="${it.value}" cls="${it.cls}"`)
        console.log(`      rect=${JSON.stringify(it.rect)}  inlineH=${it.inlineH}  cssH=${it.cssH}  pad=${it.pad}  fs=${it.fs}`)
        console.log(`      text="${it.text}"`)
        console.log(`      left=${JSON.stringify(it.left)}  leftIcon=${JSON.stringify(it.leftIcon)}  leftText=${JSON.stringify(it.leftText)}`)
        console.log(`      right=${JSON.stringify(it.right)}  rightTip=${JSON.stringify(it.rightTip)}  rightIcon=${JSON.stringify(it.rightIcon)}`)
        console.log(`      check=${JSON.stringify(it.check)}`)
      }
    }
    await shot('after')

    // ---- 汇总差异 ----
    console.log('\n===== 结论 =====')
    const beforePane = m.panels.find((p) => p.items.some((i) => i && i.name === 'playback-rate')) || null
    console.log('展开前 根面板条目名 :', JSON.stringify((beforePane ? beforePane.items : []).map((i) => i && i.name)))
  } finally {
    try { if (ws) ws.close() } catch { }
    try { spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)]) } catch { }
    await sleep(2500)
    const ok = devdb.restoreSnapshot(snap)
    console.log('\ndev 库还原:', ok ? 'OK（字节一致）' : '❌ 需人工处理')
  }
}

main().catch((e) => { console.error('探针异常:', (e && e.stack) || e); process.exitCode = 1 })
