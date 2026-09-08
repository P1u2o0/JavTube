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
  MOVIES_RECORD_PLAY: 'movies:recordPlay',
  MOVIES_SEARCH: 'movies:search',

  // === 女优 ===
  ACTRESS_LIST: 'actress:list',
  ACTRESS_GET: 'actress:get',
  ACTRESS_CREATE: 'actress:create',
  ACTRESS_UPDATE: 'actress:update',
  ACTRESS_DELETE: 'actress:delete',

  // === 网址 ===
  WEBSITES_LIST: 'websites:list',
  WEBSITES_CREATE: 'websites:create',
  WEBSITES_UPDATE: 'websites:update',
  WEBSITES_DELETE: 'websites:delete',

  // === 设置 ===
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_GET_TAG_CATS: 'settings:getTagCats',
  SETTINGS_SAVE_TAG_CATS: 'settings:saveTagCats',
  SETTINGS_BACKUP: 'settings:backup',
  SETTINGS_RESTORE: 'settings:restore',
  SETTINGS_CLEAR: 'settings:clear',
  MISC_DATA_DIR: 'misc:dataDir',

  // === 工具 ===
  UTILS_PLAY_VIDEO: 'utils:playVideo',
  UTILS_SCAN_DIR: 'utils:scanDir',
  UTILS_READ_FILE_TEXT: 'utils:readFileText',
  UTILS_READ_FILE_BASE64: 'utils:readFileBase64',

  // === 对话框 ===
  DIALOG_OPEN_DIR: 'dialog:openDir',
  DIALOG_OPEN_VIDEO: 'dialog:openVideo',
  DIALOG_OPEN_IMAGE: 'dialog:openImage',
  DIALOG_OPEN_FILE: 'dialog:openFile',
  DIALOG_OPEN_NFO: 'dialog:openNfo',
  DIALOG_SAVE_DB: 'dialog:saveDb',
  DIALOG_OPEN_DB: 'dialog:openDb',

  // === 刮削 ===
  SCRAPER_SCRAPE: 'scraper:scrape'
}
