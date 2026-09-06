/**
 * ============================================================
 * 文件名：global.js
 * 功能：全局搜索处理与数据辅助工具函数。
 *      包含搜索分发逻辑、封面路径解析、番号提取、
 *      全局响应式数据目录引用等通用功能。
 * 依赖：element-plus（ElMessage）、vue（ref）、window.api（Electron preload）
 * ============================================================
 */

// 搜索全局处理 + 数据辅助工具
import { ElMessage } from 'element-plus'

/**
 * 全局搜索处理函数
 * 功能：根据搜索范围和关键词调用后端搜索 API，返回结果类型和数据
 * @param {string} scope - 搜索范围（如 'movie'）
 * @param {string} q - 搜索关键词
 * @returns {Promise<Object>} 结果对象，type 字段：
 *   - 'empty'：空关键词
 *   - 'no_api'：无 API 环境
 *   - 'nav'：唯一结果，直接跳转（data 为路由路径）
 *   - 'data'：多条结果，返回数据数组
 *   - 'err'：搜索出错
 */
export async function onSearch(scope, q) {
  q = (q || '').trim()
  if (!q) return { type: 'empty' }
  if (!window.api) return { type: 'no_api' }
  try {
    const r = await window.api.search(scope, q)
    if (!r.ok) throw new Error(r.error)
    // 如果是 movie，跳转到片库并附加筛选关键词
    if (scope === 'movie') {
      // 先尝试直接跳转到第一个匹配的详情
      if (r.data && r.data.length === 1) {
        return { type: 'nav', data: `/detail/${r.data[0].id}` }
      }
      // 多个结果回传数据让上层筛选（简化处理：返回数据）
      return { type: 'data', data: r.data }
    }
    return { type: 'data', data: r.data || [] }
  } catch (e) {
    ElMessage.error('搜索失败：' + e.message)
    return { type: 'err', data: [] }
  }
}

// 全局响应式 dataDir - 存储应用数据目录路径，供 resolveCover 使用
import { ref } from 'vue'
export const dataDirRef = ref('')

/**
 * 获取封面图解析为实际文件路径
 * 功能：根据封面字段值，将其转换为浏览器可显示的 URL
 * 支持的输入格式：HTTP/HTTPS URL、file:// URL、Windows 绝对路径、
 *                  Unix 绝对路径、相对路径（基于 dataDir）
 * @param {string} cover - 封面路径字段值
 * @returns {string} 可用于 img src 的 URL
 */
export function resolveCover(cover) {
  if (!cover) return ''
  // HTTP/HTTPS URL 直接返回
  if (/^https?:\/\//i.test(cover)) return cover
  // Already a file:// URL 直接返回
  if (/^file:\/\//i.test(cover)) return cover
  // Windows absolute path (C:\...) 转为 file:// URL
  if (/^[A-Z]:[\\/]/i.test(cover)) {
    return 'file:///' + cover.replace(/\\/g, '/')
  }
  // Unix absolute path 转为 file:// URL
  if (/^\//.test(cover)) return 'file://' + cover
  // Relative path => file:// + dataDir/cover 拼接数据目录
  const dataDir = dataDirRef.value || window.__dataDir || ''
  if (dataDir) {
    const p = (dataDir + '/' + cover).replace(/\\/g, '/')
    return 'file:///' + p.replace(/\/+/g, '/').replace(/^\//, '')
  }
  return cover
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

// 全局分隔符常量（中文逗号）
export const DELIM = '，'
