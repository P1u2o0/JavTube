/**
 * @file preload/index.js
 * @module electron/preload
 * @description Electron 预加载脚本。在页面加载前执行，通过 contextBridge 将安全的 IPC 通信接口
 *              暴露为 window.api 对象供渲染进程使用。这是渲染进程与主进程通信的唯一桥梁，
 *              遵循 Electron 安全最佳实践（contextIsolation + 最小化暴露）。
 *              所有接口均封装为 ipcRenderer.invoke 调用，方向：渲染进程 → 主进程。
 * @dependencies electron (contextBridge, ipcRenderer)
 * @keyAPI contextBridge.exposeInMainWorld(), ipcRenderer.invoke()
 */

// 引入 contextBridge（安全暴露 API 的工具）和 ipcRenderer（IPC 通信客户端）
const { contextBridge, ipcRenderer } = require('electron')
// IPC 通道名常量（preload 与 main 共享，定义于 common/ipc-channels.js）
const IPC = require('../common/ipc-channels')

// 通过 contextBridge 将 window.api 对象暴露给渲染进程
// 渲染进程通过 window.api.xxx() 调用对应方法，实际通过 IPC 转发到主进程
contextBridge.exposeInMainWorld('api', {
  // === 影片相关接口 ===

  /**
   * 分页查询影片列表
   * @param {Object} params - 查询参数（过滤、排序、分页等）
   * @returns {Promise<Object>} { ok, data, total }
   */
  getMovies: (params) => ipcRenderer.invoke(IPC.MOVIES_GET, params),

  /**
   * 根据 ID 查询单条影片详情
   * @param {number} id - 影片 ID
   * @returns {Promise<Object>} { ok, data }
   */
  getMovie: (id) => ipcRenderer.invoke(IPC.MOVIES_GET_ONE, id),

  /**
   * 创建新影片
   * @param {Object} data - 影片数据
   * @returns {Promise<Object>} { ok, id }
   */
  createMovie: (data) => ipcRenderer.invoke(IPC.MOVIES_CREATE, data),

  /**
   * 更新影片信息
   * @param {number} id - 影片 ID
   * @param {Object} data - 要更新的字段
   * @returns {Promise<Object>} { ok }
   */
  updateMovie: (id, data) => ipcRenderer.invoke(IPC.MOVIES_UPDATE, { id, data }),

  /**
   * 删除单条影片
   * @param {number} id - 影片 ID
   * @returns {Promise<Object>} { ok }
   */
  deleteMovie: (id) => ipcRenderer.invoke(IPC.MOVIES_DELETE, id),

  /**
   * 批量删除影片
   * @param {number[]} ids - 影片 ID 数组
   * @returns {Promise<Object>} { ok }
   */
  deleteMovies: (ids) => ipcRenderer.invoke(IPC.MOVIES_DELETE_MANY, ids),

  /**
   * 获取所有标签列表（按使用频率排序）
   * @returns {Promise<Object>} { ok, tags }
   */
  getAllTags: () => ipcRenderer.invoke(IPC.MOVIES_GET_ALL_TAGS),

  /**
   * 首页推荐数据：轮播影片 / 类别按钮 / 近期上新
   * @returns {Promise<Object>} { ok, data: { hero, categories, arrivals, recentCount } }
   */
  getHomeRecommend: () => ipcRenderer.invoke(IPC.HOME_RECOMMEND),

  /**
   * 记录影片播放时间
   * @param {number} id - 影片 ID
   * @returns {Promise<Object>} { ok }
   */
  recordPlay: (id) => ipcRenderer.invoke(IPC.MOVIES_RECORD_PLAY, id),

  /**
   * 批量设置收藏状态
   * @param {number[]} ids - 影片 ID 数组
   * @param {boolean} isFav - 是否收藏
   * @returns {Promise<Object>} { ok }
   */
  batchSetFavorite: (ids, isFav) => ipcRenderer.invoke(IPC.MOVIES_BATCH_FAV, { ids, isFav }),

  /**
   * 批量追加标签
   * @param {number[]} ids - 影片 ID 数组
   * @param {string[]} tags - 标签数组
   * @returns {Promise<Object>} { ok }
   */
  batchAddTags: (ids, tags) => ipcRenderer.invoke(IPC.MOVIES_BATCH_TAGS, { ids, tags }),

  /**
   * 把设置里的「标签映射」规则套用到已有影片
   * @param {boolean} [dryRun=true] true 只返回影响预览（不写库），false 才真正落库
   * @returns {Promise<Object>} { ok, total, changed:[{id,ph,pm,from,to}], applied }
   */
  applyTagMap: (dryRun = true) => ipcRenderer.invoke(IPC.MOVIES_APPLY_TAG_MAP, { dryRun }),

  // === 女优相关接口 ===

  /**
   * 获取女优列表
   * @returns {Promise<Object>} { ok, data }
   */
  getActressList: () => ipcRenderer.invoke(IPC.ACTRESS_LIST),

  /**
   * 获取女优详情（含参演影片）
   * @param {number} id - 女优 ID
   * @returns {Promise<Object>} { ok, data }
   */
  getActress: (id) => ipcRenderer.invoke(IPC.ACTRESS_GET, id),

  /**
   * 创建女优
   * @param {Object} data - 女优数据
   * @returns {Promise<Object>} { ok, id }
   */
  createActress: (data) => ipcRenderer.invoke(IPC.ACTRESS_CREATE, data),

  /**
   * 更新女优信息
   * @param {number} id - 女优 ID
   * @param {Object} data - 要更新的字段
   * @returns {Promise<Object>} { ok }
   */
  updateActress: (id, data) => ipcRenderer.invoke(IPC.ACTRESS_UPDATE, { id, data }),

  /**
   * 删除女优
   * @param {number} id - 女优 ID
   * @returns {Promise<Object>} { ok }
   */
  deleteActress: (id) => ipcRenderer.invoke(IPC.ACTRESS_DELETE, id),

  /**
   * 按演员名查询其出演的全部影片 + 演员信息（性别/头像/资料）
   * @param {string} name - 演员名
   * @returns {Promise<{ok:boolean,data:{name,gender,avatar,info,movies}}>}
   */
  getActorFilms: (name) => ipcRenderer.invoke(IPC.ACTOR_FILMS, name),

  /**
   * 演员页总览（2026-09-22）：库内全部女优的聚合信息
   * @returns {Promise<{ok:boolean,data:Array<{name,avatar,count,heat,rank,total,tier,top:Array}>}>}
   *          top = 该女优「想看人数最多」的至多 3 部影片（id/ph/pm/cover/want）
   */
  getActressOverview: () => ipcRenderer.invoke(IPC.ACTOR_OVERVIEW),

  // === 设置相关接口 ===

  /**
   * 获取所有设置项
   * @returns {Promise<Object>} { ok, data }
   */
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),

  /**
   * 更新单个设置项
   * @param {string} k - 设置键名
   * @param {string} v - 设置值
   * @returns {Promise<Object>} { ok }
   */
  updateSetting: (k, v) => ipcRenderer.invoke(IPC.SETTINGS_UPDATE, { key: k, value: v }),

  /**
   * 批量更新设置（2026-09-10 新增）：一次事务写入多条、只持久化一次，保存不再卡顿
   * @param {Object} obj - { 键: 值 } 映射
   * @returns {Promise<Object>} { ok, error? }
   */
  updateSettingsBatch: (obj) => ipcRenderer.invoke(IPC.SETTINGS_UPDATE_BATCH, obj),

  /**
   * 备份数据库到指定路径
   * @param {string} targetPath - 备份文件路径
   * @returns {Promise<Object>} { ok }
   */
  backupDb: (targetPath) => ipcRenderer.invoke(IPC.SETTINGS_BACKUP, targetPath),

  /**
   * 从备份文件恢复数据库
   * @param {string} sourcePath - 备份源文件路径
   * @returns {Promise<Object>} { ok, info }
   */
  restoreDb: (sourcePath) => ipcRenderer.invoke(IPC.SETTINGS_RESTORE, sourcePath),

  /**
   * 清空所有数据（影片、女优、网址）
   * @returns {Promise<Object>} { ok }
   */
  clearDb: () => ipcRenderer.invoke(IPC.SETTINGS_CLEAR),

  /**
   * 获取标签分类列表
   * @returns {Promise<Object>} { ok, data }
   */
  getTagCategories: () => ipcRenderer.invoke(IPC.SETTINGS_GET_TAG_CATS),

  /**
   * 保存标签分类列表
   * @param {Array} cats - 标签分类数组
   * @returns {Promise<Object>} { ok }
   */
  saveTagCategories: (cats) => ipcRenderer.invoke(IPC.SETTINGS_SAVE_TAG_CATS, cats),

  // === 工具类接口 ===

  /**
   * 播放视频文件（优先使用自定义播放器）
   * @param {string} p - 视频文件路径
   * @returns {Promise<Object>} { ok }
   */
  playVideo: (p) => ipcRenderer.invoke(IPC.UTILS_PLAY_VIDEO, p),

  /**
   * playVideo 的别名（演员影片页 actor:films 用的是 playMovie 命名）
   * @param {string} p - 视频文件路径
   */
  playMovie: (p) => ipcRenderer.invoke(IPC.UTILS_PLAY_VIDEO, p),

  /**
   * 扫描目录中的视频文件
   * @param {string} dir - 目录路径
   * @returns {Promise<Object>} { ok, data }
   */
  scanDir: (dir) => ipcRenderer.invoke(IPC.UTILS_SCAN_DIR, dir),

  /**
   * 读取视频文件时长（分钟）
   * @param {string} p - 视频文件绝对路径
   * @returns {Promise<Object>} { ok, data }，data 为分钟数（0 表示无法解析）
   */
  readVideoDuration: (p) => ipcRenderer.invoke(IPC.UTILS_READ_DURATION, p),

  // === 系统对话框接口 ===

  /** 打开目录选择对话框，返回选中目录路径 */
  openDirDialog: () => ipcRenderer.invoke(IPC.DIALOG_OPEN_DIR),

  /** 打开视频文件选择对话框，返回选中文件路径 */
  openVideoDialog: () => ipcRenderer.invoke(IPC.DIALOG_OPEN_VIDEO),

  /** 打开图片文件选择对话框，返回选中文件路径 */
  openImageDialog: () => ipcRenderer.invoke(IPC.DIALOG_OPEN_IMAGE),

  /** 打开可执行文件选择对话框，返回选中文件路径 */
  openFileDialog: () => ipcRenderer.invoke(IPC.DIALOG_OPEN_FILE),

  /** 打开数据库保存对话框，返回保存路径 */
  saveDbDialog: () => ipcRenderer.invoke(IPC.DIALOG_SAVE_DB),

  /** 打开数据库文件选择对话框，返回选中文件路径 */
  openDbDialog: () => ipcRenderer.invoke(IPC.DIALOG_OPEN_DB),

  // === 刮削接口 ===

  /**
   * 根据番号刮削影片信息
   * @param {string} ph - 影片番号
   * @param {string} source - 刮削来源（'auto' 或具体名称）
   * @returns {Promise<Object>} { ok, data, source }
   */
  scrapeMovie: (ph, source, opts) => ipcRenderer.invoke(IPC.SCRAPER_SCRAPE, { ph, source, ...(opts || {}) }),

  // === 杂项接口 ===

  /**
   * 获取应用数据目录路径
   * @returns {Promise<string>} 数据目录路径
   */
  getDataDir: () => ipcRenderer.invoke(IPC.MISC_DATA_DIR),

  /**
   * 立即重启应用。
   * 用于「从备份恢复数据库」之后：恢复只替换了磁盘文件，内存里仍是旧库，
   * 必须重启才能加载恢复后的数据（重启前主进程已禁止落盘，不会覆盖恢复结果）。
   * @returns {Promise<{ok: boolean}>}
   */
  relaunchApp: () => ipcRenderer.invoke(IPC.APP_RELAUNCH)
})
