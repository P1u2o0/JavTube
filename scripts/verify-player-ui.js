/**
 * 播放页 UI 调整验证（CDP + 屏外启动壳，窗口不抢焦点）
 *
 * 断言：
 *   U1  播放页背景 = 全局底色（与 body 一致，浅色）
 *   U2  番号在标题前方（DOM 顺序 + 视觉左边界 + 同一行）
 *   U3  播放器下方两行：第一行标签（最右喜欢按钮）、第二行女优圆形头像（30×30 / 50% 圆角）+ 名字
 *   U4  头像图片真实加载成功（covers/actress/*.jpg）
 *   U5  点击女优 → 跳转 /actor/<名字>（URL 编码）
 *   U6  标签全部显示；「体型/行为/玩法」三类排在最前（id=10：口交、接吻 在前）
 *   U7  未命中三类的标签跟在后面（女教师/第一人称摄影/单体作品）
 *   U8  无头像的影片（id=11）显示首字占位圆形，且不出现破图
 *   U9  信息区评分已移除；文件名属性标签（中文字幕等）位于喜欢按钮左侧（2026-10-04 改）
 *   U11 标题行位于播放器上方（标题底边 ≤ 播放器顶边）
 *   U12 播放器顶边 = 右侧第一张海报顶边（两列头部等高）
 *   U13 喜欢按钮：图标+文字、位于播放器下方一行最右、点击可切换状态、标题后无旧图标按钮
 *   U14 推荐项：海报 220 / 标题 3 行 / 不再显示评分 / 属性标签位于标题与演员名之间（2026-10-04 改）
 *   U15 详情按钮：图标+文字、与喜欢按钮同款样式、位于其右侧、点击进入影片详情页
 *   U16 推荐列表滚动条贴到窗口最右（与其它页面一致）
 *   U17 换片过渡动画（swap-in）已挂载
 *   U18 点击推荐影片：自动切到播放窗口播放 + 标题等信息同步更新
 *   U19 播放器放大（右列 440→400、海报保持 220 → 播放器 ≥1062px）
 *   U20 右侧正好完整显示 5 个推荐项（列表高 741.5px，第 6 个不露半截）
 *   U24 女优行：单女优无 +N 截断；多女优共演全部平铺显示（2026-10-04 改）
 *   U10 无未捕获页面异常
 *
 * ⚠️ 会写 dev 库：进入播放页会触发 recordPlay（写 play_count / play_time / play_pos），
 *    点「喜欢」会改 movies.cl。本脚本用 scripts/_devdb.js 做**整库快照 + 整库还原**，
 *    跑完库应逐字节回到原样（2026-09-30 之前只还原 cl，播放记录会留在库里，已修）。
 *
 * 依赖 dev 库中的固定样本：id=10（有头像）/ id=11（无头像）；换库后需同步调整下方常量。
 *
 * 用法：node scripts/verify-player-ui.js
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const devdb = require('./_devdb.js')

const ROOT = path.resolve(__dirname, '..')
const DEV_DB = path.join(ROOT, 'node_modules', 'electron', 'dist', 'data', 'app.db')
const PORT = 9800 + Math.floor(Math.random() * 150)
const ID_WITH_AVATAR = 10   // IPX-247 / 岬ななみ / cast 有 covers/actress/rsv.jpg
const ID_NO_AVATAR = 11     // ABF-337 / 釈アリス / cast.avatar 为空
// 多位女优共演的样本（2026-10-04 女优全显断言用）：id=140 SONE-561 cast 有 9 位女优
const ID_MULTI_ACTRESS = 140
const MULTI_ACTRESS_MIN = 3  // 断言下限取 3（防数据漂移；实际 9）
// id=10 的 bq = 「第一人称摄影，女教师，口交，接吻，单体作品」
const EXPECT_KEY_FIRST = ['口交', '接吻']                                    // 三类命中项（排最前）
const EXPECT_ALL = ['口交', '接吻', '第一人称摄影', '女教师', '单体作品']      // 全部标签
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** dev 库直读/直写（app 已退出时用；点喜欢会改 movies.cl，收尾还原） */
async function withDb(fn) {
  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs()
  const db = new SQL.Database(fs.readFileSync(DEV_DB))
  const out = fn(db)
  fs.writeFileSync(DEV_DB, Buffer.from(db.export()))
  db.close()
  return out
}

