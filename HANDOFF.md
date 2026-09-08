# JavTube 项目交接书（HANDOFF）

> 给"换模型后接手 javtube 的人"看的精简速查。**配合 `PROJECT_BRIEF.md` 一起读**——本文是"现在到哪了 + 别踩这些坑"，BRIEF 是"项目是什么 + 历史"。
>
> 维护：每次切换模型/会话前由当前模型重写本文件。

---

## 0. 一句话

`javtube_dev` 是 Electron 30 + Vue 3 + sql.js 写的**纯本地**影视库管理软件。今天（2026-09-07）已恢复到 WorkBuddy 工作区 `<项目根目录>\`，dev 服务正在跑、9 个 commit、git tree clean。

---

## 1. 当前状态（2026-09-08 12:33 快照）

| 项 | 值 |
|---|---|
| 工作区 | `<用户目录>\WorkBuddy\2026-09-07-21-10-26\` |
| 项目根 | `…\javtube_dev\` |
| 大小 | 600M（含 595M `node_modules`） |
| 源文件数 | 36 个（`electron/` + `src/` 下 js/vue/css） |
| git 分支 | `main`（9 个 commit） |
| 远端 | `https://github.com/P1u2o0/JavTube.git`（项目元数据，**用户已决定不再 push**） |
| dev 服务 | 后台 task `uoTIaA`，Vite 5173 + Electron 窗口开 |
| 数据目录 | `node_modules\electron\dist\data\`（开发模式默认位置） |
| 用户数据库 | `…\data\app.db`（含 `SSNI-888` 影片 1 条） |
| 封面 | `…\data\covers\SSNI-888.jpg`（已修复可正常显示） |

### 最近 9 个 commit
```
425cf5f docs: 更新日志回填真实 commit hash
cf0084a docs: 项目档案——补充 9/7 两条更新记录（封面修复 + 项目恢复）
e6482f9 fix: 封面图片加载——注册 javtube-cover privileged scheme   ★ 今天新增
2f04f79 perf: 优化页面切换卡顿
3837053 feat: 添加影片仅保留两种方式 + 修复关于页图标裁剪
13854fe fix: 修复路由切换后页面空白（过渡动画死锁）
07a8c1c refactor: 代码梳理与冗余清理
5cd25d1 docs: 新增 GitHub README
639e669 feat: UI 全面重绘——统一设计令牌、图标体系与配色
```

---

## 2. 启动与运行

```bash
# 依赖已装好（595M node_modules 已在），直接：
cd "<项目根目录>"
"<工具目录>\binaries\node\versions\22.22.2-2\npm.cmd" run dev
# Vite 5173 + Electron 窗口（dev 时 dataDir 默认在 node_modules/electron/dist/data/）
# DevTools 自动 detached 打开

# 验证构建
"<工具目录>\binaries\node\versions\22.22.2-2\npx.cmd" vite build

# 打包 Win 安装包
"<工具目录>\binaries\node\versions\22.22.2-2\npm.cmd" run build:win

