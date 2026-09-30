/**
 * 修复验证：切换影片误报「解码器不支持」的修复是否真的两向都对
 *
 * 被验证的修复（src/views/Player.vue）：
 *   ① video:error 不再立刻永久置 mediaErr，而是先给 ArtPlayer 的自愈留 ERR_GRACE_MS(1200ms)；
 *      期间 canplay/playing 一到（说明它自己重连成功）就撤销 → 瞬时错误不上报。
 *   ② 累计 ≥2 次错误且始终不可播，才认定真的放不了 → 仍然上报（不能把真故障吞掉）。
 *   ③ 板上加「重试」按钮（art.url = url 强制重载，因为 switchUrl 对同地址会提前 return）。
 *
 * 四段验证：
 *   V1 瞬时错误（把 src 指向不存在的文件，随后 ArtPlayer 自己重连回来）→ 面板**不得**出现
 *   V2 真放不了（新建一条 py 指向不存在文件的临时影片）→ 面板**必须**出现，且文案/错误码正确
 *   V3 点「重试」→ 面板先清零，因为仍失败会再次出现（同时用 loadstart 计数证明真的重载了）
 *   V4 从坏片切到好片 → 面板消失、视频正常播放
 *
 * ⚠️ 会写 dev 库（新建临时影片 + recordPlay + 进度）：全程用 scripts/_devdb.js 快照/还原。
 *
 * 用法：node scripts/verify-media-error-fix.js
 */
const path = require('path')
const { spawn } = require('child_process')
const devdb = require('./_devdb.js')

const ROOT = path.resolve(__dirname, '..')
const LIVE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'data', 'app.db')
const PORT = 9100 + Math.floor(Math.random() * 90)
const GOOD_ID = 60                 // 正常影片
const BAD_PH = 'PROBE-BROKEN-FILE' // 临时坏片番号（跑完随快照还原一起消失）
const BAD_PY = 'C:/__probe_nonexistent__/broken.mp4'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const RECORDER = function () {
  if (window.__v4) return 'already'
  const R = { ev: [], panel: [] }
  window.__v4 = R
  const seen = new WeakSet()
  const decode = (src) => {
    const m = /^javtube-media:\/\/[^/]*\/(.+)$/.exec(src || '')
    if (!m) return String(src || '')
    try {
      let b = m[1].replace(/-/g, '+').replace(/_/g, '/')
      while (b.length % 4) b += '='
      return decodeURIComponent(escape(atob(b)))
    } catch (e) { return String(src || '') }
  }
  window.__dec = decode
  const EV = ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'stalled', 'abort', 'emptied', 'error']
  const attach = (v) => {
    if (!v || seen.has(v)) return
    seen.add(v)
    for (const n of EV) {
      v.addEventListener(n, () => {
        R.ev.push({
          t: Math.round(performance.now()), ev: n,
          rs: v.readyState, ct: +(v.currentTime || 0).toFixed(2),
          tail: decode(v.currentSrc || v.src || '').split('\\').pop(),
          errCode: v.error ? v.error.code : null,
          panel: !!document.querySelector('.media-error')
        })
      }, true)
    }
  }
  const mo = new MutationObserver(() => document.querySelectorAll('video').forEach(attach))
  mo.observe(document.documentElement, { childList: true, subtree: true })
  document.querySelectorAll('video').forEach(attach)

  let last = false
  setInterval(() => {
    const h = !!document.querySelector('.media-error')
    if (h !== last) { last = h; R.panel.push({ t: Math.round(performance.now()), has: h }) }
  }, 100)
  return 'installed'
}

const SNAP = function () {
  const v = document.querySelector('video')
  const pe = document.querySelector('.media-error')
  return {
    panel: !!pe,
    meTitle: pe ? ((pe.querySelector('.me-title') || {}).textContent || '') : '',
    meDesc: pe ? ((pe.querySelector('.me-desc') || {}).textContent || '') : '',
    meHint: pe ? ((pe.querySelector('.me-hint') || {}).textContent || '') : '',
    btns: pe ? Array.from(pe.querySelectorAll('button')).map((b) => b.textContent.trim()) : [],
    rs: v ? v.readyState : -1,
    paused: v ? v.paused : null,
    ct: v ? +(v.currentTime || 0).toFixed(2) : -1,
    err: v && v.error ? v.error.code : null,
    src: v ? (window.__dec ? window.__dec(v.currentSrc || v.src || '') : '').split('\\').pop() : '',
    hash: location.hash
  }
}

