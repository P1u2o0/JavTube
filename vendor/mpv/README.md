# vendor/mpv —— 随包分发的 mpv 播放内核

内置播放页的「高兼容模式」用 mpv 做播放内核（详见 [`docs/MPV_INTEGRATION_PLAN.md`](../../docs/MPV_INTEGRATION_PLAN.md)）。
这里放的是**运行时二进制**，不是源码。

| 文件 | 说明 |
|---|---|
| `mpv.exe` | 主程序（约 116 MB，静态链接 FFmpeg，含全部解码器） |
| `d3dcompiler_43.dll` | d3d11 视频输出需要 |
| `mpv.com` | 控制台包装（本应用不用，保留以便手工排查） |

## 版本

- **mpv v0.41.0**（`v0.41.0-1104-geb0ee1031`），libplacebo v7.374.0
- 来源：<https://github.com/shinchiro/mpv-winbuild-cmake/releases>
  构建包名形如 `mpv-x86_64-<日期>-git-<hash>.7z`

> ⚠️ **不要用 `-v3` 结尾的构建**：那是针对较新 CPU 指令集的版本，兼容性差。

## 怎么重新获取

```bash
# ① 查最新构建（GitHub API）
curl -sL --max-time 60 \
  "https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);
      console.log(j.tag_name);for(const a of j.assets) if(/mpv-x86_64.*\.7z$/.test(a.name)) console.log('  ',a.name)})"

# ② 下载（本机直连 GitHub 不通，只有这个代理可用；shell 里的 HTTPS_PROXY=13553 会 502）
curl -L --http1.1 --ssl-no-revoke -x "http://127.0.0.1:7897" --max-time 600 \
  -o mpv.7z "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/<tag>/<包名>.7z"

# ③ 解包，只取这三个文件放到本目录
"/c/Program Files/7-Zip/7z.exe" x -y -o. mpv.7z
```

## 许可

mpv 本身是 GPL-2.0+ / LGPL-2.1+ 双许可，但**官方与 Shinchiro 的 Windows 构建默认含 GPL-only 组件
（如 `--enable-gpl` 的某些滤镜），按 GPL-2.0+ 分发**。

本应用以**独立进程**方式调用 mpv（`spawn` + JSON IPC，不做链接、不改动其源码），
属于「聚合分发」；发布物中必须附带 mpv 的许可文本与来源声明。
**正式对外发版前需确认这一条**（见方案文档 §7 风险表最后两行）。
