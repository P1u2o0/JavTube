/**
 * @file mpv.js
 * @module electron/main/mpv
 * @description mpv 播放内核的**进程管理 + 控制通道**（内置播放页「高兼容模式」的后端）。
 *
 * 方案与验证记录见 `docs/MPV_INTEGRATION_PLAN.md`（A2 路线：透明窗口 + `--wid` 嵌入）。
 * 本文件只做三件事：
 *   ① 起停 mpv 进程（`--wid=<主窗口句柄>` 把它嵌成窗口的子窗口）；
 *   ② 用 JSON IPC（Windows 命名管道）收发命令与属性；
 *   ③ 把 mpv 的属性变化归一化成少量事件推给渲染层。
 *
 * ── 为什么渲染层不直接连管道 ────────────────────────────────────────────────
 *   渲染层拿不到 Node 能力（contextIsolation），且管道名/进程生命周期属于主进程职责。
 *   于是：渲染层 → `mpv:control`（一条通道，白名单化）→ 本模块 → 管道 → mpv。
 *
 * ── 三个必须记住的坑（都是实测踩出来的）────────────────────────────────────
 *   ① `mpv.exe` 是 **GUI 子系统**：spawn 拿不到 stdout/stderr，只能靠 `--log-file` 排查。
 *   ② 这个 Windows 构建**没有 `--no-focus-on-open`**，传了 mpv 直接 exit=1。
 *   ③ 画面与「页面镂空矩形」的对齐靠 `--video-margin-ratio-*`（窗口尺寸的比例）。
 *      实测：启动时传、运行时用 `set_property` 改，都能即时生效，**缩放不需要重启 mpv**。
 *
 * @dependencies node:net, node:fs, node:path, node:child_process, electron, ../common/ipc-channels
 */

const net = require('net')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { app, ipcMain, BrowserWindow } = require('electron')
const IPC = require('../common/ipc-channels')

// ============================================================================
// 白名单：渲染层只能下发下面这些内容（通道是「透传式」的，必须自己设闸）
// ============================================================================

/** 允许写入的 mpv 属性 */
const ALLOWED_SET = new Set([
  'pause', 'volume', 'mute', 'speed', 'time-pos', 'panscan',
  'video-align-x', 'video-align-y', 'keepaspect'
])
/** 允许读取的 mpv 属性（含诊断用的丢帧/解码统计） */
const ALLOWED_GET = new Set([
  'time-pos', 'duration', 'pause', 'volume', 'mute', 'speed',
  'width', 'height', 'eof-reached', 'video-format', 'hwdec-current',
  'container-fps', 'estimated-vf-fps', 'display-fps',
  'frame-drop-count', 'decoder-frame-drop-count', 'mistimed-frame-count',
  'cache-buffering-state', 'paused-for-cache', 'vo-configured',
  // 镂空矩形（诊断用：探针要能核对「页面算出的矩形」与「mpv 实际收到的 margin」是否一致）
  'video-margin-ratio-left', 'video-margin-ratio-top',
  'video-margin-ratio-right', 'video-margin-ratio-bottom',
  // 画面几何诊断（排查「画面没对齐窗口」用）：osd-dimensions 给出画面在窗口里的实际矩形
  'osd-dimensions', 'video-params', 'video-out-params', 'video-zoom', 'video-aspect-override'
])
/** 允许直接调用的 mpv 命令 */
const ALLOWED_CMD = new Set([
  'cycle', 'seek', 'stop', 'playlist-next', 'playlist-prev',
  'frame-step', 'frame-back-step', 'quit'
])

/** 轮询播放位置的间隔（毫秒）。mpv 没有持续性的 timeupdate 事件，只能轮询。
 *  250ms ≈ 4 次/秒：进度条足够顺，进度记账（5 秒节流）绰绰有余。 */
const POLL_MS = 250

// ============================================================================
// 进程状态
// ============================================================================

