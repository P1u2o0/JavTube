# JavTube 项目交接书（HANDOFF）

> 给「换模型/新会话后接手 javtube 的人」看的精简速查。**本文是唯一权威接力入口**。
> 批次级开发历史见 `接续工作小结.md`，项目背景档案见 `PROJECT_BRIEF.md`。
>
> 维护：每次切换模型/会话前由当前 AI 重写本文件（更新快照与批次摘要）。

---

## 0. 一句话

`javtube_dev` 是 **Electron 30 + Vue 3 + Vite 5 + Element Plus + Pinia + sql.js** 写的
**纯本地**影视库管理软件（JAV 元数据刮削 / 整理 / 九类标签筛选 / 播放）。
数据全部保存在本机，不上传任何内容。当前 main 分支约 **184 个 commit**（以 `git rev-list --count HEAD` 实时值为准），工作区 clean；远端 `origin` → https://github.com/P1u2o0/javtube.git（**公开仓库 · MIT**）。

---

## 1. 当前状态快照（2026-09-15）

| 项 | 值 |
|---|---|
| 项目根 | `<项目根目录>\` |
| git | `main` 分支，约 184 commit（实时值为准），工作区 clean，远端 `origin` = https://github.com/P1u2o0/javtube.git（**公开 · MIT**） |
| 提交身份 | `P1u2o0 <<邮箱>>`（**仓库级** user.name/user.email；全局仍是 `WorkBuddy` 占位，别混用） |
| 运行时 | Node 22（`<工具目录>\binaries\node\versions\22.22.2-3\`，用绝对路径调用；版本目录会随会话变化，先 `ls versions/` 确认） |
| dev 服务 | 需手动启动（`npm run dev`，见下）；2026-09-15 收尾时软件窗口已关闭 |
| 数据目录（dev） | `node_modules\electron\dist\data\`（`app.db` + `covers\`） |
| 离线备份 | 工作区上级 `javtube_backup_20260915_post_b5b7.bundle`（git bundle 全历史，含到 B7/B5）+ `javtube_src_backup_20260915_post_b5b7.tar.gz`；另存 B5/B7 开工前的回滚点 `*_20260915_pre_b5b7.bundle` |；**发布前回滚点** `javtube_backup_20260915_pre_rewrite.bundle`（改写历史前的完整旧历史）
| 测试数据 | 2 部影片（SSNI-888 / MNGS-067），含封面与预览图 |

### ⚠️ 启动前必读：清掉 `ELECTRON_RUN_AS_NODE`

WorkBuddy 的 bash 会话会注入 `ELECTRON_RUN_AS_NODE=1`，此时 `electron.exe` 会退化为纯 Node
运行，`require('electron')` 拿不到 API，启动即崩（报 `Cannot read properties of undefined (reading 'commandLine')`
且堆栈显示 `Node.js v20.x`）。**启动命令必须先 unset**：

```bash
cd "<项目根目录>"
unset ELECTRON_RUN_AS_NODE          # ← 关键，否则 Electron 变纯 Node 启动失败
"<工具目录>\binaries\node\versions\22.22.2-3\npm.cmd" run dev
```

### 常用命令

```bash
# 构建验证（~5s，改完必跑）
npx vite build
# 主进程「调用但未定义」静态检查（改 electron/ 代码后必跑，见 §5 坑 14）
npm run check:undefined
# 刮削全链路冒烟（脱离 Electron 直接跑 scrapeMovie，改 scraper/net-curl 后必跑）
npm run scrape:test            # 默认 WAAA-661；可传番号：npm run scrape:test -- NPJS-268
# 主进程语法检查（批量）
for f in electron/main/*.js electron/main/db/*.js; do node --check "$f"; done
# IPC 通道配平检查：invoke 与 handle 应 40/40
# 打包 Win 安装包
npm run build:win
# GPU 驱动异常降级调试
set JAVTUBE_DISABLE_GPU=1 && npm run dev
# git 推送走本机代理（直连 GitHub 会超时；仓库级配置，仅本仓库生效）
git config http.proxy http://<代理地址> && git config https.proxy http://<代理地址>
```

---

## 2. 必读文档地图（按顺序）

1. **本文件** —— 现状 + 架构 + 机制 + 坑
2. **`接续工作小结.md`** —— 全部开发批次详细记录（每个 commit 改了什么、为什么，§1.x）
3. **`PROJECT_BRIEF.md`** —— 项目背景档案与早期历史（第 10 节更新日志）
4. **`README.md`** —— 面向使用者的功能介绍

> ⚠️ `开发文档.md` / `快速开始.md` / `项目说明.md` 已删除（2026-09-11 整理：内容过时且与上述文档重叠）。

---

## 3. 架构速查

```
javtube_dev/
├─ electron/
│  ├─ main/
│  │  ├─ index.js            # 主进程入口：启动序列 / 窗口 / javtube-cover 封面协议注册
│  │  ├─ ipc-utils.js        # 工具 IPC：playVideo(含文件存在校验)、扫描目录、readDuration 等
│  │  ├─ scraper.js          # 在线刮削：JAVBUS / JAVDB 解析（唯一出处）
│  │  ├─ net-curl.js         # 刮削网络层：基于系统 curl（Cloudflare 按 TLS 指纹放行 curl，
│  │  │                      #   而 Electron/Node 的指纹被拦——见 §5 坑 17）
│  │  ├─ video-meta.js       # 纯 Node MP4 mvhd 时长解析（AVI/MKV 返回 0）
│  │  └─ db/
│  │     ├─ init.js          # sql.js 初始化 + WASM 定位 + 建库/迁移（4 张表：movies / actress / websites / settings）
│  │     ├─ movies.js        # 影片 CRUD / 分页查询 / 批量操作（全部写操作用 persistSoon）
│  │     ├─ settings.js      # 设置读写 + updateBatch 批量保存 + 标签类别 JSON
│  │     ├─ actress.js       # 女优表
│  │     └─ websites.js      # 网址表
│  ├─ preload/index.js       # contextBridge 暴露 window.api（40 个通道，与 main 一一配对）
│  └─ common/ipc-channels.js # IPC 通道名常量（main/preload 共享唯一来源）
└─ src/
   ├─ router/index.js        # 静态引入全部页面（性能优化，勿改回懒加载）
   ├─ views/                 # 7 个页面：Library(片库) Favorite(喜欢) History(历史)
   │                         #   Detail(详情) Actress(女优) Website(网址) Home(占位 TODO)
   │                         #   ManualForm.vue / ScanDirForm.vue —— 添加影片的子表单
   ├─ components/            # MovieCard / MovieGrid / TagFilter / StatusBar / TopNav /
   │                         #   AppIcon(自绘 SVG 图标库) / SettingsDialog(设置弹窗) /
   │                         #   AddMovieDialog.vue + AddMovieDialog/(添加影片表单)
   ├─ store/movies.js        # Pinia：列表/分页/排序/筛选/批量选择（片库/喜欢/历史三视图共享！）
   ├─ store/scrape.js        # 刮削任务进度（顶栏铃铛面板）
   ├─ store/actress.js       # 女优列表 store（2026-09-11 自 store/settings.js 拆出）
   ├─ store/website.js       # 网址导航 store（同上拆分）
   └─ composables/useMovieList.js  # 列表页公共交互（onToggle/onPageChange/onDetail）
```

**已删除**：`EditMovieDialog.vue`（三点菜单移除后零引用）、`Settings.vue` + `/settings` 路由（设置改弹窗）、
`开发文档.md` / `快速开始.md` / `项目说明.md`（文档整理）。

---

## 4. 关键机制（改代码前必读）

| 机制 | 说明 |
|---|---|
| **persistSoon** | sql.js 的 `persist` 是整库同步导出（阻塞主进程）。**全部四个 db 模块**（movies / settings / actress / websites）的写操作统一用 `persistSoon(db)`（定义于 `db/util.js`，setImmediate 延迟落盘）。**新增写操作必须用它** |
| **稳定分页** | 所有 `ORDER BY` 必须追加唯一 tie-breaker（`, id DESC`），否则同值行跨 LIMIT/OFFSET 查询顺序不保证 → 影片在页间跳动 |
| **设置批量保存** | 渲染端 `updateSettingsBatch(obj)`（`settings:updateBatch` 通道）一次事务写多键只落盘一次；不要逐键调 `updateSetting`（会卡） |
| **IPC 通道** | 新增通道三步：`ipc-channels.js` 常量 → `preload/index.js` invoke → `electron/main/**` handle。当前 40/40 配对，返回格式 `{ ok, data?, error? }` |
| **三视图共享 store** | 片库/喜欢/历史共用 `store.movies`——各视图挂载时必须重新加载自己视图的全量语义（片库=全量、喜欢=onlyFavorite、历史=historyOnly） |
| **刮削进度** | 顶栏铃铛按钮（`useScrapeStore`：start/done/clear），红色角标=进行中数量；单个与批量刮削都接入 |
| **灯箱查看器** | Detail.vue 点击预览小图 → `<Teleport to="body">` 全屏遮罩（0.3s 渐暗）+ 滚轮缩放 0.5-5x + 左右按钮/方向键循环 + Esc 关闭 |
| **详情页海报区** | 框尺寸 JS 计算：`min((视口高-300px)/海报高, 视口宽×0.56/海报宽)`，小分辨率海报强制放大；窗口 resize 重算；海报 contain 贴合框体 |
| **封面协议** | `javtube-cover://0/<base64url>` 自定义 privileged scheme（`resolveCover`，详见 PROJECT_BRIEF §5） |
| **刮削网络层** | 走系统 curl（`net-curl.js`，Windows 10 1803+ 内置）：页面请求按设置走代理并携带用户 Cookie；图片按域名决定优先级（主站图走代理优先、第三方图床直连优先，另一种兜底）；**不加 `-L`**（JAVBUS 302 到反爬页但响应体仍是有效详情页） |
| **乐观更新** | 交互路径写库已延迟落盘，UI 侧可乐观翻转、失败回滚（Detail.toggleFav 与三视图 onPlay 是范例） |

---

## 5. 已知坑（血的教训，勿重蹈）

1. **分页 ORDER BY 必须带唯一 tie-breaker**（`, id DESC`）——同值行跨查询顺序不保证 → 影片"页间跳动/消失"
2. **三视图共享 store.movies**——挂载时必须无条件重载自己视图的全量语义；"dirty 才加载"的优化对共享数据是错误优化
3. **IPC 结构化克隆数据的深层属性修改响应性不可靠**——关键 UI 更新用 `splice(idx, 1, {...m})` 元素替换强制触发
4. **el-dialog 根样式作用不到 scoped**——dialog 根的尺寸/居中样式须放非 scoped 块；固定高度用根 `height + flex column`（max-height 不够）
5. **el-dialog 强制居中**用 `.el-overlay-dialog:has(.xxx-dialog) { display:flex }` 比 align-center 可靠
6. **AppIcon 图标名写错会渲染空 svg 占位**（不报错）——按钮出现神秘空白先查图标名
7. **sql.js persist 整库同步导出是交互卡顿总根源**——永远不要在 IPC handler 内同步执行
8. **凡涉及模块加载的改动必须跑 `npm run dev` 冒烟**——node --check 与 vite build 查不出 require 路径错误（轮次 4 教训）
9. **封面协议三坑**：`registerSchemesAsPrivileged` 必须在 app ready 前；base64url 必须配占位 host `0`；CSP `img-src` 必须加 `javtube-cover:`（详见 PROJECT_BRIEF §5）
10. **路由过渡不要用 `<transition mode="out-in">`**——`--disable-gpu` 时帧回调节流导致空白页，用纯 CSS `@keyframes`
11. **回滚/脚本分段替换文件后必须 grep 验证 + build**——部分应用状态（残留大括号/emits）会导致编译错误
12. **★ 函数被脚本批量替换时要警惕自引用**——2026-09-11 发现 `persistSoon` 曾被脚本误改成 `(db) => persistSoon(db)` 无限递归，且被 IPC handler 的 `try/catch` 吞掉只返回 `{ ok:false }`，表现为「界面点了不变色但数据库其实已改」（前端乐观更新被回滚）。**批量替换后务必检查被改函数自身是否引用了自己**；IPC 的 try/catch 会掩盖此类致命错误，排查 UI 不更新时先查主进程异常
13. **WorkBuddy 会话注入 `ELECTRON_RUN_AS_NODE=1`**——会让 Electron 退化为纯 Node，启动即崩（详见 §1 启动说明）
14. **★ 脚本按区间替换代码时，必须确认区间内是否夹带其他函数定义**——2026-09-13 一次替换把 `throttleByHost`、`assertJavdbNotBlocked` 两个定义连带删除，`node --check` 只查语法查不出未定义引用，直到运行时才报 `xxx is not defined`。**改主进程代码后必跑 `npm run check:undefined`**（`scripts/check-undefined.js`：静态列出「调用了但找不到定义」的候选，本次即靠它复查出第二个被删函数）
15. **Electron `net.fetch` 不能手动设置 Cookie 头**——Fetch 标准把 Cookie 列为 forbidden header，`headers.Cookie = ...` 会被 Chromium **静默丢弃**（表现为「配置了 Cookie 仍 403」）。必须用 `session.cookies.set()` 注入，请求在 `credentials: 'include'` 下自动携带（见 scraper.js `applyCookieString`）
16. **刮削图片的网络路径按域名区分**——DMM 图床（awsimgsrc/pics.dmm.co.jp）经代理连接失败、直连正常；而 JAVBUS/JAVDB 主站图必须走代理。`downloadImage` 按域名决定优先顺序、另一种兜底
17. **★ Cloudflare 与图床按客户端 TLS 指纹放行**——2026-09-13 实测（同一代理/同一 Cookie/同一时刻）：curl 全部 200，而 Electron `net.fetch`（JAVDB 403 / DMM 连接被关闭）与 Node `https`（JAVDB 403）都被拦。**因此刮削网络层改用系统 curl**（`net-curl.js`）。改 scraper 网络相关代码前先读该文件头注释；回归用 `npm run scrape:test`
18. **JAVBUS 反爬态：返回 302 + 有效响应体**——不能加 `curl -L`（会跟随到 `/doc/driver-verify` 验证页，拿到无效内容）；按 200/302 都读响应体、由内容判定有效性
19. **★ 删除变量/字段时必须 grep 全部引用**——2026-09-15 清理死代码时删了 `let sc`，却漏了两行 `sc = sc * 60`：`node --check` 查不出（语法合法），**运行时才报 `sc is not defined`**，靠 `npm run scrape:test` 兜住。**改主进程代码后必须跑 scrape:test 冒烟，不能只靠语法检查**
20. **函数搬进 composable / 组件后必清死导入**——三视图的 `onPlay`/`onBatch*` 搬进 `useMovieList` 后，`ElMessage`/`ElMessageBox`/`safeCall` 在这些视图里只剩导入行（**Library 仍在用 ElMessage，别一起删**）；排序下拉抽成 `SortDropdown.vue` 后，ActorFilms 的 `AppIcon` 导入也变死
21. **★ 用 CDP 验证 UI 时的三个假象**（2026-09-15 踩坑，做法已写进 `electron-cdp-screenshot` 技能）——① 窗口被遮挡时 Chrome 节流（rAF 完全不推进）→ `Page.captureScreenshot` **永不返回**，命令被 SIGTERM 且 **stdout 全空**（极易误判成"命令没跑"）→ 进度要写文件 + 每个 CDP 请求加超时；② 同一任务内设内联样式后**立即** `getComputedStyle` 读到的是**变更前**的值（节流时 pending transition 永不推进）→ 看起来像"样式改了没生效"，**别据此判定 CSS 坏了**，用页内 clone 探针验证级联；③ 本机 `prefers-reduced-motion: reduce` 为 true → `global.css` 降级动效块把 `transition-duration` 压成 `0.01ms !important`（`getComputedStyle().transitionDuration` 显示 `1e-05s`）属**正常**，不是 CSS 变量失效

---

## 6. 设计约束（违反会破坏一致性）

1. **颜色/圆角/阴影一律用 CSS 变量**：`var(--bg)` / `var(--r-md)` / `var(--sh-1)`（检查：`grep -rE '#[0-9a-fA-F]{6}' src/`）
2. **图标用 AppIcon 库**（30+ 自绘 SVG），不新增 emoji；需要新图标先在 AppIcon.vue 注册
3. **主色朱柿红 #d2401e**、暖纸白 + 墨黑主题、字体 Outfit 拉丁 + Noto Sans SC 中文
4. **Tab 分隔符用中文逗号「，」**（标签字段约定）
5. **数据库是 sql.js 不是 better-sqlite3**：SQL 全走主进程异步 IPC
6. **项目已公开**（GitHub `P1u2o0/javtube`，MIT）：文档可正常提及远端地址；但**内部审计 / 性能计划类文档不入库** —— `docs/` 已写进 `.gitignore` 并从全部历史清除，新增内部文档放 `docs/` 即自动忽略；提交信息与文档中不得出现账号、token、Cookie 等凭据

---

## 7. 近期批次摘要（2026-09-09 ~ 09-15）

> 完整明细见 `接续工作小结.md` §1.x（每批次对应 commit 与理由）。

- **9/15｜代码审查（屎山梳理）→ 执行优化批次 B1~B7，全部完成**（审查报告见 commit `a219a80`：
  3 硬缺陷 + 20 性能热点 + 16 处重复/死代码；B 系列逐批提交、逐批实测，收尾工作区 clean / 181 commit）——
  - **B1 硬缺陷**：`Library.vue` router 未定义（点结果页标题条「×」即抛 ReferenceError）→ 补 `useRouter`；
    preload 缺 `playMovie`（演员页点播放静默失效，异常被 safeCall 吞掉）→ 补别名；
    `db/settings.js` 备份时序错误（`persistSoon` 是延迟落盘，紧接着 `copyFileSync` 拷到的仍是旧库）→ 改同步 `persist(db)` 后再拷
  - **B2 热路径 O(n²)→Set**：MovieGrid 卡片选中判断、`visibleCategories`、StatusBar `invert()`（页面外选中保留）
  - **B3 首页聚合**：`home:recommend` 约 12n 次 `splitMulti` → 进 handler 先 `prepared[]` 预处理缓存三字段；
    categories 候选由「每个标签各扫全表」改「一次遍历按标签累加」；筛选语义与随机结果不变
  - **B4 死代码清理**（8 文件 / -73 行）：`movies:search` 整链路、`utils:readFileBase64`、`sc` 时长字段全链路、
    `flagsText`、`filterByActress`、store 的 `dirty`/`collapsed`（含 4 处写入）、`previews.includes`→Set
  - **B5 重复代码收敛**（10 文件）：新增 `utils/global.splitTags()`（前端 7 处手写拆分归一，
    **顺带修掉 ActorFilms 一处漏 `filter(Boolean)`**）；三视图（Library/Favorite/History）的
    `onPlay`/`onBatchDelete`/`onBatchFav` → `useMovieList`（新增 `onRefresh` 回调注入，因三者刷新函数不同名，
    **顺带统一 Favorite 两处走样**：确认框缺标题与 warning 类型、`onBatchFav` 缺 API 守卫与成功提示）；
    排序下拉 → 新受控组件 `SortDropdown.vue`（StatusBar + ActorFilms 共用，去重约 45×2 行，
    父级各自写回 `store.sort` / 本地 ref）
  - **B6 刮削**：`twToCn` 逐字符 `TW_STR.indexOf` 全表扫描 → 模块加载建 `TW_CN_MAP`；欧美片分类路径每部都拉首页 → 模块级 `omPathCache`。
    **有意未做**（用户确认）：图片并发下载（限速策略未核实、防触发反爬）、选 javbus 仍跑 JAVDB 补统计（既有产品行为，属产品决策）
  - **B7 主进程阻塞**：`ipc-utils.scanDir` 同步递归 → `fs.promises` 异步（原实现扫几万文件时占满事件循环、窗口无响应）；
    封面协议 `existsSync`+`statSync` 两次同步调用 → 一次异步 `stat`；批量操作逐条 SQL → 单条 `IN(...)`（batchTags 另加 `BEGIN/COMMIT` 事务）；
    启动 11 条「列已存在即抛错」的 ALTER → 先 `PRAGMA table_info` 只补缺失列
  - **验证**：每批 `check:undefined` + `vite build`；改主进程的批次额外 `scrape:test`；B3/B5 用 CDP 实机核对
  - **回滚点**：开工前 `javtube_backup_20260915_pre_b5b7.bundle`；全部完成后 `javtube_backup_20260915_post_b5b7.bundle`
- **9/8**：8 轮工程重构（db 按领域拆分 / IPC 通道常量化 / 刮削映射公共函数 / index.js 拆分 / 写盘原子性）
- **9/9**：搜索列表页、刮削预览图+统计+时长提取、详情页改版、结果页标题条、女优/导演/系列筛选、UI 对齐 EP 主题、8 轮实测修复
- **9/10 上午**：设置页 → 弹窗（900×74vh 固定、五 tab 双栏网格、批量保存、注释精简 + show_tips 开关）
- **9/10 中午**：详情页定版（自适应海报区 + 灯箱查看器 + 信息行距均分）、排序 dropdown（方向切换+随机）、**修切页影片消失**（稳定分页 + 挂载重载）、铃铛刮削面板、三点菜单移除、persistSoon 性能根治、设置批量保存、全量代码梳理（净减 100 行）
- **9/10 晚**：卡片喜欢按钮多轮修复未达预期 → **整体回滚到静态收藏角标**（喜欢切换=详情页底部按钮，一直正常）
- **9/14 晚｜Apple 风格重构（Emil Kowalski 设计工程规范，**仅 CSS，零逻辑改动**）**——
  动效：换强自定义曲线（`--ease-out .23,1,.32,1` / `in-out` / `drawer` iOS / `spring` 弹性）+
  分级时长（`--dur-press 120 / fast 160 / base 220 / slow 300`，UI 一律 <300ms）；消除 `transition:all`（TopNav 2 处）；
  收敛超长时长（轮播 620→480ms）；弹层一律从 `scale(0.96)+opacity` 进入（非 scale(0)）；对话框退出快于进入；
  全站按压态统一 `scale(0.96)` 并补齐所有可按压元素；开关/Tabs 下划线/播放钮用弹性曲线。
  质感：圆角微调（`r-sm10/r-md14/r-lg20`）；阴影单层→**多层叠加**（近层锐利+远层柔和）并同步 EP 变量；
  主按钮加顶部内高光；卡片/面板补默认微阴影。
  响应式：顶栏搜索框固定 260px → 弹性（`flex 1 1 220 / min150 / max260`）+ `@media(max-width:1200px)` 断点
  （窗口 `minWidth:1000 / minHeight:700`）。
  修复：首页轮播在「库小且全部看过」时整块消失 → hero 候选池逐级兜底。
  **重构前回滚备份**：`javtube_backup_20260914_pre_apple.bundle` + `javtube_src_backup_20260914_pre_apple.tar.gz`
  （对应 commit `35a5678`，如需回退：`git reset --hard 35a5678`）
- **9/14**：**UI 审计修复（UI-UX-Pro-Max / Taste / Shadcn / Impeccable 四 skill）**——
  global.css 补令牌（字号阶梯、间距阶梯、图标按钮尺寸 --icon-btn-sm/md/lg、遮罩 alpha --overlay-*/--shade-*/--glass）；
  硬编码色值收敛 token、遮罩纯黑改暖黑；圆钮 12 种尺寸 → 3 档（24/32/40）；磨砂玻璃/hover 幅度统一；
  全部图标按钮补 :active 按压态；AppIcon 基线 vertical-align 修正；:focus-visible 去 border-radius。
  （修复前备份：`javtube_backup_20260913_ui_audit.bundle` + 同名 tar.gz）
