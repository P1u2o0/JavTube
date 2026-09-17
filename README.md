JavTube

> JavTube——一款本地jav影片管理软件
集影片推荐、海报墙展示、影片刮削和影片信息展示功能于一体，功能强悍。与其他同类软件有所不同的是，该软件更倾向于打造一个类似私人影院选片库的氛围，在软件使用过程中，让人有种在用私人db网站的感觉～

JavTube 基于 Electron + Vue 3 构建，所有数据（影片信息、标签、收藏、观看记录）仅保存在本机 `data` 目录中，**不上传任何内容**。无需注册，除刮削外均无需联网。

![Release](https://img.shields.io/github/v/release/P1u2o0/JavTube)
![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Tech](https://img.shields.io/badge/Electron-30-47848f)
![Vue](https://img.shields.io/badge/Vue-3-42b883)
![License](https://img.shields.io/badge/license-MIT-green)
 
前言
 
从小我就立志要给每一位日本小姐姐在硬盘中有一个家，奈何影片下载千百部，再回首，却无从下手。市面上的本地影片管理软件我也用了很多，其中也不乏优秀的作品，但总感觉功能上差些什么。借着ai编程的东风，根据我自己的需求与喜好，借鉴（bushi）众多前辈的软件，写出了这么一款软件。
 
界面与功能展示
 
首页
 
相信许多热衷收藏jav影片的老哥都遇到过一个困境，那就是影片越下越多，却不知从何看起。首页要解决的就是这一痛点。要注意的一点是，首次使用软件，因软件内没有影片数据，首页会呈现空白，属于正常现象。在把硬盘里的各位小姐姐导入刮削完成后重启软件，就可以看到焕然一新的界面了。首页分为三个板块，分别是影片推荐轮播、喜爱类别推荐和每日上新板块。
 
首先是影片推荐轮播板块，会根据历史观看和影片收藏，在每次打开软件时推荐五部影片，解决选片难的痛点。
 
其次就是喜爱类别推荐板块，跟上面影片推荐轮播板块逻辑相似，会根据近期观看历史，总结喜欢的电影类别。
 
再就是每日上新板块，这个板块推送逻辑就与上面两个板块截然相反，会从片库里找八部最近不常看类别的影片，做到雨露均沾～
 
片库
 
与众多同类影片管理软件不同，片库页面将类别筛选功能和海报墙展示合为一体，同时类别板块支持多选和类别分类，有种在访问db站搜索影片的感觉，精准定位符合自己xp的影片～
 
刮削功能
 
本软件集成javbus和javdb两个网站的刮削功能，并且为了尽可能的补全刮削字段，会同时使用两个网站进行刮削，刮削字段有导演，系列，javdb评分，想看/看过人数，女优，类别，影片预览图等。值得注意的是，javdb站首次使用时需要在设置里填入cookie并且配置代理访问，cookie获取方式为在javdb网页打开F12审查页面-刷新-网络-cookie。如果有不想要刮削的项目可以在设置里进行关闭。
影片数据存放在软件同目录data文件夹里。

本地开发

```bash
# 1. 安装依赖
npm install

# 2. 开发模式（Vite 热更新 + Electron）
npm run dev

# 3. 代码检查
npm run check:undefined

# 4. 打包 Windows 绿色版 zip（输出到 release/）
npm run release
```

---

目录结构

```
javtube_dev/
├── electron/
│   ├── common/
│   │   └── ipc-channels.js     # IPC 通道名常量（主进程与预加载共用）
│   ├── main/
│   │   ├── index.js            # 入口：窗口 / 数据目录 / 旧数据迁移 / IPC 注册
│   │   ├── scraper.js          # JAVBUS / JAVDB 刮削与图片本地化
│   │   ├── net-curl.js         # 走系统 curl 的网络层（代理 / Cookie / 限速）
│   │   ├── cover-protocol.js   # javtube-cover:// 自定义协议
│   │   ├── video-meta.js       # MP4 时长解析
│   │   ├── home.js             # 首页数据聚合（轮播 / 类别 / 上新）
│   │   └── db/                 # 影片 / 女优 / 网址 / 设置 / 建表与迁移
│   └── preload/
│       └── index.js            # contextBridge 暴露 window.api
├── src/
│   ├── views/                  # 首页 / 片库 / 详情 / 喜欢 / 观看记录 / 演员影片页
│   ├── components/             # 顶栏 / 卡片 / 网格 / 标签筛选 / 排序 / 状态栏 / 设置 / 导入
│   ├── store/                  # Pinia 状态：影片 / 刮削 等
│   ├── composables/            # 列表加载复用逻辑
│   ├── router/  utils/  styles/
├── scripts/
│   └── build-portable.js       # 绿色版打包（含 asar 瘦身 / 图标版本信息写入 / 自检）
└── build/                      # 应用图标
```

---

声明

本软件仅为**本地jav媒体文件管理工具**，不提供、不存储、不分发任何媒体内容。刮削功能抓取的元数据来自公开网站，仅供个人整理收藏使用。请遵守所在地区的法律法规，合理使用本软件。

许可证

[MIT](LICENSE)
