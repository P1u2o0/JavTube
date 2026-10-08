# AGENTS.md —— 接手开发的入口文档

> **这是一份给「第一次接触本项目的人和 AI」的入口文档。读完这一份就能开工。**
>
> - 环境坑 / 发版流程 / 历史事故的完整记录 → [`HANDOFF.md`](HANDOFF.md)
> - 架构、数据库、IPC 通道、刮削链路的全表 → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
> - 用户可见的功能介绍 → [`README.md`](README.md)
> - 发版怎么做 → [`scripts/release/README.md`](scripts/release/README.md)

---

## 0. 这是什么

JavTube 是一个 **Windows 桌面端的本地影片库管理工具**。把硬盘里的影片登记进来，自动刮削元数据
（番号、片名、演员、标签、评分、想看/看过人数、预览图），然后用海报墙浏览、按标签筛选、收藏、记录观看。

- **纯本机应用**：所有数据只在 `data/` 目录（SQLite + 封面缓存），**不上传任何内容**；除刮削外无需联网。
- **没有后端、没有账号**、没有云同步。单进程 Electron 应用。
- 分发形态：Windows x64 便携版 zip，解压即用（含 Electron 运行时 + mpv 播放内核，约 174 MB）。

| 层 | 选型 | 说明 |
|---|---|---|
| 外壳 | Electron 40.10.6 | 主进程 + 渲染进程，`contextIsolation` 开启。**窗口 `transparent: true`**（mpv 内核的画面从页面镂空处透出，见 §2.2 的 `src/player/`） |
| 渲染层 | Vue 3 `<script setup>` + Vue Router 4 + Pinia 2 + Element Plus 2.8 | 路由用 **Hash 模式**，组件全静态引入（不懒加载） |
| 构建 | Vite 5.4（`vite.config.mjs`）+ electron-builder 24 | dev 模式下 Vite 自己 spawn Electron |
| 数据库 | **sql.js 1.10**（SQLite 的 WASM 版） | **全内存 + 同步 API**，靠 `persistSoon` 定时整库写盘 —— 见 §4 |
| 播放器 | 内置播放页有**两套内核**：mpv（默认，「兼容模式」）+ ArtPlayer 5.4（「标准模式」）；另有可配置外部播放器 | 内核由设置项 `player_kernel` 切换，内置/外置由 `use_builtin_player` 切换。**页面只准依赖 `src/player/` 的契约** |
| 网络 | **系统 `curl.exe`**，不是 Node 的 http | 见 `electron/main/net-curl.js`；原因写在 HANDOFF §6 |
| 样式 | 手写 CSS + `src/styles/global.css` 里的设计令牌 | 全站颜色/圆角/阴影都取自令牌，不要硬编码色值 |

---

## 1. 五分钟上手

```bash
# 依赖已随包提供（node_modules 在位）；若缺失则：
npm install

# 开发模式：Vite(5173) + Electron，前端热更新
npm run dev

# 改完 electron/ 必跑：静态查「调用了但没定义」的标识符（会漏掉运行时才炸的批量替换错误）
npm run check:undefined
```

**改代码后要重启/重建的情况**：

| 改了什么 | 要做什么 |
|---|---|
| `src/**`（前端） | 不用管，Vite 热更新 |
| `electron/**`（主进程） | **重启** `npm run dev`（主进程不热更） |
| 想用 `npm start` 或打包 | 先 `npm run build` —— 非 dev 模式加载的是 **`dist/`**，不重建就是旧代码 |

双击 `start.bat` 等价于 `npm run dev`。

### 验证手段（按改动范围挑）

```bash
npm run check:undefined        # electron/ 静态检查（秒级）
npm run audit:wiring           # 渲染层事件 / preload 接口 / IPC 通道三端接线审计（秒级）
npm run test:devdb             # dev 数据库安全助手自检（19 项，用假库，不碰真库）
npm run test:restore           # 数据库备份/恢复回归（约 40s）
npm run test:persist           # 落盘机制（约 15s）
npm run test:persist-coalesce  # 落盘合并窗口单测
npm run test:fill              # 刮削「补全字段」逻辑单测
npm run scrape:test            # 刮削全链路冒烟（脱离 Electron 直跑，需联网+代理）
npm run verify:player-ui       # 播放页 UI 套件（CDP 探针，屏外窗口，约 1 分钟）
```