- **9/14 演员头像**：刮削提取**女优头像**（JAVBUS `#avatar-waterfall`，下载到 `covers/actress/<starId>.jpg`），
  `movies` 新增 `cast_json`（`[{name,gender,avatar}]`）、`actress` 新增 `gender`；
  新增 IPC `actor:films`（按演员名查影片 + 头像/资料）+ preload `getActorFilms`；
  **详情页演员栏改纯文字**（点击名字进入演员页，仅女优）；新页面 `ActorFilms.vue`
  （头像+资料 / 标签栏 / 排序栏 / 海报网格，每行数量跟随设置）+ 路由 `/actor/:name`；
  默认男女剪影 SVG（`public/actor-female.svg` / `actor-male.svg`）。
  注：JAVBUS 只列女优且带头像；JAVDB 新版结构 `<a class=actor-female>` 女优 / 无 class 男优，逗号分隔（男优本次不做）
- **9/14 UI 收尾**：演员页标签栏/排序栏对齐片库（TagFilter / StatusBar 同款，移除选择按钮）；
  片库标签区与详情信息板块去横线、行间距均匀（详情 `space-evenly` + 行高自适应，标签两行时间距仍相等）；
  详情页信息卡底部四按钮 `margin-top:auto` 恒贴底。
- **9/12~9/13**：**首页 Home.vue 从占位改为完整首页**并多轮重构（轮播 / 类别 / 近期上新三板块）：
  - **轮播**：横向 3:2 海报 600×400、板块 430px、去玻璃背景、缺位淡红占位；多轮试错后
    **最终定为 3D coverflow**——每海报按距中心 d 做 rotateY/translateZ/translateX/scale
    （perspective 内联进 transform，避免父级 perspective+overflow 压平 3D）+ 非中心暗角遮罩；
    **常驻渲染**（所有海报无进出场，只改内联 style）保证 transition 稳定触发；
    乒乓往返自动轮播 + decoding=async
  - **类别区**：推翻 2×2 拼图，改为**全库标签频率前 5**（4 字以内，不基于用户画像），
    5 列卡片 = 单张背景海报 + 暗色渐变遮罩 + 左下角文字（参考 Emby 横滑卡片）
  - **刮削铃铛**：store 引入 pending 队列（enqueue/begin/done），批量刮削先登记待刮削再逐个执行；
    铃铛常显、红标实时显示待刮削总数、面板分「正在/待刮削/失败」三组
  - **设置-标签设置**：加号移到第一行 × 后、×/加号统一 32px 圆形描边按钮（对齐修复）
