# JavTube 开发交接书

> 面向接手本项目的开发者 / AI 会话。**本文只讲架构与命令**。
> 面向使用者的功能介绍见 `README.md`，许可见 `LICENSE`。
>
> **当前版本：v2.9.0**（2026-09-30）｜更新本文时请连同这里的版本号一起改。

---

## 1. 项目定位

**JavTube** —— 用 **Electron 30 + Vue 3 + Vite 5 + Element Plus + Pinia + sql.js** 写的
**纯本地**影视库管理软件（元数据刮削 / 整理 / 分类标签筛选 / 浏览播放）。

全部数据保存在本机，不上传任何内容。

---

## 2. 环境准备

**依赖**：Node 22（更高版本未验证）。

```bash
npm install
```

### ⚠️ 启动前必须清掉 `ELECTRON_RUN_AS_NODE`

部分受管终端会话会注入 `ELECTRON_RUN_AS_NODE=1`，此时 `electron.exe` 会退化为纯 Node 运行，
`require('electron')` 拿不到 API，启动即崩（报 `Cannot read properties of undefined (reading 'commandLine')`，
且堆栈显示 `Node.js v20.x`）。**启动前先 unset**：

```bash
unset ELECTRON_RUN_AS_NODE      # ← 关键，否则 Electron 变纯 Node 启动失败
npm run dev
```

### ⚠️ 同时留意 `NODE_OPTIONS`：它注入的 fs shim 会让「报错内容本身失真」

受管会话还会注入 `NODE_OPTIONS=--require .../shim/node-language-shim.cjs`。它 hook 了 `fs`
与 `child_process`，后果是**报错信息不可信**（不是功能坏了，是错误来源被替换了）：

| 现象 | 真相 | 正确做法 |
|---|---|---|
| `fs.rmSync` 报 `[safe-delete] ... Error during a 'trash' operation` | 看着像「文件被句柄锁死」，其实只是该 shim 把删除劫持去走回收站失败 | **`unset NODE_OPTIONS` 后重跑**，才会看到真实的 `EBUSY` / `EPERM` |
| `spawnSync` / `execFileSync` 取输出必 `EBUSY` | 该 shim 打断了管道式 stdio | 用 `stdio: ['ignore', fd, 'inherit']`（打包脚本已封装成 `execFileCapture()`） |

**判断 gating**：排查任何「删不掉 / 调不动外部命令」的问题，**先确认 `NODE_OPTIONS` 是否为空**，
再决定是不是真故障。写临时脚本时可在开头加自愈重跑（见 `scripts/` 之外的参考实现）。

---

## 3. 常用命令

```bash
# 开发启动（DevTools 自动打开）
npm run dev

# 构建验证（改完必跑，约 5s）
npx vite build

# 主进程「调用但未定义」静态检查（改 electron/ 代码后必跑，见 §6 坑 9）
npm run check:undefined

# 刮削全链路冒烟（脱离 Electron 直接跑 scrapeMovie；改 scraper / net-curl 后必跑）
npm run scrape:test                 # 可传番号：npm run scrape:test -- <番号>

# ★ 数据库恢复回归（改 settings:restore / init.js 落盘逻辑后必跑；约 40s，自带备份还原）
npm run test:restore                # 断言：恢复后关窗不会被内存旧库覆盖
npm run test:persist                # 断言：普通会话的定时/关窗落盘没被误伤

# ★ 补全字段逻辑（改 buildScrapeUpdate / 刮削来源相关代码后必跑）
npm run test:fill                   # 纯函数单测，秒级，无需网络
npm run test:fill:e2e               # 端到端（需网络+代理，自带 dev 库备份还原）

# ★ 接线审计（改渲染层事件 / preload 接口 / IPC 通道后必跑；秒级）
npm run audit:wiring                # 死按钮、死事件、未暴露接口、safeCall 误用

# ★ 落盘合并窗口单测（改 db/util.js persistSoon 后必跑）
npm run test:persist-coalesce

# ★ dev 库善后（跑完探针/回归后，看「到底写了什么」/ 精确回滚；见 §8）
node scripts/devdb-diff.js [快照.bak]      # 不传参数取 tmp/_devdb 里最新一份；只报字段级差异
node scripts/devdb-restore.js <快照.bak>   # 逐字节回滚，自带 SQLite 头校验 + 回读比对

# 主进程语法检查（批量）
for f in electron/main/*.js electron/main/db/*.js; do node --check "$f"; done

# 发版：打包 Windows x64 zip —— 一条命令
npm run release

# 清理构建产物（release/ + dist/，带句柄重试）
npm run clean
```

**脚本一览**：`scripts/check-undefined.js`（未定义引用静态检查）、`scripts/scrape-smoke.js`（刮削冒烟）、
`scripts/build-portable.js`（打包，见 §4.1）、`scripts/clean.js`（清理产物）、
**`scripts/_devdb.js`（★ dev 库快照/还原助手，见 §6 坑 17 —— 任何会写 dev 库的脚本都必须用它）**。

---

## 4.1 打包（发版必读）

`npm run release` → 产出 **`release/JavTube-v<版本>-win-x64.zip`**（约 102 MB）。
同目录还会留下解压好的 `release/JavTube/`，可直接双击 `JavTube.exe` 试跑。

解压即用、免安装，数据在 exe 同级的 `data/`，升级只需覆盖文件（别覆盖 `data/`）。

一条命令做完这些事（**6 步**）：清理历史残留 → `vite build` → `electron-builder --dir` →
瘦身 `app.asar` → 整理目录 + 写 `使用说明.txt` → **写 exe 图标与版本信息** → 自检 → 打 zip。