> ⚠️ 所有会碰数据库的脚本都要先快照、跑完复核。规则见 §4。

---

## 2. 我该改哪里 —— 模块地图

### 2.1 主进程 `electron/`

| 文件 | 职责 |
|---|---|
| `main/index.js` | 入口与启动时序：数据目录定位/迁移 → 数据库初始化 → 注册各 IPC 模块 → 建窗口。**具体 IPC 已拆走**，这里只做编排 |
| `common/ipc-channels.js` | **所有 IPC 通道名的唯一事实来源**（52 个）。新增通道必须在这里加一行，preload 与 main 都引用它 |
| `main/constants.js` | 跨文件共享常量：视频扩展名白名单、排序白名单、标签分隔符、封面目录名等 |
| `main/db/init.js` | 数据库加载/创建、**表结构定义**、默认设置、建索引、`persistSoon` 脏标记落盘机制 |
| `main/db/movies.js` | 影片增删改查、批量操作、搜索；`recordPlay`（播放次数） |
| `main/db/actress.js` | 演员相关：`actor:films` / `actor:overview` / 女优头像补全 |
| `main/db/player.js` | 内置播放页后端：播放进度记忆（`play_pos`/`play_dur`）、相关推荐 |
| `main/db/settings.js` | 设置读写、标签分类（存 JSON 文件）、数据库备份/恢复/清空、数据目录路径 |
| `main/db/images.js` | 失效图片检查与修复（封面 / 预览图） |
| `main/db/cleanup.js` | 删记录后清理本地图片文件 |
| `main/db/util.js` | sql.js 查询结果转换（`rows`/`firstRow`/`firstScalar`）、`nowLocal` 时间格式、`persistSoon` |
| `main/home.js` | 首页三块推荐数据（轮播 / 喜爱类别 / 每日上新） |
| `main/scraper.js` | **刮削核心**：JAVDB + JAVBUS 抓取与字段解析、图片下载。改动风险最高，改前先读 HANDOFF §5.3 |
| `main/net-curl.js` | 基于系统 curl 的 HTTP 客户端（代理、Cookie、按域名决定直连/代理） |
| `main/media-protocol.js` | `javtube-media://` 协议：把本地视频以支持 **Range** 的方式给 `<video>` |
| `main/cover-protocol.js` | `javtube-cover://` 协议：把本地图片安全地给 `<img>` |
| `main/video-meta.js` | 零依赖解析 MP4/MOV 时长（无刮削数据时的兜底） |
| `main/ipc-utils.js` | 工具类 IPC：播放视频、扫描目录、系统对话框封装 |
| `preload/index.js` | **渲染进程与主进程的唯一桥梁**，把 IPC 暴露成 `window.api`。改接口必须同步改这里 |

### 2.2 渲染层 `src/`

| 文件 | 职责 |
|---|---|
| `main.js` | Vue 应用入口，注册插件与全局组件 |
| `App.vue` | 根组件：顶部导航 + 内容区 |
| `router/index.js` | 路由表（Hash 模式）。见下方路由表 |
| `store/movies.js` | **核心 store**：影片列表、分页、排序、标签筛选、批量选择、与 `window.api` 的交互 |
| `store/scrape.js` | 刮削任务进度与「待刮削」队列 |
| `utils/global.js` | 工具函数集合：封面路径解析、番号提取、刮削结果映射、全局响应式数据目录引用；`resolveMedia()`（自定义协议 URL）与 **`resolveMediaPath()`（真实路径，mpv 用）** |
| `utils/playback.js` | **统一的「打开影片」入口** —— 内置/外置播放器的分派都走这里，不要各处直接 `push('/play/:id')` |
| `composables/useMovieList.js` | 列表页（片库/喜欢/记录）的公共交互：批量选择切换、翻页回顶 |
| `composables/useImageRepair.js` | 图片检查与修复的前端逻辑（设置页按钮 + 启动自动检查共用） |
| `styles/global.css` | **设计令牌总表**（颜色/圆角/阴影/字体）。改 UI 前先看它 |
| `views/Home.vue` | 首页（三块推荐面板） |
| `views/Library.vue` | 片库页（标签筛选 + 状态栏 + 网格 + 分页） |
| `views/Favorite.vue` | 喜欢页 |
| `views/History.vue` | 观看记录页（按播放时间倒序） |
| `views/Detail.vue` | 影片详情页（信息 + 预览图画廊 + 演员 + 操作） |
| `views/Player.vue` | **内置播放页**（播放内核 + 右侧相关推荐 + 键盘控制 + 播放失败提示 + mpv 模式的挖洞遮罩）。全项目最大的单文件 |
| `views/Actresses.vue` | 演员页（头像墙 ⇄ 热度排行 双视图） |
| `views/ActorFilms.vue` | 某位演员的全部影片页 |
| `components/*` | 见下 |

