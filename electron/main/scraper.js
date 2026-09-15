/**
 * @file scraper.js
 * @module electron/main/scraper
 * @description 影片信息刮削模块。通过 HTTP 请求从 JAVDB、JAVBUS 等网站获取影片元数据（番号、标题、封面、
 *              演员、标签等），并支持封面图片下载到本地。基于 JavTag AS3 源码逻辑移植。
 * @dependencies ./net-curl (系统 curl 网络层), fs, path, url (URL)
 * @keyAPI curlGet()(net-curl.js), twToCn(), inteHandler(), scrapeMovie()
 */

// 引入 Electron 内置的 net 模块用于 HTTP 请求（支持 fetch API）
// 网络层改用系统 curl（见 net-curl.js 说明：Cloudflare 按 TLS 指纹放行 curl，
// 而 Electron net.fetch / Node https 的指纹被拦截）
const { curlGet, curlDownload, curlAvailable } = require('./net-curl')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')
// 封面目录名等共享常量（集中定义于 constants.js）
const { COVER_DIR } = require('./constants')

// 模拟浏览器请求的 User-Agent 字符串，避免被网站拦截
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

// 支持的刮削网站来源列表
const WEB_SOURCES = [
  { id: 1, name: 'JAVDB', url: 'https://javdb.com' },
  { id: 2, name: 'JAVBUS', url: 'https://www.javbus.com' },
  { id: 3, name: 'FC2PPVDB', url: 'https://fc2ppvdb.com' },
  { id: 4, name: 'AVSOX', url: 'https://avsox.click/cn' }
]

// 欧美分类路径缓存（首次抓取后复用；见 scrapeJavBus 中 type==='欧美' 分支）
let omPathCache = ''

// 繁体→简体字符映射表 (从 AS3 源码移植)
// TW_STR 和 CN_STR 中的字符一一对应，用于将繁体中文转换为简体中文
const TW_STR = '嘔觸蠻橫嬌處軌癢運動爛殘畫惡劇學姦雙騷擾戀癡侶亂倫藝獵豔組優総編時間謝訪問焼専專縦雑誌幫員亞講師鬥檢臉兒書輕車婦醫種職業賽場親蕩務遊戲級裝戰襪著貓緊體圍連褲識喪傭鏡蘿變無條貧為顏騎糞陰語飲濫槍宮頸輪異鴨腸監藥愛縛陽類別給觀眾屬價複質視紹馬賽經數國進稱攝餘寫獨製單爐門轉機薦頻設項係驗懺軟養換湯診貞鏈預覽圖實溫窺隸曬樂誼賦幹紋絕頂純歷濕護禮儀飛漢隊媽絲過飾莖腳兩約會後綁戶調脫導釘環輔鉤蠟燭碼綜選電紀錄險擬懸鍾與開奧龜紅訕捲髮緻紗膚漁網氣標題長發懷舊週暢銷騙綠採訪聞態對繪聖誕萬聖節歐頭藍個豐滿線勻翹號達傳臥側擴張疊帶膠襯點灘辦庫廳廚獄園圖館尋歡維繼閨續潤劑褻'
const CN_STR = '呕触蛮横娇处轨痒运动烂残画恶剧学奸双骚扰恋痴侣乱伦术猎艳组优总编时间谢访问烧专专纵杂志帮员亚讲师斗检脸儿书轻车妇医种职业赛场亲荡务游戏级装战袜着猫紧体围连裤识丧佣镜萝变无条贫为颜骑粪阴语饮滥枪宫颈轮异鸭肠监药爱缚阳类别给观众属价复质视绍马赛经数国进称摄余写独制单炉门转机荐频设项系验忏软养换汤诊贞链预览图实温窥隶晒乐谊赋干纹绝顶纯历湿护礼仪飞汉队妈丝过饰茎脚两约会后绑户调脱导钉环辅钩蜡烛码综选电纪录险拟悬钟与开奥龟红讪卷发致纱肤鱼网气标题长发怀旧周畅销骗绿采访闻态对绘圣诞万圣节欧头蓝个丰满线匀翘号达传卧侧扩张叠带胶衬点滩办库厅厨狱园图馆寻欢维继闺续润剂亵'

// 繁→简查找表（模块加载时构建一次）。
// 原实现在 twToCn 里对每个字符执行 TW_STR.indexOf(ch) —— TW_STR 约 450 字，
// 等于每次转换都做全表扫描；改为 Map 后单字符查找 O(1)。
const TW_CN_MAP = (() => {
  const m = new Map()
  for (let i = 0; i < TW_STR.length; i++) m.set(TW_STR[i], CN_STR[i])
  return m
})()

/**
 * 繁体中文转简体中文（查 TW_CN_MAP）。
 * @param {string} str - 待转换的繁体字符串
 * @returns {string} 转换后的简体字符串
 */
function twToCn(str) {
  let result = ''
  for (const ch of str) {
    result += TW_CN_MAP.get(ch) || ch
  }
  return result
}

/**
 * 删除字符串中的多余空白字符。
 * 移除换行符和制表符，将多个连续空格压缩为单个空格。
 * @param {string} str - 待处理的字符串
 * @returns {string} 处理后的字符串
 */
