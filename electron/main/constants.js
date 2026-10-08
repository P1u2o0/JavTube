/**
 * @file constants.js
 * @module electron/main/constants
 * @description 主进程跨文件共享常量的集中定义。此前 VIDEO_EXTS / 排序白名单 /
 *              标签分隔符 / 封面目录名等常量散落在 index.js / db/movies.js /
 *              db/init.js / scraper.js 各自硬编码，同一语义多处重复，改一处易漏其他。
 *              本文件仅收拢「跨文件共享的通用配置值」；刮削器私有的 USER_AGENT /
 *              WEB_SOURCES 仅 scraper.js 一个文件使用，仍保留在 scraper.js 内。
 * @keyAPI VIDEO_EXTS, SORTABLE_COLUMNS, TAG_DELIM, FAV_Y, FAV_N, COVER_DIR
 */

// 视频文件扩展名（utils:scanDir 扫描目录时按此识别视频文件）
const VIDEO_EXTS = ['.mp4', '.avi', '.mkv', '.mov', '.flv', '.wmv', '.rmvb', '.m4v', '.mpg', '.mpeg', '.ts', '.webm']

// movies 表允许排序的列白名单（防 SQL 注入；不在名单内的排序字段回退为 tjrq）
const SORTABLE_COLUMNS = ['id', 'ph', 'pm', 'pfs', 'yz', 'tjrq', 'fxrq', 'zb', 'tix', 'cl', 'play_time', 'score', 'play_count', 'duration', 'want', 'watched']

// 标签分隔符（项目约定：中文逗号「，」）
const TAG_DELIM = '\uff0c'

// 收藏标记值（movies.cl 字段：'y' 已收藏 / 'n' 未收藏）
const FAV_Y = 'y'
const FAV_N = 'n'

// 封面图片子目录名（旧布局 covers/；迁移前的识别与归属校验仍要认出它）
const COVER_DIR = 'covers'

// ====== 图片存储新布局（2026-10-05 用户要求；旧数据由启动迁移自动整理）======
//   data/images/<番号>/                该片的海报 <番号>.<ext> + 全部预览图 <番号>-N.<ext>
//   data/images/actress/<女优名>.<ext>  女优头像集中一个文件夹，文件名用软件内显示的名字
// 存储路径只从这里取（scraper 写、迁移搬、校验读），避免各处拼字符串走样。
const IMAGE_DIR = 'images'
// 预览图最小有效字节数：小于它视为「打不开的小图」——下载时丢弃、校验时判坏（宁缺毋滥）
const PREVIEW_MIN_BYTES = 10 * 1024

/** 海报相对路径：images/<番号>/<番号><ext> */
const posterRelPath = (ph, ext) => `${IMAGE_DIR}/${ph}/${ph}${ext}`
/** 预览图相对路径：images/<番号>/<番号>-<n><ext> */
const previewRelPath = (ph, n, ext) => `${IMAGE_DIR}/${ph}/${ph}-${n}${ext}`
/** 女优头像相对路径：images/actress/<名字><ext> */
const actressRelPath = (name, ext) => `${IMAGE_DIR}/actress/${name}${ext}`

// ====== 标题栏覆盖层（Windows 右上角的三个原生窗口按钮）======
// 窗口用 titleBarStyle:'hidden' + titleBarOverlay 把系统标题栏换成自绘顶栏，
// 右上角保留最小化/最大化/关闭。**进 mpv 播放页的全屏时必须把它藏掉**
// （用户 2026-10-08 要求：全屏就只留播放器，不要软件样式的三个按钮）。
// 为什么要显式切换：透明窗口上 Electron 自己的全屏态判断是坏的（`isFullScreen()` 恒 false），
// 它不会像常规窗口那样在进全屏时自动隐藏覆盖层 —— 那三个原生按钮会一直压在画面上。
// HIDDEN 的 height 取 1（而不是 0）：覆盖层只剩 1px 高 → 按钮既不可见、也几乎点不到，
// 等价于「藏起来」，又不依赖 Electron 是否允许 height=0。
const TITLEBAR_OVERLAY = { color: '#ffffff', symbolColor: '#22211f', height: 48 }
const TITLEBAR_OVERLAY_HIDDEN = { color: '#00000000', symbolColor: '#00000000', height: 1 }

module.exports = { VIDEO_EXTS, SORTABLE_COLUMNS, TAG_DELIM, FAV_Y, FAV_N, COVER_DIR, IMAGE_DIR, PREVIEW_MIN_BYTES, posterRelPath, previewRelPath, actressRelPath, TITLEBAR_OVERLAY, TITLEBAR_OVERLAY_HIDDEN }
