/**
 * 探针专用启动壳（**不改应用源码**，只在测试时替换 Electron 的入口脚本）。
 *
 * 为什么需要它：应用的 `new BrowserWindow({ width:1400, height:900, center:true })` 加上
 * `ready-to-show` 里的 `show() → focus() → setAlwaysOnTop(true/false) → moveTop()`，
 * 会把启动参数 `--window-position/-size` **全部覆盖**，窗口必定居中弹到用户桌面最前并抢焦点。
 * Electron 的 CDP 又没实现 `Browser.getWindowForTarget/setWindowBounds`（实测 -32601），
 * 所以只能在 Electron 层解决。
 *
 * 本壳做三件事（都在窗口构造完成之后、显示之前）：
 *   ① 把窗口停到屏幕外（可用区之外，永不与用户桌面相交）；
 *   ② 屏蔽 focus / moveTop / setAlwaysOnTop → 不抢焦点、不置顶；
 *   ③ 每次 show / ready-to-show / 定时器 都重新停一次，防止被系统或应用挪回来。
 * 注意：**仍让窗口处于 show 状态**（不隐藏），否则 `document.visibilityState` 会变 hidden，
 * 而应用按设计会在隐藏时暂停自动轮播 —— 那正是要被测的行为，不能因测试装置而改变。
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')

// 应用的真正主进程（相对本文件定位，保持应用内部的 __dirname 语义不变）
require(path.join(__dirname, '..', 'electron', 'main', 'index.js'))

const OFF = { x: -3200, y: -3200, width: 1400, height: 900 }

app.on('browser-window-created', (_e, win) => {
  const park = () => {
    try { win.setBounds(OFF) } catch { }
    try { win.setSkipTaskbar(true) } catch { }
    try { win.blur() } catch { }            // 不从用户手里抢焦点
  }
  park()
  // 不抢焦点、不置顶（本测试只覆盖轮播逻辑，焦点/置顶行为不在范围内）
  const noop = () => { }
  try { win.focus = noop; win.moveTop = noop; win.setAlwaysOnTop = noop } catch { }
  // 不可获得焦点：Windows 上窗口仍 shown（→ document.hidden 恒 false），但不会抢走用户的输入焦点
  try { win.setFocusable(false) } catch { }
  const origShow = win.show.bind(win)
  win.show = () => { park(); origShow(); park() }
  win.on('show', park)
  win.on('ready-to-show', park)
  // 兜底：构造后若干次再停一遍（应用可能在 ready-to-show 里挪窗）
  for (const t of [100, 400, 1000, 2500, 5000]) setTimeout(park, t)
})

// 供探针核对「壳确实生效了」：把停窗坐标写到 stdout
app.whenReady().then(() => {
  setTimeout(() => {
    const wins = BrowserWindow.getAllWindows()
    console.log('[probe-launch] windows=' + wins.length + ' bounds=' + JSON.stringify(wins.map(w => { try { return w.getBounds() } catch { return null } })))
  }, 1500)
})
