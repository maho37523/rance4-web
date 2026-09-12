# Internet Archive proxy (Cloudflare Workers Free)

这是一个有意限制范围的 Worker：只代理两个固定路径，不接受 URL、文件名或 Archive identifier 参数，也不连接 R2。将 `worker.js` 顶部的 `TODO_REPLACE_*` 常量替换为已获授权的 Internet Archive 标识、文件名和固定数据节点主机后，复制 `wrangler.toml.example` 为 `wrangler.toml`，使用 `npx wrangler deploy` 部署。

固定端点：

- `GET`/`HEAD` `/v1/ranceking/cd.img`：必须是单段且有明确结束位置的 `Range: bytes=start-end`，且响应段不超过 16 MiB；无 Range、开放结尾/后缀 Range、多段、非法 Range 均为 `416`。
- `GET`/`HEAD` `/v1/ranceking/cd.cue`：仅接受上游 `200`，响应体限制为 1 MiB。
- `OPTIONS` 返回 `204`。仅 `https://maho37523.github.io` 获得 CORS 响应头；查询字符串、未知路径返回 `404`，其他方法返回 `405`。

上游 URL 是固定的 Internet Archive `/download/...` URL，所有请求使用 `redirect: "error"`；IMG 必须严格得到 `206` 和匹配的 `Content-Range`。响应以流方式传回，并暴露浏览器读取 Range 所需的 headers。

本地快速检查：`node --input-type=module` 导入 `handleRequest` 并注入 mock `fetch`，即可无需 Cloudflare 账号测试路由和上游校验。部署前必须把 TODO 常量换成真实值，并确认资源拥有公开访问权限。