let pass = 0, fail = 0
const ok = (l, c, d = '') => { if (c) { pass++; console.log('  [OK]   ' + l + (d ? '  ' + d : '')) } else { fail++; console.log('  [FAIL] ' + l + (d ? '  ' + d : '')) } }

/**
 * 自包含：读取播放页信息区几何 + 样式 + 文本。
 *
 * ⚠️ 必须先**等入场动画播完再读几何**（2026-09-30 修，原为同步函数）：
 *   `.route-anim`（路由入场）与 `.swap-in`（播放页信息块/推荐列表）**都从 `translateY(6px)` 起步**，
 *   动画进行中读 `getBoundingClientRect()` 会读到位移中的位置。
 *   实测 U12「播放器顶边 = 右侧第一张海报顶边」与 U20「列表底 = 右列底」都恰好差 **6.00px**，
 *   且同一份代码会出现「一次 30/0、一次 26/4」的抖动 —— 根因就是这个，**不是产品缺陷**
 *   （U16/U19 同属这一类：几何在布局未落定时被读走）。
 *   ⚠️ 不能简单等「所有动画结束」：TopNav 的状态呼吸灯 `bp-pulse` 是 `infinite`，永远不结束。
 *   这里只等这两类入场动画；最多等 3s，超时也继续（保证探针不会挂死）。
 * @returns {Promise<Object>}
 */