/** @type {import('child_process').ChildProcess|null} */
let proc = null
/** @type {{connect:Function,request:Function,close:Function}|null} */
let client = null
let pipeName = ''
let pollTimer = null
let lastTimePos = -1
/** 事件出口：由 index.js 注入（转发到渲染层） */
let emit = () => { }
/** 最近一次镂空矩形（窗口缩放时重算用） */
let lastHole = null
/** 观察 id → 属性名（mpv 的 property-change 事件只带 id，需要自己映射回来） */
const observeMap = new Map()
let nextObserveId = 1
/** 正在启动的 Promise（防并发重复 spawn） */
let starting = null
/** 已通知过「退出」的进程号，避免重复上报 */
let exitNotifiedFor = -1

/** mpv 可执行文件路径：打包后在 resources/mpv/，开发时在 vendor/mpv/ */
function mpvPath() {
  const exe = process.platform === 'win32' ? 'mpv.exe' : 'mpv'
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'mpv', exe) : '',
    path.join(__dirname, '..', '..', 'vendor', 'mpv', exe)
  ].filter(Boolean)
  for (const p of candidates) if (fs.existsSync(p)) return p
  return ''
}

function logPath() {
  try { return path.join(app.getPath('temp'), 'javtube-mpv.log') } catch { return path.join(os.tmpdir(), 'javtube-mpv.log') }
}

// ============================================================================
// JSON IPC 客户端（Windows 命名管道，行分隔 JSON）
// ============================================================================

function createClient(pipe) {
  let sock = null
  let buf = ''
  let id = 0
  /** @type {Map<number, Function>} */
  const pending = new Map()

  function handleMessage(m) {
    if (m.request_id && pending.has(m.request_id)) {
      const fn = pending.get(m.request_id)
      pending.delete(m.request_id)
      fn(m)
      return
    }
    // 无 request_id 的是事件（property-change / end-file / start-file …）
    if (m.event) onMpvEvent(m)
  }

  function connect() {
    return new Promise((resolve, reject) => {
      sock = net.connect(pipe)
      sock.once('connect', resolve)
      sock.once('error', reject)
      sock.on('close', () => { sock = null })
      sock.on('data', d => {
        buf += d.toString('utf8')
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i)
          buf = buf.slice(i + 1)
          if (!line.trim()) continue
          try { handleMessage(JSON.parse(line)) } catch { /* 半行/坏行，忽略 */ }
        }
      })
    })
  }

  /**
   * 发一条命令，返回 mpv 的应答对象（{error:'success', data} 或 {error:'...'}）。
   * @param {any[]} command - mpv 命令数组，如 ['get_property','time-pos']
   */
  function request(command, timeoutMs = 5000) {
    return new Promise(resolve => {
      if (!sock) return resolve({ error: 'not-connected' })
      const rid = ++id
      let done = false
      pending.set(rid, m => { done = true; resolve(m) })
      try {
        sock.write(JSON.stringify({ command, request_id: rid }) + '\n')
      } catch (e) {
        pending.delete(rid)
        return resolve({ error: String(e.message || e) })
      }
      setTimeout(() => {
        if (done) return
        pending.delete(rid)
        resolve({ error: 'timeout' })
      }, timeoutMs)
    })
  }

  function close() {
    try { sock && sock.end() } catch { /* 已断开 */ }
    sock = null
    pending.clear()
  }

  return { connect, request, close }
}

// ============================================================================
// mpv → 渲染层 的事件归一化
// ============================================================================

/**
 * 处理 mpv 主动推来的消息。
 * `property-change` 只在**值真的变了**时到来，所以 pause/eof 这类布尔量可以直接当边沿事件用。
 */
