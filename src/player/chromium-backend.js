/**
 * @file chromium-backend.js
 * @module src/player
 * @description Chromium 播放内核后端（默认实现）：ArtPlayer + Chromium 媒体栈。
 *              本文件是**全项目唯一**允许出现 `Artplayer` 的地方 —— 页面侧只认
 *              `./backend.js` 里那份契约。
 *
 * 契约见 backend.js。本实现把 ArtPlayer 的事件名（`video:xxx`）映射成归一化事件名，
 * 页面因此不必知道底层用的是 ArtPlayer。
 *
 * 两处「看起来多余」的写法**都是历史修复，不要删**（详见 HANDOFF §5.7 与本节注释）：
 *   ① SETTING_WIDTH / SETTING_ITEM_WIDTH 一起钉到 200 —— 修「倍速面板展开前后宽度不一致」；
 *   ② moreVideoAttr.preload = 'auto' —— 让浏览器尽量多缓冲，减少 waiting 闪烁。
 *
 * @dependencies artplayer, ./backend
 */

import Artplayer from 'artplayer'
import { PLAYER_EVENTS } from './backend'

// ── 设置面板「倍速」宽度：两态统一 200px（2026-09-30，实测 tmp/probe-playbackrate-size.js）──
// ① 一致性：ArtPlayer resize() 取「当前面板首项的 $parent.width || SETTING_WIDTH(250)」当
//    面板宽度。根面板首项 $parent 为 undefined → 落到 250，而内置倍速项
//    width = SETTING_ITEM_WIDTH(200) → 点开倍速后面板 250→200、左右各内缩 25px，两态不同宽。
// ② 收窄：250 时面板右缘正好压在视频右边框上（right=0），观感太长；收到 200 后右缘退回 25px。
// 把两个常量一起钉到 200 —— 展开前后同宽、且不再贴着右边界。
// （顺带覆盖之后可能启用的画面比例 / 翻转等内置 selector 项）
Artplayer.SETTING_WIDTH = 200
Artplayer.SETTING_ITEM_WIDTH = Artplayer.SETTING_WIDTH

/** 归一化事件名 → ArtPlayer 事件名。ArtPlayer 把底层 <video> 的事件转发为 `video:*`。 */
const ART_EVENT = Object.freeze(
  PLAYER_EVENTS.reduce((m, name) => { m[name] = 'video:' + name; return m }, {})
)

/**
 * Chromium 播放内核后端。
 * @implements {import('./backend.js')} 契约（见 backend.js 顶部说明）
 */
export class ChromiumBackend {
  constructor() {
    /** @type {Artplayer|null} */
    this._art = null
    /** 当前地址：reload() 用（ArtPlayer 实例上的 url 是 getter，重试必须用 setter 才能强制重载，
     *  这里自己留一份，不依赖内核内部状态） */
    this._url = ''
  }

  /** 内核标识 */
  static get kind() { return 'chromium' }

  get isMounted() { return !!this._art }

  // ── 生命周期 ──────────────────────────────────────────────────────────────

  /**
   * 在容器里创建内核实例。
   * @param {HTMLElement} containerEl - 播放器容器（页面里的 .player-box）
   * @param {{url:string, autoplay?:boolean, volume?:number, muted?:boolean}} opts
   */
  mount(containerEl, opts = {}) {
    if (this._art) return
    this._url = opts.url || ''
    this._art = new Artplayer({
      container: containerEl,
      url: opts.url,
      autoplay: opts.autoplay !== false,
      volume: typeof opts.volume === 'number' ? opts.volume : 0.8,
      muted: !!opts.muted,
      // 以下均为 Chromium/ArtPlayer 侧的内核调参，不暴露给页面：
      playbackRate: true,
      aspectRatio: false,
      flip: false,
      fullscreen: true,
      fullscreenWeb: false,
      miniProgressBar: true,
      pip: true,
      setting: true,
      mutex: false,
      // backdrop: false —— 控制条毛玻璃（backdrop-filter: blur(20px)）压在视频上时每帧都要
      // 重算模糊，是播放卡顿的主要来源之一，这里关掉（控制条仍有半透明黑底，观感不变）。
      backdrop: false,
      hotkey: false,          // 内置键盘关闭：方向键长按/单击语义由播放页接管
      // preload=auto：让浏览器尽可能多缓冲，连续快进时命中已缓冲区间即可瞬时跳转，
      // 减少 waiting 事件触发的加载图标闪烁
      moreVideoAttr: { playsInline: true, preload: 'auto' }
    })
  }