- **9/11**：项目交接文档整理（HANDOFF 重写 / 删除 3 个过时文档 / start.bat 修复）；
  代码全量审查后执行优化批次：★ **persistSoon 无限递归根因修复**（解开 9/10 喜欢按钮"点了不变色"之谜）、
  persistSoon 提升 util 并推广到全部 db 模块、设计令牌合规（2 处硬编码色）、
  sc 死字段移除、store/settings.js 按领域拆分、DevTools 仅 dev 打开、刮削设置查询合并

---

## 8. 下一轮待办（按优先级，需用户点头后执行）

1. **实测验证**：JAVDB 时长提取正则未经真实页面验证（JAVBUS 已验证）；刮削预览图/统计若抓不到，对照实际 HTML 调 `scraper.js` 正则
2. **B4 功能缺口**（用户搁置中）：女优/网址页导航入口、网址卡片显示已存 `img` 字段
3. **#4 scraper.js 拆分**（561 行 → scrape-javbus.js / scrape-javdb.js / 共享提取器）
4. **#7 JSDoc typedef 深化** + **dev 冒烟自动化**（scripts/smoke.js）
5. **卡片喜欢交互重做**（上次回滚）——建议换实现思路：纯角标 + 详情页切换组合，或点击卡片其他区域触发
6. **P2 清理**：`src/views/` 下 ManualForm.vue / ScanDirForm.vue 可挪到 AddMovieDialog/ 下归位；Home.vue 已做成完整首页（9/13），轮播观感可调 `Home.vue` 的 slotStyle（angle/depth/x/scale 四参数）
7. **待评估**：Detail.vue（803 行）拆分出 PreviewLightbox.vue 独立组件

