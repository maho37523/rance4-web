# 鬼畜王资源代理（Cloudflare Workers Free）

这是一个固定白名单代理：只转发 GitHub Release 标签 `game-assets-v1` 中已知的鬼畜王文件；不接受任意 URL、文件名、查询参数或 R2 绑定。

固定端点：

- `GET`/`HEAD` `/v1/ranceking/cd.img`：必须是单段、闭合 Range；最大 80 MiB。
- `GET`/`HEAD` `/v1/ranceking/cd.cue`：仅接受固定长度的完整响应。
- `GET`/`HEAD` `/v1/ranceking/{SA,GA,GB,WA}.ALD`：可完整下载，也支持最大 4 MiB 的单段 Range，供移动端断点续传。
- `OPTIONS` 返回 `204`；只有 `https://maho37523.github.io` 获得 CORS 响应头。

移动端策略：网页将 ALD 分块下载、失败时只重试当前块，并在完整下载成功后写入浏览器 Cache Storage。再次启动优先从缓存读取。CD 镜像继续按游戏需要读取范围，绝不预下载整张镜像。

本地验证：

```sh
node --test archive-proxy/worker.test.mjs
```

部署前将 `wrangler.toml.example` 复制为本机未跟踪的 `wrangler.toml`，确认 Worker 名称与登录账户无误，然后运行：

```sh
npx wrangler deploy
```

部署后应从公开 Pages Origin 对任一 ALD 发起 `Range: bytes=0-1023`，确认响应为 `206` 且包含正确的 `Content-Range`。