  /**
   * 载入 / 切换到某个地址。
   * 首次之后走 switchUrl（内核内部会先 pause 再换源）。
   * @param {string} url
   * @returns {Promise<void>} 换源失败时内核会让它 reject —— 调用方自行接住
   *          （真正的失败判定交给播放页的错误宽限复核，不在这里做）
   */
  load(url) {
    if (!this._art) return Promise.resolve()
    this._url = url
    return Promise.resolve(this._art.switchUrl(url))
  }

  /**
   * 强制重新载入（重试）。
   * ⚠️ 必须走 `art.url = url` 而不是 `switchUrl(url)` —— 后者对同一个地址会提前
   * `return`（`if (e === t.url) void a()`），拿它重试等于什么都没做；
   * `url` 的 setter 则是无条件 `$video.src = a`，能真正触发一次重新加载。
   * @param {string} [url] - 不传则用最近一次载入的地址
   */
  reload(url) {
    if (!this._art) return
    const target = url || this._url
    if (!target) return
    this._url = target
    this._art.url = target
  }

  /** 销毁内核实例（保留容器 DOM，与重构前 art.destroy(false) 一致） */
  destroy() {
    if (!this._art) return
    try { this._art.destroy(false) } catch { /* 已销毁 / DOM 已被移除 */ }
    this._art = null
  }

  // ── 播放控制 ──────────────────────────────────────────────────────────────

  play() { try { return this._art?.play() } catch { return undefined } }
  pause() { try { this._art?.pause() } catch { /* 忽略 */ } }
  toggle() { try { this._art?.toggle() } catch { /* 忽略 */ } }

  // ── 状态读写 ──────────────────────────────────────────────────────────────

  get currentTime() { return this._art?.currentTime || 0 }
  set currentTime(v) { if (this._art) this._art.currentTime = v }

  get duration() { return this._art?.duration || 0 }

  get volume() { return this._art?.volume ?? 0 }
  set volume(v) { if (this._art) this._art.volume = v }

  get muted() { return !!this._art?.muted }
  set muted(v) { if (this._art) this._art.muted = !!v }

  get playbackRate() { return this._art?.playbackRate || 1 }
  set playbackRate(v) { if (this._art) this._art.playbackRate = v }

  get fullscreen() { return !!this._art?.fullscreen }
  set fullscreen(v) { if (this._art) this._art.fullscreen = !!v }
  set fullscreenWeb(v) { if (this._art) this._art.fullscreenWeb = !!v }

  // ── 只读信息 ──────────────────────────────────────────────────────────────

  /** 底层 <video> 元素：供几何计算（object-fit 铺满）。mpv 后端没有它，页面侧必须判空。 */
  get element() { return this._art?.video || null }
  /** 内核根容器：供页面挂自定义浮层（如长按提示徽标） */
  get rootEl() { return this._art?.template?.$player || null }
  get videoWidth() { return this._art?.video?.videoWidth || 0 }
  get videoHeight() { return this._art?.video?.videoHeight || 0 }

  /**
   * 当前是否处于「可播的健康态」：没有挂错误 且 已拿到元数据。
   * 播放页的失败面板宽限复核用它判断「错误是否已自愈」（详见 Player.vue 播放错误段注释）。
   * @returns {boolean}
   */
  isPlayable() {
    const v = this._art?.video
    return !!v && v.error == null && v.readyState >= 2
  }

  // ── 事件 ──────────────────────────────────────────────────────────────────

  /**
   * 订阅归一化事件。
   * @param {string} name - 取值见 backend.js 的 PLAYER_EVENTS
   * @param {Function} fn
   * @returns {Function} 取消订阅
   */
  on(name, fn) {
    if (!this._art) return () => { }
    const ev = ART_EVENT[name] || name
    this._art.on(ev, fn)
    return () => { try { this._art?.off(ev, fn) } catch { /* 已销毁 */ } }
  }
}
