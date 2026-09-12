# 鬼畜王兰斯：Cloudflare R2 发布准备

GitHub Pages 只发布网页壳和前三作的静态资源。鬼畜王的 CD 镜像不能放进 Git
仓库或 Pages：网页运行时会使用 HTTP Range 按需读取其中的一段（通常是一首音乐），
不会下载整张镜像。

## 建议的对象布局

创建私有写入、公开只读的 bucket，例如 `rance-web-assets`。将对象放在以下前缀：

```
ranceking/core/RanceKingSA.ALD
ranceking/core/RanceKingGA.ALD
ranceking/core/RanceKingGB.ALD
ranceking/core/RanceKingWA.ALD
ranceking/core/RanceKingSA.ASD       # 如该版本存在
ranceking/cd/kichiku_CD-DA.img
ranceking/cd/kichiku_CD-DA.cue
```

对象名可使用 ASCII；网页加载时会恢复 ALD 的逻辑文件名。不要上传 EXE、DLL、补丁
目录、说明文档或 CCD/SUB 文件。IMG 和 CUE 必须来自同一份镜像。

## CORS

为公开读取域名配置以下 CORS 规则。将开发地址仅保留在本地测试期间：

```json
[
  {
    "AllowedOrigins": [
      "https://maho37523.github.io",
      "http://127.0.0.1:4173"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": [
      "Accept-Ranges",
      "Content-Length",
      "Content-Range",
      "Content-Type"
    ],
    "MaxAgeSeconds": 86400
  }
]
```

发布后必须验证 `Range: bytes=0-0` 对 IMG 返回 `206 Partial Content`、
`Content-Range: bytes 0-0/<总字节数>`，而非 `200`。给 IMG/CUE 设
`Cache-Control: public, max-age=31536000, immutable`。

## 发布验收

1. 在本地配置 R2 公共基址后，确认首屏只请求 ALD、CUE 与 IMG 的 `bytes=0-0`，未
   下载完整 IMG。
2. 进入新游戏，确认中文文本、存档/读档正常。
3. 播放 CD 音轨 2 和另一首后段音轨，确认每次请求范围仅覆盖对应音轨并能播放。
4. 在手机横屏实际验证方向、A、短按 B（取消）和长按 B（跳过）。
5. 通过后再把公开基址写入发布清单并部署 GitHub Pages。
