/**
 * ============================================================
 * 文件名：movies.js
 * 功能：影片数据的核心状态管理（Pinia store）。
 *      管理影片列表、分页、排序、标签筛选、批量选择等状态，
 *      以及与 Electron 主进程（window.api）的数据交互。
 * 依赖：pinia（defineStore）、window.api（Electron preload 暴露的接口）
 * ============================================================
 */
import { defineStore } from 'pinia'

// 默认显示名 - 程序启动后从 settings:saveTagCats / tag-categories.json 读取，用户可自定义
// 9 个标签大类，初始为空，后续从配置文件或数据库加载
const DEFAULT_CATS = [
  { cat: 'C1', tags: [] }, { cat: 'C2', tags: [] }, { cat: 'C3', tags: [] },
  { cat: 'C4', tags: [] }, { cat: 'C5', tags: [] }, { cat: 'C6', tags: [] },
  { cat: 'C7', tags: [] }, { cat: 'C8', tags: [] }, { cat: 'C9', tags: [] }
]

export const useMoviesStore = defineStore('movies', {
  // ====== 状态定义 ======
  state: () => ({
    inited: false,        // 是否已初始化（防止重复初始化）
    settings: {},         // 全局设置对象
    categories: [...DEFAULT_CATS], // [{cat, tags: []}] 9 大标签分类配置
    allDbTags: [],        // 数据库中实际存在的标签（扁平化数组）
    movies: [],           // 当前页影片列表
    total: 0,             // 影片总数（含筛选条件）
    page: 1,              // 当前页码
    pageSize: 20,         // 每页显示数量（与 settings 表默认值 page_size='20' 一致；
                          //  initIfNeeded 加载设置后会被用户配置覆盖）
    colsPerRow: 5,        // 每行显示的影片卡片数
    loading: false,       // 加载中标志
    dirty: false,         // 数据脏标志（标记数据有变动，需重新加载）

    // 筛选状态
    sort: { by: 'tjrq', order: 'DESC', random: false },  // 排序：字段、方向、随机模式
    tagSelected: [[], [], [], [], [], [], [], [], []],   // 9个类别选中的标签数组
    collapsed: [false, false, false, false, false, false, false, false, false], // 各类别折叠状态
    searchQ: '',          // 当前搜索关键词（2026-09-09 新增：来自顶栏搜索，
                          //  loadMovies 会并入 filter.q，保证翻页/刷新不丢搜索条件）

    // 批量选择
    selectMode: false,    // 是否处于批量选择模式
    selectedIds: []       // 选中的影片 ID 列表
  }),

  // ====== 计算属性 ======
  getters: {
    /**
     * 总页数
     * @param {Object} s - store state
     * @returns {number} 最大页数（至少为 1）
     */
    pageCount: (s) => Math.max(1, Math.ceil(s.total / s.pageSize)),

    /**
     * 可见类别：返回只含数据库中实际存在标签的 category 数组
     * 空类别也保留（用户可扩展）
     * @param {Object} s - store state
     * @returns {Array} 过滤后的类别数组
     */
    visibleCategories: (s) => {
      return s.categories.map((c, idx) => ({
        cat: c.cat,
        idx,
        tags: c.tags.filter(t => s.allDbTags.includes(t))
      }))
    }
  },

  // ====== 动作方法 ======
  actions: {
    /**
     * 初始化 store（仅在首次调用时执行）
     * 功能：加载全局设置和标签分类配置
     */
    async initIfNeeded() {
      if (this.inited) return
      try {
        // 加载设置
        if (window.api) {
          const r = await window.api.getSettings()
          if (r.ok) {
            this.settings = r.data || {}
            if (r.data?.page_size) this.pageSize = Number(r.data.page_size) || 20
            if (r.data?.cols_per_row) this.colsPerRow = Number(r.data.cols_per_row) || 5
          }
          // 加载标签分类配置（必须为 9 类）
          const cr = await window.api.getTagCategories()
          if (cr.ok && Array.isArray(cr.data) && cr.data.length === 9) {
            this.categories = cr.data
          }
        }
        this.inited = true
      } catch (e) { console.warn('init err', e) }
    },

    /**
     * 加载数据库中实际存在的所有标签
     * @returns {Promise<Array>} 标签数组
     */
    async loadAllDbTags() {
      if (!window.api) return []
      const r = await window.api.getAllTags()
      if (r.ok) { this.allDbTags = r.tags || [] }
      return this.allDbTags
    },

    /**
     * 加载影片列表
     * @param {Object} opts - 加载选项
     * @param {boolean} opts.onlyFavorite - 仅加载收藏影片
     * @param {Object} opts.extraFilter - 额外筛选条件（如 actress、studio、series、historyOnly）
     * @param {boolean} opts.append - 是否追加模式（分页加载更多时为 true）
     * @returns {Promise<void>}
     */
    async loadMovies({ onlyFavorite = false, extraFilter = {}, append = false } = {}) {
      if (!window.api) { this.movies = []; this.total = 0; return }
      this.loading = true
      try {
        // 合并标签筛选与额外筛选条件；搜索词并入 filter.q（主进程按番号/片名/标签 LIKE）
        const filter = { tagSelected: JSON.parse(JSON.stringify(this.tagSelected)), ...extraFilter }
        if (this.searchQ) filter.q = this.searchQ
        const r = await window.api.getMovies({
          filter,
          sort: JSON.parse(JSON.stringify(this.sort)),
          page: this.page,
          pageSize: this.pageSize,
          onlyFavorite
        })
        if (r.ok) {
          const newMovies = r.data || []
          if (append) {
            // 追加模式：去重后追加
            const existingIds = new Set(this.movies.map(m => m.id))
            this.movies = [...this.movies, ...newMovies.filter(m => !existingIds.has(m.id))]
          } else {
            // 替换模式：直接覆盖
            this.movies = newMovies
          }
          this.total = Number(r.total) || 0
        }
      } finally { this.loading = false }
    },

    /**
     * 切换单个标签的选中状态
     * @param {number} catIdx - 类别索引（0-8）
     * @param {string} tag - 标签名
     */
    toggleTag(catIdx, tag) {
      const arr = this.tagSelected[catIdx] || []
      const i = arr.indexOf(tag)
      if (i >= 0) arr.splice(i, 1)
      else arr.push(tag)
    },

    /**
     * 切换该类别的全选/全不选
     * @param {number} catIdx - 类别索引（0-8）
     */
    toggleCatAll(catIdx) {
      const present = this.visibleCategories[catIdx]?.tags || []
      const selected = this.tagSelected[catIdx] || []
      // 已全选则清空，否则全选
      if (selected.length === present.length) {
        this.tagSelected[catIdx] = []
      } else {
        this.tagSelected[catIdx] = [...present]
      }
    },

    /**
     * 重置所有筛选/排序状态
     */
    resetAll() {
      this.tagSelected = [[], [], [], [], [], [], [], [], []]
      this.page = 1
      this.sort = { by: 'tjrq', order: 'DESC', random: false }
      this.selectedIds = []
      this.searchQ = ''
    },

    /**
     * 切换影片收藏状态
     * @param {number} id - 影片 ID
     */
    async toggleFav(id) {
      if (!window.api) return
      const m = this.movies.find(x => x.id === id)
      if (!m) return
      const val = m.cl === 'y' ? 'n' : 'y'
      const r = await window.api.updateMovie(id, { cl: val })
      if (r.ok) m.cl = val
    }
  }
})
