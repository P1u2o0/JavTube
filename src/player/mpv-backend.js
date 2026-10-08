/**
 * @file mpv-backend.js
 * @module src/player
 * @description mpv 播放内核后端（「高兼容模式」）：mpv 以独立进程运行，通过主进程的
 *              `mpv:control` / `mpv:event` 通道驱动。契约见 backend.js。
 *
 * 为什么需要它：少数影片的容器时间戳不标准（码流用了 B 帧但 MP4 缺 ctts 盒），
 * Chromium 的渲染器会因此丢掉约 20% 的帧；mpv 是 FFmpeg 系，按码流自带的顺序信息还原
 * 时间轴，同一文件完全不丢帧。顺带还解决了 AVI / TS / 10bit HEVC 等 Chromium 播不了的格式。
 * 方案与验证记录：`docs/MPV_INTEGRATION_PLAN.md`。
 *
 * ── 两个实现要点（照抄契约时必须处理）──────────────────────────────────────
 *   ① **状态要缓存**：契约里 currentTime/duration/volume/… 都是同步读，而 mpv 只能异步问。
 *      所以本后端自己维护一份缓存，靠事件与主动回读更新，页面侧完全感知不到差异。
 *   ② **element 为 null**：mpv 没有 <video>，页面侧一切几何/健康检查都要改用
 *      `isPlayable()` 与 `setHole()`（见 Player.vue 的 mpv 分支）。
 *
 * @dependencies window.api (mpvControl / onMpvEvent), ./backend
 */

import { PLAYER_EVENTS } from './backend'

/** 订阅时若当前状态已经满足，需要「补发」的事件 —— 否则会漏掉订阅之前发生的事。
 *  （页面是 mount() 之后才 on() 的，而 mpv 起进程约 0.4s，loadedmetadata 可能早于订阅。） */
const REPLAYABLE = Object.freeze(['loadedmetadata', 'canplay', 'playing', 'pause'])

/**
 * mpv 播放内核后端。
 * @implements {import('./backend.js')} 契约（见 backend.js 顶部说明）
 */
export class MpvBackend {
  constructor() {
    /** 是否已挂载（mount 后立即为 true，真正的进程启动是异步的） */
    this._mounted = false
    /** @type {HTMLElement|null} 播放器容器（也是 setHole 的测量对象） */
    this._container = null
    /** @type {HTMLElement|null} 浮层挂载点（长按徽标等） */
    this._overlay = null
    this._url = ''
    this._offEvent = null
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map()

    // ── 状态缓存（同步读的来源）──
    this._t = 0
    this._dur = 0
    this._vol = 0.8
    this._muted = false
    this._rate = 1
    this._meta = false       // 是否已拿到元数据（= 可播）
    this._playing = false
    this._failed = false     // mpv 报错 / 进程异常退出
    this._destroyed = false
    /** 窗口级全屏状态（透明窗口上 win.isFullScreen() 读值不可靠，自己持有，见 fullscreen） */
    this._fs = false
    /** 最近一次下发的镂空矩形（窗口缩放时重算用） */
    this._hole = null
    /** @type {((reason:string)=>void)|null} mpv 起不来时的回调（页面据此退回 Chromium） */
    this._onFatal = null
    this._fatalSent = false
    /** mpv 的视频输出是否已就绪（真的开始往窗口画了）。
     *  页面据此决定何时把视频区域「镂空」—— 早于它镂空就会透出桌面（见 Player.vue）。 */
    this._videoReady = false
  }

  /** 内核标识 */
  static get kind() { return 'mpv' }

  get isMounted() { return this._mounted }

  // ── 生命周期 ──────────────────────────────────────────────────────────────

  /**
   * 在容器里创建内核实例（启动 mpv 进程）。
   * @param {HTMLElement} containerEl - 播放器容器（页面里的 .player-box）
   * @param {{url:string, autoplay?:boolean, volume?:number, muted?:boolean, overlayEl?:HTMLElement,
   *          onFatal?:(reason:string)=>void}} opts
   *        onFatal：mpv 起不来（exe 缺失 / 管道连不上 / 进程秒退）时回调 —— 页面据此
   *        自动退回 Chromium 内核，避免出现「点了播不了」。
   */
  mount(containerEl, opts = {}) {
    if (this._mounted) return
    this._container = containerEl || null
    this._overlay = opts.overlayEl || containerEl || null
    this._onFatal = typeof opts.onFatal === 'function' ? opts.onFatal : null
    this._url = opts.url || ''
    this._vol = typeof opts.volume === 'number' ? opts.volume : 0.8
    this._muted = !!opts.muted
    this._mounted = true
    this._destroyed = false

    // 主进程 → 渲染层的事件订阅
    this._offEvent = window.api?.onMpvEvent?.(({ type, data }) => this._onMpvEvent(type, data)) || null

    const hole = this._hole || (this._container ? rectToHole(this._container) : null)
    Promise.resolve(window.api?.mpvControl?.({
      cmd: 'start',
      file: this._url,
      hole,
      volume: this._vol,
      muted: this._muted,
      startAt: opts.startAt || 0
    })).then(r => {
      if (r && r.ok === false) this._fatal(r.error || 'start-failed')
    }).catch(() => this._fatal('start-threw'))
  }