**播放内核（`src/player/`）**：播放页与内核之间的唯一接口层，2026-10-07 抽象、10-08 接入 mpv。
`backend.js`（契约 + `PLAYER_EVENTS` + `PLAYER_KINDS`）、`chromium-backend.js`（ArtPlayer，**全项目唯一**允许出现 `Artplayer` 的文件）、`mpv-backend.js`（mpv 独立进程）、`index.js`（`createBackend(kind)` 工厂）。
**改播放相关代码前必读 `docs/MPV_INTEGRATION_PLAN.md`**（内部文档）。三条硬约束：① 页面不得直接 import 任何内核；② 契约里 `element` 允许为 null（mpv 没有 `<video>`），健康检查一律用 `isPlayable()`；③ 契约的状态属性是同步读的，外部内核必须自己缓存。

**公共组件**：`TopNav`（顶部导航+搜索）、`MovieGrid` / `MovieCard`（网格与卡片）、`TagFilter` / `TagChip`（标签筛选）、
`SortDropdown`（排序）、`StatusBar`（总数/批量操作/分页）、`SettingsDialog`（设置弹窗，**第二大的单文件**）、
`AddMovieDialog`（导入容器）+ `ScanDirForm`（扫描目录导入）/ `ManualForm`（手动录入，与编辑复用）、
`CoverImg`（图片失败回落）、`AppIcon`（**全站统一图标，24×24 viewBox**）、`BackButton`。

### 2.3 路由表

| 路径 | 视图 | 说明 |
|---|---|---|
| `/` | Home | 首页 |
| `/library` | Library | 片库（搜索也走这里，用 `q` 参数） |
| `/favorite` | Favorite | 喜欢 |
| `/history` | History | 观看记录 |
| `/actresses` | Actresses | 演员 |
| `/detail/:id` | Detail | 影片详情 |
| `/actor/:name` | ActorFilms | 演员影片 |
| `/play/:id` | Player | 内置播放页 |

---

## 3. 数据流与 IPC

```
Vue 组件
   ↓ (读/写)
Pinia store（src/store/*.js）
   ↓ window.api.xxx(...)
preload（electron/preload/index.js，contextBridge 暴露）
   ↓ ipcRenderer.invoke(通道名)
main 进程 handler（ipcMain.handle，按模块注册在 electron/main/db/*.js 等）
   ↓
sql.js（全内存数据库，同步 API）
   ↓ persistSoon() 脏标记 + 定时器（默认 10s）
磁盘 data/app.db（整库导出写回）
```

**关键约束**：

- 通道名一律从 `electron/common/ipc-channels.js` 取，**不要写字符串字面量**。
  拼错的通道会静默返回 `undefined`（invoke 找不到 handle 不报错），非常难查。
- 新增一个 IPC 要改 **三处**：`ipc-channels.js`（常量）→ `preload/index.js`（暴露）→ main 里的 `ipcMain.handle`。
  改完跑 `npm run audit:wiring` 验证三端接线一致。
- 渲染层拿不到 Node API，只能用 `window.api`。

### 自定义协议

| 协议 | 用途 | 实现 |
|---|---|---|
| `javtube-cover://` | 给 `<img>` 提供本地图片 | `cover-protocol.js` |
| `javtube-media://0/<base64url>` | 给 `<video>` 提供本地视频，**支持 Range** | `media-protocol.js` |

媒体协议的错误码约定：`fs.stat` 失败 → **404**；扩展名不在白名单 → **415**；其它异常 → **500**。