function onMpvEvent(m) {
  if (m.event === 'property-change') {
    const name = observeMap.get(m.id) || m.name
    if (!name || m.data === undefined) return
    switch (name) {
      case 'duration':
        if (typeof m.data === 'number' && m.data > 0) emit('loadedmetadata', { duration: m.data })
        break
      case 'pause':
        emit(m.data ? 'pause' : 'playing', {})
        break
      case 'core-idle':
        // core-idle 由 true → false 表示解码器开始工作 = 可以出画面
        if (m.data === false) emit('canplay', {})
        break
      case 'eof-reached':
        if (m.data === true) emit('ended', {})
        break
      case 'vo-configured':
        // 视频输出就绪（mpv 开始往窗口画了）。渲染层收到它才把视频区域镂空 —— 见下面 startMpv 的注释。
        if (m.data === true) emit('voready', {})
        break
      case 'volume':
      case 'mute':
        emit('volumechange', {})
        break
      default:
        break
    }
    return
  }

  if (m.event === 'end-file') {
    // reason: eof / stop / quit / error / redirect
    if (m.reason === 'error') {
      emit('error', { reason: m.reason, error: String(m.file_error || '') })
    }
    return
  }

  if (m.event === 'start-file') {
    lastTimePos = -1
    emit('startfile', {})
  }
}

/** 开始轮询 time-pos → timeupdate */
function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    if (!client) return
    const r = await client.request(['get_property', 'time-pos'])
    if (r.error !== 'success' || typeof r.data !== 'number') return
    if (Math.abs(r.data - lastTimePos) < 0.02) return
    lastTimePos = r.data
    emit('timeupdate', { currentTime: r.data })
  }, POLL_MS)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// ============================================================================
// 镂空矩形 → margin ratio
// ============================================================================

/**
 * 把「页面里视频区域的矩形」换算成 mpv 的四个 margin 比例。
 * mpv 是往**整个窗口**渲染的，margin 把它的可用区框到指定矩形（实测像素级对齐）。
 * @param {{x:number,y:number,w:number,h:number,winW:number,winH:number}} hole
 * @returns {Array<[string, number]>} [属性名, 值] 列表；参数不合法时返回空数组
 */
function holeToMargins(hole) {
  if (!hole) return []
  const winW = Number(hole.winW), winH = Number(hole.winH)
  const x = Number(hole.x), y = Number(hole.y), w = Number(hole.w), h = Number(hole.h)
  if (!(winW > 0) || !(winH > 0) || !(w > 0) || !(h > 0)) return []
  const clamp01 = v => Math.min(1, Math.max(0, v))
  return [
    ['video-margin-ratio-left', clamp01(x / winW)],
    ['video-margin-ratio-top', clamp01(y / winH)],
    ['video-margin-ratio-right', clamp01(1 - (x + w) / winW)],
    ['video-margin-ratio-bottom', clamp01(1 - (y + h) / winH)]
  ]
}

/** 上一次**确认下发成功**的四个 margin（只下发变化项用；滚动时每帧都要同步，必须省） */
const lastMargins = { left: null, top: null, right: null, bottom: null }
let holeRetryTimer = null

/**
 * 把镂空矩形下发给 mpv。
 * ⚠️ 只下发**值真的变了**的那些 margin：窗口滚动时渲染层会高频调用本方法，
 *    而每次 set_property 都会让 mpv 重新配置一次视频输出；四个全发会白白抖四倍。
 *    （竖向滚动只改 top/bottom，横向不动 → 每次实际只发 2 条。）
 *
 * ⚠️⚠️ **只有发送成功才记进缓存**，失败必须留空等下次重试。
 *    踩过的坑：一开始无论成败都记缓存 → 启动阶段 mpv 还没接管窗口、set_property 失败，
 *    但缓存已被写上「这个值已下发」→ 之后所有 syncHole 都跳过它 → 画面比窗口低 6px
 *    且**再也纠不回来**（渲染层有去重，不会再发同样的矩形）。现在失败会安排重试。
 *
 * @param {{x:number,y:number,w:number,h:number,winW:number,winH:number}} hole
 * @param {number} [attempt] 第几次尝试（内部重试用）
 */