  /** mpv 起不来：交给页面决定怎么办（当前策略是退回 Chromium 内核） */
  _fatal(reason) {
    if (this._destroyed || this._fatalSent) return
    this._fatalSent = true
    this._failed = true
    console.warn('[mpv-backend] mpv 启动失败：', reason)
    try { this._onFatal?.(reason) } catch { /* 回调异常不影响页面其它逻辑 */ }
  }

  /**
   * 载入 / 切换到某个地址（换片）。mpv 进程常驻，只是 loadfile。
   * @param {string} url
   * @returns {Promise<void>}
   */
  load(url) {
    if (!this._mounted || !url) return Promise.resolve()
    this._url = url
    this._meta = false
    this._failed = false
    this._t = 0
    return Promise.resolve(
      window.api?.mpvControl?.({ cmd: 'load', file: url }).catch(() => { })
    )
  }

  /** 强制重新载入当前地址（重试）。mpv 侧 loadfile 同一个地址也会真正重新加载。 */
  reload(url) {
    const target = url || this._url
    if (!this._mounted || !target) return
    this._url = target
    this._meta = false
    this._failed = false
    window.api?.mpvControl?.({ cmd: 'load', file: target }).catch(() => { })
  }

  /** 销毁内核实例：停掉 mpv 进程、退订事件（保留容器 DOM） */
  destroy() {
    if (!this._mounted) return
    this._mounted = false
    this._destroyed = true
    // 兜底：销毁时若还处于窗口级全屏，必须把窗口还原 —— 否则离开播放页后
    // 整个应用停在无边框全屏里，用户没有退出的入口（Esc 已随页面卸载）。
    if (this._fs) {
      this._fs = false
      try { window.api?.setWindowFullscreen?.(false)?.catch?.(() => { }) } catch { /* 忽略 */ }
    }
    try { this._offEvent?.() } catch { /* 忽略 */ }
    this._offEvent = null
    this._handlers.clear()
    window.api?.mpvControl?.({ cmd: 'stop' }).catch(() => { })
  }

  // ── 播放控制 ──────────────────────────────────────────────────────────────

  play() { return this._send({ cmd: 'set', name: 'pause', value: false }) }
  pause() { return this._send({ cmd: 'set', name: 'pause', value: true }) }
  toggle() { return this._send({ cmd: 'command', name: 'cycle', args: ['pause'] }) }

  // ── 状态读写（全部走缓存，保证同步语义）──────────────────────────────────

  get currentTime() { return this._t }
  set currentTime(v) {
    const sec = Math.max(0, Number(v) || 0)
    this._t = sec
    this._send({ cmd: 'command', name: 'seek', args: [sec, 'absolute'] })
    this._emit('timeupdate', { currentTime: sec })
  }

  get duration() { return this._dur }

  get volume() { return this._vol }
  set volume(v) {
    const val = Math.min(1, Math.max(0, Number(v) || 0))
    this._vol = val
    this._send({ cmd: 'set', name: 'volume', value: Math.round(val * 100) })
    this._emit('volumechange', {})
  }

  get muted() { return this._muted }
  set muted(v) {
    this._muted = !!v
    this._send({ cmd: 'set', name: 'mute', value: this._muted })
    this._emit('volumechange', {})
  }

  get playbackRate() { return this._rate }
  set playbackRate(v) {
    const val = Math.min(16, Math.max(0.25, Number(v) || 1))
    this._rate = val
    this._send({ cmd: 'set', name: 'speed', value: val })
  }

