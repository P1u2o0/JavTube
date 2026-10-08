/**
 * ============================================================
 * 文件名：global.js
 * 功能：数据辅助工具函数集合。
 *      包含封面路径解析、番号提取、刮削结果映射、
 *      全局响应式数据目录引用等通用功能。
 *      （原全局搜索分发 onSearch 已移除：搜索改为跳转片库结果页，
 *        逻辑收敛至 TopNav + Library 的 q 参数过滤。）
 * 依赖：vue（ref）、window.api（Electron preload）
 * ============================================================
 */

// 全局响应式 dataDir - 存储应用数据目录路径，供 resolveCover 使用
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
export const dataDirRef = ref('')

/**
 * 封面版本表：解决「刮削后海报不同步更新」。
 * 原因：本地封面一律按「番号」固定文件名覆盖写入（如 covers/MNGS-071.jpg），
 *       重新刮削后 URL 一个字符都没变 → <img> 的 src 不变 → 浏览器认为无需重新请求，
 *       于是继续显示旧图（已实测：src 不变时请求数 = 0）。
 * 做法：刮削成功后 bumpCover(影片 id)，让该影片的封面 URL 带上 ?v=<时间戳>，
 *       src 变化触发重新请求；未 bump 过的影片不带版本号，缓存照旧生效。
 */
export const coverVersions = reactive({})

/**
 * 标记某个影片的封面已更新，使其封面/预览图 URL 换新（强制浏览器重新加载）。
 * @param {string|number} key - 影片 id（与 resolveCover 第二参数保持一致）
 */
export function bumpCover(key) {
  if (key === undefined || key === null || key === '') return
  coverVersions[key] = Date.now()
}

/**
 * 女优头像的版本键（与影片封面**共用** coverVersions 这张表，前缀区分，互不冲突）。
 * 头像和封面是同一个坑：本地头像一律按「名字」固定文件名覆盖写入
 * （`data/images/actress/<名字>.<ext>`），替换头像后 URL 一个字符都没变 →
 * `<img>` 的 src 不变 → 浏览器认为无需重新请求 → 界面上还是旧头像
 * （2026-10-08 用户反馈「女优信息页里替换头像图片时不能及时更新」）。
 * @param {string} name - 女优名字
 * @returns {string} 传给 resolveCover 第二参数的键（名字为空时返回 ''，即不带版本号）
 */
export function actressAvatarKey(name) {
  return name ? `actress:${name}` : ''
}

/**
 * 标记某位女优的头像「刚换过」：之后所有 `resolveCover(头像路径, actressAvatarKey(名字))`
 * 的地方（女优影片页头部 / 演员页头像墙 / 编辑弹窗预览）都会自动带上新的 `?v=`，
 * src 变化即触发重新请求（同 bumpCover 的机制）。
 * @param {string} name - 女优名字
 */
export function bumpActressAvatar(name) {
  if (!name) return
  coverVersions[actressAvatarKey(name)] = Date.now()
}

/**
 * 获取封面图解析为 <img> 可加载的 URL
 * 功能：根据封面字段值，将其转换为浏览器可显示的 URL
 * 支持的输入格式：HTTP/HTTPS URL、javtube-cover:// 自定义协议、file:// URL、
 *                  Windows 绝对路径、Unix 绝对路径、相对路径（基于 dataDir）
 *
 * 设计说明：本地磁盘的封面图原本用 file:// URL，但 Electron 在严格 CSP + Privileged 上下文下
 *           会拒绝 img 加载 file:// 资源（控制台报 "Not allowed to load local resource"）。
 *           我们在主进程注册了 javtube-cover:// privileged scheme，主进程会把路径白名单校验
 *           后转为 net.fetch(file://) 返回，因此这里统一改用 javtube-cover://，对调用方透明。
 * @param {string} cover - 封面路径字段值
 * @param {string|number} [key] - 影片 id；传入且该 id 已 bumpCover 过时，URL 会带 ?v= 版本号
 * @returns {string} 可用于 img src 的 URL
 */