async function applyHole(hole, attempt = 0) {
  lastHole = hole || null
  if (!client) return { ok: false, error: 'not-running' }
  const failed = []
  for (const [k, v] of holeToMargins(hole)) {
    const name = k.replace('video-margin-ratio-', '')
    if (lastMargins[name] !== null && Math.abs(lastMargins[name] - v) < 1e-6) continue
    const r = await client.request(['set_property', k, v])
    if (r.error === 'success') lastMargins[name] = v
    else failed.push(`${name}:${r.error}`)
  }
  if (failed.length && attempt < 6) {
    console.warn(`[mpv] 镂空矩形下发失败（第 ${attempt + 1} 次）：${failed.join(', ')}，稍后重试`)
    // 失败项留空 → 下次全量重算时会重新下发。这里再安排几次重试，
    // 因为渲染层对「矩形没变」有去重，它不会再主动发同样的矩形。
    if (holeRetryTimer) clearTimeout(holeRetryTimer)
    holeRetryTimer = setTimeout(() => {
      holeRetryTimer = null
      if (lastHole && client) applyHole(lastHole, attempt + 1)
    }, 400)
    return { ok: false, error: failed.join(',') }
  }
  if (failed.length) console.warn(`[mpv] 镂空矩形下发重试次数用尽，仍有失败：${failed.join(', ')}`)
  return { ok: true }
}

// ============================================================================
// 起停
// ============================================================================

/** 停掉 mpv 进程并清理状态 */
async function stopMpv() {
  stopPolling()
  observeMap.clear()
  const c = client
  client = null
  if (c) {
    try { await c.request(['quit'], 1200) } catch { /* 忽略 */ }
    c.close()
  }
  const p = proc
  proc = null
  if (p && p.exitCode === null) {
    try { p.kill() } catch { /* 已退出 */ }
    // 兜底：GUI 子系统进程偶有 kill 不掉的情况，1 秒后强杀整棵进程树
    setTimeout(() => {
      try { if (p.exitCode === null) spawn('taskkill', ['/F', '/T', '/PID', String(p.pid)], { stdio: 'ignore' }) } catch { /* 忽略 */ }
    }, 1000)
  }
  lastTimePos = -1
  if (holeRetryTimer) { clearTimeout(holeRetryTimer); holeRetryTimer = null }
  // ⚠️ 必须清掉 margin 缓存：新进程是白纸，靠「只发变化项」的差分会把四个 margin 全跳过，
  //    结果新起的 mpv 拿不到镂空矩形（画面铺满整窗）。
  lastMargins.left = lastMargins.top = lastMargins.right = lastMargins.bottom = null
  return { ok: true }
}

/**
 * 启动 mpv 并载入文件。
 * @param {object} o
 * @param {number} o.hwnd - 主窗口句柄（`--wid`）
 * @param {string} o.file - 视频地址（javtube-media:// 或本地路径）
 * @param {object} [o.hole] - 镂空矩形
 * @param {number} [o.volume] - 0~1
 * @param {boolean} [o.muted]
 * @param {number} [o.startAt] - 起播秒数
 */