# GPU 驱动异常降级
set JAVTUBE_DISABLE_GPU=1 && npm run dev
```

**重要**：托管 Node 路径用绝对路径（`<工具目录>\binaries\node\…`），不要用裸 `npm`/`node`，因为 PATH 里有多个版本。

---

## 3. 文件速查

### 入口
- `package.json` — `name: javtube`, `main: electron/main/index.js`, `build`: electron-builder
- `index.html` — 唯一 HTML，含 CSP meta（**`img-src` 已加 `javtube-cover:`**）
- `vite.config.js` — Vue 插件 + `start-electron-after-vite` 自定义插件，CDP 调试端口 9223
- `start.bat` — 老启动脚本（路径写死 `c:\Users\<用户名>\Documents\<旧目录>\<旧项目名>\app` 已过期，仅历史遗留）

### 主进程
- `electron/main/index.js` — 窗口/IPC/迁移/数据目录；**`registerCoverProtocol()` 在这**
- `electron/main/scraper.js` — JavDB/JavBUS/FC2PPVDB/AVSOX 刮削（基于 AS3 JavTag 移植）
- `electron/main/db/init.js` — sql.js 初始化 + WASM 定位 + 5 秒脏标记自动 save
- `electron/main/db/movies.js` — 影片 CRUD + 搜索 + 分页 + 标签筛选
- `electron/main/db/actress.js` — 女优 CRUD
- `electron/main/db/settings.js` — 设置 + 标签分类 JSON + 备份/恢复/清空

### 预加载（contextBridge → `window.api`）
- `electron/preload/index.js` — 暴露 `api.getMovies/getMovie/createMovie/updateMovie/...` 等 20+ 方法

### 渲染层
- `src/main.js` — `createApp` + Pinia + ElementPlus + zhCn + 全局注册 Element Plus 图标
- `src/App.vue` — TopNav + `<router-view>`；**用 CSS keyframe 做路由入场，不用 `<transition mode="out-in">`**
- `src/router/index.js` — **静态引入**全部 8 个页面（性能优化后不要改回懒加载）
- `src/store/{movies,settings}.js` — Pinia
- `src/styles/global.css` — **设计令牌层**（颜色/圆角/阴影/动画/字体），别硬编码十六进制
- `src/utils/global.js` — `resolveCover()`（已切到 javtube-cover 协议）、`extractCode()`、`dataDirRef`
- `src/components/AppIcon.vue` — **统一 SVG 图标库**（30+），别再加 emoji

### 页面（8 个）
- `src/views/Home.vue` — 当前是功能引导占位（**未接真实数据**，是个 TODO）
- `src/views/Library.vue` — 主片库（卡片网格 + 标签筛选 + 批量操作）
- `src/views/Detail.vue` — 详情（封面大图 + 标签 + 操作按钮）
- `src/views/Favorite.vue` — 收藏
- `src/views/History.vue` — 观看记录
- `src/views/Actress.vue` — 女优管理
- `src/views/Website.vue` — 网址导航
- `src/views/Settings.vue` — 设置（基础 / 标签类别 / 辅助 / 关于 4 tab）

### 通用组件
- `src/components/{TopNav,MovieCard,MovieGrid,SortBar,StatusBar,TagChip,TagFilter}.vue`
- `src/components/{AddMovieDialog,EditMovieDialog}.vue`
- `src/components/AddMovieDialog/{ScanDirForm,NfoForm,ManualForm,ScrapeForm,SingleForm}.vue`
  - **当前未引用**：`ScrapeForm.vue`、`SingleForm.vue`（被禁用但保留文件）
  - **仅 EditMovieDialog 引用**：`ManualForm.vue`

### 文档
- `PROJECT_BRIEF.md` — 项目档案（必读，第 10 节是更新日志）
- `README.md` — GitHub README
- `开发文档.md` / `快速开始.md` / `项目说明.md` — 历史文档，与代码偶有出入（比如 better-sqlite3 vs sql.js 实际是 sql.js）
- `replace_icon.py` + `rcedit.exe` — 给打包后的 exe 替换图标（用 pefile 改 PE 资源）

---

## 4. 设计约束（**违反会破坏一致性，不要这样做**）

1. **颜色/圆角/阴影一律用 CSS 变量**：`var(--bg)` / `var(--r-md)` / `var(--sh-1)` 等。检查硬编码：`grep -rE '#[0-9a-fA-F]{6}' src/`
2. **图标用 `AppIcon` 库**：不要新加 emoji；需要新图标先在 `AppIcon.vue` 注册
3. **不用 `<transition mode="out-in">` 做路由过渡**：Electron `--disable-gpu` 时帧回调会被节流，过渡未结束新页面永挂载，表现为空白页。改用纯 CSS `@keyframes route-anim`
4. **数据库是 sql.js，不是 better-sqlite3**：所有 SQL 走主进程 `window.api.db.*` 异步 API，不在渲染进程直接调用
5. **Tab 分隔符用中文逗号「，」**：项目约定
6. **IPC 返回格式**：`{ ok: boolean, data, error }`
7. **不要在 vite.config.js 追加 `--disable-software-rasterizer`**：会禁 SwiftShader，大窗口动画掉帧
8. **不要自己算 Unix 时间戳**：用 `date` / PowerShell `[DateTimeOffset]`
9. **写新 UI 前先看 `src/styles/global.css` + `AppIcon.vue`**，把现有令牌复用而不是新加

---

## 5. ★ 今天做的关键修复：`e6482f9` 封面协议

**问题**：刮削后的本地封面 `file:///C:/.../covers/SSNI-888.jpg` 加载不出来，DevTools 报 `Not allowed to load local resource`。