  /**
   * 全屏：**走窗口级全屏**（`win.setFullScreen`），不是 DOM 全屏。
   * 2026-10-08 修（用户反馈「点全屏直接黑掉、什么都没有」）：
   *   mpv 的画面来自**独立子窗口**、靠页面把视频区域「镂空」透出来，而 DOM 全屏只会绘制
   *   全屏元素及其后代 —— 挖洞遮罩（teleport 到 body）与控制条（在 .player-wrap 里）都被
   *   排除在绘制之外，屏幕上只剩全屏背景，而它盖在 mpv 子窗口之上 ⇒ 纯黑。
   *   窗口级全屏只是把窗口放大：页面照常绘制、mpv 照常从镂空处透出，画面与控制条都还在。
   * 页面侧收到 `fullscreenchange` 后把播放器铺满视口（html.mpv-fs）并重算镂空矩形。
   * ⚠️ 透明窗口上 `win.isFullScreen()` 的读值不可靠（实测恒 false），所以状态在这里自己持有。
   */
  get fullscreen() { return this._fs }
  set fullscreen(v) {
    const on = !!v
    if (this._fs === on) return
    this._fs = on
    // 通道不在场（旧 preload / 极端降级）时退化为「只做页面内铺满」：
    // 画面仍然可见，只是不覆盖任务栏，绝不回到「全黑」那条路。
    try { window.api?.setWindowFullscreen?.(on)?.catch?.(() => { }) } catch { /* 忽略 */ }
    // 进出都**立即**广播，不要等窗口 —— 主进程现在是瞬时 setBounds（不是系统全屏动画），
    // 窗口与页面会在同一帧里一起切，用户看到的是一次干净的动作。
    // （曾经试过「退出时等窗口缩回去再切页面」，结果是「先变成窗口形式的画面、再回到软件界面」
    //   这种两步动作，用户 2026-10-09 明确反馈更别扭。）
    this._emit('fullscreenchange', { fullscreen: on })
  }
  /** 契约兼容：Chromium 后端有 fullscreenWeb（网页全屏），mpv 后端没有这个概念 */
  set fullscreenWeb(_v) { /* no-op */ }

  // ── 只读信息 ──────────────────────────────────────────────────────────────

  /** mpv 没有 <video> 元素 —— 页面侧一切用到它的地方都必须判空 */
  get element() { return null }
  /** 浮层挂载点（长按徽标等；由页面通过 mount 的 overlayEl 指定） */
  get rootEl() { return this._overlay }
  get videoWidth() { return 0 }
  get videoHeight() { return 0 }

  /**
   * 是否处于「可播的健康态」：已拿到元数据且没有报错/异常退出。
   * 替代 Chromium 后端的 `<video>.error/readyState` 判据（见 Player.vue 播放错误段）。
   */
  isPlayable() { return this._meta && !this._failed }

  /** mpv 是否已开始出画（页面用它决定何时把视频区域镂空） */
  get isVideoReady() { return this._videoReady }

  // ── mpv 专属：镂空矩形同步（不属于契约，页面在支持时调用）────────────────

  /**
   * 把「页面里视频区域的矩形」同步给 mpv（mpv 往整个窗口渲染，靠 margin 把画面框进来）。
   * @param {{x:number,y:number,w:number,h:number,winW:number,winH:number}} [hole]
   *        不传则用容器当前的位置尺寸现算
   */
  setHole(hole) {
    const h = hole || (this._container ? rectToHole(this._container) : null)
    if (!h) return
    this._hole = h
    window.api?.mpvControl?.({ cmd: 'setHole', hole: h }).catch(() => { })
  }

  /** 诊断用：读 mpv 的统计（丢帧/解码器等），只在探针里用 */
  stat(name) { return window.api?.mpvControl?.({ cmd: 'get', name }).catch(() => null) }

  // ── 事件 ──────────────────────────────────────────────────────────────────

  /**
   * 订阅归一化事件。
   * @param {string} name - 取值见 backend.js 的 PLAYER_EVENTS
   * @param {Function} fn
   * @returns {Function} 取消订阅
   */
  on(name, fn) {
    if (!this._handlers.has(name)) this._handlers.set(name, new Set())
    this._handlers.get(name).add(fn)
    // 补发：状态已经满足的事件（页面是 mount 之后才订阅的，可能已经错过）
    if (REPLAYABLE.includes(name) && this._stateMatches(name)) {
      setTimeout(() => { if (this._handlers.get(name)?.has(fn)) fn(this._eventPayload(name)) }, 0)
    }
    return () => { this._handlers.get(name)?.delete(fn) }
  }