### ⚠️ exe 图标：改打包配置前必读

**`package.json → build.win.signAndEditExecutable` 必须保持 `false`。**
一旦改成 `true`，electron-builder 会去解压 `winCodeSign` 归档，而该归档含 macOS 符号链接
（`darwin/10.12/lib/*.dylib`），**普通权限的 Windows 解不开**，直接报
`Cannot create symbolic link：客户端没有所需的特权`，整个打包失败。

代价是这个开关同时也关掉了 electron-builder 往 exe 写图标/版本信息的能力 ——
所以 **图标由 `scripts/build-portable.js` 的 `embedIcon()` 用 rcedit 补写**。

> **历史教训（v1.0 踩过）**：因为漏了这一步，打进包的 `JavTube.exe` 与原生 `electron.exe`
> **字节数完全一致（177,038,336）= 图标压根没嵌进去**，用户拿到的就是 Electron 默认图标。
> 当年还为此单独写了 `rcedit.exe` + `replace_icon.py` 手动补图标（已删除），
> 其实根因就是这个开关。
>
> **判断有没有嵌进去**：`ls -l JavTube.exe` 若等于 `node_modules/electron/dist/electron.exe`
> 的字节数，就是没嵌。嵌好后应改为 **177,027,072**，且图标资源从 4 档变 6 档
> （与 `build/icon.ico` 的 6 档逐字节一致）。
> 脚本自检里已加这道校验（读回 exe 的 `ProductName` 必须等于 `JavTube`，否则报错）。

rcedit 不在仓库里，`embedIcon()` 按此顺序找：electron-builder 缓存 →
从缓存 `winCodeSign/*.7z` 单独解出 → `app-builder prefetch-tools` 拉一次 →
都没有则**打醒目警告继续打包**（exe 会是默认图标，但流程不中断）。

### ⚠️ app.asar 会瘦身，别以为打错了

electron-builder 会把**整个 node_modules** 塞进 asar（实测 **85.6 MB**，连它自己的 devDeps 都在内），
但运行时主进程只 `require('sql.js')`，渲染层已被 Vite 打进 `dist/`。
脚本用 `@electron/asar` 重打，只留 `dist/ + electron/ + package.json + sql.js 的两个文件`：

**85.6 MB → 2.7 MB**（整包 339 MB → **257 MB**）。

### ⚠️ 三个环境坑（前两个已在脚本里绕过）

1. **`app.asar` 会被句柄占住** —— 复用同一个输出目录时，electron-builder 删不掉上次的
   `app.asar`，直接报 `The process cannot access the file because it is being used by another process`
   并失败。**脚本改为每次用带时间戳的唯一临时目录 `release/.build-<ts>`** 绕开。
   被占住的旧目录删不掉也没关系，重启后可清。
2. **`rm -rf` 在受管环境会被安全删除层拦截**（路由到回收站失败即整体失败）。
   脚本统一用 Node `fs.rmSync` + 重试；**先递归删文件、再删目录**成功率最高。
   排查这类问题时先读 §2 的 `NODE_OPTIONS` 说明 —— **报错文本可能本身是假象**。
3. **★「改名 → 复制合并」降级是常态，且危害是静默的**（v2.7.0 / v2.8.0 / v2.9.0 **连续三版**都撞上）：
   第 4 步 `remove(OUT_DIR)` 删不掉 `release/JavTube` 时改用 rename，而 rename 也可能 5/5 `EPERM`
   （日志：`rename 第 5/5 次失败：EPERM` + `改用复制（源目录请稍后手动清理）`）。
   **降级后 zip 照样生成、自检照过**，理论上会残留上一版独有的文件。
   ⇒ **不能只看「打包成功」**，必须做下面的独立核验。

### ★ 打包后必做：独立核验（三步，缺一不可）

1. **asar 四层比对**：`dist` 双向哈希（asar 内 ↔ 本地）、`electron/**` + `package.json` 逐文件哈希、
   **本期特征字符串探针**、产物目录卫生（**文件数基线 73** + 无 `.old-` / `.build-` / `.tmp` 残留）。
   现成脚本：`tmp/verify-asar-290.js`（照抄后只改 `VERSION` 与特征字符串即可）。
   > 特征字符串的正确取法：先在源码 grep 出**真实标识符**，再 `git grep -c <串> HEAD` 确认它在
   > **上一版不存在**。否则探针等于没测（例如 `加载影片列表失败` 在 HEAD 里已有，只能当回归守卫）。
2. **干净环境启动**：解压到**带空格 + 中文**的路径，用**干净环境变量 + 非项目工作目录**启动。
   判据：日志出现 `[main] APP READY` / `initDb DONE` / `IPC OK` / `loadFile SUCCESS`、
   `data/` 建在 exe 同级、CDP 里 `window.api` 已注入、优雅关闭（`Browser.close`）后落盘。
   现成脚本：`tmp/verify-clean-run-290.js`。
   > 这条专门防「开发机上跑得好好的，别人机器上双击没反应」——`node_modules/electron` 就在旁边时，
   > 漏文件在本机也照样能跑。
3. **`--check-only` 复核**（见下）。

**独立复核任意一版（不构建）**：

```bash
node scripts/build-portable.js --check-only              # 默认复核 release/JavTube
node scripts/build-portable.js --check-only <解压后的目录>  # 复核别人给的包
```

### 产物自检（含「解压即用」自包含性）

`checkSelfContained()`（`scripts/build-portable.js`，构建第 5 步自动跑）：