export function resolveCover(cover, key) {
  if (!cover) return ''
  // 该影片的封面是否被标记为「刚更新过」（读响应式表 → 调用处的 computed 会自动重算）
  const ver = (key === undefined || key === null || key === '') ? 0 : coverVersions[key]
  const withVer = (u) => (ver ? `${u}${u.includes('?') ? '&' : '?'}v=${ver}` : u)
  // HTTP/HTTPS URL 直接返回（远程封面图无需走自定义协议，也不参与本地版本化）
  if (/^https?:\/\//i.test(cover)) return cover
  // 已经是 javtube-cover:// URL 直接返回（避免重复编码）
  if (/^javtube-cover:\/\//i.test(cover)) return withVer(cover)
  // 其他任意本地路径（含 file://、Windows 绝对路径、Unix 路径、相对路径）
  // 都统一编码为 javtube-cover:///<base64url(absolutePath)>
  const dataDir = dataDirRef.value || window.__dataDir || ''
  let abs = ''
  if (/^file:\/\//i.test(cover)) {
    // 三种形态都要还原正确（2026-10-02 修正）：
    //   file:///C:/...（Windows 盘符）→ C:/...
    //   file:///home/...（Unix 绝对）→ 保留前导 /（旧实现统一剥掉前导斜杠，会降级成相对路径）
    //   file://NAS/share/...（UNC）→ //NAS/share/...（旧实现丢 host，路径必然 404）
    try {
      const u = new URL(cover)
      const p = decodeURIComponent(u.pathname)
      if (u.host) abs = `//${u.host}${p}`
      else if (/^\/[A-Za-z]:/.test(p)) abs = p.slice(1)
      else abs = p
    } catch { abs = cover.replace(/^file:\/\/\//i, '') }
  } else if (/^[A-Z]:[\\/]/i.test(cover)) {
    // Windows 绝对路径
    abs = cover
  } else if (/^\//.test(cover)) {
    // Unix 绝对路径：原样保留（2026-09-30 审计修复：原实现 `cover.slice(1)` 会吃掉前导斜杠，
    // 变成相对路径后被主进程按 cwd 解析，图片必然 404）
    abs = cover
  } else if (dataDir) {
    // 相对路径：拼到 dataDir。
    // ⚠️ 只做分隔符归一（反斜杠 → 正斜杠、合并重复斜杠），**不要再吃掉前导斜杠**：
    // 数据目录可能是 UNC（\\NAS\share\data）或 Unix 绝对路径（/home/u/data），
    // 吃掉前导斜杠会把绝对路径降级成相对路径 → 主进程 path.resolve 按 cwd 解析 → 全库封面 404。
    let joined = (dataDir + '/' + cover).replace(/\\/g, '/')
    const isUnc = joined.startsWith('//')     // UNC 路径开头的双斜杠必须保留
    joined = joined.replace(/\/{2,}/g, '/')
    abs = isUnc ? '/' + joined : joined
  } else {
    // 兜底：未知格式，原样返回（让浏览器尝试加载）
    return cover
  }
  // base64url 编码（A-Z a-z 0-9 - _），不需要再 URL 编码，安全无 #/空格/中文问题
  const enc = btoa(unescape(encodeURIComponent(abs)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  // 用固定占位 host = "0"，避免 base64url 串（合法 host 字符）被 Chromium 当成 host 段解析，
  // 否则 pathname 会只剩 "/" 拿不到编码内容。CRITICAL：0 是占位，主进程按 pathname.slice(1) 取。
  return withVer(`javtube-cover://0/${enc}`)
}

/**
 * 把 movies.py 归一化成**本地绝对路径**（去掉 file:// 前缀等）。
 * 与 resolveMedia 共用同一套还原规则；mpv 播放内核需要真实路径 —— 它读不了
 * javtube-media:// 这种只在本应用内注册的自定义协议（见 src/player/mpv-backend.js）。
 * @param {string} py - movies.py
 * @returns {string} 本地绝对路径（UNC 保留 \\host\share\... 形式）；空路径返回空串
 */
export function resolveMediaPath(py) {
  if (!py) return ''
  let abs = String(py)
  if (/^file:\/\//i.test(abs)) {
    try {
      const u = new URL(abs)
      const p = decodeURIComponent(u.pathname)
      if (u.host) abs = `//${u.host}${p}`
      else if (/^\/[A-Za-z]:/.test(p)) abs = p.slice(1)
      else abs = p
    } catch { abs = abs.replace(/^file:\/\/\//i, '') }
  }
  return abs
}

/**
 * 把视频文件绝对路径解析为 <video>/播放器可加载的 URL（2026-09-29 内置播放页）。
 * 走 javtube-media:// 协议（主进程支持 Range 206，拖进度条必需），
 * 编码方式与 resolveCover 完全一致（base64url + 占位 host '0'）。
 * ⚠️ 只有 Chromium 内核能用它；mpv 内核要用 resolveMediaPath 给真实路径。
 * @param {string} py - movies.py（视频文件绝对路径）
 * @returns {string} javtube-media://0/<base64url>；空路径返回空串
 */
export function resolveMedia(py) {
  if (!py) return ''
  if (/^javtube-media:\/\//i.test(py)) return py
  const abs = resolveMediaPath(py)
  const enc = btoa(unescape(encodeURIComponent(abs)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `javtube-media://0/${enc}`
}

/**
 * 同一影片「喜欢」操作的 in-flight 去重锁（2026-09-29 审计）。
 *
 * 问题：片库 store.toggleFav、详情页 toggleFav、演员页 onFav 三处都能改同一部影片的收藏，
 *       对同一 id 连点会打出两个在飞请求 —— 后到的决定库里的值，界面可能出现「点了两次又变回去」
 *       或界面与库不一致。用一个共享的 id 集合做去重：第一次点击拿锁，完成后释放；
 *       在飞期间的重复点击直接忽略（界面已是乐观更新的目标态，无需再发）。
 */
const favInFlight = new Set()

/**
 * 尝试获取某影片的喜欢操作锁。
 * @param {number|string} id
 * @returns {boolean} true=拿到锁可继续；false=已有相同 id 的操作在飞，调用方应直接返回
 */
export function favLock(id) {
  const k = String(id)
  if (favInFlight.has(k)) return false
  favInFlight.add(k)
  return true
}

/**
 * 释放某影片的喜欢操作锁（务必放在 finally 里）。
 * @param {number|string} id
 */
export function favUnlock(id) {
  favInFlight.delete(String(id))
}

// 番号噪声词（2026-10-02）：清晰度/编码串形如「HD-1080」「FHD 1080」「HEVC-10」，
// 会被通用正则误判成番号（实测「FHD 1080p.mp4」提取出 FHD-1080）。命中这些词时
// 继续向后找下一个候选 —— 文件名里常同时带清晰度与真番号（如「[FHD] SSIS-001」）。
const CODE_NOISE_WORDS = new Set([
  'HD', 'FHD', 'UHD', 'QHD', 'SD', 'HDR', 'SDR', 'HEVC', 'AVC', 'H264', 'H265', 'X264', 'X265',
  'WEB', 'WEBRIP', 'BLURAY', 'BDRIP', 'REMUX', 'AAC', 'AC3', 'DTS'
])

/**
 * 从文件名尝试提取番号
 * 功能：通过正则匹配常见番号格式（字母-数字），如 ABC-123
 * @param {string} name - 文件名
 * @returns {string} 提取到的番号（大写格式），无匹配则返回空字符串
 */
export function extractCode(name) {
  if (!name) return ''
  // 正则匹配：2-10 个字母 + 可选分隔符(-_\s) + 2-6 位数字；全局匹配以便跳过噪声词
  const re = /([A-Za-z]{2,10})[-_\s]?(\d{2,6})/g
  const s = String(name)
  let m
  while ((m = re.exec(s))) {
    if (CODE_NOISE_WORDS.has(m[1].toUpperCase())) continue
    return `${m[1].toUpperCase()}-${m[2]}`
  }
  return ''
}

/**
 * 从视频文件名解析「无码破解 / 中文字幕 / 4K」属性标签（2026-10-04 播放页）。
 *
 * 命名约定（按用户真实库核对，2026-10-04）：
 *   -U / -UC / -破解        → 无码破解（用户库中 300+ 部用「-破解」，-U 仅 2 部）
 *   -C / -UC                → 中文字幕（含 -破解-C、-C-4K 这类组合）
 *   4K                      → 4K（文件名标记，或调用方探测到的真实分辨率）
 * 匹配方式：把文件名主干按 - _ 空格 点 切词做整词匹配（避免「ABC」里的 C 被误判），
 * 「破解」用子串匹配（中文字符不存在跨词歧义）。
 *
 * @param {string} py - movies.py（视频文件路径，取文件名部分解析）
 * @param {{is4k?: boolean}} [opts] - is4k=true：真实分辨率探测为 4K（文件名没写也加标签）
 * @returns {{kind:'uncen'|'cnsub'|'uhd', label:string}[]} 按「无码破解 → 中文字幕 → 4K」排序
 */
export function fileBadgesOf(py, opts = {}) {
  const badges = []
  const name = String(py || '').replace(/\\/g, '/').split('/').pop()
  if (!name) return badges
  const stem = name.replace(/\.[A-Za-z0-9]+$/, '')
  const tokens = stem.split(/[-_\s.]+/).map(t => t.toUpperCase()).filter(Boolean)
  const hasTok = (...arr) => tokens.some(t => arr.includes(t))
  if (hasTok('U', 'UC') || stem.includes('破解')) badges.push({ kind: 'uncen', label: '无码破解' })
  if (hasTok('C', 'UC')) badges.push({ kind: 'cnsub', label: '中文字幕' })
  if (hasTok('4K') || opts.is4k === true) badges.push({ kind: 'uhd', label: '4K' })
  return badges
}

/**
 * 真实分辨率 → 是否算 4K（3840×2160 及以上的宽或高）。
 * @param {{width?: number, height?: number}|null} size - readVideoSize 的返回
 * @returns {boolean}
 */
export function is4kSize(size) {
  return !!(size && ((Number(size.width) || 0) >= 3840 || (Number(size.height) || 0) >= 2160))
}

/**
 * 安全调用 fire-and-forget 的 IPC Promise（如 playVideo / recordPlay）。
 * 失败仅输出控制台警告（可选用 errMsg 弹一条错误提示），同时避免 unhandled promise rejection。
 *
 * ⚠️ 2026-09-21 修正：**同时接受 Promise 与返回 Promise 的函数**。
 * 此前只接受 Promise，而演员影片页传的是箭头函数（`safeCall(() => window.api.playMovie(...))`），
 * `Promise.resolve(函数)` 会把函数本身当成结果直接 resolve —— **函数从未执行、也不报错**，
 * 表现为「播放/喜欢按钮点了没反应」，且喜欢按钮还会因为乐观更新而"看起来生效了"却没写库。
 * @param {Promise|Function} promiseOrFn - ipcRenderer.invoke 返回的 Promise，或返回 Promise 的函数
 * @param {string} [errMsg] - 失败时要弹出的提示文案（留空则只打 console.warn）
 * @returns {Promise<void>}
 */
export function safeCall(promiseOrFn, errMsg = '') {
  let p
  if (typeof promiseOrFn === 'function') {
    try { p = promiseOrFn() } catch (e) { p = Promise.reject(e) }
  } else {
    p = promiseOrFn
  }
  return Promise.resolve(p).catch(e => {
    console.warn('[ipc] call failed:', e?.message || e)
    if (errMsg) ElMessage.error(errMsg)
  })
}

/**
 * 按中英文逗号拆分多值字段（标签/演员/导演/片商/系列等），去除首尾空白与空项。
 * 此前这段语义在前端手写了 7 遍（Detail ×4、ActorFilms ×2、SettingsDialog ×1），
 * 分隔符规则一旦调整就要改多处，且其中一处漏了 filter(Boolean) 导致行为不一致。
 * @param {string} v - 原始字段值（如 "潮吹，巨乳"）
 * @returns {string[]} 拆分后的非空项数组
 */
export function splitTags(v) {
  return String(v || '').split(/[，,]/).map(s => s.trim()).filter(Boolean)
}

/**
 * 刮削字段的中文名（用于「补全字段」后提示补了哪些字段）。
 */
export const SCRAPE_FIELD_LABELS = {
  pm: '片名', fl: '分类', fxrq: '发行日期', yid: '演员', dy: '导演',
  ps: '制作商', fx: '发行商', xl: '系列', bq: '标签', cover: '封面',
  previews: '预览图', want: '想看人数', watched: '看过人数', score: '评分',
  cast_json: '演员信息'
}

/**
 * 判断影片记录里某字段是否为「空」（补全模式据此决定要不要写）。
 * 0 视为空：评分/想看/看过 三项在库里以 0 表示「没有数据」。
 * @param {*} v - 字段当前值
 * @returns {boolean}
 */
function isEmptyField(v) {
  if (v === null || v === undefined || v === '') return true
  if (v === 0 || v === '0') return true
  // 空数组序列化后是 '[]'
  if (typeof v === 'string' && v.trim() === '[]') return true
  return false
}

/**
 * 补全模式下，检查「本来就缺、本次也没补上」的统计字段（评分 / 想看 / 看过）。
 *
 * 这三项只来自 JAVDB。Cookie 过期、Cloudflare 拦截（实测直接 403）或代理不通时，
 * 主进程的跨源补全会静默失败（只在控制台留一行日志）；前端若什么都不说，
 * 用户会以为「补全没生效」却查不出原因 —— 所以显式提示。
 *
 * @param {Object} current - 当前影片记录
 * @param {boolean} statsEnabled - 设置里是否开启抓取想看/看过/评分
 * @returns {string} 形如「评分、想看人数」的缺失清单；无缺失时返回空串
 */
export function statsFillHint(current, statsEnabled) {
  if (!statsEnabled || !current) return ''
  const names = { score: '评分', want: '想看人数', watched: '看过人数' }
  const missing = Object.keys(names).filter(k => isEmptyField(current[k]))
  return missing.map(k => names[k]).join('、')
}

/**
 * 将刮削结果对象转换为影片更新字段对象（仅保留有值的字段）。
 * 原 Library.vue（onBatchScrape）与 Detail.vue（onScrape）各有一份相同的
 * 10 字段映射，提取为公共函数消除重复。映射关系与原实现逐字段一致：
 * 刮削返回字段 yy → 更新字段 yid（演员），其余字段同名透传，空值跳过。
 *
 * `fillOnly`（刮削来源=补全字段）时：只写「当前记录为空」的字段，
 * 已有值的字段一律跳过 —— 用于把早年刮削不全的影片补齐，而不覆盖已有正确数据。
 *
 * @param {Object} d - 刮削结果对象（scraper:scrape 返回的 data）
 * @param {Object} [current] - 当前影片记录（fillOnly 时必需，用于判断字段是否已有值）
 * @param {Object} [opts]
 * @param {boolean} [opts.fillOnly=false] - 只补全缺失字段
 * @returns {Object} 可直接传给 window.api.updateMovie 的字段对象
 */
export function buildScrapeUpdate(d, current = null, { fillOnly = false } = {}) {
  const update = {}
  if (!d) return update
  // 补全模式：字段在库里已有值 → 跳过（current 缺失时退化为普通覆盖，避免误写空）
  const keep = (field) => !fillOnly || isEmptyField(current ? current[field] : '')
  if (d.pm && keep('pm')) update.pm = d.pm        // 片名
  if (d.fl && keep('fl')) update.fl = d.fl        // 分类（有码/无码/欧美）
  if (d.fxrq && keep('fxrq')) update.fxrq = d.fxrq // 发行日期
  if (d.yy && keep('yid')) update.yid = d.yy      // 演员
  if (d.dy && keep('dy')) update.dy = d.dy        // 导演
  if (d.ps && keep('ps')) update.ps = d.ps        // 制作商
  if (d.fx && keep('fx')) update.fx = d.fx        // 发行商
  if (d.xl && keep('xl')) update.xl = d.xl        // 系列
  if (d.bq && keep('bq')) update.bq = d.bq        // 标签
  if (d.cover && keep('cover')) update.cover = d.cover // 封面
  // 2026-09-09 刮削增强新增（预览图本地路径数组序列化入库；统计仅在有值时写入）
  if (Array.isArray(d.previews) && d.previews.length && keep('previews')) {
    // 合并而非整体替换（2026-09-28 审计）：本次若只下到部分预览图（源站失败/数量变少），
    // 直接覆盖会把上次完整的列表连同文件引用一起丢掉（文件变孤儿、画廊少图）。
    // 以本次顺序为主，补上本次没有、但库里仍在引用的其余路径。
    //
    // 去重键改为「去掉扩展名的 basename」（2026-09-29 审计）：原实现按完整路径去重，
    // 同一张图不同扩展名（ABF-2-1.jpg 与 ABF-2-1.png）会被当成两张同时入库 →
    // 画廊出现重复缩略图。同名冲突时保留**本次新下载**的那条（d.previews 在前）。
    const baseNoExt = (p) => String(p).replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '')
    const merged = d.previews.slice()
    const seen = new Set(merged.map(baseNoExt))
    try {
      const cur = current ? JSON.parse(current.previews || '[]') : []
      if (Array.isArray(cur)) for (const p of cur) {
        if (!p) continue
        const k = baseNoExt(p)
        if (!seen.has(k)) { seen.add(k); merged.push(p) }
      }
    } catch {}
    update.previews = JSON.stringify(merged)
  }
  // 想看/看过/评分：0 表示无数据，补全模式下只填当前为 0 的
  // 注意用「数值 > 0」判断而不是 `if (d.want)`（2026-09-28 审计）：源站返回字符串 "0" 时
  // 它是真值，会把库里已有的统计覆盖成 0（数据看起来被清空）。
  const posNum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }
  if (posNum(d.want) && keep('want')) update.want = posNum(d.want)
  if (posNum(d.watched) && keep('watched')) update.watched = posNum(d.watched)
  if (posNum(d.score) && keep('score')) update.score = posNum(d.score)
  // 2026-09-14 演员头像：演员列表 [{name,gender,avatar}] 序列化入库
  if (Array.isArray(d.cast) && d.cast.length && keep('cast_json')) {
    update.cast_json = JSON.stringify(d.cast)
  }
  return update
}