> 已完成（勿重复）：~~settings.js/actress.js 的同步 persist 迁移到 persistSoon~~（9/11 完成）
>
> 已完成（勿重复）：**代码审查批次 B1~B7 全部完成**（3 硬缺陷 / 热路径 Set 化 / 首页聚合 / 死代码清理 /
> 重复代码收敛 / 刮削两处 / 主进程阻塞），详见 §7 的 9/15 条目 —— 上表若与此重叠，以 §7 为准。

---

## 9. 测试 / 调试指南

- `npm run dev` 后 DevTools 自动打开（detached）；主进程日志带 `[main]`，渲染层 console 会转发到终端 `[renderer][N]`
- 路由首次切换应 ≤20ms（静态引入）；变慢说明被改回懒加载
- GPU 问题：先 `set JAVTUBE_DISABLE_GPU=1 && npm run dev` 排除
- 数据清空测试：设置弹窗 → 关于 → 清空数据库（二次确认）
- 交互卡顿排查顺序：①是否新写操作没走 persistSoon ②是否同步 persist 残留（`grep -n "persist(db)" electron/main/`）

---

## 10. 用户偏好（新 AI 必须遵守）

- **简体中文回复**，结构化表格 + 清晰章节标题
- 重构遵循已有业务逻辑；输出**精简 diff + 变更理由**，不贴完整文件
- 动手前确认理解，逻辑模糊时**主动停下询问**
- 设计还原度要求高：保留原字体/配色/版面；SVG 矢量图标（不用 emoji）；CSS 变量管理颜色
- 关键操作后跑 `npm run build` 验证 + git commit；每次收尾做备份（bundle + tar.gz）并更新本文档
- 换模型流程：读本文 → 读接续工作小结 → 跑 dev 看现状 → 问用户想做什么 → 动手前先读相关文件