function deleteSpace(str) {
  return str.replace(/[\r\n\t]+/gim, '').replace(/ +/g, ' ')
}

/**
 * 通用 HTML 内容提取器（从 AS3 源码移植）。
 * 在原始字符串中查找起始标记和结束标记之间的内容，并根据参数控制提取范围和清理。
 * @param {string} orStr - 原始字符串（HTML）
 * @param {string} staStr - 起始标记
 * @param {string} endStr - 结束标记
 * @param {number[]} arr - 选项数组 [startMode, endMode, stripTags]
 *   arr[0]: 0=从起始标记之后开始提取, 非0=从起始标记位置开始提取（含标记）
 *   arr[1]: 0=提取到结束标记之前, 1=提取到结束标记之后（含标记）
 *   arr[2]: 1=移除提取结果中的 HTML 标签, 0=保留标签
 * @returns {string} 提取并处理后的字符串
 */
function inteHandler(orStr, staStr, endStr, arr) {
  const sInd = orStr.indexOf(staStr)
  if (sInd === -1) return ''  // 未找到起始标记，返回空
  const eInd = orStr.indexOf(endStr, sInd + staStr.length)
  const end = eInd === -1 ? orStr.length : eInd
  const start = arr[0] === 0 ? sInd + staStr.length : sInd
  let newStr = orStr.slice(start, arr[1] === 1 ? end + endStr.length : end)
  // 如果 arr[2] 为 1，移除所有 HTML 标签
  if (arr[2] === 1) newStr = newStr.replace(/<[^>]+>/g, '')
  return newStr
}

/**
 * JAVDB 拦截识别（2026-09-13，判定逻辑参考 mdcx）：把 Cloudflare 5 秒盾 /
 * IP 封禁 / 版权限制三类拦截转为可操作的中文错误，避免用户只看到 HTTP 403。
 * @param {string} html - 响应 HTML
 * @param {string} url - 请求地址（便于用户核对）
 * @param {boolean} hasCookie - 本次请求是否携带了用户配置的 Cookie
 * @throws {Error} 命中拦截特征时抛出（调用方 catch 后作为刮削失败原因返回 UI）
 */
function assertJavdbNotBlocked(html, url, hasCookie) {
  if (html.includes('The owner of this website has banned your access based')) {
    throw new Error(`JAVDB 因请求过多临时封禁了当前 IP，请稍后重试或更换代理节点（${url}）`)
  }
  if (html.includes('Due to copyright restrictions')) {
    throw new Error('JAVDB 禁止日本 IP 访问，请将代理节点切换到日本以外的地区')
  }
  if (html.includes('ray-id') || html.includes('Just a moment')) {
    throw new Error(hasCookie
      ? 'JAVDB 被 Cloudflare 拦截：设置中的 JAVDB Cookie 已失效，请重新登录 javdb.com 复制新 Cookie'
      : 'JAVDB 被 Cloudflare 拦截（5 秒盾）：请在 设置 → 刮削 中填入 JAVDB Cookie')
  }
}

// 请求限速（2026-09-13，思路参考 amane 的 RateLimiters）：
// 同一 host 的连续请求保持最小间隔——突发请求极易触发站点反爬
// （JAVDB 的 Cloudflare 会直接 403）。批量刮削会连续命中同一站点，
// 因此按 host 维护「上次请求时间」，不足最小间隔则等待补足。
// 注：本块曾因脚本批量替换区间时被误删，导致运行时 throttleByHost is not defined——
//     改动本文件后建议执行 scripts/check-undefined.js 做未定义引用检查。
const lastReqAt = new Map()   // host → 上次请求时间戳
const MIN_REQ_INTERVAL = 400  // 同 host 最小请求间隔（毫秒，约 2.5 req/s）

/**
 * 按 host 限速：距上次请求不足 MIN_REQ_INTERVAL 则等待补足。
 * @param {string} url - 即将请求的地址
 */
async function throttleByHost(url) {
  let host = ''
  try { host = new URL(url).host } catch { return }
  const wait = MIN_REQ_INTERVAL - (Date.now() - (lastReqAt.get(host) || 0))
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastReqAt.set(host, Date.now())
}

