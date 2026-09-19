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
    // file:///C:/... 或 file:///home/... → 真实路径
    try {
      const u = new URL(cover)
      abs = decodeURIComponent(u.pathname.replace(/^\//, ''))
      // Windows: '/C:/foo' → 'C:/foo'（去掉前导 /）
      if (/^\/[A-Za-z]:/.test(abs)) abs = abs.slice(1)
    } catch { abs = cover.replace(/^file:\/\/\//i, '') }
  } else if (/^[A-Z]:[\\/]/i.test(cover)) {
    // Windows 绝对路径
    abs = cover
  } else if (/^\//.test(cover)) {
    // Unix 绝对路径
    abs = cover.slice(1)
  } else if (dataDir) {
    // 相对路径：拼到 dataDir
    abs = (dataDir + '/' + cover).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '')
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
 * 从文件名尝试提取番号
 * 功能：通过正则匹配常见番号格式（字母-数字），如 ABC-123
 * @param {string} name - 文件名
 * @returns {string} 提取到的番号（大写格式），无匹配则返回空字符串
 */
export function extractCode(name) {
  if (!name) return ''
  // 正则匹配：2-10 个字母 + 可选分隔符(-_\s) + 2-6 位数字
  const m = String(name).match(/([A-Za-z]{2,10})[-_\s]?(\d{2,6})/)
  if (m) return `${m[1].toUpperCase()}-${m[2]}`
  return ''
}

/**
 * 安全调用 fire-and-forget 的 IPC Promise（如 playVideo / recordPlay）。
 * 失败仅输出控制台警告，不弹 UI 提示（保持这些调用原有的"无感知"语义），
 * 同时避免 unhandled promise rejection。
 * @param {Promise} promise - ipcRenderer.invoke 返回的 Promise
 */
export function safeCall(promise) {
  Promise.resolve(promise).catch(e => console.warn('[ipc] call failed:', e?.message || e))
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
 * 将刮削结果对象转换为影片更新字段对象（仅保留有值的字段）。
 * 原 Library.vue（onBatchScrape）与 Detail.vue（onScrape）各有一份相同的
 * 10 字段映射，提取为公共函数消除重复。映射关系与原实现逐字段一致：
 * 刮削返回字段 yy → 更新字段 yid（演员），其余字段同名透传，空值跳过。
 * @param {Object} d - 刮削结果对象（scraper:scrape 返回的 data）
 * @returns {Object} 可直接传给 window.api.updateMovie 的字段对象
 */
export function buildScrapeUpdate(d) {
  const update = {}
  if (!d) return update
  if (d.pm) update.pm = d.pm        // 片名
  if (d.fl) update.fl = d.fl        // 分类（有码/无码/欧美）
  if (d.fxrq) update.fxrq = d.fxrq  // 发行日期
  if (d.yy) update.yid = d.yy       // 演员
  if (d.dy) update.dy = d.dy        // 导演
  if (d.ps) update.ps = d.ps        // 制作商
  if (d.fx) update.fx = d.fx        // 发行商
  if (d.xl) update.xl = d.xl        // 系列
  if (d.bq) update.bq = d.bq        // 标签
  if (d.cover) update.cover = d.cover // 封面
  // 2026-09-09 刮削增强新增（预览图本地路径数组序列化入库；统计仅在有值时写入）
  if (Array.isArray(d.previews) && d.previews.length) update.previews = JSON.stringify(d.previews)
  if (d.want) update.want = Number(d.want) || 0      // 想看人数（JAVDB）
  if (d.watched) update.watched = Number(d.watched) || 0 // 看过人数（JAVDB）
  if (d.score) update.score = Number(d.score) || 0   // 评分（JAVDB）
  // 2026-09-14 演员头像：演员列表 [{name,gender,avatar}] 序列化入库
  if (Array.isArray(d.cast) && d.cast.length) update.cast_json = JSON.stringify(d.cast)
  return update
}

