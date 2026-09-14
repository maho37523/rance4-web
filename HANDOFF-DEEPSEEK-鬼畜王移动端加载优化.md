# 《鬼畜王兰斯》移动端加载优化交接（2026-09-14）

## 结论

本轮解决的是 **鬼畜王兰斯（`ranceking`）首屏下载慢、分段下载偶发失败** 的网页端基础设施问题，改动已经推送到 `main` 并公开部署。它不涉及 System35/SCO 执行、文本乱码、汉化资源或游戏流程逻辑；那些问题应与本次加载优化分开诊断。

当前公开站点：<https://maho37523.github.io/rance4-web/?game=ranceking>  
公开下载代理：<https://ranceking-archive-proxy.ljc787865.workers.dev>

## 相关提交（均已推送到 `origin/main`）

| 提交 | 内容 |
| --- | --- |
| `677ea87` | 并发下载、进度汇总、浏览器本地缓存；代理端受控 Range 支持与测试。 |
| `edd53e3` | 让 Service Worker 对代理请求使用 `NetworkOnly`，修复 Range 响应被错误复用。 |
| `e3e2068` | 客户端续传块从 4 MiB 降为 1 MiB，并严格核验 `Content-Range`。 |

## 已完成的实现

### 1. 下载策略与缓存

文件：`dist/autostart.js`

- 仅对 `ranceking` 的 4 个预载 ALD 使用 `downloadGameFiles()`；最多 **2 个并发**，替代原先串行等待。
- 进度显示为全局累计的“文件数 / 总 MB / 已复用缓存数”。
- 完整下载的文件存入同源 Cache Storage：`ranceking-game-data-v1`。缓存 key 由资源路径和 manifest 的 `sha256`（无 sha256 时用 URL）组成；资源更新会自然失效。
- 缓存配额不足或 Cache Storage 不可用时会静默退化为网络加载，不影响启动。
- 对远程分段数据统一做长度校验；若 `blob.size !== 预期区间长度` 会报 `short chunk`，不会把截断数据交给引擎。

### 2. 分段读取

文件：`shell/loadersource.ts`、构建产物 `dist/shell.js` / `dist/shell.js.map`、`dist/autostart.js`

- 客户端续传块统一为 **1 MiB**（`1 << 20`），适合移动网络重试；不是把完整 50+ MB ALD 切成一次大请求。
- 代理可接收的单段上限仍是 **4 MiB**，因此 1 MiB 客户端请求一定在允许范围内。
- 不能删除 `Content-Range` 或长度校验来“绕过”错误：这会导致残缺 ALD 被当成完整游戏文件，后续表现为随机黑屏或引擎异常。

### 3. Cloudflare 下载代理

文件：`archive-proxy/worker.js`

- Worker 名称：`ranceking-archive-proxy`；已登录账户并发布。
- 发布 URL：`https://ranceking-archive-proxy.ljc787865.workers.dev`。
- 对 ALD 的闭区间 Range 请求最多回传 4 MiB；会验证源站状态、`Content-Range`、`Content-Length` 后才转发。
- 已设置 Pages 站点所需 CORS；实测 `Range: bytes=1048576-2097151` 返回 `206`、`Content-Length: 1048576`、正确的 `Content-Range` 和允许的 Origin。
- 代理不是 R2：它按需读取 Internet Archive 的资源。大体积 CD 镜像不在首屏预下载范围内，继续按需 Range 访问。
- `archive-proxy/worker.test.mjs` 共 6 项 Node 测试，均通过。

`archive-proxy/wrangler.toml` 是本机未跟踪的部署配置，内容不含账号 ID、令牌或密钥。若换机器部署，可参考 `archive-proxy/README.md` 复制配置后执行 `npx wrangler deploy`；不要提交任何 Cloudflare Token。

### 4. 修复 Service Worker 的 Range 缓存冲突

文件：`dist/service-worker.js`