- `JavTube.exe` / `resources/app.asar` / `使用说明.txt` / `data/` 在位
- **Electron 运行时 17 个必需文件**（`icudtl.dat`、`*.pak`、`snapshot_blob.bin`、
  `v8_context_snapshot.bin`、`d3dcompiler_47/ffmpeg/libEGL/libGLESv2/vk_swiftshader/vulkan-1.dll`、
  `vk_swiftshader_icd.json`、两份 LICENSE）+ `locales/*.pak`
  —— 缺任何一个，**在开发机上照样能跑**（`node_modules/electron` 就在旁边），
  只有在别人机器上才暴露成「双击没反应」，极难排查，所以要靠自检兜住
- asar 内含 `sql-wasm.wasm` 与 `dist/index.html`
- exe 版本信息已写入（`ProductName` 回读校验）
- 开发机绝对路径泄漏检查（asar 内出现项目路径 → 警告）

### 外部依赖（已实测：新电脑无需下载任何东西）

| 依赖 | 是否随包 | 说明 |
|---|---|---|
| Chromium / Node 运行时 | ✅ 打包在 zip 内 | Electron 自带，不需要装 Node |
| `sql.js` + `sql-wasm.wasm` | ✅ 在 app.asar 内 | 数据库引擎 |
| VC++ 运行库 / .NET | 不需要 | Electron 只用 Windows 自带 UCRT |
| `curl.exe` | ⚠️ 系统自带 | **仅刮削用**；Win10 1803+ 在 `System32` 自带，缺了不影响启动 |
| 播放器 | 可选 | 不配则用系统默认程序打开 |

系统要求写进了包内 `使用说明.txt`（Win10 1803+、避开 `C:\Program Files` 解压、
首启 SmartScreen 提示）。

### 发版后的残留清理

用 `github-release-windows` 技能里的两个常驻脚本（**别再临时手写**）：

```bash
python <skill>/scripts/gh-releases-check.py --repo=<O/R> --out=<repo>/tmp/_remote_assets.json
node   <skill>/scripts/cleanup-residue.js --repo=<repo> --keep-prefix=JavTube-v<版本>-          # 预演
node   <skill>/scripts/cleanup-residue.js --repo=<repo> --keep-prefix=JavTube-v<版本>- --apply  # 执行
```

> **删本地 zip 前必须先在远端确认同名附件 `state == 'uploaded'`**（v1.9.0 就漏传过，
> 本地那份是唯一副本）。脚本把这个判据做成了硬断言。
> 另：`release/` 下的 `.build-*` 常被句柄锁死删不掉（`EBUSY` / `EPERM`），**无害**
> —— 打包脚本开头会自愈扫掉，且 `makeZip()` 的残留检查只扫 `release/JavTube`，不会进 zip。

---

## 4.2 目录结构

```
javtube_dev/
├─ HANDOFF.md  README.md  LICENSE  package.json     # 根目录只留这些
├─ docs/                                            # 内部文档（.gitignore，仅本地保留）
├─ dist/                                            # Vite 产物（可随时删）
├─ release/                                         # 唯一构建输出根（可随时删，见 §4.1）
├─ scripts/                                         # 构建与检查脚本（含 _devdb.js）
├─ build/icon.ico                                   # 应用图标（打包时写进 exe）
├─ electron/
│  ├─ main/
│  │  ├─ index.js            # 主进程入口：启动序列 / 窗口 / 自定义协议注册
│  │  ├─ constants.js        # 主进程侧常量
│  │  ├─ ipc-utils.js        # 工具 IPC：playVideo(含文件存在校验)、扫描目录、readDuration、文件对话框
│  │  ├─ home.js             # 首页推荐 IPC
│  │  ├─ scraper.js          # 在线刮削：JAVBUS / JAVDB 解析（唯一出处）
│  │  ├─ net-curl.js         # 刮削网络层：基于系统 curl（见 §6 坑 11）
│  │  ├─ video-meta.js       # 纯 Node MP4 mvhd 时长解析（AVI/MKV 返回 0）
│  │  ├─ cover-protocol.js   # javtube-cover:// 协议实现（★ 2.9.0 加了 LRU + ETag，见 §5）
│  │  ├─ media-protocol.js   # javtube-media:// 视频流协议（支持 Range）
│  │  └─ db/
│  │     ├─ init.js          # sql.js 初始化 + WASM 定位 + 建库/迁移 + ★ensureIndexes
│  │     ├─ movies.js        # 影片 CRUD / 分页查询 / 批量操作
│  │     ├─ settings.js      # 设置读写 + 批量保存 + 标签类别 JSON + 备份/恢复/清空
│  │     ├─ actress.js       # 女优表 + ★头像待办缓存
│  │     ├─ images.js        # 封面缺失扫描 / 修复（★ 分片让出事件循环）
│  │     ├─ player.js        # 播放进度 + 口味画像推荐
│  │     ├─ cleanup.js       # 数据清理
│  │     └─ util.js          # persistSoon 等公共工具
│  ├─ preload/index.js       # contextBridge 暴露 window.api（**41 个成员 / 40 条通道**）
│  └─ common/ipc-channels.js # IPC 通道名常量（40 条，main / preload 共享唯一来源）
└─ src/
   ├─ router/index.js        # 静态引入全部页面（性能优化，勿改回懒加载）
   ├─ views/                 # Library(片库) Favorite(喜欢) History(历史) Detail(详情)
   │                         #   Actress(女优) ActorFilms(演员作品) Website(网址) Home(首页)
   │                         #   AddMovieDialog/ 下为添加影片的子表单
   ├─ components/            # MovieCard / MovieGrid / TagFilter / TagChip / StatusBar / TopNav /
   │                         #   SortDropdown / AppIcon(自绘 SVG 图标库) / SettingsDialog /
   │                         #   AddMovieDialog.vue / CoverImg.vue
   ├─ store/                 # Pinia：movies(三视图共享) / scrape / actress / website
   ├─ composables/           # useMovieList.js —— 列表页公共交互
   ├─ styles/global.css      # 设计令牌（含 ★动画时长变量）+ 全局样式
   └─ utils/global.js        # 番号解析、标签拆分、safeCall 等前端工具
```

