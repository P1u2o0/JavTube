/**
 * ============================================================
 * 文件名：actress.js
 * 功能：女优（Actress）状态管理（Pinia store）。
 *      管理女优列表的加载、单条查询、增删改。
 * 说明：2026-09-11 自 store/settings.js 拆出（原文件名与内容不符，
 *      现按领域独立成 store）。
 * 依赖：pinia（defineStore）、window.api（Electron preload 暴露的接口）
 * ============================================================
 */
import { defineStore } from 'pinia'

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
     * 查询单个女优（编辑回填用；2026-09-11 自 Actress.vue 直调收敛至此）
     * @param {number} id - 女优 ID
     * @returns {Promise<Object|undefined>} 女优数据
     */
    async getOne(id) {
      if (!window.api) return
      const r = await window.api.getActress(id)
      return r.ok ? r.data : undefined
    },

    /**
     * 创建新女优
     * @param {Object} d - 女优数据对象
     * @returns {Promise<Object|undefined>} 创建结果 { ok, id?, error? }
     */
    async create(d) {
      if (!window.api) return
      const r = await window.api.createActress(JSON.parse(JSON.stringify(d)))
      if (r.ok) await this.load()
      return r
    },

    /**
     * 更新女优信息
     * @param {number} id - 女优 ID
     * @param {Object} d - 女优数据对象
     * @returns {Promise<Object|undefined>} 更新结果
     */
    async update(id, d) {
      if (!window.api) return
      const r = await window.api.updateActress(id, JSON.parse(JSON.stringify(d)))
      if (r.ok) await this.load()
      return r
    },

    /**
     * 删除女优
     * @param {number} id - 女优 ID
     * @returns {Promise<Object|undefined>} 删除结果
     */
    async remove(id) {
      if (!window.api) return
      const r = await window.api.deleteActress(id)
      if (r.ok) await this.load()
      return r
    }
  }
})