async function pageUI() {
  {
    const deadline = performance.now() + 3000
    while (performance.now() < deadline) {
      const els = [document.querySelector('.route-anim'), ...document.querySelectorAll('.swap-in')].filter(Boolean)
      const busy = els.some(el => el.getAnimations && el.getAnimations().some(a => a.playState === 'running'))
      if (!busy) break
      await new Promise(r => requestAnimationFrame(r))
    }
  }
  const q = s => document.querySelector(s)
  const rect = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } }
  const page = q('.player-page')
  const ph = q('.info-ph'), nameEl = q('.info-name'), act = q('.actress'), av = q('.ac-avatar')
  const avImg = q('.ac-avatar img')
  const cats = [...document.querySelectorAll('.cat-tag')].map(e => e.textContent.trim())
  const fileTags = [...document.querySelectorAll('.tag-row .file-tag')].map(e => e.textContent.trim())
  const fileTagEls = [...document.querySelectorAll('.tag-row .file-tag')]
  return {
    bg: page ? getComputedStyle(page).backgroundColor : '',
    bodyBg: getComputedStyle(document.body).backgroundColor,
    titlePhFirst: !!(q('.info-title') && q('.info-title').children[0] && q('.info-title').children[0].classList.contains('info-ph')),
    phText: ph ? ph.textContent.trim() : '',
    nameText: nameEl ? nameEl.textContent.trim() : '',
    phBox: rect(ph), nameBox: rect(nameEl),
    titleBox: rect(q('.info-title')), subBox: rect(q('.actress-row')), tagRowBox: rect(q('.tag-row')),
    headBox: rect(q('.info-head')), recHeadBox: rect(q('.rec-head')),
    playerBox: rect(q('.player-box')), thumbBox: rect(q('.rec-item .thumb')),
    recCount: document.querySelectorAll('.rec-item').length,
    actBox: rect(act), actText: act ? act.textContent.replace(/\s+/g, '') : '',
    acName: q('.ac-name') ? q('.ac-name').textContent.trim() : '',
    avBox: rect(av), avRadius: av ? getComputedStyle(av).borderRadius : '', avOverflow: av ? getComputedStyle(av).overflow : '',
    acFontSize: q('.actress') ? getComputedStyle(q('.actress')).fontSize : '',
    avImgOk: !!(avImg && avImg.complete && avImg.naturalWidth > 0), avImgW: avImg ? avImg.naturalWidth : -1,
    avImgSrc: avImg ? avImg.src.slice(0, 46) : '',
    fallback: q('.ac-fallback') ? q('.ac-fallback').textContent.trim() : '',
    hasImg: !!avImg,
    // 女优展示（2026-10-04）：全部平铺；不再有 +N 截断
    actressCount: document.querySelectorAll('.actress-row .actress').length,
    hasAcMore: !!q('.ac-more'),
    // 文件名属性标签（2026-10-04）：无码破解/中文字幕/4K
    fileTags: fileTags,
    fileTagsInFavLeft: fileTagEls.length > 0 && !!q('.fav-btn') &&
      fileTagEls.every(el => el.parentElement && el.parentElement.classList.contains('row-actions')) &&
      fileTagEls[fileTagEls.length - 1].getBoundingClientRect().right <= q('.fav-btn').getBoundingClientRect().left + 1,
    hasScore: !!q('.info-stats'),
    recScoreExists: !!q('.rec-score'),
    cats: cats, catBox: rect(q('.cat-tag')),
    favBox: rect(q('.fav-btn')), favText: q('.fav-btn') ? q('.fav-btn').textContent.trim() : '',
    favHasIcon: !!q('.fav-btn .app-icon'), favOn: !!(q('.fav-btn') && q('.fav-btn').classList.contains('on')),
    favIsFirst: (() => {
      const fav = q('.fav-btn'); if (!fav) return false
      const kids = [...fav.parentElement.children]
      return kids[0] === fav && fav.parentElement.classList.contains('row-actions')
    })(),
    favInRow: (() => {
      const fav = q('.fav-btn'); if (!fav) return false
      return fav.parentElement.classList.contains('row-actions')
    })(),
    artRadiusVar: (() => { const ap = q('.art-video-player'); return ap ? getComputedStyle(ap).getPropertyValue('--art-border-radius').trim() : '' })(),
    videoBg: (() => { const v = q('.player-box video'); return v ? getComputedStyle(v).backgroundColor : '' })(),
    detailBox: rect(q('.detail-btn')), detailText: q('.detail-btn') ? q('.detail-btn').textContent.trim() : '',
    detailHasIcon: !!q('.detail-btn .app-icon'),
    detailSameStyle: (() => {
      const a = q('.fav-btn'), b = q('.detail-btn'); if (!a || !b) return false
      const ca = getComputedStyle(a), cb = getComputedStyle(b)
      return ca.height === cb.height && ca.borderRadius === cb.borderRadius && ca.fontSize === cb.fontSize &&
        ca.paddingLeft === cb.paddingLeft && ca.backgroundImage === cb.backgroundImage
    })(),
    hasIconBtns: !!document.querySelector('.info-actions') || !!document.querySelector('.act-btn'),
    recThumbW: (() => { const t = q('.rec-item .thumb'); return t ? Math.round(t.getBoundingClientRect().width) : 0 })(),
    recTitleClamp: (() => { const t = q('.rec-item .rec-title'); return t ? (getComputedStyle(t).webkitLineClamp || '') : '' })(),
    recText: [...document.querySelectorAll('.rec-item')].slice(0, 3).map(e => e.textContent.replace(/\s+/g, ' ').trim()),
    // 推荐项文件名标签（2026-10-04）：数量 + 第一个带标签的项里标签行的位置
    recFileTagCount: document.querySelectorAll('.rec-item .file-tag').length,
    recTagsBetween: (() => {
      const info = q('.rec-item .rec-info'); if (!info) return false
      const kids = [...info.children].map(e => e.className)
      const ti = kids.findIndex(c => c === 'rec-title')
      const gi = kids.findIndex(c => c === 'rec-file-tags')
      const ai = kids.findIndex(c => c === 'rec-actors')
      if (gi < 0) return true   // 该项没有标签，不适用
      return ti >= 0 && ai >= 0 && ti < gi && gi < ai
    })(),
    recActorsBox: rect(q('.rec-item .rec-actors')),
    recWhyCount: document.querySelectorAll('.rec-item .rec-why').length,
    recActorsText: q('.rec-item .rec-actors') ? q('.rec-item .rec-actors').textContent.trim() : '',
    recHasPh: !!q('.rec-item .rec-ph'),
    recOrder: (() => {
      const info = q('.rec-item .rec-info')
      return info ? [...info.children].map(e => e.className) : []
    })(),
    recListBox: rect(q('.rec-list')),
    recColBox: rect(q('.rec-col')),
    mainColBox: rect(q('.main-col')),
    pageBox: rect(page),
    recListOverflow: q('.rec-list') ? getComputedStyle(q('.rec-list')).overflowY : '',
    recListClient: q('.rec-list') ? q('.rec-list').clientHeight : 0,
    recItemBoxes: [...document.querySelectorAll('.rec-item')].slice(0, 7).map(e => {
      const b = e.getBoundingClientRect(); return { t: Math.round(b.top * 100) / 100, b: Math.round(b.bottom * 100) / 100 }
    }),
    clientW: document.documentElement.clientWidth,
    videoPaused: (() => { const v = q('.player-box video'); return v ? v.paused : null })(),
    videoT: (() => { const v = q('.player-box video'); return v ? v.currentTime : -1 })(),
    videoReady: (() => { const v = q('.player-box video'); return v ? v.readyState : -1 })(),
    infoName: q('.info-name') ? q('.info-name').textContent.trim() : '',
    swapAnim: q('.actress-row') ? getComputedStyle(q('.actress-row')).animationName : '',
    hash: location.hash
  }
}

