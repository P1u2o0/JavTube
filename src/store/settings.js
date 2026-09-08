/**
 * ============================================================
 * 文件名：settings.js
 * 功能：女优（Actress）和网址（Website）的状态管理（Pinia store）。
 *      定义两个 store：useActressStore 管理女优列表的增删查，
 *      useWebStore 管理网址导航的增删查。
 * 依赖：pinia（defineStore）、window.api（Electron preload 暴露的接口）
 * ============================================================
 */
import { defineStore } from 'pinia'

/**
 * 女优 Store
 * 管理女优列表数据的加载、创建和删除
 */
export const useActressStore = defineStore('actress', {
  // 状态：女优列表与加载状态
  state: () => ({ list: [], loading: false }),
  actions: {
    /**
     * 加载女优列表
     * @returns {Promise<void>}
     */
    async load() {
      if (!window.api) return
      this.loading = true
      try {
        const r = await window.api.getActressList()
        if (r.ok) this.list = r.data || []
      } finally { this.loading = false }
    },

    /**
     * 创建新女优
     * @param {Object} d - 女优数据对象
     * @returns {Promise<Object>} 创建结果
     */
    async create(d) { if(window.api){const r=await window.api.createActress(JSON.parse(JSON.stringify(d))); if(r.ok) await this.load(); return r} },

    /**
     * 更新女优信息（此前 Actress.vue 绕过 store 直调 window.api，收敛至此）
     * @param {number} id - 女优 ID
     * @param {Object} d - 女优数据对象
     * @returns {Promise<Object>} 更新结果
     */
    async update(id, d) { if(window.api){const r=await window.api.updateActress(id, JSON.parse(JSON.stringify(d))); if(r.ok) await this.load(); return r} },

    /**
     * 删除女优
     * @param {number} id - 女优 ID
     * @returns {Promise<Object>} 删除结果
     */
    async remove(id) { if(window.api){const r=await window.api.deleteActress(id); if(r.ok) await this.load(); return r} }
  }
})

/**
 * 网址 Store
 * 管理网址导航数据的加载、创建和删除
 */
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
     * @returns {Promise<Object>} 创建结果
     */
    async create(d) { if(window.api){const r=await window.api.createWebsite(JSON.parse(JSON.stringify(d))); if(r.ok) await this.load(); return r} },

    /**
     * 更新网址（与 actress store 对齐补齐，当前 UI 未使用，供后续扩展）
     * @param {number} id - 网址 ID
     * @param {Object} d - 网址数据对象
     * @returns {Promise<Object>} 更新结果
     */
    async update(id, d) { if(window.api){const r=await window.api.updateWebsite(id, JSON.parse(JSON.stringify(d))); if(r.ok) await this.load(); return r} },

    /**
     * 删除网址
     * @param {number} id - 网址 ID
     * @returns {Promise<Object>} 删除结果
     */
    async remove(id) { if(window.api){const r=await window.api.deleteWebsite(id); if(r.ok) await this.load(); return r} }
  }
})
