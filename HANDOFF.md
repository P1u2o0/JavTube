# JavTube 开发交接书

> 面向接手本项目的开发者 / AI 会话。**本文只讲架构与命令**。
> 面向使用者的功能介绍见 `README.md`，许可见 `LICENSE`。

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

# 主进程语法检查（批量）
for f in electron/main/*.js electron/main/db/*.js; do node --check "$f"; done

# 发版：打包 Windows x64 zip —— 一条命令
npm run release

# 清理构建产物（release/ + dist/，带句柄重试）
npm run clean
```

**脚本一览**：`scripts/check-undefined.js`（未定义引用静态检查）、`scripts/scrape-smoke.js`（刮削冒烟）、
`scripts/build-portable.js`（打包，见 §4.1）、`scripts/clean.js`（清理产物）。

---

## 4.1 打包（发版必读）

`npm run release` → 产出 **`release/JavTube-v<版本>-win-x64.zip`**（约 102 MB）。
同目录还会留下解压好的 `release/JavTube/`，可直接双击 `JavTube.exe` 试跑。

解压即用、免安装，数据在 exe 同级的 `data/`，升级只需覆盖文件（别覆盖 `data/`）。

一条命令做完这些事：清理历史残留 → `vite build` → `electron-builder --dir` →
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

electron-builder 会把**整个 node_modules** 塞进 asar（实测 84.9 MB，连它自己的 devDeps 都在内），
但运行时主进程只 `require('sql.js')`，渲染层已被 Vite 打进 `dist/`。
脚本用 `@electron/asar` 重打，只留 `dist/ + electron/ + package.json + sql.js 的两个文件`：

**84.9 MB → 2.6 MB**（整包 339 MB → 257 MB）。

### ⚠️ 两个环境坑（都已在脚本里绕过）

1. **`app.asar` 会被句柄占住** —— 复用同一个输出目录时，electron-builder 删不掉上次的
   `app.asar`，直接报 `The process cannot access the file because it is being used by another process`
   并失败。**脚本改为每次用带时间戳的唯一临时目录**（`.tmp-build-<ts>`）绕开。
   被占住的旧目录删不掉也没关系，重启后可清。
2. **`rm -rf` 在受管环境会被安全删除层拦截**（路由到回收站失败即整体失败）。
   脚本统一用 Node `fs.rmSync` + 重试；**先递归删文件、再删目录**成功率最高。

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

**独立复核任意一版（不构建）**：

```bash
node scripts/build-portable.js --check-only              # 默认复核 release/JavTube
node scripts/build-portable.js --check-only <解压后的目录>  # 复核别人给的包
```

**发版前另外手动跑一次**：解压 zip → 双击 exe → 确认窗口能开、`data/` 在同级生成。

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

---

## 4.2 目录结构

```
javtube_dev/
├─ HANDOFF.md  README.md  LICENSE  package.json     # 根目录只留这些
├─ docs/                                            # 内部文档（.gitignore，仅本地保留）
├─ dist/                                            # Vite 产物（可随时删）
├─ release/                                         # 唯一构建输出根（可随时删，见 §4.1）
├─ scripts/                                         # 构建与检查脚本
├─ build/icon.ico                                   # 应用图标（打包时写进 exe）
├─ electron/
│  ├─ main/
│  │  ├─ index.js            # 主进程入口：启动序列 / 窗口 / javtube-cover 封面协议注册
│  │  ├─ ipc-utils.js        # 工具 IPC：playVideo(含文件存在校验)、扫描目录、readDuration 等
│  │  ├─ scraper.js          # 在线刮削：JAVBUS / JAVDB 解析（唯一出处）
│  │  ├─ net-curl.js         # 刮削网络层：基于系统 curl（见 §6 坑 11）
│  │  ├─ video-meta.js       # 纯 Node MP4 mvhd 时长解析（AVI/MKV 返回 0）
│  │  └─ db/
│  │     ├─ init.js          # sql.js 初始化 + WASM 定位 + 建库/迁移（movies / actress / websites / settings）
│  │     ├─ movies.js        # 影片 CRUD / 分页查询 / 批量操作
│  │     ├─ settings.js      # 设置读写 + 批量保存 + 标签类别 JSON
│  │     ├─ actress.js       # 女优表
│  │     ├─ websites.js      # 网址表
│  │     └─ util.js          # persistSoon 等公共工具
│  ├─ preload/index.js       # contextBridge 暴露 window.api（40 个通道，与 main 一一配对）
│  └─ common/ipc-channels.js # IPC 通道名常量（main / preload 共享唯一来源）
└─ src/
   ├─ router/index.js        # 静态引入全部页面（性能优化，勿改回懒加载）
   ├─ views/                 # Library(片库) Favorite(喜欢) History(历史) Detail(详情)
   │                         #   Actress(女优) ActorFilms(演员作品) Website(网址) Home(首页)
   │                         #   AddMovieDialog/ 下为添加影片的子表单
   ├─ components/            # MovieCard / MovieGrid / TagFilter / TagChip / StatusBar / TopNav /
   │                         #   SortDropdown / AppIcon(自绘 SVG 图标库) / SettingsDialog /
   │                         #   AddMovieDialog.vue
   ├─ store/                 # Pinia：movies(三视图共享) / scrape / actress / website
   ├─ composables/           # useMovieList.js —— 列表页公共交互
   ├─ styles/global.css      # 设计令牌 + 全局样式
   └─ utils/global.js        # 番号解析、标签拆分等前端工具
```

**数据目录**：运行时数据（`app.db` + `covers/`）写在应用数据目录下，**不入版本控制**。

---

## 5. 关键机制（改代码前必读）

| 机制 | 说明 |
|---|---|
| **persistSoon** | sql.js 的 `persist` 是整库同步导出（阻塞主进程）。**三个 db 模块**（movies / settings / actress）的写操作统一用 `persistSoon(db)`（定义于 `db/util.js`，setImmediate 延迟落盘）。**新增写操作必须用它** |
| **稳定分页** | 所有 `ORDER BY` 必须追加唯一 tie-breaker（`, id DESC`），否则同值行跨 LIMIT/OFFSET 查询顺序不保证 → 影片在页间跳动 |
| **设置批量保存** | 渲染端 `updateSettingsBatch(obj)`（`settings:updateBatch` 通道）一次事务写多键只落盘一次；不要逐键调 `updateSetting`（会卡） |
| **IPC 通道** | 新增通道三步：`ipc-channels.js` 常量 → `preload/index.js` invoke → `electron/main/**` handle。当前 38/38 配对，返回格式 `{ ok, data?, error? }` |
| **★ 数据库恢复需重启** | `settings:restore` 只替换磁盘文件，内存里仍是旧库 → 恢复后置 `db._blockPersist = true`，**一切落盘被 `saveDbToDisk` 拦截**（否则关窗的 `_forceSave`／10s 定时／`persistSoon` 会把刚恢复的文件覆盖回去，恢复白做）。前端弹「立即重启」→ `app:relaunch`（`app.relaunch()+exit`）。**改动这段务必跑 `npm run test:restore`** |
| **★ 刮削来源「补全字段」** | `scrape_source='fill'`：照常走自动刮削，但落库前用 `buildScrapeUpdate(d, current, { fillOnly:true })`（`src/utils/global.js`）**只写当前为空/为 0 的字段**，已有值一律跳过；无缺失时不写库并提示「字段已完整」。0 与 `'[]'` 都算空（评分/想看/看过在库里以 0 表示无数据）。**统计字段只来自 JAVDB**：Cookie 过期或 Cloudflare 403 时会静默拿不到，故 `statsFillHint()` 会显式提示「未取到（检查 Cookie 与代理）」。单部（Detail）与批量（Library）共用同一套逻辑；补全时传 `skipPreviews` 避免重复下载已有预览图 |
| **落盘失败会重试** | `saveDbToDisk` 返回布尔值；定时器与 `force` **仅在成功时清 `dirty`** → 一次写盘失败（磁盘满/占用）不会丢标记，下一轮还会重试 |
| **三视图共享 store** | 片库 / 喜欢 / 历史共用 `store.movies`——各视图挂载时必须重新加载自己视图的全量语义（片库=全量、喜欢=onlyFavorite、历史=historyOnly） |
| **刮削进度** | 顶栏铃铛按钮（`useScrapeStore`：enqueue / begin / done / clear），红色角标=待刮削数量；单个与批量刮削都接入 |
| **灯箱查看器** | 详情页点击预览小图 → `<Teleport to="body">` 全屏遮罩 + 滚轮缩放 0.5-5x + 左右按钮/方向键循环 + Esc 关闭 |
| **详情页海报区** | 框尺寸 JS 计算：`min((视口高-300px)/海报高, 视口宽×0.56/海报宽)`，小分辨率海报强制放大；窗口 resize 重算 |
| **封面协议** | `javtube-cover://0/<base64url>` 自定义 privileged scheme（`electron/main/index.js` 注册，`cover-protocol.js` 解析） |
| **刮削网络层** | 走系统 curl（`net-curl.js`）：页面请求按设置走代理并携带用户 Cookie；图片按域名决定代理/直连优先级；**不加 `-L`**（见 §6 坑 12） |
| **乐观更新（仅部分路径）** | `store.toggleFav` **不是**乐观更新：先 await IPC 写库、成功后才改状态（本地 sql.js 毫秒级，无需乐观）。其余写库已延迟落盘，UI 侧可乐观翻转、失败回滚 —— 改之前先确认具体函数实现，别照抄注释 |

---

## 6. 已知坑（勿重蹈）

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

---

## 8. 调试指南

- `npm run dev` 后 DevTools 自动打开（detached）；主进程日志带 `[main]`，渲染层 console 转发为终端 `[renderer][N]`
- 路由首次切换应 ≤20ms（静态引入）；变慢说明被改回懒加载
- GPU 驱动异常：先 `set JAVTUBE_DISABLE_GPU=1 && npm run dev` 排除
- 数据清空测试：设置弹窗 → 关于 → 清空数据库（二次确认）
- 交互卡顿排查顺序：① 是否新写操作没走 `persistSoon` ② 是否同步 persist 残留
  （`grep -n "persist(db)" electron/main/`）
- Git 推送若直连超时，可为仓库单独配置代理（仅本仓库生效）：
  `git config http.proxy <代理地址> && git config https.proxy <代理地址>`
