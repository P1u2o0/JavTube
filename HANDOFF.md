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

# 主进程语法检查（批量）
for f in electron/main/*.js electron/main/db/*.js; do node --check "$f"; done

# 打包 Windows 安装包
npm run build:win
```

**脚本一览**：`scripts/check-undefined.js`（未定义引用静态检查）、`scripts/scrape-smoke.js`（刮削冒烟）。

---

## 4. 目录结构

```
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
| **persistSoon** | sql.js 的 `persist` 是整库同步导出（阻塞主进程）。**全部四个 db 模块**（movies / settings / actress / websites）的写操作统一用 `persistSoon(db)`（定义于 `db/util.js`，setImmediate 延迟落盘）。**新增写操作必须用它** |
| **稳定分页** | 所有 `ORDER BY` 必须追加唯一 tie-breaker（`, id DESC`），否则同值行跨 LIMIT/OFFSET 查询顺序不保证 → 影片在页间跳动 |
| **设置批量保存** | 渲染端 `updateSettingsBatch(obj)`（`settings:updateBatch` 通道）一次事务写多键只落盘一次；不要逐键调 `updateSetting`（会卡） |
| **IPC 通道** | 新增通道三步：`ipc-channels.js` 常量 → `preload/index.js` invoke → `electron/main/**` handle。当前 40/40 配对，返回格式 `{ ok, data?, error? }` |
| **三视图共享 store** | 片库 / 喜欢 / 历史共用 `store.movies`——各视图挂载时必须重新加载自己视图的全量语义（片库=全量、喜欢=onlyFavorite、历史=historyOnly） |
| **刮削进度** | 顶栏铃铛按钮（`useScrapeStore`：enqueue / begin / done / clear），红色角标=待刮削数量；单个与批量刮削都接入 |
| **灯箱查看器** | 详情页点击预览小图 → `<Teleport to="body">` 全屏遮罩 + 滚轮缩放 0.5-5x + 左右按钮/方向键循环 + Esc 关闭 |
| **详情页海报区** | 框尺寸 JS 计算：`min((视口高-300px)/海报高, 视口宽×0.56/海报宽)`，小分辨率海报强制放大；窗口 resize 重算 |
| **封面协议** | `javtube-cover://0/<base64url>` 自定义 privileged scheme（`electron/main/index.js` 注册，`cover-protocol.js` 解析） |
| **刮削网络层** | 走系统 curl（`net-curl.js`）：页面请求按设置走代理并携带用户 Cookie；图片按域名决定代理/直连优先级；**不加 `-L`**（见 §6 坑 12） |
| **乐观更新** | 交互路径写库已延迟落盘，UI 侧可乐观翻转、失败回滚 |

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
3. **主色朱柿红 `#d2401e`**、暖纸白 + 墨黑主题、字体 Outfit（拉丁）+ Noto Sans SC（中文）
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