**数据目录**：运行时数据（`app.db` + `covers/`）写在应用数据目录下，**不入版本控制**。

---

## 5. 关键机制（改代码前必读）

### 5.1 数据与并发

| 机制 | 说明 |
|---|---|
| **persistSoon** | sql.js 的 `persist` 是整库同步导出（阻塞主进程）。**三个 db 模块**（movies / settings / actress）的写操作统一用 `persistSoon(db)`（定义于 `db/util.js`）。**新增写操作必须用它** |
| **★ 落盘合并窗口** | `persistSoon` 是「前缘节流」：距上次落盘 >120ms 时**立即**落盘（单次写延迟不变），窗口内的后续写合并成窗口末尾的一次。<br>⚠️ **合并窗口的时间戳必须在落盘完成后（`finally`）才更新**：若在落盘**之前**打点，落盘自身耗时会污染下一次判断，窗口永远不成立（v2.9.0 修的就是这个，改前 30 次连写 = 30 次整库导出）。实测：**30 次连写从 30 次导出降到 2 次（降 93%）**。改这里务必跑 `npm run test:persist-coalesce` |
| **★ 索引** | `db/init.js` 的 `ensureIndexes(db)` 建 5 条索引（`fl` / `cl` / `play_time` / `tjrq` / `fxrq`），幂等。<br>⚠️ 调用点必须在「拦截 `db.run` 打 dirty」**之前**：只读启动不该因建索引而把库标脏、触发一次多余落盘。<br>规模注：308 部时收益是**亚毫秒**，价值要等库更大才体现 |
| **落盘失败会重试** | `saveDbToDisk` 返回布尔值；定时器与 `force` **仅在成功时清 `dirty`** → 一次写盘失败（磁盘满/占用）不会丢标记，下一轮还会重试 |
| **★ 数据库恢复需重启** | `settings:restore` 只替换磁盘文件，内存里仍是旧库 → 恢复后置 `db._blockPersist = true`，**一切落盘被 `saveDbToDisk` 拦截**（否则关窗的 `_forceSave`／10s 定时／`persistSoon` 会把刚恢复的文件覆盖回去，恢复白做）。前端弹「立即重启」→ `app:relaunch`（`app.relaunch()+exit`）。**改动这段务必跑 `npm run test:restore`** |
| **★ 启动期长任务必须分片让出** | `images.js` 的封面缺失扫描会遍历全库，纯同步会长时间占住主进程（实测阻塞峰值 **1771ms**）。现改为每 24 张 `await setImmediate` 让出一次 → 峰值降到 **≤43ms**。**任何启动期遍历都要照此办理** |
| **稳定分页** | 所有 `ORDER BY` 必须追加唯一 tie-breaker（`, id DESC`），否则同值行跨 LIMIT/OFFSET 查询顺序不保证 → 影片在页间跳动 |
| **★ 分页参数要有上界** | `movies.js` 的 `pageSize` 用 `Math.min(200, Math.max(1, Number(pageSize) || 20))` 夹住。否则异常参数会触发一次超大查询把界面卡死 |

### 5.2 IPC 与前端数据流

| 机制 | 说明 |
|---|---|
| **★ 接线审计** | 「按钮点了没反应」这类问题一律先跑 `npm run audit:wiring`（检查 ①`window.api.X` 是否暴露 ②接口→通道→`ipcMain.handle` 三方对齐 ③组件 emit 是否有人监听 ④`safeCall` 用法）。改事件/接口后必跑 |
| **IPC 通道** | 新增通道三步：`ipc-channels.js` 常量 → `preload/index.js` invoke → `electron/main/**` handle。**当前 40 条常量 ↔ 40 个 handler 一一配对（双向无孤儿）**，返回格式 `{ ok, data?, error? }` |
| **★ `loadMovies` 的返回契约** | `store/movies.js` 的 `loadMovies` 返回 `{ ok, total?, stale?, error? }`，三个出口语义不同：<br>· `ok:true` 结果已写入 store；<br>· `ok:false, stale:true` = **被更晚发出的请求取代**（静默，调用方**不要**据此提示用户）；<br>· `ok:false, error` = **最新请求但失败**（弹一次提示）。<br>越界重试的递归分支**必须透传**内层返回值，否则失败被吞掉（v2.9.0 前就是这样，界面「点不动」且无任何提示） |
| **设置批量保存** | 渲染端 `updateSettingsBatch(obj)`（`settings:updateBatch` 通道）一次事务写多键只落盘一次；不要逐键调 `updateSetting`（会卡） |
| **三视图共享 store** | 片库 / 喜欢 / 历史共用 `store.movies`——各视图挂载时必须重新加载自己视图的全量语义（片库=全量、喜欢=onlyFavorite、历史=historyOnly） |
| **★ 列表页不要在模板里调函数** | 模板里 `resolveCover(m)` 这类调用会在每次重渲染时重新解析（3 处实测）。改为在 `computed` 里**预解析**成 `avatarSrc` / `coverSrc` 字段。URL 字符串必须逐字符不变，避免缓存失效 |

