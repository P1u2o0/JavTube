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

// 加载序号（模块级即可：每个渲染进程只有一份 store 实例），用于丢弃过期响应
let loadSeq = 0
// 标签库是否已加载（模块级：跨页面挂载保留；见 ensureTagsLoaded）
let tagsLoaded = false

export const useMoviesStore = defineStore('movies', {  // ====== 状态定义 ======
  state: () => ({
    inited: false,        // 是否已初始化（防止重复初始化）
    settings: {},         // 全局设置对象
    categories: [...DEFAULT_CATS], // [{cat, tags: []}] 9 大标签分类配置
    allDbTags: [],        // 数据库中实际存在的标签（扁平化数组，主进程按使用频率降序返回）
    tagCounts: {},        // 标签 → 含该标签的影片数量（用于标签排序，见 TagFilter.byUsage）
    movies: [],           // 当前页影片列表
    total: 0,             // 影片总数（含筛选条件）
    page: 1,              // 当前页码
    pageSize: 20,         // 每页显示数量（与 settings 表默认值 page_size='20' 一致；
                          //  initIfNeeded 加载设置后会被用户配置覆盖）
    colsPerRow: 5,        // 每行显示的影片卡片数
    loading: false,       // 加载中标志

    // 筛选状态
    sort: { by: 'tjrq', order: 'DESC', random: false },  // 排序：字段、方向、随机模式
    tagSelected: [[], [], [], [], [], [], [], [], []],   // 9个类别选中的标签数组
    searchQ: '',          // 当前搜索关键词（2026-09-09 新增：来自顶栏搜索，
                          //  loadMovies 会并入 filter.q，保证翻页/刷新不丢搜索条件）

    // 批量选择
    selectMode: false,    // 是否处于批量选择模式
    selectedIds: [],      // 选中的影片 ID 列表

    // 片库重置信号：顶栏点「片库」时自增，Library 监听它把筛选/页码复位后重新加载。
    // 用信号而不是路由 query —— 路由本来就是 /library（无 query）时 push 不产生任何变化
    libraryResetToken: 0,

    // 数据刷新信号：新增影片等「当前列表该重载了」的场景由顶栏自增，
    // 各列表视图监听后**按自己的筛选参数**重载（Library 带路由筛选、喜欢只拉收藏、历史只拉观看记录）。
    // 若改成由顶栏直接 loadMovies，会把当前页面的列表覆盖成全库（喜欢/历史页尤其明显）。
    dataToken: 0
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
      // 先建一次 Set：原写法对每个候选标签做 allDbTags.includes() 线性查找，
      // 标签上千时是「类别标签数 × 全库标签数」，标签栏首次渲染会卡。
      const known = new Set(s.allDbTags)
      return s.categories.map((c, idx) => ({
        cat: c.cat,
        idx,
        tags: c.tags.filter(t => known.has(t))
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
    /**
     * 拉取全库标签（标签栏数据源）。
     * 每次调用都会走一次 IPC + 主进程全表扫描，所以：
     *  - 页面挂载这类「只是想拿到标签」的场景请用 ensureTagsLoaded()（有守卫，只拉一次）
     *  - 写操作之后（刮削 / 编辑标签 / 批量加标签）必须用本方法强制刷新
     */
    async loadAllDbTags() {
      if (!window.api) return []
      const r = await window.api.getAllTags()
      if (r.ok) {
        this.allDbTags = r.tags || []
        this.tagCounts = r.counts || {}
        tagsLoaded = true
      }
      return this.allDbTags
    },

    /**
     * 标签库「按需加载」：已加载过就直接返回，避免每次进片库/喜欢都重拉一遍全量标签。
     * 标签集合只会在写操作后变化，那些路径都会显式调用 loadAllDbTags() 刷新。
     */
    async ensureTagsLoaded() {
      if (tagsLoaded) return this.allDbTags
      return this.loadAllDbTags()
    },

    /**
     * 加载影片列表
     * @param {Object} opts - 加载选项
     * @param {boolean} opts.onlyFavorite - 仅加载收藏影片
     * @param {Object} opts.extraFilter - 额外筛选条件（如 actress、studio、series、historyOnly）
     * @param {boolean} opts.append - 是否追加模式（分页加载更多时为 true）
     * @param {boolean} opts.useTags - 是否带上标签栏的选中标签（默认 true）
     * @param {boolean} opts.useSearch - 是否带上顶栏搜索词（默认 true）
     * @returns {Promise<void>}
     */
    async loadMovies({ onlyFavorite = false, extraFilter = {}, append = false, useTags = true, useSearch = true } = {}) {
      if (!window.api) { this.movies = []; this.total = 0; return }
      // 加载序号：连续点翻页/快速切筛选时会有多个请求同时在飞，只让**最后一次**的结果生效。
      // 否则先发的慢请求后返回，会把新一页的数据覆盖回旧页（表现为「翻页跳来跳去」）。
      const seq = ++loadSeq
      this.loading = true
      try {
        // 合并标签筛选与额外筛选条件；搜索词并入 filter.q（主进程按番号/片名/标签 LIKE）
        //
        // useTags / useSearch：tagSelected 与 searchQ 是**跨视图共享**的，而「观看记录」没有标签栏
        // 和搜索框、「喜欢」没有搜索框。这两页必须关掉对应的开关，否则片库留下的筛选会把它们
        // 静默过滤小（实测：观看记录 14 条 → 0 条，页面还显示「还没有观看记录」，用户无从察觉）。
        // 这里只是「本次请求不带」，**不清空** store —— 回到片库时筛选照旧生效。
        const filter = { tagSelected: useTags ? JSON.parse(JSON.stringify(this.tagSelected)) : [], ...extraFilter }
        if (useSearch && this.searchQ) filter.q = this.searchQ
        const r = await window.api.getMovies({
          filter,
          sort: JSON.parse(JSON.stringify(this.sort)),
          page: this.page,
          pageSize: this.pageSize,
          onlyFavorite
        })
        if (r.ok && seq === loadSeq) {
          const newMovies = r.data || []
          const total = Number(r.total) || 0
          // 页码越界守卫：page 超过实际总页数时后端返回空列表，界面表现为「列表空白」。
          // 典型成因：其它视图（喜欢/观看记录）留下的页码、详情页删除影片后总页数变少、
          // 带筛选的结果页数变少。这里收敛到最后一页重取一次（loadSeq 自增，旧响应自动作废）。
          if (!append && total > 0 && this.page > Math.ceil(total / this.pageSize)) {
            this.total = total
            this.page = Math.ceil(total / this.pageSize)
            // 重取时必须原样带上 useTags / useSearch，否则收敛后的这一页会换回全局筛选条件
            return this.loadMovies({ onlyFavorite, extraFilter, append, useTags, useSearch })
          }
          if (append) {
            // 追加模式：去重后追加
            const existingIds = new Set(this.movies.map(m => m.id))
            this.movies = [...this.movies, ...newMovies.filter(m => !existingIds.has(m.id))]
          } else {
            // 替换模式：直接覆盖
            this.movies = newMovies
          }
          this.total = total
        } else {
          console.warn('[store] loadMovies 失败:', r.error)
        }
      } catch (e) {
        // IPC 抛异常时不能把异常抛给调用方（10 处调用都没包 catch，会变成
        // unhandled rejection，而且界面会静默停在旧列表）；这里记日志并保留旧数据。
        console.error('[store] loadMovies 异常:', e)
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
     * 顶栏点「片库」：把筛选/排序/页码复位到初始状态，并通知片库页重新加载。
     * 需求：无论此前在片库里选了多少标签、翻到第几页，点「片库」都回到初始（无标签选中）状态。
     */
    requestLibraryReset() {
      this.resetAll()
      this.libraryResetToken++
    },

    /**
     * 通知各列表视图「数据变了，按自己的筛选条件重载一次」。
     * 目前由顶栏在新增影片成功后调用（见 TopNav.onCreated）。
     */
    requestDataRefresh() {
      this.dataToken++
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
