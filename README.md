# JavTube

> 一款**纯本地**运行的桌面影视库管理软件 —— 刮削、整理、筛选、播放，你的私人片库一站搞定。

JavTube 基于 Electron + Vue 3 构建，所有数据（影片信息、标签、收藏、观看记录）仅保存在本机 `data` 目录中，**不上传任何内容**，无需注册、无需联网即可使用全部本地功能。

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Tech](https://img.shields.io/badge/Electron-30-47848f)
![Vue](https://img.shields.io/badge/Vue-3-42b883)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ 功能一览

### 🏷️ 强大的标签系统

- **9 大类标签**：类型、地区、片商、系列、导演、演员、年份、画质、自定义，类别名称与标签内容均可在设置中自由增删改
- **AND 逻辑组合筛选**：多标签叠加过滤，精准定位目标影片
- 标签分隔符统一使用中文逗号「，」，输入无负担

### 🎬 片库管理

- 卡片式网格浏览，**每行列数可自定义**（设置中拖动滑块调整）
- 多字段排序（添加时间、发行日期、番号等）+ 分页浏览
- **批量操作**：多选后批量收藏 / 取消收藏 / 删除
- 点击影片可选「查看详情」或「直接播放」两种行为
- 详情页支持：播放（调用系统或自定义播放器）、收藏、编辑元数据、重新刮削、删除

### ❤️ 收藏与历史

- 一键收藏，独立「喜欢」页面快速回看
- 自动记录观看历史，随时追溯

### 👤 女优管理

- 女优卡片库：头像、罩杯、身高、三围、生日、出道日期、备注
- 点击卡片查看参演影片列表，可直接跳转影片详情
- 支持手动添加与刮削补全资料

### 💾 数据安全

- **备份**：一键导出 SQLite 数据库到任意位置
- **恢复**：从备份文件完整还原
- **清空**：危险操作二次确认，防止误删

### 🎨 精心打磨的界面

- 极简工具风设计：暖纸白底 + 墨黑主色 + 朱柿红点缀
- 统一 SVG 图标体系、四级圆角规范、卡片错峰入场动画
- 基于 Element Plus 深度定制主题

---

## 🛠️ 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 30 |
| 前端框架 | Vue 3（`<script setup>`）+ Vite 5 |
| UI 组件 | Element Plus（深度主题定制） |
| 状态管理 | Pinia + Vue Router（Hash 模式） |
| 数据库 | sql.js（SQLite WASM，纯本地文件存储，免原生编译） |
| 元数据刮削 | 主进程 HTTP 抓取 + HTML 解析（JavBus / JavDb） |
| 打包分发 | electron-builder |

**架构**：三层 IPC 通信 —— 主进程（窗口 / 爬虫 / 数据库）→ 预加载脚本（contextBridge 暴露 `window.api`）→ 渲染进程（Vue 页面）。所有 IPC 统一返回 `{ ok, data, error }` 结构。

---

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动开发模式（Electron 窗口 + 热更新）
npm run dev

# 3. 打包 Windows 安装包
npm run build:win
```

打包产物输出至 `release/` 目录。

---

## 📁 目录结构

```
javtube_dev/
├── electron/
│   ├── main/            # 主进程：窗口、IPC、刮削器、数据库
│   │   ├── index.js     # 入口 + IPC 注册
│   │   ├── scraper.js   # JavBus / JavDb 元数据刮削
│   │   └── db/          # sql.js 数据库模块（影片/女优/设置）
│   └── preload/         # 预加载：contextBridge 暴露 window.api
├── src/
│   ├── views/           # 8 个页面（首页/片库/详情/收藏/历史/女优/网址/设置）
│   ├── components/      # 通用组件（导航/卡片/筛选/对话框/图标库）
│   ├── store/           # Pinia 状态
│   └── styles/          # 设计令牌与全局样式
└── data/                # 运行时生成：SQLite 数据库 + 封面缓存
```

---

## ⚠️ 声明

本软件仅为**本地媒体文件管理工具**，不提供、不存储、不分发任何媒体内容。刮削功能抓取的元数据来自公开网站，仅供个人整理收藏使用。请遵守所在地区的法律法规，合理使用本软件。

## 📄 许可证

[MIT](LICENSE)
