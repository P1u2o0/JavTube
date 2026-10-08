/**
 * @file backend.js
 * @module src/player
 * @description 播放内核后端「契约」层（抽象）。
 *
 * 为什么要有这一层（2026-10-07）：
 *   在此之前 Player.vue 直接 `new Artplayer(...)` 并到处操作它的实例，播放内核与页面逻辑
 *   焊死在一起。后果是「想换内核」= 「重写整个播放页」—— 例如为了兼容性引入 mpv 时，
 *   相关推荐、女优、标签、进度记忆、快捷键、错误判定这些逻辑都要跟着重写一遍。
 *   本层把「播放」这件事收敛成一个契约，页面只依赖契约、不碰具体内核。
 *
 * 现有实现：`./chromium-backend.js`（ArtPlayer + Chromium 媒体栈，默认，行为与重构前一致）。
 * 将来可加：mpv 后端（独立进程 / libmpv），用于「高兼容模式」。
 *
 * ⚠️ 新增后端必须实现下面列出的**全部**成员；事件名一律走 PLAYER_EVENTS 的归一化命名，
 *    不得把内核自己的事件名（如 ArtPlayer 的 `video:xxx`）泄露给页面。
 *
 * ── 契约（PlayerBackend 实例必须提供）──────────────────────────────────────
 * 生命周期
 *   mount(containerEl, opts)   在容器里创建内核实例。opts: { url, autoplay, volume, muted, moreVideoAttr }
 *   load(url)                  载入/切换到某个地址（首次之后等价于「换片」）
 *   reload()                   强制重新载入当前地址（重试用；内核须真正重新加载，不能提前 return）
 *   destroy()                  销毁内核实例（保留容器 DOM）
 * 播放控制
 *   play() / pause() / toggle()
 * 状态读写（属性）
 *   currentTime  秒（可读写）
 *   duration     秒（只读，未知时为 0）
 *   volume       0~1（可读写）
 *   muted        布尔（可读写）
 *   playbackRate 倍速（可读写）
 *   fullscreen   布尔（可读写）。Chromium 后端 = ArtPlayer 的页面内全屏（DOM 全屏）；
 *                mpv 后端 = **窗口级**全屏（`win.setFullScreen`，2026-10-08），并广播
 *                `fullscreenchange` 事件 —— 因为 mpv 的画面是独立子窗口，DOM 全屏会把
 *                挖洞遮罩排除在绘制之外、屏幕变成纯黑（详见 electron/main/ipc-utils.js）。
 * 只读信息
 *   isMounted            是否已创建实例
 *   element              底层 <video> 元素（供几何计算）；**没有 <video> 的内核返回 null**
 *   rootEl               内核根容器（供挂自定义浮层，如长按提示徽标）
 *   videoWidth/videoHeight 视频像素尺寸
 *   isPlayable()         当前是否处于「可播的健康态」（用于播放失败面板的宽限复核）
 * 事件
 *   on(name, fn) → 返回取消订阅函数；name 取值见 PLAYER_EVENTS
 *
 * ⚠️ 写新后端时注意两条：
 *   ① `element` 允许为 null（mpv 这类外部进程内核没有 <video>）—— 页面侧一切用到
 *      `element` 的地方都必须判空，健康检查改用 `isPlayable()`；
 *   ② 契约里的状态属性（currentTime/duration/volume/…）都是**同步读**的，而外部内核
 *      多半只能异步拿值，所以后端必须自己维护一份缓存，事件到达时更新。
 *
 * @dependencies 无（纯契约，不引入任何内核）
 */

/**
 * 归一化事件名 —— 页面**只允许**用这些名字订阅，各后端负责把内核事件映射过来。
 * 语义与 HTMLMediaElement 的同名事件一致，便于页面逻辑与内核解耦。
 */
export const PLAYER_EVENTS = Object.freeze([
  'loadedmetadata',   // 拿到元数据（时长/尺寸）—— 换片完成的标志
  'canplay',          // 可以开始播放（用于撤销错误面板）
  'playing',          // 真正开始播放（用于撤销错误面板）
  'pause',
  'ended',
  'timeupdate',
  'volumechange',
  'error',
  // 全屏状态变化（2026-10-08，仅 mpv 后端发）：负载 { fullscreen: boolean }。
  // mpv 的「全屏」是**窗口级**的（`win.setFullScreen`），不产生 document 的 fullscreenchange
  // 事件，所以由后端自己通报；页面据此把播放器铺满视口并重算镂空矩形。
  // Chromium 后端用 ArtPlayer 自己的全屏（会产生原生 fullscreenchange，页面另有监听），不发此事件。
  'fullscreenchange'
])

/**
 * 支持的播放内核标识。
 * @type {Readonly<{CHROMIUM: string, MPV: string}>}
 */
export const PLAYER_KINDS = Object.freeze({
  CHROMIUM: 'chromium',   // ArtPlayer + Chromium 媒体栈（默认、兜底）
  MPV: 'mpv'              // mpv 独立进程（高兼容模式，2026-10-08）
})