async function startMpv(o) {
  if (starting) return starting
  starting = (async () => {
    const exe = mpvPath()
    if (!exe) return { ok: false, error: 'mpv-not-found' }
    await stopMpv()

    pipeName = '\\\\.\\pipe\\javtube-mpv-' + process.pid
    const args = [
      '--no-config',
      '--wid=' + o.hwnd,
      '--input-ipc-server=' + pipeName,
      // 不让 mpv 抢键盘：键位由播放页统一接管（设置里的快捷键要在 mpv 模式下照常可用）
      '--input-default-bindings=no',
      '--input-vo-keyboard=no',
      '--no-terminal',
      '--osc=no',
      '--osd-level=0',
      '--hwdec=auto-safe',
      // 播完停在末尾但不退出进程：换片靠 loadfile，进程常驻避免每次换片都重启（重启约 0.5~1s）
      '--keep-open=no',
      '--idle=yes',
      '--keepaspect=yes',
      // 不要因为片子宽高比去改窗口尺寸 —— 窗口归 Electron 管，mpv 只是嵌在里面画
      '--keepaspect-window=no',
      '--video-align-x=0',
      '--video-align-y=0',
      '--panscan=0',
      // 窗口底色：镂空矩形内的 letterbox 黑边由它提供（否则会透出桌面）
      '--background-color=#FF000000',
      '--volume=' + Math.round((typeof o.volume === 'number' ? o.volume : 0.8) * 100),
      '--mute=' + (o.muted ? 'yes' : 'no'),
      '--msg-level=all=warn'
    ]
    for (const [k, v] of holeToMargins(o.hole)) args.push(`--${k}=${v}`)
    if (o.startAt > 0) args.push('--start=' + Number(o.startAt))
    args.push(o.file)

    let logFile = ''
    try { logFile = logPath() } catch { /* 拿不到临时目录就放弃日志 */ }
    if (logFile) {
      try { fs.writeFileSync(logFile, '') } catch { /* 忽略 */ }
      args.splice(1, 0, '--log-file=' + logFile)
    }

    try {
      proc = spawn(exe, args, {
        cwd: path.dirname(exe),
        stdio: ['ignore', 'ignore', 'ignore'],   // GUI 子系统，抓不到输出（见文件头坑①）
        windowsHide: true
      })
    } catch (e) {
      return { ok: false, error: 'spawn-failed: ' + (e.message || e) }
    }
    // ⚠️ pid 必须在 spawn 之后立刻记下来：exit 回调里 `proc` 可能已被 stopMpv 置空，
    //    也可能已经指向**下一个**进程（换片/重启），用它判等会漏报或误报。
    const pid = proc.pid
    proc.on('exit', (code) => {
      stopPolling()
      if (client) { client.close(); client = null }
      if (proc && proc.pid === pid) proc = null
      if (exitNotifiedFor !== pid) {
        exitNotifiedFor = pid
        emit('exited', { code })
      }
    })
    proc.on('error', e => emit('error', { reason: 'spawn', error: String(e.message || e) }))

    // 等管道就绪（mpv 起进程到建管道通常 < 1s）
    client = createClient(pipeName)
    let connected = false
    for (let i = 0; i < 40; i++) {
      try { await client.connect(); connected = true; break } catch { await new Promise(r => setTimeout(r, 200)) }
      if (!proc) break          // 进程已经没了，不用再等
    }
    if (!connected) {
      const detail = logFile && fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(-600) : ''
      await stopMpv()
      return { ok: false, error: 'ipc-connect-failed', detail }
    }

    // 订阅需要的属性变化（property-change 事件里只带 id，所以要自己记映射）
    // vo-configured：视频输出就绪 = mpv 真的开始画画面了。渲染层据此才把视频区域「镂空」——
    // 否则从页面进来到 mpv 出画之间会有一段「洞是透明的、mpv 还没画」的空窗，透出桌面。
    for (const name of ['duration', 'pause', 'core-idle', 'eof-reached', 'volume', 'mute', 'vo-configured']) {
      const id = nextObserveId++
      observeMap.set(id, name)
      await client.request(['observe_property', id, name])
    }
    startPolling()
    emit('started', {})
    return { ok: true, exe }
  })()
  try { return await starting } finally { starting = null }
}

// ============================================================================
// IPC 通道
// ============================================================================

// 注：**没有**「窗口全屏」这条命令 —— 实测透明窗口上 `win.setFullScreen()` 是失效的
// （窗口会铺满屏幕，但 `isFullScreen()` 恒为 false，属于 Electron 对 WS_EX_LAYERED
// 窗口的限制）。而 **DOM 全屏**（`element.requestFullscreen()`）在透明窗口下完全正常：
// 窗口铺满整屏、退出能还原、且 z 序在任务栏之上。所以全屏一律走 DOM 全屏，
// 渲染层直接调标准 API 即可，不需要经过主进程（详见 tmp/mpv-spike/test-transparent-window.js）。

