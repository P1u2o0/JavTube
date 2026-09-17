/**
 * @file ipc-channels.js
 * @module electron/common/ipc-channels
 * @description IPC 通道名常量（preload 与 main 共享的唯一事实来源）。
 *              此前 40 个通道名字符串散落在 preload/index.js（invoke 端）与
 *              main 各模块（handle 端），两侧靠字符串人工对齐——拼写错误或
 *              改名不同步会静默失效（invoke 无匹配 handle 时返回 undefined）。
 *              收拢后新增通道只需在此加一行，两端引用同一份常量。
 *              注意：本文件必须保持 CommonJS（preload 以 node require 加载），
 *              通道名字符串值与重构前逐一相同，纯常量化无行为变更。
 */

module.exports = {
  // === 影片 ===
  MOVIES_GET: 'movies:get',
  MOVIES_GET_ONE: 'movies:getOne',
  MOVIES_CREATE: 'movies:create',
  MOVIES_UPDATE: 'movies:update',
  MOVIES_DELETE: 'movies:delete',
  MOVIES_DELETE_MANY: 'movies:deleteMany',
  MOVIES_BATCH_FAV: 'movies:batchFav',
  MOVIES_BATCH_TAGS: 'movies:batchTags',
  MOVIES_GET_ALL_TAGS: 'movies:getAllTags',
  // 把设置里的标签映射规则套用到「已有影片」（dryRun 时只返回影响预览，不写库）
  MOVIES_APPLY_TAG_MAP: 'movies:applyTagMap',
  HOME_RECOMMEND: 'home:recommend',        // 首页推荐（轮播/类别按钮/近期上新）
  MOVIES_RECORD_PLAY: 'movies:recordPlay',

  // === 女优 ===
  ACTRESS_LIST: 'actress:list',
  ACTRESS_GET: 'actress:get',
  ACTRESS_CREATE: 'actress:create',
  ACTRESS_UPDATE: 'actress:update',
  ACTRESS_DELETE: 'actress:delete',
  // 2026-09-14 演员头像：按演员名查询其出演影片 + 演员信息（男女通用）
  ACTOR_FILMS: 'actor:films',

  // === 设置 ===
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_UPDATE_BATCH: 'settings:updateBatch',
  SETTINGS_GET_TAG_CATS: 'settings:getTagCats',
  SETTINGS_SAVE_TAG_CATS: 'settings:saveTagCats',
  SETTINGS_BACKUP: 'settings:backup',
  SETTINGS_RESTORE: 'settings:restore',
  SETTINGS_CLEAR: 'settings:clear',
  MISC_DATA_DIR: 'misc:dataDir',

  // === 工具 ===
  UTILS_PLAY_VIDEO: 'utils:playVideo',
  UTILS_SCAN_DIR: 'utils:scanDir',
  UTILS_READ_DURATION: 'utils:readDuration',

  // === 对话框 ===
  DIALOG_OPEN_DIR: 'dialog:openDir',
  DIALOG_OPEN_VIDEO: 'dialog:openVideo',
  DIALOG_OPEN_IMAGE: 'dialog:openImage',
  DIALOG_OPEN_FILE: 'dialog:openFile',
  DIALOG_SAVE_DB: 'dialog:saveDb',
  DIALOG_OPEN_DB: 'dialog:openDb',

  // === 刮削 ===
  SCRAPER_SCRAPE: 'scraper:scrape'
}