### 5.3 刮削

| 机制 | 说明 |
|---|---|
| **★ 刮削来源「补全字段」** | `scrape_source='fill'`：照常走自动刮削，但落库前用 `buildScrapeUpdate(d, current, { fillOnly:true })`（`src/utils/global.js`）**只写当前为空/为 0 的字段**，已有值一律跳过；无缺失时不写库并提示「字段已完整」。0 与 `'[]'` 都算空（评分/想看/看过在库里以 0 表示无数据）。**统计字段只来自 JAVDB**：Cookie 过期或 Cloudflare 403 时会静默拿不到，故 `statsFillHint()` 会显式提示「未取到（检查 Cookie 与代理）」。单部（Detail）与批量（Library）共用同一套逻辑；补全时传 `skipPreviews` 避免重复下载已有预览图 |
| **刮削网络层** | 走系统 curl（`net-curl.js`）：页面请求按设置走代理并携带用户 Cookie；图片按域名决定代理/直连优先级；**不加 `-L`**（见 §6 坑 12） |
| **★ 头像 / 封面按需算 + 缓存** | `actress.js` 的 `avatarTodoOf`（`computeAvatarTodo` + 缓存包装）是 O(影片数) 的 cast_json 解析 + O(女优数) 次文件存在性检查。缓存指纹 = `moviesKey(db) + '|' + dataDir`，TTL 60s；**`invalidateActorCaches()` 必须一并清掉它**（否则补全头像后要等 60s 才生效）。实测冷 61.6ms → 热 0.14ms |
| **刮削进度** | 顶栏铃铛按钮（`useScrapeStore`：enqueue / begin / done / clear），红色角标=待刮削数量；单个与批量刮削都接入 |

### 5.4 媒体协议与视图

| 机制 | 说明 |
|---|---|
| **★ 封面协议 `javtube-cover://`** | `electron/main/index.js` 注册 privileged scheme，`cover-protocol.js` 解析。2.9.0 起加了 **内存 LRU**（200 项 / 32MB / 单张 4MB，超限走流式）+ **ETag（size-mtime）校验**；文件被覆盖写（重刮 / 修失效图都是**写回原路径**）时 mtime 变 → ETag 变 → 自动失效。取文件用 `fs.promises.readFile`，`ENOENT`/`EISDIR` → **404**（让 `<img>` 回落占位图，而不是等超时） |
| **⚠️ CSP 约束** | `index.html` 的 `connect-src` **不含** `javtube-cover:` → 渲染层 `fetch('javtube-cover:...')` 会被拦截；`img-src` 已放行，`<img>` 正常。**测这个协议必须走真实 `<img>` 路径**，用 fetch 测出来的「0ms 失败」是 CSP 造成的假象 |
| **⚠️ 写缓存头的坑** | 协议 handler 里 `u.pathname.split('/')` **忽略 query**，所以可以给同一文件挂 `?cb=<i>` 强制缓存未命中（探针常用）。另外**不要**给封面响应加 `cache-control: max-age=...`：文件会被原地覆盖写，长缓存会拿到旧图 |
| **媒体协议 `javtube-media://`** | 视频流，支持 Range |
| **灯箱查看器** | 详情页点击预览小图 → `<Teleport to="body">` 全屏遮罩 + 滚轮缩放 0.5-5x + 左右按钮/方向键循环 + Esc 关闭 |
| **详情页海报区** | 框尺寸 JS 计算：`min((视口高-300px)/海报高, 视口宽×0.56/海报宽)`，小分辨率海报强制放大；窗口 resize 重算 |
| **乐观更新（仅部分路径）** | `store.toggleFav` **不是**乐观更新：先 await IPC 写库、成功后才改状态（本地 sql.js 毫秒级，无需乐观）。其余写库已延迟落盘，UI 侧可乐观翻转、失败回滚 —— 改之前先确认具体函数实现，别照抄注释 |

### 5.5 ★ 动效时序（2.9.0 起有明确预算，改动画前必读）

| 令牌 / 类 | 值 | 用途 |
|---|---|---|
| `--dur-route` | **120ms** | 路由容器淡入。它**直接等于「点击后屏幕空白」的时长**，必须极短 |
| `--dur-enter` | **160ms** | 卡片 / 元素浮现 |
| `--dur-base` | 220ms | 通用过渡（**不要**再用在路由/入场这类「挡住内容」的地方） |

- **入场动画都带位移**（`.route-anim` / `.swap-in` 从 `translateY(6px)`、`card-in` 从 `translateY(14px)`）
  → **自动化读几何时必须先等动画结束**，否则会读到「差 6px」这种中间态
  （表现是断言间歇性失败、失败读数恰好 6.00px）。
- **错峰动画必须有固定预算**：`MovieGrid.vue` 的 `staggerDelay()` 是
  `step = clamp(round(160 / n), 2, 14)`，`delay = min(i*step, 160)`。
  **不要**改成「固定步长 × 卡片数」（卡片多时总时长线性膨胀，用户能明显感到越来越慢）。
- **重播抑制窗口** = 最大错峰 + 动画时长 + 余量 → 取 **420ms**。它必须**大于**错峰+动画之和，
  否则动画播到一半被 `animation: none` 打断会「啪」地跳到终态。