/** 从 payload 里取一个白名单内的属性名 */
function safeName(name, allow) {
  return (typeof name === 'string' && allow.has(name)) ? name : ''
}

/**
 * 注册 mpv 控制通道。
 * ⚠️ 形参名必须是 `ipcMain`：`scripts/audit-wiring.js` 是按**字面量**去 main 目录里找
 *    「ipcMain.handle(常量)」来收集已注册通道的，换个参数名就会被判成「通道没人处理」。
 *    （同理，注释里也不要写出那个字面量，否则会被当成真代码匹配到。）
 * @param {import('electron').IpcMain} ipcMain
 * @param {{getMainWindow: () => import('electron').BrowserWindow|null}} ctx
 */
function registerMpvIpc(ipcMain, ctx) {
  // 事件出口：主进程 → 渲染层
  emit = (type, data) => {
    try {
      const win = ctx.getMainWindow()
      if (win && !win.isDestroyed()) win.webContents.send(IPC.MPV_EVENT, { type, data: data || {} })
    } catch { /* 窗口已销毁 */ }
  }

  ipcMain.handle(IPC.MPV_CONTROL, async (_e, payload) => {
    const { cmd } = payload || {}
    const win = ctx.getMainWindow()
    switch (cmd) {
      case 'start': {
        if (!win) return { ok: false, error: 'no-window' }
        let hwnd = 0
        try { hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE(0)) } catch { /* 非 Windows */ }
        if (!hwnd) return { ok: false, error: 'no-hwnd' }
        return startMpv({ ...payload, hwnd })
      }
      case 'stop':
        return stopMpv()
      case 'load': {
        if (!client) return { ok: false, error: 'not-running' }
        lastTimePos = -1
        const args = [payload.file, 'replace']
        if (payload.startAt > 0) args.push('start=' + Number(payload.startAt))
        const r = await client.request(['loadfile', ...args], 8000)
        return { ok: r.error === 'success', error: r.error }
      }
      case 'setHole':
        return applyHole(payload.hole)
      case 'set': {
        const name = safeName(payload.name, ALLOWED_SET)
        if (!name) return { ok: false, error: 'not-allowed' }
        if (!client) return { ok: false, error: 'not-running' }
        const r = await client.request(['set_property', name, payload.value])
        return { ok: r.error === 'success', error: r.error }
      }
      case 'get': {
        const name = safeName(payload.name, ALLOWED_GET)
        if (!name) return { ok: false, error: 'not-allowed' }
        if (!client) return { ok: false, error: 'not-running' }
        const r = await client.request(['get_property', name])
        return { ok: r.error === 'success', data: r.data, error: r.error }
      }
      case 'command': {
        const name = safeName(payload.name, ALLOWED_CMD)
        if (!name) return { ok: false, error: 'not-allowed' }
        if (!client) return { ok: false, error: 'not-running' }
        // cycle 只允许在可写白名单内的属性上循环
        if (name === 'cycle' && !safeName(payload.args?.[0], ALLOWED_SET)) return { ok: false, error: 'not-allowed' }
        const r = await client.request([name, ...(payload.args || [])])
        return { ok: r.error === 'success', error: r.error }
      }
      case 'status':
        return {
          ok: true,
          running: !!proc,
          exe: mpvPath(),
          pid: proc ? proc.pid : 0
        }
      default:
        return { ok: false, error: 'unknown-cmd' }
    }
  })

  // 主窗口尺寸变化：重算 margin（mpv 的 margin 是窗口尺寸的比例，窗口变了必须重下发）
  const onResize = () => { if (lastHole && client) applyHole(lastHole) }
  try {
    app.on('browser-window-created', (_e, w) => { w.on('resize', onResize) })
  } catch { /* 忽略 */ }
}

/** 应用退出前的清理（index.js 调用） */
function disposeMpv() {
  return stopMpv()
}

module.exports = { registerMpvIpc, disposeMpv, mpvPath, stopMpv }