---

## 4. ★ 数据安全：动手前必读

这一节是硬规矩，违反会**不可逆地损坏用户数据**。

### 4.1 用户数据在哪里

| 场景 | 数据库路径 |
|---|---|
| 打包后的正式版 | `<exe 所在目录>/data/app.db`（扁平结构，`data/` 与 exe 同级） |
| **开发时** | `node_modules/electron/dist/data/app.db` ← 因为 dev 时 electron.exe 在这个目录 |

数据目录里还有 `images/`（每部影片一个文件夹：海报 + 预览图；`actress/` 为女优头像；
3.2.1 起新布局，更早版本为 `covers/`，升级时自动迁移）和 `tag-categories.json`。**这些全部是用户数据。**

### 4.2 三条铁律

1. **绝不删除或覆盖 `data/` 目录**。任何安装/更新脚本都必须跳过它，并在前后校验 `app.db` 字节数一致。
2. **任何会写数据库的动作，先声明、先快照、跑完复核**。
   包括：跑 `scripts/test-*.js`、跑 CDP 探针、起应用点一下「喜欢」或进播放页。
3. **回归脚本一律用 `scripts/_devdb.js` 做快照/还原**，不要自己写备份逻辑。

```js
const devdb = require('./_devdb.js')
const snap = devdb.takeSnapshot('my-test', LIVE)   // 拿不到有效快照会抛错，绝不静默降级
try { /* ...测试，随便写库... */ } finally { devdb.restoreSnapshot(snap) }
```

### 4.3 已经踩过的两个坑（务必不要再犯）

- **`new SQL.Database(buf)` 会「就地改写」你传进去的那个 Buffer**。
  sql.js 经 Emscripten MEMFS 直接拿这片内存当文件的底层存储。所以
  **凡是要交给 sql.js 的 Buffer，一律先 `Buffer.from(x)` 复制一份**。
  2026-09-30 就是因此把测试标记写进了真库，而且因为比对用的也是同一片脏内存，**流程还报 OK**。
  取证脚本：`scripts/diag-buffer-share.js`；`_devdb` 内部用独立的 `pristine` 副本兜住了这条。
- **回归脚本不要写死 `movies.id`**。dev 库的 id 会漂移（当前 10..318），
  写死 `WHERE id=8` 会变成「改动 0 行」，断言恒成立 —— 一个永远假绿的测试。

> 想知道「跑完到底写了什么」，用 `node scripts/devdb-diff.js <快照>` 做**字段级**比对，
> 用 `node scripts/devdb-restore.js <快照>` 精确回滚。库 sha 变了只说明「有人写过」，
> SQLite 每次整库导出字节都不同，**不能凭 sha 判断数据被写坏**。

---

## 5. 雷区清单

按「踩过的次数 / 排查成本」排序，前几条务必读。

1. **`MEDIA_ERR_SRC_NOT_SUPPORTED`(4) ≠ 格式不支持。**
   Chromium 把「资源打不开」（自定义协议 404/415/500、SMB 瞬时读失败）也报成 code 4。
   不能凭 code 4 断言解码器问题。判据要基于**当前状态**而不是「累计错误次数」。
   详见 HANDOFF §5.6（改播放页前必读）。
2. **ArtPlayer 设置面板宽度**由 `this.active[0]?.$parent?.width || SETTING_WIDTH(250)` 决定，
   两态会不一样宽。`src/views/Player.vue` 导入区把两个常量一起钉到 200 修掉了这个问题，
   顺带让面板不再贴着视频右边框。改那里之前先读 HANDOFF §5.7。
3. **`ELECTRON_RUN_AS_NODE` 必须清掉**再启动 Electron，否则 electron.exe 退化成纯 Node，
   `require('electron').app` 是 undefined 直接崩。自己 spawn Electron 的脚本要
   `delete env.ELECTRON_RUN_AS_NODE`（并连带清 `NODE_OPTIONS` / `NODE_PATH` / `VITE_DEV_SERVER_URL`）。
4. **`NODE_OPTIONS` 注入的 shim 会让报错内容失真**：删除失败会显示成
   `[safe-delete] ... trash operation`（看起来像「目录被句柄锁死」，其实是 shim 劫持了 fs）。
   要看到真实的 `EBUSY`/`EPERM` 必须 `unset NODE_OPTIONS`。
   同理它让 `execFileSync` 取输出必失败 —— 要用 `stdio: ['ignore', fd, 'inherit']`。