- **`prefers-reduced-motion`**：压缩 `animation-duration` 的同时**必须一起压 `animation-delay`**，
  否则「减少动画」下卡片仍然延迟出现（2.9.0 修的）。
- **`will-change` 要收敛**：常驻 `will-change` 会把元素提升到独立合成层，25 个以上反而拖慢。
  现按「可见卡片数」有条件开启（`Home.vue` 用 `rawAbs <= 4`）。
  ⚠️ 判断掉帧必须用**同进程交替 A/B/A/B**，不能「先跑完 A 再跑 B」—— 顺序设计会把离屏窗口的
  调度/GC 噪声误判成模式差异（这条踩过，得出了相反结论）。

### 5.6 ★ 播放失败的错误判定（2026-09-30 修误报，改播放页前必读）

`Player.vue` 的失败面板由 `mediaErr` 控制，判定**不能只看「有没有 error 事件」**：

| 事实 | 含义 |
|---|---|
| **`MEDIA_ERR_SRC_NOT_SUPPORTED`(4) 不等于「格式不支持」** | Chromium 把「**资源打不开**」（自定义协议返回 404/415/500、NAS/SMB 瞬时读失败、`FFmpegDemuxer: open context failed`）**也**报成 code 4。凭 code 4 断言「解码器不支持」就是原错误文案的由来 —— 而用户看到的「（MP4）不支持」其实是文件一时读不到 |
| **ArtPlayer 自带重连** | `RECONNECT_SLEEP_TIME=1000ms` 后重设 `url`，最多 `RECONNECT_TIME_MAX=5` 次。实测错误后 **1 秒 `canplay`/`playing` 正常到来、视频照常播放** ⇒ 绝大多数「错误」是一次性的 |
| **重连用的是 `art.option.url`，且 ArtPlayer 自己会同步它** | `url` setter 里有 `t.option.url = a`（源码级确认），所以**不会**重连回第一部影片 —— 这条曾被我误判为 bug，实测证伪 |
| **`<track default kind="metadata" src="">` 的 error 是噪音** | ArtPlayer 的 `<video>` 里带着这么个空 track，每次新媒体加载都会由它发一次 **不冒泡**的 `error`（target=TRACK、`video.error` 为 null）。ArtPlayer 的事件转发是**非捕获**绑定 ⇒ **永远收不到它**，与失败面板无关。探针若用 `capture:true` 会抓到它，**必须同时记录 `event.target` 身份**才不会误判 |

**现行判据**（`Player.vue` 的 `onMediaError` / `recheckMediaErr` / `onMediaRecovered`）：

1. `video:error` **不立刻上报**，先给 `ERR_GRACE_MS`(1800ms) 宽限；
2. 宽限到点**只看元素状态**：`mediaHealthy()`（`error == null && readyState >= 2`）→ 当瞬时故障放过；
   若「仍在加载中」（`error == null && networkState === 2`，即 ArtPlayer 重连正在跑 / NAS 首包慢）→ 再延长一次；
   两者都不是 → 上报（并顺手解除 `switchSuppress`，否则记账会静默失效）；
3. `video:canplay` / `video:playing` 一到就**撤销**面板 ⇒ 偶尔的短暂显示能自愈；
4. ⚠️ **判据不要写成「累计 N 次错误」**：ArtPlayer 的重连只有 5 次，用完就不再重载，
   「点重试仍失败」时只会产生 **1 次**错误 → 按次数判断会出现「面板消失后再也不回来」的死角
   （V3 就是这么暴露的，真踩过）。
5. **重试必须用 `art.url = url`**，不能用 `switchUrl(url)` —— 后者对同一地址会提前 `return`，等于没重试。

> 取证脚本：`tmp/probe-switch-media-error{,2,3}.js`（根因）、
> `tmp/verify-media-error-fix.js`（修复四段验证：不误报 / 不漏报 / 重试 / 换片恢复）。

### 5.7 设置面板展开前后的宽度一致性（2026-09-30 修）

ArtPlayer `resize()` 取「当前面板首项 `$parent.width || SETTING_WIDTH(250)`」当面板宽度：
根面板首项 `$parent` 为 undefined → 250，而**内置 selector 项**（倍速/画面比例/翻转）的
`width = SETTING_ITEM_WIDTH(200)` ⇒ 点开倍速后面板 250→200、左右各内缩 25px，选项行变窄。
修法一行（`Player.vue` 导入区）：`Artplayer.SETTING_ITEM_WIDTH = Artplayer.SETTING_WIDTH`。
实测探针：`tmp/probe-playbackrate-size.js`（顺带量条目矩形/截图，改设置面板 UI 时可直接复用）。

---

## 6. 已知坑（勿重蹈）

### safeCall 只吃 Promise（2026-09-21 修）

`src/utils/global.js` 的 `safeCall` 原本签名是 `safeCall(promise)`。演员影片页写成了
`safeCall(() => window.api.playMovie(m.py))` —— `Promise.resolve(函数)` 会把函数当值直接 resolve，
**函数永不执行且不报错**：播放按钮、喜欢按钮（界面已乐观变红但库里没写）、`initIfNeeded`/
`loadAllDbTags` 全部静默失效。

- 现已让 `safeCall` **同时接受 Promise 与函数**（传函数会自动执行），但**正确写法是直接传 Promise**：
  `safeCall(window.api.recordPlay(m.id))`。
- 教训：凡是「点了没反应」先跑 `npm run audit:wiring`，不要靠肉眼。