async function fetchHtml(url, { referer, cookie, proxy } = {}) {
  await throttleByHost(url)  // 同 host 限速（防突发触发反爬）
  // 系统 curl 不可用时给出明确错误（刮削依赖 curl 的 TLS 指纹，见 net-curl.js）
  if (!(await curlAvailable())) {
    throw new Error('未找到系统 curl（Windows 10 1803+ 自带），无法请求刮削站点')
  }
  const r = await curlGet(url, { proxy, cookie, referer, timeout: 30000 })
  if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`)
  return r.html
}

/**
 * 下载图片并保存到本地文件（经系统 curl，默认直连不走代理）。
 *
 * 实测：DMM 图床（awsimgsrc/pics.dmm.co.jp）直连 200、经代理连接失败；
 * 且 Electron 直连会 ERR_CONNECTION_CLOSED，故统一走 curl 直连。
 * @param {string} url - 图片的 URL
 * @param {string} savePath - 本地保存路径
 * @param {string} [referer] - 请求来源页（部分图床校验 Referer）
 * @returns {Promise<string>} 保存成功后返回保存路径
 * @throws {Error} 下载失败时抛出异常
 */
async function downloadImage(url, savePath, referer, proxy) {
  // 图床与主站的网络路径不同，按域名决定优先级，另一种方式兜底：
  //   - 刮削主站自家图片（javbus/javdb 的 /pics/...）→ 走代理优先（主站本身需代理）
  //   - 第三方图床（DMM 等，样本图常用）→ 直连优先（经代理连接失败）
  const isMainSite = /javbus\.com|javdb\.com/i.test(url)
  const tries = isMainSite ? [proxy, ''] : ['', proxy]
  let last = null
  for (const px of tries) {
    const r = await curlDownload(url, savePath, { referer, proxy: px || undefined, timeout: 30000 })
    if (r.ok) return savePath
    last = r
  }
  console.warn(`[scrape] 图片下载失败(两种方式均失败) status=${last?.status} size=${last?.size} err=${last?.error} url=${url.slice(0, 70)}`)
  throw new Error(last?.error || '图片下载失败')
}

async function scrapeJavBus(ph, type, opts = {}) {
  const proxy = opts.proxy || ''
  const baseUrl = 'https://www.javbus.com'
  let targetUrl

  if (type === '欧美') {
    // 欧美分类路径（首页那个隐藏 li 里的分类链接）。
    // 该路径是站点固定的分类地址，不是动态令牌 —— 因此只在首次请求一次并缓存，
    // 避免每部欧美影片都白拉一次完整首页（数百 KB + 限速等待）。
    if (!omPathCache) {
      const homeHtml = await fetchHtml(baseUrl, { proxy })
      const omUrl = inteHandler(deleteSpace(homeHtml), '<li class="hidden-md hidden-sm">', '</li>', [0, 0, 0])
      let omPath = inteHandler(omUrl, '<a href="', '">', [0, 0, 0])
      // 路径处理：去除首尾斜杠，将 org 替换为 hair
      omPath = omPath.replace(/^\/+|\/+$/g, '').replace('org', 'hair')
      omPathCache = omPath
    }
    targetUrl = omPathCache + '/' + ph.replace(/\./g, '-')
  } else {
    // 非欧美影片直接拼接番号
    targetUrl = baseUrl + '/' + ph
  }

  // 请求影片详情页 HTML
  const html = await fetchHtml(targetUrl, { referer: baseUrl, proxy })
  const data = deleteSpace(html)

  // 提取封面图片 URL
  let cover = inteHandler(data, '<div class="col-md-9 screencap">', '</div>', [0, 0, 0])
  cover = inteHandler(cover, 'src="', '"', [0, 0, 0])
  if (cover && !cover.startsWith('http')) cover = baseUrl + cover  // 补全相对路径
  if (!cover) return null

  // 提取分类（有码/无码/欧美）
  let fl = inteHandler(data, '<li class="active">', '</li>', [1, 1, 1])
  fl = twToCn(fl)  // 繁体转简体

  // 提取番号
  let phCode = inteHandler(data, '<span class="header">識別碼:</span>', '</span>', [0, 1, 1])
  phCode = phCode.trim()
  if (!phCode) return null

  // 提取片名（移除番号前缀）
  let pm = inteHandler(data, '<h3>', '</h3>', [0, 0, 0])
  pm = pm.replace(phCode, '').trim()

  // 提取发行日期
  let fxrq = inteHandler(data, '<span class="header">發行日期:</span>', '</p>', [0, 0, 0]).trim()
  // 提取时长并转换为秒（原页面显示为"分鐘"单位）

  // 提取导演
  let dy = inteHandler(data, '<span class="header">導演:</span>', '</a>', [0, 1, 1]).trim()
  // 提取制作商
  let ps = inteHandler(data, '<span class="header">製作商:</span>', '</a>', [0, 1, 1]).trim()
  // 提取发行商
  let fx = inteHandler(data, '<span class="header">發行商:</span>', '</a>', [0, 1, 1]).trim()
  // 提取系列
  let xl = inteHandler(data, '<span class="header">系列:</span>', '</a>', [0, 1, 1]).trim()

  // 提取演员列表（2026-09-14 增强：从 #avatar-waterfall 区块同时取头像与演员页链接）
  // 结构：<a class="avatar-box" href="/star/xxx"><div class="photo-frame"><img src="/pics/actress/xxx_a.jpg" title="名字"></div><span>名字</span></a>
  let yy = ''
  const cast = []   // [{ name, gender, avatar, star }]
  // 检查是否有演员信息（排除"暂无出演者信息"的情况）
  const hasCast = data.indexOf('暫無出演者資訊') === -1 && data.indexOf('暂无出演者信息') === -1
  if (hasCast) {
    const castRe = /<a class="avatar-box"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    let cm
    while ((cm = castRe.exec(data)) !== null) {
      const star = cm[1]
      const inner = cm[2]
      const avM = inner.match(/<img[^>]*src="([^"]+)"/)
      const nmM = inner.match(/title="([^"]+)"/) || inner.match(/<span>([^<]+)<\/span>/)
      const name = nmM ? nmM[1].trim() : ''
      if (!name) continue
      let avatar = avM ? avM[1] : ''
      if (avatar && !avatar.startsWith('http')) avatar = baseUrl + avatar
      cast.push({ name, gender: 'f', avatar, star })
      yy = yy ? yy + '，' + name : name
    }
    // 兼容旧结构（无 avatar-waterfall 时仅取名字，无头像）
    if (!cast.length) {
      let castHtml = inteHandler(data, '<span class="header" style="cursor: pointer;">演員</span>', '</ul>', [0, 1, 0])
      if (!castHtml) castHtml = inteHandler(data, '<span class="header">演員</span>', '</ul>', [0, 1, 0])
      if (!castHtml) castHtml = inteHandler(data, '演員', '</ul>', [0, 1, 0])
      castHtml = inteHandler(castHtml, '<li>', '</ul>', [0, 0, 0])
      const castArr = castHtml.split('</li>')
      castArr.pop()
      for (const c of castArr) {
        const name = inteHandler(c, 'title="', '"', [0, 0, 0])
        if (name) { yy = yy ? yy + '，' + name : name; cast.push({ name, gender: 'f', avatar: '', star: '' }) }
      }
    }
  }

  // 提取标签（类别）
  let bq = ''
  const tagEnd = fl === '欧美' ? '演員' : '多選提交'
  let tagHtml = inteHandler(data, '<p class="header">類別:', tagEnd, [0, 1, 0])
  tagHtml = inteHandler(tagHtml, '<span class="genre">', tagEnd, [0, 0, 0])
  const tagArr = tagHtml.split('<span class="genre">')
  tagArr.pop()
  for (const t of tagArr) {
    const tag = inteHandler(t, '<a href=', '</a>', [1, 1, 1])
    if (tag) bq = bq ? bq + '，' + tag : tag
  }
  bq = twToCn(bq)  // 繁体标签转简体

  // 提取时长（分钟，2026-09-09 新增）
  // 2026-09-13 修正：实测 JAVBUS 页面该字段为 <span class="header">長度:</span>
  // （原实现用 <p class="header"> 恒失配，导致详情页时长永远取不到值）
  const lenStr = inteHandler(data, '<span class="header">長度:</span>', '</p>', [0, 1, 0])
  const lenM = lenStr.match(/(\d+)/)
  const duration = lenM ? Number(lenM[1]) : 0

  // 提取预览图（样本图）大图 URL 列表（2026-09-09 新增）
  // JAVBUS 详情页 sample-waterfall 区块结构：<a class="sample-box" href="大图URL"><img src="缩略图"></a>
  const previews = []
  const previewSet = new Set()   // 去重用（原 includes 为线性查找）
  const sampleRe = /class="sample-box"[^>]*href="([^"]+)"/g
  let sm
  while ((sm = sampleRe.exec(data)) !== null) {
    const url = sm[1]
    if (url && url.startsWith('http') && !previewSet.has(url)) { previewSet.add(url); previews.push(url) }
  }

  return { ph: phCode, pm, fl, fxrq, dy, ps, fx, xl, yy, bq, cover, duration, previews, cast, source: 'JAVBUS' }
}

/**
 * 从 JAVDB 网站刮削影片信息。
 * 先通过搜索页面查找匹配的影片，再进入详情页提取信息。
 * @param {string} ph - 影片番号
 * @param {string} type - 影片类型（'欧美' 或其他）
 * @param {Object} [opts] - 可选参数
 * @param {boolean} [opts.fetchStats=true] - 是否提取想看/看过人数与评分
 * @returns {Promise<Object|null>} 影片信息对象，与 scrapeJavBus 返回结构类似，额外包含
 *   vr(是否VR)、previews(预览图URL数组)、want/watched(想看/看过人数)、score(评分) 字段
 */
async function scrapeJavDb(ph, type, opts = {}) {
  const fetchStats = opts.fetchStats !== false  // 默认开启
  // 用户配置的 JAVDB Cookie（绕 Cloudflare 5 秒盾；见设置 → 刮削）
  const userCookie = opts.cookie || ''
  const baseUrl = 'https://javdb.com'
  // 构建搜索 URL，对番号进行 URL 编码
  const searchUrl = `${baseUrl}/search?q=${encodeURIComponent(ph)}&f=all`

  const proxy = opts.proxy || ''
  // 请求搜索结果页面（curl 携带用户 Cookie；无 Cookie 时 curl 亦可访问）
  const searchHtml = await fetchHtml(searchUrl, { referer: baseUrl, cookie: userCookie || undefined, proxy })
  assertJavdbNotBlocked(searchHtml, searchUrl, !!userCookie)
  let data = deleteSpace(searchHtml)

  // 提取搜索结果列表
  let resultsHtml = inteHandler(data, '<div class="item">', '</section>', [0, 0, 0])
  if (!resultsHtml) return null

  // 遍历搜索结果项，查找匹配的影片
  const items = resultsHtml.split('<div class="item">')
  let detailUrl = ''
  for (const item of items) {
    if (type === '欧美') {
      // 欧美番号格式特殊（如 XX.01.01.01），需特殊匹配逻辑
      const pattern = /\d{2}\.\d{2}\.\d{2}/
      const tPh = ph.replace(/ /g, '')
      const match = tPh.match(pattern)
      if (match) {
        const nStr = match[0].replace(/\./g, '-')
        const sStr = tPh.split('.' + match[0]).join('')
        // 同时匹配日期部分和前缀部分
        if (item.toUpperCase().includes(nStr.toUpperCase()) && item.toUpperCase().includes(sStr.toUpperCase())) {
          detailUrl = inteHandler(item, '<a href="', '"', [0, 0, 0])
          break
        }
      }
    } else {
      // 非欧美番号直接匹配
      if (item.toUpperCase().includes(ph.toUpperCase())) {
        detailUrl = inteHandler(item, '<a href="', '"', [0, 0, 0])
        break
      }
    }
  }

  if (!detailUrl) return null
  // 拼接完整详情页 URL
  const fullDetailUrl = baseUrl + detailUrl
  // 请求详情页 HTML
  const detailHtml = await fetchHtml(fullDetailUrl, { referer: searchUrl, cookie: userCookie || undefined, proxy })
  assertJavdbNotBlocked(detailHtml, fullDetailUrl, !!userCookie)
  data = deleteSpace(detailHtml)

  // 提取详情区块
  let detail = inteHandler(data, '<div class="video-detail" data-controller="movie-detail">', '<div class="modal magnet-help-modal" id="magnet-help-modal">', [0, 0, 0])
  if (!detail) return null

  // 提取番号
  let phCode = inteHandler(detail, '<strong>', '</strong>', [0, 0, 0])
  let fl
  if (type === '欧美') {
    fl = '欧美'
  } else if (phCode.indexOf('無碼') !== -1) {
    // 包含"無碼"标记则为无码
    fl = '无码'
    phCode = phCode.replace('無碼', '')
  } else {
    fl = '有码'
  }
  phCode = phCode.trim()

  // 提取片名：优先使用原标题（如果有"顯示原標題"按钮），否则使用当前标题
  let pm = ''
  if (data.indexOf('顯示原標題') !== -1) {
    pm = inteHandler(detail, '<span style="display: none" class="origin-title">', '</span>', [0, 0, 0])
  } else {
    pm = inteHandler(detail, '<strong class="current-title">', '</strong>', [0, 0, 0])
  }
  pm = pm.trim()

  // 判断是否为 VR 影片
  const vr = /【VR】|\[VR\]/.test(pm) ? 'y' : 'n'
  // 提取发行日期
  let fxrq = inteHandler(inteHandler(detail, '<strong>日期:</strong>', '</div>', [0, 0, 0]), '<span class="value">', '</span>', [0, 0, 0])
  // 提取时长并转换为秒

  // 提取导演
  let dy = inteHandler(inteHandler(detail, '<strong>導演:</strong>', '</div>', [0, 0, 0]), '<span class="value">', '</span>', [0, 0, 1])
  // 提取片商
  let ps = inteHandler(inteHandler(detail, '<strong>片商:</strong>', '</div>', [0, 0, 0]), '<span class="value">', '</span>', [0, 0, 1])
  // 提取发行
  let fx = inteHandler(inteHandler(detail, '<strong>發行:</strong>', '</div>', [0, 0, 0]), '<span class="value">', '</span>', [0, 0, 1])
  // 提取系列
  let xl = inteHandler(inteHandler(detail, '<strong>系列:</strong>', '</div>', [0, 0, 0]), '<span class="value">', '</span>', [0, 0, 1])

  // 提取演员列表（2026-09-14，仅女优）：
  //   新版 JAVDB 结构 <span class="value"><a class="actor-female" href="/actors/xxx">女优名</a>,
  //   <a href="/actors/yyy">男优名</a>, ...</span>：女优带 class="actor-female"，
  //   其余为男优（本次需求不做男优，直接跳过）；兼容旧版 ♀ 符号写法。
  let yy = ''
  const cast = []
  let castContainer = inteHandler(detail, '<strong>演員:</strong>', '</div>', [0, 0, 0])
  let castHtml = inteHandler(castContainer, '<span class="value">', '</span>', [0, 0, 0])
  if (castHtml) {
    const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/g
    let am
    while ((am = aRe.exec(castHtml)) !== null) {
      const attrs = am[1]
      const rawName = am[2].replace(/<[^>]+>/g, '').trim()
      const name = rawName.replace(/[♀♂]/g, '').trim()
      if (!name) continue
      const female = /actor-female/.test(attrs) || rawName.indexOf('♀') !== -1
      if (!female) continue   // 仅女优
      yy = yy ? yy + '，' + name : name
      cast.push({ name, gender: 'f', avatar: '', star: '' })  // JAVDB 详情页无头像
    }
  }

  // 提取标签（类别）
  let bq = ''
  let tagHtml = inteHandler(inteHandler(detail, '<strong>類別:</strong>', '</div>', [0, 0, 0]), '<span class="value">', '</span>', [0, 0, 0])
  let tagArr = tagHtml.split(',&nbsp;')  // 标签之间用 ,&nbsp; 分隔
  for (const t of tagArr) {
    const tag = t.replace(/<[^>]+>/g, '').trim()
    if (tag) bq = bq ? bq + '，' + tag : tag
  }
  bq = twToCn(bq)  // 繁体标签转简体

  // 提取封面图片 URL
  let cover = inteHandler(inteHandler(detail, '<div class="video-meta-panel">', '</div>', [0, 0, 0]), '<img src="', '"', [0, 0, 0])
  if (cover && !cover.startsWith('http')) cover = baseUrl + cover  // 补全相对路径

  // 提取时长（分钟，2026-09-09 新增）：JAVDB「時長:」字段，如 "120 分鐘"
  let duration = 0
  const lenStr = inteHandler(detail, '<strong>時長:</strong>', '</div>', [0, 0, 0])
  const lenM = lenStr.match(/(\d+)/)
  if (lenM) duration = Number(lenM[1])

  // 提取预览图 URL 列表（2026-09-09 新增；2026-09-13 兼容新版页面结构）
  // 实测 JAVDB 现行页面为：<div class="tile-images preview-images">…<img src="https://...jpg">
  // （旧实现只找 '<div class="preview-images">'，页面加 tile-images 类后恒失配 → 预览图恒空）
  const previews = []
  const previewSet = new Set()   // 去重用（原 includes 为线性查找）
  let previewBlock = inteHandler(data, 'class="tile-images preview-images"', '</div>', [0, 0, 0])
  if (!previewBlock) previewBlock = inteHandler(data, '<div class="preview-images">', '</div>', [0, 0, 0])
  if (previewBlock) {
    const imgRe = /<img[^>]*src="([^"]+)"/g
    let im
    while ((im = imgRe.exec(previewBlock)) !== null) {
      const url = im[1]
      if (url && url.startsWith('http') && !previewSet.has(url)) { previewSet.add(url); previews.push(url) }
    }
  }

  // 提取想看/看过人数与评分（2026-09-09 新增；2026-09-13 按 JAVDB 现行页面结构修正）
  // 实测页面结构（2026-09-13 联网验证）：
  //   想看/看过人数：纯文本节点「10245人想看」「3323人看過」
  //   评分：在「評分:」字段块内 —— <strong>評分:</strong><span class="value">
  //         <span class="score-stars">★…</span> 4.51分, 由3323人評價</span>
  //   注：旧结构的 nav-separated-title/value 与 score-average 类名已被 JAVDB 废弃，
  //       导致此前提取恒为空值（表现为「想看/看过/评分永远为空」）
  let want = '', watched = '', score = ''
  if (opts.fetchStats) {
    // 想看人数：「N人想看」（兼容千分位逗号）
    const wantM = data.match(/([\d,]+)\s*人\s*想(?:要)?看/)
    if (wantM) want = wantM[1].replace(/,/g, '')
    // 看过人数：「N人看過」（繁体页面）
    const watchM = data.match(/([\d,]+)\s*人\s*看[过過]/)
    if (watchM) watched = watchM[1].replace(/,/g, '')
    // 评分：「評分:」字段块内的「4.51分」形式（避免误取评价人数）
    const ratingBlock = inteHandler(detail, '<strong>評分:</strong>', '</div>', [0, 0, 0])
    const scoreM = ratingBlock.match(/([\d.]+)\s*分/)
    if (scoreM) score = scoreM[1]
  }

  return { ph: phCode, pm, fl, fxrq, dy, ps, fx, xl, yy, bq, cover, vr, duration, previews, want, watched, score, cast, source: 'JAVDB' }
}

/**
 * 根据番号格式判断影片类型。
 * @param {string} ph - 影片番号
 * @returns {string} 类型：'FC2'、'欧美' 或 '有码'
 */
function getMovieType(ph) {
  const upper = ph.toUpperCase()
  if (/^FC2/i.test(upper) || upper.startsWith('PPV')) return 'FC2'        // FC2-PPV 番号
  if (/\d{2}\.\d{2}\.\d{2}/.test(upper)) return '欧美'                      // 欧美番号格式（含日期）
  if (/^[A-Z]{2,5}-?\d{3,5}$/i.test(upper)) return '有码'                   // 标准有码番号格式（字母+数字）
  return '有码'  // 默认视为有码
}

/**
 * 根据影片类型自动选择刮削来源（优先级排序）。
 * @param {string} type - 影片类型
 * @returns {number[]} 来源 ID 数组，按优先级排序
 */
function autoSelectSources(type) {
  // 注意：WEB_SOURCES 里声明了 FC2PPVDB(3) 和 AVSOX(4)，但 scrapeMovie 中
  // 目前只实现了 JAVDB(1) 和 JAVBUS(2) 两个来源的刮削逻辑。
  // FC2 番号在 JAVBUS / JAVDB 上同样可查，因此这里让 FC2 走 JAVBUS + JAVDB，
  // 避免走未实现的 FC2PPVDB 导致 FC2 影片永远刮削失败。
  if (type === 'FC2') return [2, 1]       // FC2 类型：JAVBUS 优先，JAVDB 兜底
  if (type === '欧美') return [1]          // 欧美类型优先使用 JAVDB
  return [2, 1]                            // 有码类型优先 JAVBUS，其次 JAVDB
}

/**
 * 应用标签映射（2026-09-09 新增，配合设置页「标签映射」功能）。
 * 刮削获得的标签逐个与映射表对照：命中原标签则替换为新标签
 * （新标签为空字符串表示删除该标签），最后去重。
 * @param {string} bq - 中文逗号分隔的标签串
 * @param {Array[]} mapping - 映射规则数组 [[原标签, 新标签], ...]
 * @returns {string} 替换后的标签串
 */
function applyTagMapping(bq, mapping) {
  if (!bq || !Array.isArray(mapping) || !mapping.length) return bq
  const map = new Map()
  for (const pair of mapping) {
    if (Array.isArray(pair) && pair[0]) map.set(String(pair[0]).trim(), String(pair[1] ?? '').trim())
  }
  if (!map.size) return bq
  const out = []
  for (const raw of String(bq).split('，')) {
    const tag = raw.trim()
    if (!tag) continue
    const nt = map.has(tag) ? map.get(tag) : tag
    if (nt && !out.includes(nt)) out.push(nt)
  }
  return out.join('，')
}

/**
 * 影片刮削主入口函数。
 * 根据番号和指定的来源，从相应网站获取影片信息，并下载封面图片到本地。
 * @param {string} ph - 影片番号
 * @param {Object} [opts] - 可选参数
 * @param {string} [opts.source='auto'] - 刮削来源：'auto'（JAVBUS 优先 JAVDB 兜底，
 *   欧美仅 JAVDB）/ 'javbus'（仅 JAVBUS）/ 'javdb'（仅 JAVDB），大小写不敏感
 * @param {string} [opts.coverDir=COVER_DIR] - 封面图片保存的子目录名
 * @param {string} [opts.dataDir=''] - 数据根目录路径
 * @param {boolean} [opts.downloadPreviews=false] - 是否下载预览图到本地
 * @param {number} [opts.previewCount=0] - 预览图下载数量上限（0 = 全部下载）
 * @param {boolean} [opts.fetchStats=true] - 是否提取想看/看过人数与评分（仅 JAVDB 有效）
 * @param {Array[]} [opts.tagMapping=[]] - 标签映射规则 [[原标签,新标签],...]，刮削后自动替换
 * @returns {Promise<Object>} 结果对象 { ok: boolean, data?: Object, source?: string, error?: string }
 *   data.previews 在开启下载时为本地相对路径数组，未开启时该字段被移除（不入库远程 URL）
 */
async function scrapeMovie(ph, {
  source = 'auto', coverDir = COVER_DIR, dataDir = '',
  downloadPreviews = false, previewCount = 0, fetchStats = true, tagMapping = [],
  javdbCookie = '', proxy = ''
} = {}) {
  const cleanPh = ph.trim()
  if (!cleanPh) return { ok: false, error: '番号不能为空' }

  // 判断影片类型
  const type = getMovieType(cleanPh)
  let sourceIds

  // 来源归一：兼容 'auto'/'javbus'/'javdb' 与旧 'JAVDB'/'JAVBUS' 写法
  const srcName = String(source || 'auto').toUpperCase()
  if (srcName === 'AUTO') {
    // 自动模式：根据类型选择来源
    sourceIds = autoSelectSources(type)
  } else {
    // 指定来源模式：仅使用该来源，失败不 fallback
    const found = WEB_SOURCES.find(s => s.name.toUpperCase() === srcName)
    if (found) sourceIds = [found.id]
    else return { ok: false, error: '未知的刮削来源' }
  }

  // 按优先级依次尝试各个来源
  let lastError = ''
  for (const sid of sourceIds) {
    const src = WEB_SOURCES.find(s => s.id === sid)
    if (!src) continue
    try {
      let result = null
      // 根据来源名称调用对应的刮削函数
      if (src.name === 'JAVDB') {
        result = await scrapeJavDb(cleanPh, type, { fetchStats, cookie: javdbCookie, proxy })
      } else if (src.name === 'JAVBUS') {
        result = await scrapeJavBus(cleanPh, type, { proxy })
      }
      // 诊断日志：便于定位「某源请求失败/解析失配」类问题（此前 catch 静默导致无从排查）
      console.log(`[scrape] ${cleanPh} ← ${src.name}: ${result ? 'ok' : 'null(未匹配)'}`)
      if (result) {
        // 跨源兜底补全（2026-09-13）：auto/默认模式按 JAVBUS → JAVDB 顺序，
        // 第一个成功的源整体返回，不再自动补其他字段。而 JAVBUS 缺少
        // 想看/看过/评分（站点无评分体系）与 vr 字段，其预览图/时长也可能缺失。
        // 因此 JAVBUS 命中后，若需要 JAVDB 独有数据（统计或预览图任一开启），
        // 静默补抓一次 JAVDB，用其非空值填补 JAVBUS 结果的空字段。
        // 失败忽略——不影响主体数据与刮削结果。
        if (src.name === 'JAVBUS' && (fetchStats || downloadPreviews)) {
          try {
            const jd = await scrapeJavDb(cleanPh, type, { fetchStats, cookie: javdbCookie, proxy })
            console.log(`[scrape] ${cleanPh} ← JAVDB补全: ${jd ? `ok want=${jd.want || 0} watched=${jd.watched || 0} score=${jd.score || 0} previews=${(jd.previews || []).length}` : 'null(未匹配)'}`)
            if (jd) {
              // 标量字段兜底：仅填补 JAVBUS 结果中的空值
              for (const k of ['pm', 'fl', 'fxrq', 'dy', 'ps', 'fx', 'xl', 'yy', 'bq', 'cover', 'vr', 'duration']) {
                if (!result[k] && jd[k]) result[k] = jd[k]
              }
              // 预览图：JAVBUS 无样本图时用 JAVDB 的
              if (!(result.previews || []).length && (jd.previews || []).length) {
                result.previews = jd.previews
              }
              // 统计：JAVDB 专有（JAVBUS 站点无评分体系）
              if (jd.want) result.want = jd.want
              if (jd.watched) result.watched = jd.watched
              if (jd.score) result.score = jd.score
            }
          } catch (e) { console.warn(`[scrape] ${cleanPh} ← JAVDB补全失败: ${e.message}`) }
        }
        // 如果有封面图且指定了数据目录，下载封面到本地
        // 按源指定图片 Referer（部分图床校验来源页；参考 mdcx 的按源 Referer 策略）
      const imgReferer = src.name === 'JAVBUS' ? 'https://www.javbus.com/'
        : src.name === 'JAVDB' ? 'https://javdb.com/' : ''
      if (result.cover && dataDir) {
          const coversDir = path.join(dataDir, coverDir || COVER_DIR)
          if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true })
          // 从 URL 提取图片扩展名
          const ext = result.cover.match(/\.(jpg|jpeg|png|webp|gif)/i)?.[0] || '.jpg'
          const savePath = path.join(coversDir, cleanPh + ext)
          try {
            await downloadImage(result.cover, savePath, imgReferer, proxy)
            // 将封面路径改为相对路径（相对于 dataDir）
            result.cover = path.join(coverDir || COVER_DIR, cleanPh + ext)
          } catch (e) {
            // 封面下载失败不影响其他数据
          }
        }
        // 下载演员头像（2026-09-14）：有远程头像 URL 的下载到 covers/actress/，
        // 失败或本无头像则留空（前端按性别用默认剪影）
        if (dataDir && Array.isArray(result.cast) && result.cast.length) {
          const actDir = path.join(dataDir, coverDir || COVER_DIR, 'actress')
          if (!fs.existsSync(actDir)) fs.mkdirSync(actDir, { recursive: true })
          for (const c of result.cast) {
            if (!c.avatar || !/^https?:/.test(c.avatar)) { c.avatar = ''; delete c.star; continue }
            const sid = (String(c.star || '').match(/\/star\/([^/?#]+)/) || [])[1]
            const aBase = sid || `${cleanPh}-${c.name}`
            const aExt = c.avatar.match(/\.(jpg|jpeg|png|webp)/i)?.[0] || '.jpg'
            const rel = path.join(coverDir || COVER_DIR, 'actress', `${aBase}${aExt}`)
            try {
              await downloadImage(c.avatar, path.join(dataDir, rel), imgReferer, proxy)
              c.avatar = rel.replace(/\\/g, '/')
            } catch (e) { c.avatar = '' }
            delete c.star
          }
          console.log(`[scrape] ${cleanPh} 演员: ${result.cast.map(c => c.name + '(' + c.gender + (c.avatar ? '+头像' : '') + ')').join(' ')}`)
        }
        // 下载预览图（2026-09-09 新增，按设置开关与数量上限）
        if (downloadPreviews && dataDir && Array.isArray(result.previews) && result.previews.length) {
          const list = previewCount > 0 ? result.previews.slice(0, previewCount) : result.previews
          const prevDirAbs = path.join(dataDir, coverDir || COVER_DIR, 'previews')
          if (!fs.existsSync(prevDirAbs)) fs.mkdirSync(prevDirAbs, { recursive: true })
          const localPreviews = []
          for (let i = 0; i < list.length; i++) {
            const pExt = list[i].match(/\.(jpg|jpeg|png|webp)/i)?.[0] || '.jpg'
            const relPath = path.join(coverDir || COVER_DIR, 'previews', `${cleanPh}-${i + 1}${pExt}`)
            try {
              await downloadImage(list[i], path.join(dataDir, relPath), imgReferer, proxy)
              localPreviews.push(relPath.replace(/\\/g, '/'))
            } catch (e2) {
              // 单张预览图下载失败跳过，不影响其余
            }
          }
          if (localPreviews.length) result.previews = localPreviews
          else delete result.previews  // 全部失败则不入库
          console.log(`[scrape] ${cleanPh} 预览图: 待下载${list.length} 成功${localPreviews.length}`)
        } else {
          // 未开启下载：移除远程 URL，避免把外链入库（离线时无法显示）
          delete result.previews
        }
        // 应用标签映射（设置页「标签映射」规则，2026-09-09 新增）
        if (result.bq) result.bq = applyTagMapping(result.bq, tagMapping)
        return { ok: true, data: result, source: src.name }
      }
    } catch (e) {
      lastError = `${src.name}: ${e.message}`
      console.warn(`[scrape] ${cleanPh} ← ${src.name} 失败: ${e.message}`)
    }
  }

  // 所有来源都失败
  return { ok: false, error: lastError || '未找到该番号的信息' }
}

module.exports = { scrapeMovie, scrapeJavBus, scrapeJavDb, WEB_SOURCES, twToCn }