const BREAK = function () {
  const v = document.querySelector('video')
  window.__good = v.currentSrc || v.src
  const abs = 'C:/__probe_nonexistent__/nope.mp4'
  const enc = btoa(unescape(encodeURIComponent(abs))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  v.src = 'javtube-media://0/' + enc
  return 'ok'
}

async function main() {
  const snap = devdb.takeSnapshot('verify-media-error-fix', LIVE)
  const appEnv = { ...process.env }
  delete appEnv.ELECTRON_RUN_AS_NODE; delete appEnv.NODE_PATH; delete appEnv.VITE_DEV_SERVER_URL; delete appEnv.NODE_OPTIONS

  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['--remote-debugging-port=' + PORT, '--window-position=-3200,-3200', '--window-size=1500,1250',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
      path.join(ROOT, 'scripts', 'probe-launch.js')],
    { cwd: ROOT, env: appEnv, stdio: 'ignore' })

  const verdicts = []
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
      if (r.exceptionDetails) throw new Error('page EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 400))
      return r.result.value
    }
    const snapNow = () => raw('(' + SNAP.toString() + ')()')
    const watch = async (secs, label, step = 600) => {
      const out = []
      const n = Math.round((secs * 1000) / step)
      for (let i = 0; i < n; i++) {
        await sleep(step)
        const s = await snapNow()
        out.push(s)
        console.log(`  [${label}] +${(((i + 1) * step) / 1000).toFixed(1)}s 面板=${s.panel ? '★有★' : '无'} rs=${s.rs} ct=${s.ct} paused=${s.paused} err=${s.err ?? '-'} src=${s.src}`)
      }
      return out
    }

    for (let i = 0; i < 60; i++) { if (await raw('!!window.__dataDir')) break; await sleep(500) }
    console.log('应用就绪')
    console.log('记录器:', await raw('(' + RECORDER.toString() + ')()'))

    // ============ V1 瞬时错误不应误报 ============
    console.log('\n========== V1 瞬时错误（ArtPlayer 会自己重连回来）→ 面板不得出现 ==========')
    await raw(`location.hash = '#/play/${GOOD_ID}'`)
    for (let i = 0; i < 40; i++) { const s = await snapNow(); if (s.rs >= 2 && s.ct > 1) break; await sleep(700) }
    console.log('  基线:', JSON.stringify(await snapNow()))
    const m1 = await raw('window.__v4.ev.length')
    await raw('(' + BREAK.toString() + ')()')
    console.log('  已把 src 指向不存在的文件，观察 7s…')
    const v1samples = await watch(7, 'V1')
    const v1panel = v1samples.some((s) => s.panel)
    const v1last = v1samples[v1samples.length - 1]
    const v1ok = !v1panel && v1last.rs >= 2 && v1last.ct > 1
    verdicts.push(['V1 瞬时错误不误报（视频应自行恢复且无面板）', v1ok])
    console.log(`  → 结论: ${v1ok ? '✅ 通过' : '❌ 未通过'}（面板出现过=${v1panel}，末态 rs=${v1last.rs} ct=${v1last.ct}）`)

    // ============ V2 真放不了必须上报 ============
    console.log('\n========== V2 真放不了（py 指向不存在文件）→ 面板必须出现 ==========')
    const made = await raw(`window.api.createMovie({ ph:'${BAD_PH}', py:'${BAD_PY}', pm:'探针临时坏片', bq:'', tjrq:'' }).then(r=>JSON.stringify(r)).catch(e=>'ERR '+e)`)
    console.log('  新建临时影片:', made)
    const badId = (() => { try { return JSON.parse(made).id } catch { return null } })()
    if (!badId) { console.log('  ❌ 临时影片创建失败，V2/V3/V4 跳过'); verdicts.push(['V2 真放不了要上报', false]) }
    else {
      const m2 = await raw('window.__v4.ev.length')
      await raw(`location.hash = '#/play/${badId}'`)
      const v2samples = await watch(9, 'V2')
      const v2shown = v2samples.filter((s) => s.panel).length
      const v2last = v2samples[v2samples.length - 1]
      const v2ok = v2last.panel && /打不开这个文件/.test(v2last.meDesc) && /错误码 4/.test(v2last.meHint) && v2last.btns.includes('重试')
      verdicts.push(['V2 真放不了仍上报（文案/错误码/重试按钮齐备）', v2ok])
      console.log(`  → 结论: ${v2ok ? '✅ 通过' : '❌ 未通过'}`)
      console.log(`     采样中出现面板 ${v2shown}/${v2samples.length} 次`)
      console.log(`     me-title : ${v2last.meTitle}`)
      console.log(`     me-desc  : ${v2last.meDesc}`)
      console.log(`     me-hint  : ${v2last.meHint}`)
      console.log(`     按钮     : ${JSON.stringify(v2last.btns)}`)

      // ============ V3 重试按钮 ============
      console.log('\n========== V3 点「重试」→ 面板先清零，仍失败会再次出现（loadstart 证明真重载） ==========')
      const lsBefore = await raw(`window.__v4.ev.filter(e=>e.ev==='loadstart').length`)
      const clicked = await raw(`(() => { const b = Array.from(document.querySelectorAll('.me-actions button')).find(x => x.textContent.includes('重试')); if (!b) return 'no-btn'; b.click(); return 'clicked' })()`)
      console.log('  点击:', clicked)
      await sleep(400)
      const mid = await snapNow()
      console.log('  +0.4s 面板=', mid.panel ? '有' : '无')
      const v3samples = await watch(6, 'V3')
      const lsAfter = await raw(`window.__v4.ev.filter(e=>e.ev==='loadstart').length`)
      const v3last = v3samples[v3samples.length - 1]
      const v3ok = lsAfter > lsBefore && v3last.panel
      verdicts.push(['V3 重试真的重新加载了（loadstart 增加）且仍失败会再上报', v3ok])
      console.log(`  → 结论: ${v3ok ? '✅ 通过' : '❌ 未通过'}（loadstart ${lsBefore} → ${lsAfter}）`)

      // ============ V4 切到好片应恢复 ============
      console.log('\n========== V4 从坏片切到好片 → 面板消失、视频正常播放 ==========')
      await raw(`location.hash = '#/play/${GOOD_ID}'`)
      const v4samples = await watch(6, 'V4')
      const v4last = v4samples[v4samples.length - 1]
      const v4ok = !v4last.panel && v4last.rs >= 2 && v4last.ct > 0.5
      verdicts.push(['V4 切到可播放影片后恢复（面板消失且正常起播）', v4ok])
      console.log(`  → 结论: ${v4ok ? '✅ 通过' : '❌ 未通过'}`)
    }

    // ============ 面板出现轨迹 + 事件 ============
    console.log('\n===== 面板出现轨迹 =====')
    const pv = JSON.parse(await raw('JSON.stringify(window.__v4.panel)'))
    if (!pv.length) console.log('  从未出现')
    for (const p of pv) console.log(`  t=${String(p.t).padStart(6)}ms  ${p.has ? '★出现' : '消失'}`)

    console.log('\n===== 关键媒体事件（error / loadstart / canplay / playing） =====')
    for (const e of JSON.parse(await raw('JSON.stringify(window.__v4.ev)'))) {
      if (!['error', 'loadstart', 'canplay', 'playing'].includes(e.ev)) continue
      console.log(`  t=${String(e.t).padStart(6)}ms ${e.ev.padEnd(10)} rs=${e.rs} ct=${e.ct} err=${e.errCode === null ? 'null' : e.errCode} 面板=${e.panel ? 'Y' : 'n'} …${e.tail}`)
    }

    console.log('\n===== 汇总判定 =====')
    let allOk = true
    for (const [name, ok] of verdicts) { if (!ok) allOk = false; console.log(`  ${ok ? '✅' : '❌'} ${name}`) }
    console.log(allOk ? '\n全部通过 ✅' : '\n存在未通过项 ❌')
  } finally {
    try { if (ws) ws.close() } catch { }
    try { spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)]) } catch { }
    await sleep(2500)
    const ok = devdb.restoreSnapshot(snap)
    console.log('dev 库还原:', ok ? 'OK（字节一致，临时影片一起回滚）' : '❌ 需人工处理')
  }
}

main().catch((e) => { console.error('探针异常:', (e && e.stack) || e); process.exitCode = 1 })