**修法**：在主进程注册 `javtube-cover://` privileged scheme（不在渲染层去 `file://` 硬拼）。

**坑（换模型的人务必看一眼）**：
- **必须 `protocol.registerSchemesAsPrivileged` 在 app ready 之前调用**——这是 Electron 文档里非常容易遗漏的硬性要求
- 第一次写 `javtube-cover:///<base64url>`（三个斜杠）但 base64url 字符 `[A-Za-z0-9-_]` 是合法 hostname 字符，**Chromium 把整串当 host，pathname 只剩 `/`**，主进程拿到空字符串返回 400。**修法是用固定占位 host '0'** → `javtube-cover://0/<base64url>`
- CSP `img-src` 必须加 `javtube-cover:`
- 安全：白名单扩展名（仅图片）+ 白名单根目录（dataDir/cwd/exe 同级/tmpdir），用 `path.relative` + 不以 `..` 开头判断，不能用正则

**涉及文件**：
- `electron/main/index.js` — `registerSchemesAsPrivileged`（文件顶部）+ `registerCoverProtocol()`（getDataDir 之后定义）
- `src/utils/global.js` — `resolveCover()` 全部改用 base64url 编码 + 固定 host '0'
- `index.html` — CSP `img-src` 加 `javtube-cover:`

---

## 6. 已知 TODO（按优先级）

### P1（用户会问的）
- **Home.vue 未接真实数据**：现在是功能引导占位页（"导入影片 / 浏览片库 / 收藏"三个按钮）。可接：统计（总影片/收藏/观看数）、最近添加、最近观看、随机推荐。**结构很适合做 Dashboard**

### P2（清理类）
- **未引用文件**：`ScrapeForm.vue`、`SingleForm.vue` 当前没被引用（被禁用但保留）。可清理
- **`ManualForm.vue` 仅 EditMovieDialog 引用**，可考虑挪到 EditMovieDialog/ 下
- **vite.config.js 旧注释**："已改为静态引入"——但 router 已经静态引入，注释可清理
- **老 `start.bat`** 路径写死 <旧目录>，过期

### P3（优化类）
- **sql.js 持久化**：没有 WAL 模式，靠设置里的「备份」手动 export；可考虑自动备份或检测退出信号
- **scrape 失败的容错**：目前是单次 try/catch，可加重试 + 多源 fallback
- **Home.vue 真实数据**接入后，可考虑做 skeleton loading

---

## 7. 测试/调试指南

- DevTools 自动打开（detached 模式），主进程日志全部带 `[main]` 前缀
- 主进程 console 转 `Ctrl+Shift+I` 直接看；渲染进程 console 通过 DevTools
- 性能问题：路由首次切换应 ≤20ms（静态引入），若变慢说明有人改回懒加载
- 调试 GPU 问题：先 `set JAVTUBE_DISABLE_GPU=1 && npm run dev` 排除
- 数据清空测试：Settings → 关于 → 清空数据库（二次确认）

---

## 8. 用户偏好（从历史对话归纳，**会持续更新**）

- **设计敏感**：改 UI 时必须保留原始字体（Outfit 拉丁 + Noto Sans SC 中文）、配色（暖纸白 + 墨黑 + 朱柿红 #d2401e）、版面（卡片错峰入场、4 级圆角 8/12/16/pill）
- **喜欢 SVG 矢量透明背景导出**（用于设计资产跨软件集成）
- **要求设计+工程一体化**：交付物要工程可用，不是纯展示稿
- **GitHub 用户名**：`P1u2o0`，仓库 `https://github.com/P1u2o0/JavTube`
- **常在 WorkBuddy 中工作**，习惯把"项目档案" `PROJECT_BRIEF.md` 放在项目根

---

## 9. 换模型后的建议流程

1. 读这份 `HANDOFF.md`（你正在看的）
2. 读 `PROJECT_BRIEF.md`（第 5 节"已完成的工作"必看）
3. 跑 `npm run dev` 看现状
4. 问用户当前想做什么，再开始改
5. **动手前先看相关文件再改**，别瞎改
6. 改完按 PROJECT_BRIEF.md 第 10 节约定追加更新日志一行

---

*此文件由 2026-09-07 会话的 WorkBuddy 写就。下一任接手者请根据当时情况重写本文件。*