1. **分页 `ORDER BY` 必须带唯一 tie-breaker**（`, id DESC`）——同值行跨查询顺序不保证 → 影片"页间跳动/消失"
2. **三视图共享 store.movies**——挂载时必须无条件重载自己视图的全量语义；"dirty 才加载"的优化对共享数据是错误优化
3. **IPC 结构化克隆数据的深层属性修改响应性不可靠**——关键 UI 更新用 `splice(idx, 1, {...m})` 元素替换强制触发
4. **el-dialog 根样式作用不到 scoped**——dialog 根的尺寸/居中样式须放非 scoped 块；固定高度用根 `height + flex column`（`max-height` 不够）
5. **el-dialog 强制居中**用 `.el-overlay-dialog:has(.xxx-dialog) { display:flex }` 比 `align-center` 可靠
6. **AppIcon 图标名写错会渲染空 svg 占位**（不报错）——按钮出现神秘空白先查图标名
7. **sql.js persist 整库同步导出是交互卡顿总根源**——永远不要在 IPC handler 内同步执行
8. **路由过渡不要用 `<transition mode="out-in">`**——`--disable-gpu` 时帧回调节流导致空白页，用纯 CSS `@keyframes`
9. **`node --check` 查不出「调用了但未定义」**——函数被批量替换/删除引用后语法仍合法，运行时才报 `xxx is not defined`。
   改主进程代码后**必跑 `npm run check:undefined`**，涉及刮削的再跑 `npm run scrape:test`
10. **批量替换函数时要警惕自引用**——曾出现 `persistSoon` 被脚本误改成 `(db) => persistSoon(db)` 造成无限递归，
    且被 IPC handler 的 `try/catch` 吞掉只返回 `{ ok:false }`，表现为「界面点了不变色但数据库其实已改」。
    **批量替换后务必检查被改函数自身是否引用了自己**；排查 UI 不更新时先查主进程异常
11. **★ Cloudflare 与图床按客户端 TLS 指纹放行**——实测同一代理/同一 Cookie/同一时刻下：系统 curl 全部 200，
    而 Electron `net.fetch`（403 / 连接被关闭）与 Node `https`（403）都被拦。**因此刮削网络层用系统 curl**（`net-curl.js`）。
    改 scraper 网络相关代码前先读该文件头注释
12. **JAVBUS 反爬态：返回 302 + 有效响应体**——不能加 `curl -L`（会跟随到验证页，拿到无效内容）；
    按 200/302 都读响应体、由内容判定有效性
13. **Electron `net.fetch` 不能手动设置 Cookie 头**——Fetch 标准把 Cookie 列为 forbidden header，
    `headers.Cookie = ...` 会被 Chromium 静默丢弃（表现为「配置了 Cookie 仍 403」）；
    须用 `session.cookies.set()` 注入（见 `scraper.js` `applyCookieString`）
14. **刮削图片的网络路径按域名区分**——部分第三方图床经代理连接失败、直连正常；而主站图必须走代理。
    `downloadImage` 按域名决定优先顺序、另一种兜底
15. **回滚 / 脚本分段替换文件后必须 grep 验证 + build**——部分应用状态（残留大括号 / emits）会导致编译错误
16. **凡涉及模块加载的改动必须跑 `npm run dev` 冒烟**——`node --check` 与 `vite build` 查不出 require 路径错误
17. **★★ dev 库（`node_modules/electron/dist/data/app.db`）是真实数据，任何会写它的脚本都要先备份**
    （跑 `scripts/test-*.js`、`tmp/verify_*.js`、任何起 Electron 并触发写操作的探针）。
    统一用 **`scripts/_devdb.js`**：①每次运行新建**本次独有**快照（时间戳+pid，绝不复用固定文件名）
    ②落盘后 SHA-256 回读校验 ③还原前验 SQLite 文件头，坏快照**拒绝写回** ④库未变更不写盘。
    > **为什么立这条**：原三个回归脚本是「固定文件名备份 + `if(!exists) copy` 有就复用 + 结束无条件写回」，
    > 备份一旦陈旧，之后每次运行都会把**陈旧快照写回真库**（实测旧备份 45KB / 9 天前 vs 真库 610KB），
    > 真的因此丢过库里新建的 500 条测试影片。**禁止**手工 `cp` 覆盖 dev 库、`git checkout`/`stash` 碰它。
18. **★ 自动化断言「间歇性失败」时先怀疑探针口径，别先怀疑产品**：
    ① 读几何前要等动画结束（入场动画带位移，见 §5.5）；
    ② 等动画不要用「所有动画都不在 running」——`bp-pulse` 是 `infinite`，永远等不到，要按**具体选择器**等；
    ③ 用同一份 dist 复跑确认是「稳定失败」还是「抖动」。
19. **★ `check-undefined` 的行号曾整体偏移 117 行（2026-09-30 已修）**：
    `stripCommentsAndStrings()` 删块注释/模板字符串时把换行一起删了，而脚本后面是拿
    `src.split('\n')` 的**下标当行号**输出 → 之后所有行号前移。
    **改动任何「先清洗源码再报行号」的工具，都要保证行数不变**（删内容时保留换行）。
    另：`scraper.js` 的两个 `_l_(` / `_s_(` 提示是**误报** —— 那是解析 JAVBUS 预览图 URL 的
    正则字面量（`_l_` = 原图 / `_s_` = 120×90 小图），不是函数调用。**当前 `check:undefined` 全绿（仅这 2 条已知误报）**。
