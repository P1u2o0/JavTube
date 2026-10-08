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

  // === 播放页（2026-09-29 内置播放器）===
  PLAYER_GET_PROGRESS: 'player:getProgress',    // 读播放进度（续播）
  PLAYER_SAVE_PROGRESS: 'player:saveProgress',  // 节流保存播放进度
  PLAYER_RECOMMEND: 'player:recommend',         // 播放页右侧「相关推荐」

  // === mpv 播放内核（2026-10-08「高兼容模式」）===
  // 控制面收敛成一条透传通道（mpv 命令面很宽），在 main 侧白名单化 cmd 与属性名；
  // 事件面一条，由 main 把 mpv 的属性变化归一化后主动推给渲染层。
  MPV_CONTROL: 'mpv:control',   // { cmd, ...args } → { ok, data?, error? }
  MPV_EVENT: 'mpv:event',       // main → 渲染层：{ type, data }

  // === 女优 ===
  // 2026-09-14 演员头像：按演员名查询其出演影片 + 演员信息（男女通用）
  ACTOR_FILMS: 'actor:films',
  // 2026-09-22 演员页总览：全库女优（作品数/热度排名/各自身上想看最多的 3 部影片）
  ACTOR_OVERVIEW: 'actor:overview',
  // 2026-09-24 女优头像补全：列出缺头像（无图/占位图）的女优 / 按名字从 JAVDB 补一位
  ACTRESS_AVATAR_TODO: 'actress:avatarTodo',
  ACTRESS_AVATAR_FILL: 'actress:avatarFill',
  // 2026-10-06 女优头像本地补全：扫描 images/actress/ 下按「名字.<ext>」命名的图片，
  //   匹配库内女优并写入 cast_json（用户手工放置的头像，点击「补全头像」时优先于 JAVDB 应用）
  ACTRESS_AVATAR_REFRESH_LOCAL: 'actress:avatarRefreshLocal',
  // 2026-10-06 女优信息编辑：在演员影片页修改该女优的名字/头像/身高三围等资料
  ACTRESS_UPDATE: 'actress:update',
  // 2026-10-06 女优头像导入：把用户选中的本地图片复制到 images/actress/ 并写入 cast_json
  ACTRESS_IMPORT_AVATAR: 'actress:importAvatar',
  // 2026-10-06 女优删除：从 actress 表移除该女优的个人资料（不影响影片 cast_json）
  ACTRESS_DELETE: 'actress:delete',
  // 2026-10-07 演员资料刮削：从 theidolbase.com 列表页匹配 → 详情页提取身高/三围/出道
  ACTRESS_SCRAPE_INFO: 'actress:scrapeInfo',

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
  // 立即重启应用（恢复数据库后需要重启才能加载新数据，见 settings:restore）
  APP_RELAUNCH: 'app:relaunch',

  // === 工具 ===
  UTILS_PLAY_VIDEO: 'utils:playVideo',
  UTILS_SCAN_DIR: 'utils:scanDir',
  UTILS_READ_DURATION: 'utils:readDuration',
  // 批量读取视频真实分辨率（2026-10-04 播放页「4K」标签：文件名没写 4K 的影片靠它识别）
  UTILS_READ_VIDEO_SIZE: 'utils:readVideoSize',
  // 打开外部链接（系统浏览器；仅 http/https，2026-10-05 关于页 GitHub 按钮）
  UTILS_OPEN_EXTERNAL: 'utils:openExternal',
  // 切换主窗口的「窗口级全屏」（2026-10-08，mpv 播放页全屏）。
  // 不用 DOM 全屏的原因见 ipc-utils.js 的 handler 注释（DOM 全屏会把挖洞遮罩与控制条
  // 排除在绘制之外 → mpv 的画面被全屏背景挡成纯黑）。
  UTILS_SET_WINDOW_FULLSCREEN: 'utils:setWindowFullscreen',
  // 检查更新（查询 GitHub Releases 最新版本并比较，2026-10-05）
  UPDATE_CHECK: 'update:check',

  // === 对话框 ===
  DIALOG_OPEN_DIR: 'dialog:openDir',
  DIALOG_OPEN_VIDEO: 'dialog:openVideo',
  DIALOG_OPEN_FILE: 'dialog:openFile',
  DIALOG_OPEN_IMAGE: 'dialog:openImage',
  DIALOG_SAVE_DB: 'dialog:saveDb',
  DIALOG_OPEN_DB: 'dialog:openDb',

  // === 刮削 ===
  SCRAPER_SCRAPE: 'scraper:scrape',

  // === 图片完整性（2026-09-27）===
  // 扫描全库「库里引用但文件缺失/不是有效图片」的封面与预览图 / 按影片重新下载修复
  IMAGES_SCAN: 'images:scan',
  IMAGES_REPAIR: 'images:repair'
}