原有 Workbox 的宽泛 `NetworkFirst` 规则会将代理返回的 `206 Partial Content` 放入 Cache Storage。但标准 Cache key 不区分 Range 请求头，后续不同区间有概率读到旧片段，曾实际出现 `GA.ALD: short chunk 420833`。

现已在宽泛规则之前加入：对 `https://ranceking-archive-proxy.ljc787865.workers.dev` 的请求用 `NetworkOnly`。因此：

- Range 片段永远走网络，不被 Workbox 错配缓存；
- 完整 ALD 只由 `autostart.js` 的版本化 `ranceking-game-data-v1` 缓存管理。

不要把这两层缓存重新合并。

## 数据量与预期体验

预载的 4 个 ALD 总量约 **51.8 MB**（SA / GA / GB / WA）；冷启动仍需要下载这些游戏原始数据，优化目标是可恢复、不中断、后续复用缓存，不可能把首次 50 MB 变成零网络。

在 CDP 的移动形状网络条件（1.6 Mbps 下行、300 ms RTT）中，修复版成功建立 `640×400` 游戏 Canvas，首个可见画布记录约为 15 秒；此前复现的 `short chunk` 未再出现。该 CDP 节流对 Worker 流量的实际速率并非严格的物理手机测速，不能将“15 秒”写成所有手机/网络的承诺。应在真机上再测冷缓存与热缓存。

已跑验证：

```sh
npm run build
node --check dist/autostart.js
node --test archive-proxy/worker.test.mjs
gh run view 34823511340  # build、deploy_pages 均 success
```

`npm run type` 仍会在已有 Emscripten / IDBFS 类型缺失处失败（`savedata.ts`、`shell.ts` 的 `FS.link` 等），这在本轮前即存在，不能归因于本次修改。

## 当前不属于本轮的已知工作

1. **鬼畜王的游戏内容黑屏、SCO 页入口、文本乱码、汉化数据**：请沿此前诊断/交接文件继续。这些属于 System35 引擎或游戏资源语义，不要因下载层修复而假设已解决。
2. **兰斯 4 / 4.1 / 4.2 的移动端按键、菜单翻译、画面比例**：本轮未改触控 UI；共享 loader 的分段尺寸变为 1 MiB，但未改变按键或渲染布局。
3. **真实设备体验**：应至少测 Android Brave/Chrome 的冷缓存、热缓存、弱网中断后刷新三种情况，并记录 DevTools/页面错误。

## 推荐给后续执行者的核查顺序

1. 打开公开 URL，先确认 loader 显示四个文件的累计进度，且最终有 `640×400` Canvas。
2. 在浏览器 DevTools 的 Application 面板确认完整缓存只有 `ranceking-game-data-v1` 负责 ALD；不要让 Workbox 缓存 Worker 的 `206` 请求。
3. 若出现 `short chunk`：先查请求/响应的 `Range`、`Content-Range`、`Content-Length` 是否精确对应，再查 Worker 日志和 Internet Archive 源站；**不要**移除校验。
4. 若下载完成但游戏黑屏/崩溃：收集引擎控制台、当前 ALD/SCO 页号和复现步骤，转到 System35 数据/引擎路径，不要修改下载器猜修。
5. 改 `shell/loadersource.ts` 后必须运行构建，提交同步生成的 `dist/shell.js` 与 map；站点直接发布 `dist/`，只改 TypeScript 源文件不会上线。

## 工作树注意事项

截至交接时，下列文件为先前已有的未提交内容，**不属于本轮加载优化，勿覆盖或顺手提交**：

```text
M  tools/diag/livecheck.mjs
?? tools/diag/testdata/rance4-mojibake-scene.png
?? tools/diag/testdata/rance4-scene-t61.png
```

此外 `archive-proxy/wrangler.toml` 是本轮本地部署辅助文件，未提交且不含秘密；是否纳入仓库应由项目维护者决定。