async function main() {
  console.log('===== 播放页 UI 验证（背景/番号/女优头像/标签/喜欢按钮）=====')
  // ★ 整库快照必须在**启动应用之前**取：应用一启动就会读库、退出时落盘，
  //   而下面进播放页/点喜欢都会改库。拿不到快照就直接抛错，绝不用真库硬跑。
  const snap = devdb.takeSnapshot('verify-player-ui', DEV_DB)
  // 点击测试会写 movies.cl → 先取原值（仅用于打印对照）
  const beforeCl = await withDb(db => {
    const r = db.exec(`SELECT cl FROM movies WHERE id=${ID_WITH_AVATAR}`)
    return r[0] ? r[0].values[0][0] : null
  })
  console.log('测试前 cl =', JSON.stringify(beforeCl))
  const appEnv = { ...process.env }
  delete appEnv.ELECTRON_RUN_AS_NODE; delete appEnv.NODE_PATH; delete appEnv.VITE_DEV_SERVER_URL
  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['--remote-debugging-port=' + PORT, '--window-position=-3200,-3200', '--window-size=1500,1250',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
      path.join(ROOT, 'scripts', 'probe-launch.js')],
    { cwd: ROOT, env: appEnv, stdio: 'ignore' })

  const jsErrors = []
  let ws = null
  try {
    const http = require('http')
    let targets = null
    for (let i = 0; i < 60; i++) {
      try {
        targets = await new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, r => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)))
        }).on('error', rej))
        if (targets && targets.length) break
      } catch { }
      await sleep(500)
    }
    if (!targets || !targets.length) { console.log('❌ 应用未启动'); process.exitCode = 1; return }

    ws = new WebSocket((targets.find(t => t.type === 'page') || targets[0]).webSocketDebuggerUrl)
    let mid = 0; const pend = new Map()
    const send = (m, p = {}, to = 60000) => new Promise((res, rej) => {
      const i = ++mid; pend.set(i, { res, rej })
      ws.send(JSON.stringify({ id: i, method: m, params: p }))
      setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('TO ' + m)) } }, to)
    })
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data)
      if (m.id && pend.has(m.id)) { pend.get(m.id).res(m.result); pend.delete(m.id); return }
      if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 240))
    })
    await new Promise(r => ws.addEventListener('open', r))
    await send('Page.enable'); await send('Runtime.enable')
    const raw = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error('page EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 240))
      return r.result.value
    }
    const runFn = (fn, ...args) => raw('(' + fn.toString() + ')(' + args.map(a => JSON.stringify(a)).join(',') + ')')

    for (let i = 0; i < 60; i++) { if (await raw('!!window.__dataDir')) break; await sleep(500) }
    await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1250, deviceScaleFactor: 1, mobile: false })
    await raw('location.hash = "#/play/' + ID_WITH_AVATAR + '"')

    // 等信息区渲染（影片行 + 分类配置到位后 .actress 才出现）
    let s = null
    for (let i = 0; i < 40; i++) {
      s = await runFn(pageUI)
      if (s.titlePhFirst && s.actText && s.recCount > 0) break
      await sleep(400)
    }
    console.log('页面信息区 =', JSON.stringify(s, null, 0).slice(0, 900))

    // U1 背景与全局底色一致（且必须是浅色主题的 #f6f5f2）
    ok('U1 播放页背景 = 全局底色（浅色）', s.bg === s.bodyBg && s.bg === 'rgb(246, 245, 242)', `page=${s.bg} body=${s.bodyBg}`)

    // U2 番号在标题前
    const sameRow = s.phBox && s.nameBox && Math.abs(s.phBox.t - s.nameBox.t) < 6
    ok('U2 番号在标题前方（DOM 首位 + 左侧 + 同行）',
      s.titlePhFirst && s.phBox && s.nameBox && s.phBox.l <= s.nameBox.l && sameRow,
      `ph="${s.phText}" x=${s.phBox && Math.round(s.phBox.l)} | title x=${s.nameBox && Math.round(s.nameBox.l)} | 同行=${sameRow}`)

    // U3 第一行标签 / 第二行 圆形头像 + 名字（头像 44px + 名字 17px）
    const circle = s.avBox && Math.abs(s.avBox.w - s.avBox.h) < 1 && s.avBox.w >= 20
    ok('U3 第二行：圆形头像（44px）+ 名字（放大可点击）',
      circle && s.avBox.w === 44 && s.acFontSize === '17px' && s.subBox && s.tagRowBox && s.subBox.t >= s.tagRowBox.b - 2 && !!s.acName,
      `avatar=${s.avBox && Math.round(s.avBox.w) + 'x' + Math.round(s.avBox.h)} radius=${s.avRadius} 名字字号=${s.acFontSize} 女优="${s.acName}"`)
    ok('U3b 行序：第一行标签、第二行女优',
      s.tagRowBox && s.subBox && s.tagRowBox.t < s.subBox.t && s.catBox && s.catBox.t >= s.tagRowBox.t - 1 && s.catBox.b <= s.tagRowBox.b + 1,
      `tagRow=${Math.round(s.tagRowBox && s.tagRowBox.t)}~${Math.round(s.tagRowBox && s.tagRowBox.b)} actressRow=${Math.round(s.subBox && s.subBox.t)}`)

    // U4 头像图真实加载
    ok('U4 头像图片加载成功（非破图）', s.avImgOk && s.avImgW > 0, `${s.avImgSrc}… naturalW=${s.avImgW} fallback=${s.fallback || '无'}`)

    // U6/U7 标签全部显示，三类排最前
    ok('U6 标签全部显示且三类排最前', JSON.stringify(s.cats) === JSON.stringify(EXPECT_ALL),
      `实际=${JSON.stringify(s.cats)} 期望=${JSON.stringify(EXPECT_ALL)}`)
    ok('U7 三类命中项排在最前（体型→行为→玩法 顺序）',
      JSON.stringify(s.cats.slice(0, EXPECT_KEY_FIRST.length)) === JSON.stringify(EXPECT_KEY_FIRST),
      `头部=${JSON.stringify(s.cats.slice(0, EXPECT_KEY_FIRST.length))}`)

    // U9 （2026-10-04 改）信息区评分已移除 → 改为文件名属性标签（id=10 的 py 是 ipx-247-C.mp4）
    ok('U9 信息区不再显示评分；「中文字幕」属性标签位于喜欢按钮左侧',
      !s.hasScore && s.fileTags.includes('中文字幕') && s.fileTagsInFavLeft,
      `fileTags=${JSON.stringify(s.fileTags)} 无评分=${!s.hasScore} 在喜欢左侧=${s.fileTagsInFavLeft}`)

    // U14 推荐栏：海报放大 / 标题 3 行 / 评分单独一行（与下方评分同色）/ 不再显示想看
    ok('U14a 推荐海报已放大（220px）', s.recThumbW === 220, `thumbW=${s.recThumbW}`)
    ok('U14b 推荐标题最多 3 行', String(s.recTitleClamp) === '3', `line-clamp=${s.recTitleClamp}`)
    // U14c （2026-10-04 改）推荐项不再显示评分；文件名属性标签位于标题与演员名之间
    const noWant = !s.recText.join(' ').includes('想看')
    ok('U14c 推荐项不再显示评分，属性标签位于标题与演员名之间',
      !s.recScoreExists && s.recFileTagCount >= 1 && s.recTagsBetween && noWant && s.recWhyCount === 0,
      `无评分=${!s.recScoreExists} 标签数=${s.recFileTagCount} 位置正确=${s.recTagsBetween} 无想看=${noWant}`)

    // U14d 层级：标题 →（属性标签）→ 演员名（番号不显示，看过人数也不显示；评分已移除）
    const orderOk = ['rec-title,rec-file-tags,rec-actors', 'rec-title,rec-actors'].includes(s.recOrder.join(','))
    const noWatched = !s.recText.join(' ').includes('看过')
    ok('U14d 推荐项：番号与看过人数都已隐藏，层级为 标题 →（属性标签）→ 演员名',
      !s.recHasPh && !!s.recActorsText && orderOk && noWatched,
      `演员="${s.recActorsText}" 层级=[${s.recOrder.join(' → ')}] 番号=${s.recHasPh} 无看过=${noWatched}`)

    // U16 滚动条贴窗口最右（与其它页面一致）
    ok('U16 推荐列表滚动条贴到窗口最右',
      s.recListBox && Math.abs(s.recListBox.r - s.clientW) <= 1 && s.recListOverflow === 'auto',
      `listRight=${Math.round(s.recListBox && s.recListBox.r)} clientW=${s.clientW} overflowY=${s.recListOverflow}`)

    // U19 播放器放大：右列 440→400（海报保持 220 不变）→ 左列播放器加宽（1500 宽视口下 1018→1062）
    ok('U19 播放器已放大（右列收窄、海报不变）',
      s.playerBox && s.playerBox.w >= 1055 && s.playerBox.h >= 590,
      `player=${Math.round(s.playerBox && s.playerBox.w)}x${Math.round(s.playerBox && s.playerBox.h)}`)

    // U20 右列铺满到底：列表底边压住右列底边，右列底边齐平页面内容底边 → 列表下方不留空白区
    const listFlush = s.recListBox && s.recColBox && Math.abs(s.recListBox.b - s.recColBox.b) <= 0.5
    const pageFlush = s.recColBox && s.pageBox && Math.abs(s.recColBox.b - s.pageBox.b) <= 1
    ok('U20 推荐列表铺满右列到底（列表底=右列底=页面内容底，下方无空白区）',
      listFlush && pageFlush,
      `listBottom=${Math.round(s.recListBox && s.recListBox.b)} colBottom=${Math.round(s.recColBox && s.recColBox.b)} pageContentBottom=${Math.round(s.pageBox && s.pageBox.b - 12)}`)

    // U24 （2026-10-04 改）女优行：单女优无 +N 截断；多位共演全部平铺（U24b 在 U8 之后）
    ok('U24a 单女优：无 +N 截断（旧的「首位 + N」展示已移除）',
      !s.hasAcMore && s.actressCount === 1,
      `actressCount=${s.actressCount} hasAcMore=${s.hasAcMore}`)

    // U21 盒子恒为严格 16:9（宽高比绝不跑偏 → 视频永远铺得满，四角不再有黑边楔）
    const ar = s.playerBox ? s.playerBox.w / s.playerBox.h : 0
    ok('U21 播放器盒子严格 16:9（±0.3%）', Math.abs(ar - 16 / 9) / (16 / 9) < 0.003,
      `AR=${Math.round(ar * 1000) / 1000} 目标=${Math.round(16 / 9 * 1000) / 1000}`)

    // U22 ArtPlayer 内部 UI 圆角变量 + 视频黑底（防切源白闪）
    ok('U22 ArtPlayer 内部圆角变量=10px、video 黑底',
      s.artRadiusVar === '10px' && s.videoBg === 'rgb(0, 0, 0)',
      `--art-border-radius=${s.artRadiusVar} videoBg=${s.videoBg}`)

    // U17 换片过渡动画已挂载（scoped style 会重命名 keyframes → 前缀匹配）
    ok('U17 信息区换片过渡动画已生效', String(s.swapAnim).startsWith('jt-swap-in'), `animationName=${s.swapAnim}`)

    // U13 喜欢按钮形态与位置（第一行标签行的最右）
    ok('U13a 标题后旧图标按钮已移除', !s.hasIconBtns, `hasIconBtns=${s.hasIconBtns}`)
    ok('U13b 喜欢按钮=图标+文字，位于标签行右侧按钮组', s.favHasIcon && /^(喜欢|已喜欢)$/.test(s.favText) && s.favInRow &&
      s.favBox && s.tagRowBox && s.favBox.r <= s.tagRowBox.r + 1,
      `text="${s.favText}" icon=${s.favHasIcon} 在按钮组=${s.favInRow} favRight=${Math.round(s.favBox.r)} tagRowRight=${Math.round(s.tagRowBox.r)}`)

    // U15 详情按钮（样式与喜欢按钮一致，点击进详情页）
    ok('U15a 详情按钮=图标+文字、样式与喜欢按钮一致、位于其右侧',
      s.detailHasIcon && s.detailText === '详情' && s.detailSameStyle &&
      s.detailBox && s.favBox && s.detailBox.l >= s.favBox.r - 1 && s.detailBox.r <= s.tagRowBox.r + 1,
      `text="${s.detailText}" icon=${s.detailHasIcon} 同款=${s.detailSameStyle} x=${Math.round(s.detailBox && s.detailBox.l)}≥${Math.round(s.favBox && s.favBox.r)} right=${Math.round(s.detailBox && s.detailBox.r)}`)

    // U13c 点击切换（点两次回到原状态）
    await raw('document.querySelector(".fav-btn").click()')
    let f1 = null
    for (let i = 0; i < 12; i++) { await sleep(200); f1 = await runFn(pageUI); if (f1.favOn) break }
    await raw('document.querySelector(".fav-btn").click()')
    let f2 = null
    for (let i = 0; i < 12; i++) { await sleep(200); f2 = await runFn(pageUI); if (!f2.favOn) break }
    ok('U13c 点击喜欢按钮切换状态（喜欢 ↔ 已喜欢）',
      !!f1 && f1.favOn && f1.favText === '已喜欢' && !!f2 && !f2.favOn && f2.favText === '喜欢',
      `点击后="${f1 && f1.favText}" → 回点后="${f2 && f2.favText}"`)

    // U11 标题行移到播放器上方
    ok('U11 标题行位于播放器上方', s.titleBox && s.playerBox && s.titleBox.b <= s.playerBox.t + 1 && s.titleBox.t >= s.headBox.t - 1,
      `标题底=${Math.round(s.titleBox.b)} 播放器顶=${Math.round(s.playerBox.t)} head高=${Math.round(s.headBox.h)}`)

    // U12 播放器顶边与第一张海报顶边对齐
    const dTop = s.thumbBox && s.playerBox ? Math.abs(s.thumbBox.t - s.playerBox.t) : 999
    ok('U12 播放器顶边 = 右侧第一张海报顶边', dTop <= 1.5 && Math.abs(s.headBox.h - s.recHeadBox.h) <= 1,
      `playerTop=${Math.round(s.playerBox.t)} thumbTop=${Math.round(s.thumbBox.t)} Δ=${dTop.toFixed(2)}px | headH ${Math.round(s.headBox.h)}/${Math.round(s.recHeadBox.h)}`)

    // U5 点击女优跳转
    const nameExpect = s.acName
    await raw('document.querySelector(".actress").click()')
    let hash = '', enc = encodeURIComponent(nameExpect)
    for (let i = 0; i < 20; i++) { await sleep(300); hash = await raw('location.hash'); if (hash.includes('/actor/')) break }
    ok('U5 点击女优头像/名字 → 进入女优影片页', hash === '#/actor/' + enc,
      `hash=${decodeURIComponent(hash.replace('#/actor/', ''))} 期望=${nameExpect}`)

    // U15b 详情按钮跳转（先回播放页，再点详情）
    await raw('location.hash = "#/play/' + ID_WITH_AVATAR + '"')
    for (let i = 0; i < 30; i++) { await sleep(300); if (await raw('!!document.querySelector(".detail-btn")')) break }
    await raw('document.querySelector(".detail-btn").click()')
    let hashD = ''
    for (let i = 0; i < 20; i++) { await sleep(300); hashD = await raw('location.hash'); if (hashD.indexOf('/detail/') >= 0) break }
    ok('U15b 点击详情按钮 → 进入该影片详情页', hashD === '#/detail/' + ID_WITH_AVATAR, `hash=${hashD}`)

    // U18 点击推荐影片：切到新片 → 播放窗口自动播放、信息同步更新
    await raw('location.hash = "#/play/' + ID_WITH_AVATAR + '"')
    for (let i = 0; i < 30; i++) { await sleep(300); if (await raw('document.querySelectorAll(".rec-item").length > 0')) break }
    const bS = await runFn(pageUI)
    await raw('document.querySelectorAll(".rec-item")[0].click()')
    let aS = null
    for (let i = 0; i < 40; i++) {
      await sleep(400)
      aS = await runFn(pageUI)
      if (aS.hash !== bS.hash && aS.videoReady >= 2) break
    }
    const tA = aS.videoT
    await sleep(1800)
    const aS2 = await runFn(pageUI)
    ok('U18 点击推荐影片：自动切到播放窗口播放 + 信息同步更新',
      aS.hash !== bS.hash && aS.infoName !== bS.infoName && !aS2.videoPaused && aS2.videoT > tA + 0.5,
      `hash ${bS.hash}→${aS.hash} | 标题${aS.infoName !== bS.infoName ? '已更新' : '未变'} | paused=${aS2.videoPaused} t ${tA.toFixed(1)}→${aS2.videoT.toFixed(1)}`)

    // U8 无头像影片 → 首字占位（不破图）
    await raw('location.hash = "#/play/' + ID_NO_AVATAR + '"')
    let s2 = null
    for (let i = 0; i < 30; i++) {
      s2 = await runFn(pageUI)
      if (s2.actText && s2.hash.indexOf('/play/' + ID_NO_AVATAR) >= 0) break
      await sleep(400)
    }
    console.log('无头像影片 =', JSON.stringify({ name: s2.acName, fallback: s2.fallback, hasImg: s2.hasImg, cats: s2.cats }))
    ok('U8 无头像影片显示首字占位（非破图）', !s2.hasImg && s2.fallback.length === 1 && s2.avBox && Math.abs(s2.avBox.w - s2.avBox.h) < 1,
      `fallback="${s2.fallback}" name="${s2.acName}" 圆形=${s2.avBox && Math.round(s2.avBox.w) + 'x' + Math.round(s2.avBox.h)}`)

    // U24b 多位女优共演：全部平铺显示（id=140 cast 有 9 位，断言取 >=3 防数据漂移）
    await raw('location.hash = "#/play/' + ID_MULTI_ACTRESS + '"')
    let s3 = null
    for (let i = 0; i < 30; i++) {
      s3 = await runFn(pageUI)
      if (s3.hash.indexOf('/play/' + ID_MULTI_ACTRESS) >= 0 && s3.actressCount > 0) break
      await sleep(400)
    }
    ok('U24b 多位女优共演全部平铺显示（无 +N 截断）',
      s3.actressCount >= MULTI_ACTRESS_MIN && !s3.hasAcMore,
      `actressCount=${s3.actressCount}（≥${MULTI_ACTRESS_MIN}）hasAcMore=${s3.hasAcMore}`)

    ok('U10 全程无未捕获页面异常', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '))
  } catch (e) {
    fail++
    console.log('  [FAIL] 探针异常: ' + e.message)
  } finally {
    try { ws && ws.close() } catch {}
    try { spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)]) } catch {}
    await sleep(1500)
    // ★ 整库还原到快照（不再只还原 movies.cl）
    //   进播放页会触发 recordPlay → play_count / play_time / play_pos 被改；只还原 cl
    //   会把这些播放记录留在库里。应用刚退出可能还在收尾落盘，故延迟 + 有界重试，
    //   还原不成功必须让脚本以非 0 退出，避免假绿。
    let restored = false
    for (let i = 0; i < 3 && !restored; i++) {
      try { devdb.restoreSnapshot(snap) } catch (e) { console.log('⚠️ 还原异常:', e.message) }
      await sleep(1200)
      try {
        const cur = fs.readFileSync(DEV_DB)
        restored = devdb.sha256(cur) === snap.sha
      } catch { }
      if (!restored) console.log(`   ⚠️ 第 ${i + 1} 次还原后被改写，重试…`)
    }
    if (!restored) {
      fail++
      console.log('❌ dev 库未还原到快照，请手工回滚：node scripts/devdb-restore.js ' + snap.path)
    }
  }

  console.log(`===== 结果：${pass} 通过 / ${fail} 失败 =====`)
  process.exitCode = fail ? 1 : 0
}

main()