  /** 当前状态是否满足某个可补发事件的条件 */
  _stateMatches(name) {
    if (!this._mounted) return false
    switch (name) {
      case 'loadedmetadata': return this._meta
      case 'canplay': return this._meta
      case 'playing': return this._playing
      case 'pause': return this._meta && !this._playing
      default: return false
    }
  }

  _eventPayload(name) {
    if (name === 'loadedmetadata') return { duration: this._dur }
    if (name === 'timeupdate') return { currentTime: this._t }
    return {}
  }

  _emit(name, data) {
    const set = this._handlers.get(name)
    if (!set || !set.size) return
    for (const fn of [...set]) {
      try { fn(data || this._eventPayload(name)) } catch { /* 单个回调异常不影响其它 */ }
    }
  }

  /** 主进程推来的事件 → 更新缓存 + 转发给页面 */
  _onMpvEvent(type, data = {}) {
    if (this._destroyed) return
    switch (type) {
      case 'started':
        break
      case 'voready':
        // mpv 的视频输出就绪 = 真的开始画了。**必须在这里把镂空矩形重发一次**：
        // 页面首次算矩形时 mpv 进程往往还没起来（或还没接管窗口），那次 setHole 会失败/被丢弃；
        // 而 syncHole 有「矩形没变就不重发」的去重，于是 mpv 会一直用着最初那个（可能偏了 6px 的）
        // 矩形 —— 实测就是「画面跟窗口差一条黑边」的根因。
        this._videoReady = true
        this.setHole()
        this._emit('videoready', {})
        break
      case 'loadedmetadata':
        this._meta = true
        this._failed = false
        if (typeof data.duration === 'number' && data.duration > 0) this._dur = data.duration
        // 换片后 mpv 会重新配置视频输出，镂空矩形再保险地重发一次
        this.setHole()
        this._readBackState()
        this._emit('loadedmetadata', { duration: this._dur })
        break
      case 'canplay':
        this._emit('canplay', {})
        break
      case 'playing':
        this._playing = true
        this._emit('playing', {})
        break
      case 'pause':
        this._playing = false
        this._emit('pause', {})
        break
      case 'timeupdate':
        if (typeof data.currentTime === 'number') this._t = data.currentTime
        this._emit('timeupdate', { currentTime: this._t })
        break
      case 'ended':
        this._playing = false
        this._emit('ended', {})
        break
      case 'volumechange':
        this._readBackState()
        this._emit('volumechange', {})
        break
      case 'error':
        this._failed = true
        this._emit('error', { code: 4, message: data.error || data.reason || 'mpv error' })
        break
      case 'exited':
        // mpv 进程异常退出（被任务管理器结束、崩溃等）→ 当作播放失败，页面会走兜底面板
        this._failed = true
        this._meta = false
        this._playing = false
        this._emit('error', { code: 4, message: `mpv 进程已退出（code=${data.code}）` })
        break
      default:
        break
    }
  }

  /** 回读音量/静音/倍速，保持缓存与 mpv 一致（用户可能在 mpv 侧被外部改动） */
  _readBackState() {
    const api = window.api?.mpvControl
    if (!api) return
    api({ cmd: 'get', name: 'volume' }).then(r => {
      if (r?.ok && typeof r.data === 'number') this._vol = Math.min(1, Math.max(0, r.data / 100))
    }).catch(() => { })
    api({ cmd: 'get', name: 'mute' }).then(r => { if (r?.ok) this._muted = !!r.data }).catch(() => { })
    api({ cmd: 'get', name: 'speed' }).then(r => { if (r?.ok && typeof r.data === 'number') this._rate = r.data }).catch(() => { })
  }

  _send(payload) {
    return window.api?.mpvControl?.(payload).catch(() => null)
  }
}

/**
 * 把一个元素的位置尺寸换算成 mpv 的镂空矩形（相对视口，单位 CSS px）。
 * mpv 的 margin 是窗口尺寸的**比例**，所以这里给绝对量、由主进程换算。
 * @param {HTMLElement} el
 * @returns {{x:number,y:number,w:number,h:number,winW:number,winH:number}|null}
 */
export function rectToHole(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null
  const r = el.getBoundingClientRect()
  if (!(r.width > 0) || !(r.height > 0)) return null
  return {
    x: r.left,
    y: r.top,
    w: r.width,
    h: r.height,
    winW: window.innerWidth,
    winH: window.innerHeight
  }
}

// 引用一下契约里的合法事件名，避免它被当成未使用而删掉（事件名以 backend.js 为准）
export const MPV_EVENT_NAMES = PLAYER_EVENTS
