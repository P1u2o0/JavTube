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
const SORTABLE_COLUMNS = ['id', 'ph', 'pm', 'pfs', 'yz', 'tjrq', 'fxrq', 'zb', 'tix', 'cl', 'play_time']

// 标签分隔符（项目约定：中文逗号「，」）
const TAG_DELIM = '\uff0c'

// 收藏标记值（movies.cl 字段：'y' 已收藏 / 'n' 未收藏）
const FAV_Y = 'y'
const FAV_N = 'n'

// 封面图片子目录名（相对于应用数据目录 dataDir）
const COVER_DIR = 'covers'

module.exports = { VIDEO_EXTS, SORTABLE_COLUMNS, TAG_DELIM, FAV_Y, FAV_N, COVER_DIR }