20. **★★ 做体检/清理类操作时，`FAIL` 不等于什么都没发生**（2026-09-30 实测）：
    同一次清理里，3 个 256.7 MB 的目录被判为删除失败，事后实测只剩 **7 个文件 / 15 MB** ——
    删除动作在报失败之前**已经把大部分内容删掉了**（`release/` 由 990 MB 降到 414 MB，实际回收 576 MB）。
    ⇒ ① **报告回收体积必须事后 `du` 实测**，不能拿「失败条数」当结论；
    ② 反过来，**「删失败了 ⇒ 数据完好」是不成立的推断** —— 这正是「删 zip 前先在远端确认」
    「更新本地正式版前先备份」这两条铁律必须硬执行的理由。
21. **★ 发布包特征字符串探针的取法**：先在源码 grep 出真实标识符，再
    `git grep -c <串> HEAD` 确认它在**上一版不存在**。已在 HEAD 里存在的串（如 `加载影片列表失败`）
    只能当回归守卫，**不能当「本版代码已打进包」的证据**。
22. **★★ 抓媒体事件必须 `capture:true`，并且必须记录 `event.target` 的身份**（2026-09-30 实测）：
    媒体元素的 `error` **不冒泡**，而 ArtPlayer 的转发是非捕获绑定 —— 用非捕获监听会**漏掉**
    子元素发出的错误，用捕获监听又会**多收**到它们。不记 target 就会出现「探针看到 error、
    产品代码却收不到」的诡异矛盾，白查半天。判据写成
    `target === video ? '元素自身' : target.tagName`，一眼可辨（浏览器原生媒体事件同理）。
23. **★★ 修「误报类」缺陷必须两个方向都验证**（2026-09-30 实测，同一轮里 V3 就翻过车）：
    只证明「不再误报」是不够的，**「真故障仍然要报」是另一半需求**，否则等于把 bug 换成静默失败。
    四段最小验证：① 瞬时错误 → 不报（且视频自行恢复）；② 真不可用 → 必须报（文案/错误码齐备）；
    ③ **手动重试** → 面板先清零、仍失败要再报（这条最容易漏：自动重试的预算可能已耗尽，
    手工重试只会产生一次错误，「按次数判定」的死角就在这里）；④ 换成可播的 → 面板消失且正常起播。

---

## 7. 设计约束

1. **颜色 / 圆角 / 阴影一律用 CSS 变量**：`var(--bg)` / `var(--r-md)` / `var(--sh-1)`
   （检查：`grep -rE '#[0-9a-fA-F]{6}' src/`）
2. **图标用 AppIcon 库**（自绘 SVG），不新增 emoji；需要新图标先在 `AppIcon.vue` 注册
3. **主色品牌红 `#e21a20`**（与顶栏 logo、exe 图标同色；2026-09-17 由 `#d2401e` 统一而来）、
   暖纸白 + 墨黑主题、字体 Outfit（拉丁）+ Noto Sans SC（中文）
4. **多值字段用中文逗号「，」分隔**（标签字段约定）
5. **数据库是 sql.js，不是 better-sqlite3**：SQL 全走主进程异步 IPC
6. **提交信息不得出现账号、token、Cookie 等凭据，也不得出现本机绝对路径**
7. **动画时长一律用 §5.5 的令牌**，不要在组件里写魔法数字；新增动画先问「它是在挡内容吗」，
   是就必须短（≤120ms）

---

## 8. 调试指南

- `npm run dev` 后 DevTools 自动打开（detached）；主进程日志带 `[main]`，渲染层 console 转发为终端 `[renderer][N]`
- 路由首次切换应 ≤20ms（静态引入）；变慢说明被改回懒加载
- GPU 驱动异常：先 `set JAVTUBE_DISABLE_GPU=1 && npm run dev` 排除
- 数据清空测试：设置弹窗 → 关于 → 清空数据库（二次确认）
- 交互卡顿排查顺序：① 是否新写操作没走 `persistSoon` ② 是否同步 persist 残留
  （`grep -n "persist(db)" electron/main/`）③ 是否有启动期长任务没分片让出（§5.1）
- **离屏窗口跑探针**（不抢焦点）：`setBounds({x:-3200,y:-3200})` + `setSkipTaskbar` + `blur` +
  `setFocusable(false)`，并屏蔽 `focus` / `moveTop` / `setAlwaysOnTop`；
  只杀自己 spawn 的 PID 树（`taskkill /F /T /PID`）
- **探针铁律**：注入脚本自包含、`awaitPromise:true`、末尾 `process.exit()`；
  **禁用 `eval` / `new Function`**（CSP `script-src 'self'`）
- **启动前记得**：`unset ELECTRON_RUN_AS_NODE`；排查「删除失败/命令调不动」时再
  `unset NODE_OPTIONS`（见 §2）
- ⚠️ **`tmp/verify_player_ui.js` 会写 dev 库的播放记录**（点喜欢改 `cl`、进播放页触发 `recordPlay`
  → 写 `play_count` / `play_time` / `play_pos`）。它只还原 `cl`，**播放记录会留在库里** ——
  实测跑一次就让 id 10/11/68 三行的 `play_count` +1、库 sha 由 `c1f33f19` 变 `a1f2e641`。
  ⇒ **跑它之前也要先快照**（它自己不带 `_devdb`）。事后比对/回滚：
  `node tmp/_devdb_diff2.js <快照>`（字段级差异）/ `node tmp/_devdb_restore.js <快照>`（逐字节回滚）。
- Git 推送若直连超时，可为仓库单独配置代理（仅本仓库生效）：
  `git config http.proxy <代理地址> && git config https.proxy <代理地址>`
  （⚠️ 上传大文件到 `uploads.github.com` 反而**不要**走代理，直连快得多）