5. **删除/改名不要用 shell**。Git Bash 的 `rm` 会被 shim 拦；`cmd //c rd` 会被 bash 吃掉反斜杠。
   统一用 Node 的 `fs.rmSync` / `fs.renameSync`（`scripts/release/cleanup-residue.js` 就是为此而生）。
6. **JAVDB 抓取需要 Cookie + 代理**，且 Electron 的 `net.fetch` **不能手动设 Cookie 头**
   （Fetch 标准把 Cookie 列为 forbidden header，会被静默丢弃）—— 必须用 `session.cookies.set()`。
   这也是网络层改用系统 curl 的原因：Cloudflare 与图床按 TLS 指纹放行。
7. **打包含有「降级路径」**：Windows 上 `rename` 构建目录常被句柄挡住（`EPERM`），
   脚本会降级成「复制合并」，**理论上会残留上一版的独有文件**。
   所以每次发版都必须跑 `node scripts/release/verify-asar.js` 逐文件核验，不能只看「打包成功」。
8. **`play_time` 是本地时间格式**（`YYYY-MM-DD HH:mm:ss`），**不是 ISO 8601**。
   跟它比较的阈值也必须用 `nowLocal` 生成，否则跨时区/跨格式比较会错。
9. **动效有明确预算**（2.9.0 起）。改动画前读 HANDOFF §5.5，别凭感觉调时长曲线。
10. 库里的 `websites` 表是**历史遗留**（「网站」功能已下线），不要再往上面加功能。

---

## 6. 命令速查

```bash
npm run dev                  # 开发（Vite + Electron）
npm run build                # 构建 dist（打包/非 dev 运行前必需）
npm run release              # 打包 Windows x64 zip → release/JavTube-vX.Y.Z-win-x64.zip
npm run clean                # 清理构建产物

npm run check:undefined      # 主进程「调用但未定义」静态检查
npm run audit:wiring         # 三端接线审计（渲染层事件 / preload / IPC 通道）
npm run test:devdb           # dev 库助手自检（19 项）
npm run test:restore         # 数据库备份恢复回归
npm run test:persist         # 落盘机制
npm run test:persist-coalesce# 落盘合并窗口
npm run test:fill            # 刮削补全字段单测
npm run scrape:test          # 刮削全链路冒烟
npm run verify:player-ui     # 播放页 UI 套件（CDP）
npm run verify:media-error   # 播放失败提示的两向验证
npm run watch:devdb          # 看门狗：盯「谁在改库」（45s）

node scripts/devdb-diff.js <快照>     # 字段级比对：跑完到底写了什么
node scripts/devdb-restore.js <快照>  # 精确回滚 dev 库
node scripts/probe-playbackrate-size.js  # 倍速面板尺寸探针（屏外窗口 + 截图）
node scripts/diag-buffer-share.js        # sql.js 就地改写 Buffer 的取证
```

> **两条已知误报**（静态工具的能力边界，不是代码问题，别去"修"）：
> - `npm run check:undefined` 会报 `electron/main/scraper.js` 的 `_l_(` / `_s_(`
>   —— 那是**正则字面量**（`/_l_(\d+)\./`），扫描器把它当成函数调用了。
> - `npm run audit:wiring` 会提示 `savePlayProgress` 未在渲染层使用
>   —— 实际在用（`Player.vue` 多处），只是检测没识别 `window.api?.savePlayProgress(...)` 这种**可选链**写法。

**发版**（完整流程见 [`scripts/release/README.md`](scripts/release/README.md)）：

```bash
npm run release
node scripts/release/verify-asar.js                      # 核验产物（每次改 VERSION + 特征串）
python scripts/release/make-release.py vX.Y.Z --body tmp/release-body.md
# 附件上传：curl --noproxy "*" 直连 uploads.github.com（走代理会慢到传不完）
python scripts/release/gh-releases-check.py              # 回读确认 state=uploaded
node scripts/release/install-local.js <zip> --apply      # 更新本地正式版（默认 dry-run）
node scripts/release/cleanup-residue.js --apply          # 清理残留
```

