/**
 * ============================================================
 * 文件名：website.js
 * 功能：网址导航（Website）状态管理（Pinia store）。
 *      管理网址列表的加载与增删改。
 * 说明：2026-09-11 自 store/settings.js 拆出（原文件名与内容不符）。
 * 依赖：pinia（defineStore）、window.api（Electron preload 暴露的接口）
 * ============================================================
 */
import { defineStore } from 'pinia'

export const useWebStore = defineStore('website', {
  // 状态：网址列表与加载状态
  state: () => ({ list: [], loading: false }),

  actions: {
    /**
     * 加载网址列表
     * @returns {Promise<void>}
     */
    async load() {
      if (!window.api) return
      this.loading = true
      try {
        const r = await window.api.getWebsites()
        if (r.ok) this.list = r.data || []
      } finally { this.loading = false }
    },

    /**
     * 创建新网址
     * @param {Object} d - 网址数据对象（含 name、url、grp）
     * @returns {Promise<Object|undefined>} 创建结果
     */
    async create(d) {
      if (!window.api) return
      const r = await window.api.createWebsite(JSON.parse(JSON.stringify(d)))
      if (r.ok) await this.load()
      return r
    },

    /**
     * 更新网址
     * @param {number} id - 网址 ID
     * @param {Object} d - 网址数据对象
     * @returns {Promise<Object|undefined>} 更新结果
     */
    async update(id, d) {
      if (!window.api) return
      const r = await window.api.updateWebsite(id, JSON.parse(JSON.stringify(d)))
      if (r.ok) await this.load()
      return r
    },

    /**
     * 删除网址
     * @param {number} id - 网址 ID
     * @returns {Promise<Object|undefined>} 删除结果
     */
    async remove(id) {
      if (!window.api) return
      const r = await window.api.deleteWebsite(id)
      if (r.ok) await this.load()
      return r
    }
  }
})