---

## 7. 代码约定

- **注释用中文**，且写「为什么」而不是复述代码。每个源文件顶部要有块注释说明职责；
  复杂的时序/坑点要在**现场**写清（这个项目的历史注释质量很高，请保持）。
- 主进程模块用 JSDoc 风格：`@file` / `@module` / `@description` / `@dependencies` / `@keyAPI`。
  渲染层组件用：`文件名 / 所属模块 / 功能描述 / 视觉规范`。
- **UI 一律用 `src/styles/global.css` 里的设计令牌**，不要硬编码颜色、圆角、阴影。
- 图标一律用 `AppIcon` 组件，不要内联 SVG。
- 用户是**设计敏感型**的：改 UI 时注意跨页面一致性（片库/演员页共用瀑布流样式、标签筛选、排序栏），
  动效要平滑自然，数值微调习惯用相对百分比（「再缩小 2%」）而不是绝对值。
- **改业务逻辑前先确认理解**：这个项目里很多实现是为了绕开具体的浏览器/系统坑（见 §5），
  「看起来多余的代码」往往是有原因的。逻辑不清晰时停下来问，不要直接删。
- 提交信息不要出现账号、token、Cookie 等凭据，也不要出现本机绝对路径。

---

## 8. 版本控制说明

`.gitignore` 刻意排除了几类内容。其中**有两类目录在交付包里实际存在、但不受 git 跟踪**：

| 路径 | 交付包里 | git 跟踪 | 说明 |
|---|---|---|---|
| `src/` `electron/` `scripts/`（根下除 release） `AGENTS.md` `HANDOFF.md` `README.md` | ✅ | ✅ | 正常跟踪 |
| `docs/` | ✅ 在 | ❌ **忽略** | 内部文档（`ARCHITECTURE.md`、历史审计报告），按项目约定「仅本地保留、不公开」 |
| `scripts/release/` | ✅ 在 | ❌ **忽略** | 发版工具链（含本机路径约定），按「发布脚本仅本地用」约定排除 |
| `node_modules/` `dist/` | ✅ 在 | ❌ 忽略 | 依赖与构建产物 |
| `tmp/` `release/` `out-portable/` | ❌ 不在 | ❌ 忽略 | 调试产物与构建输出，未随包交付 |

> ⚠️ **不要对仓库执行 `git clean -fdx`** —— 它会把上面「在但被忽略」的目录一并删掉。
> 若需要把这些目录纳入版本控制：`git add -f docs scripts/release`。

---

## 9. 文档索引

| 文档 | 内容 | 什么时候读 |
|---|---|---|
| `AGENTS.md` | 本文，入口 | 第一次接手 |
| `HANDOFF.md` | 开发交接书：环境坑、命令、关键机制、已知坑、调试指南 | 动手前；遇到怪问题时 |
| `docs/ARCHITECTURE.md` | 架构、数据库表结构、IPC 通道全表、刮削链路、动效预算 | 要改数据层/网络层时 |
| `scripts/release/README.md` | 发版完整流程与工具说明 | 要发版时 |
| `README.md` | 面向用户的功能介绍 | 了解产品形态 |
| `docs/PROJECT_BRIEF.md` | 项目档案（较早期） | 想了解设计初衷 |
| `docs/audits/` | 历史审计与修复报告（性能、UI、头像、代码审查） | 想查「某处为什么这么写」 |
| `docs/CODE_AUDIT.md` / `APPLE_AUDIT.md` / `PERF_PLAN.md` | 早期的代码审查、Apple 设计合规审查、性能方案 | 追溯历史决策 |

---

## 10. 你现在应该做什么

1. 读 §0–§2，建立全局认知（约 10 分钟）。
2. 读 §4、§5，把不能碰的地方和雷区记牢（**这一步别跳**）。
3. `npm run dev` 把应用跑起来，点一遍五个主页面 + 设置弹窗。
4. 明确要改的需求 → 在 §2 的模块地图里定位文件 → 读该文件头部注释与邻近实现。
5. 动手前跑一次相关回归脚本建立基线；改完再跑一次，确认没有回归。
6. 涉及数据库的改动，按 §4.2 快照/还原。
