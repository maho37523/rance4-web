# 兰斯网页化项目：现状对齐交接（2026-09-15）

> 目的：让接手者以仓库事实而非旧口头结论继续工作。本文把“上次 Codex 的记忆”与“本次直接核查到的当前仓库状态”分开；两者冲突时，以后者为准。

## 1. 项目与发布面

- 工作区：`/Users/cris/Documents/ChatGPT/兰斯4网页化/app`
- Git 仓库：`https://github.com/maho37523/rance4-web.git`
- 当前分支：`main`，`HEAD == origin/main == 363d2c6`（核查时）。
- 公开静态站：`https://maho37523.github.io/rance4-web/`
- 发布目录：`dist/`；GitHub Actions 会把它部署到 GitHub Pages。
- 线上作品选择页有四作：兰斯 4、兰斯 4.1、兰斯 4.2、鬼畜王兰斯。
- 引擎：兰斯 4 为 `xsystem35` WebAssembly；4.1/4.2 为 `system3` WebAssembly。网页壳和触控 UI 位于 `shell/`，但线上直接使用已提交的 `dist/` 产物。

最近从 `04dfa4e` 到 `363d2c6` 的所有 GitHub Actions 均已完成且成功；最近一次为 run `34933393146`（`363d2c6`）。本地也已重新执行：

```sh
node --test archive-proxy/worker.test.mjs  # 6/6 通过
npm run build                             # 通过
```

注意：`npm run build` 只重建网页壳；完整引擎重建还需要 Emscripten。CI 的 `build` job 会运行 `./build-wasm.sh`、`npm run type`、`npm run build`。

## 2. 我（Codex）记忆中已完成的内容

### 鬼畜王公开加载链路

此前为鬼畜王配置了 Cloudflare Worker 代理并完成发布：

```text
https://ranceking-archive-proxy.ljc787865.workers.dev
```

`dist/games/ranceking/manifest.json` 指向该地址。Worker 源码在 `archive-proxy/worker.js`：

- 支持 CD 镜像按 Range 读取；
- 支持四个 ALD 完整下载，及最大 4 MiB 的单段 Range；
- 严格检查上游的 Range 回应、设置 Pages 所需 CORS；
- `archive-proxy/worker.test.mjs` 覆盖 6 个边界场景。

曾发现 Workbox 可能把不同 Range 的 `206` 响应混用；`dist/service-worker.js` 已对 Worker 域名采用 `NetworkOnly`，完整游戏文件改由启动器自己的版本化 Cache Storage 管理。不要删掉这条例外规则。

### 缓存与移动加载

我先实施过“最多两并发 + Cache Storage + 可续传 Range”的版本；后续 DeepSeek 已基于实测调整了策略，当前代码**不是**旧交接中“1 MiB 分段为主”的版本：

- 当前 `dist/autostart.js` 的主路径是 **整包下载、最多 4 次重试**；失败才回退至 **4 MiB 分段**，每段最多 5 次重试。
- 这是 `dcbeb4f` 的刻意改动：当上游不可靠处理 Range 时，许多小请求会更容易全盘失败。不要把它误改回“固定 1 MiB 分段优先”。
- `87dba7b` 将版本化的 `game-data-v1` 缓存扩展至四作，并在复用前用 manifest SHA-256 验证。当前 manifest 没有 `size` 字段，所以有效的完整性依据是 SHA-256，而非旧文档声称的“尺寸和 hash 都验证”。
- 启动时会尝试 `navigator.storage.persist()`；浏览器拒绝或空间不足时，应退化为本次照常运行、下次重新下载。
- BGM、EXE、DLL 不预载；BGM 列表仍保留给播放器按需获取，避免首屏额外下载几十 MB 音频。

旧文件 `HANDOFF-DEEPSEEK-鬼畜王移动端加载优化.md` 仍有价值，但其“1 MiB 主下载块”和当时的测速描述已被后续提交取代；继续工作应以当前 `dist/autostart.js` 和本文件为准。

## 3. DeepSeek 在当前 `main` 新完成的工作

### 3.1 四作缓存完整性（`87dba7b`）

- 四个已发布游戏都通过 `downloadGameFiles()` 下载并缓存。
- 缓存命中会先验证 SHA-256；校验失败删除缓存、重新下载，避免部分文件进入引擎。
- `SourceHanSansCN-Normal.otf`（GBK 中文字体）也走缓存入口。

### 3.2 兰斯 4 文字乱码：修复尝试已回退（`84c6e51` → `8f013e6`）

- 已定位中文脚本存在双重编码现象，表现如 `涓嶈�佸姞杞�`，而引擎按 GBK 显示。
- 写出了可重复运行的 `tools/diag/repair_rance4_text.py`，它重建 ALD 条目偏移并有 identity rebuild 校验。
- 但修复后的完整 `RANCE4SA.ALD` 让浏览器引擎卡住，故 `8f013e6` 已将线上 `dist/games/rance4/RANCE4SA.ALD` 回退到原始文件。

**当前线上事实：兰斯 4 仍使用原始 `RANCE4SA.ALD`（SHA-256 `cc1db7de...`），文字乱码尚未修好。不要声称文字修复已经上线。**

### 3.3 兰斯 4 引擎/数据诊断基础设施（`363d2c6`）

新增：

- `tools/diag/enginetest.mjs`：把指定 `SA.ALD` 换入本地镜像，约 50 秒判断能否达到 `640×480`，或页面是否无响应。
- `tools/diag/localenv.mjs`：带 MIME、网络命中和完整 console 输出的本地环境。
- `tools/diag/repair_rance4_text.py`：已依据引擎真实文本运行规则更新，不再错误地把 `0x00` 当成唯一终止符。

已记录的最小对比结果：对页面 0/22/32/42 的单页修复可达到 `640×480`；页面 44 单独修复（631 字节变动）就会挂起；修全部 64 页也会挂起。这是“文本修复尚未上线”的直接阻塞点。

`DEBUGGING.md`、`tools/diag/README.md`、`tools/diag/FINDINGS.md` 是重要证据库。遵循其中的规则：先钉死 PC/偏移单位，使用实际解释器执行记录；不要扫描原始字节就断言为指令或跳转。

### 3.4 第 69 页信息的边界

诊断材料记录了一个“将页 69 条目 size 从 4489 改为 4733”的测试修复，并有静态检查/测试副本证据。然而当前发布 `RANCE4SA.ALD` 是 `8f013e6` 回退后的原始文件，且该页修复不应被默认当成已写入线上资源。

因此请把“页 69 修复”视为**诊断结论与测试资产**，直到明确确认修补后的 ALD 被正确写入、通过本地和公开站回归、并以独立提交发布为止。

## 4. 当前工作树：绝不能误当线上成果

核查时工作树不干净，以下内容尚未提交、未推送、也不会部署：

```text
M  dist/autostart.js
?? .DS_Store
?? archive-proxy/wrangler.toml
?? dist/games/rktest/
?? tools/diag/testdata/RANCE4SA-repaired.ALD
?? tools/diag/testdata/rance4-mojibake-scene.png
?? tools/diag/testdata/rance4-scene-t61.png
?? tools/diag/testdata/ranceking-loaded-after-fix.png
```

其中最关键的是实验性 `rktest`：

- 未提交的 `dist/autostart.js` 只新增 `rktest` 名称；首页没有对应按钮；
- `dist/games/rktest/manifest.json` 仅含 4 个 ALD，缺少 `imageUrl`、`cueUrl` 与实际 ALD 文件；
- 因而它**不是可用的第五作或可发布本地测试入口**，不要提交/部署，除非先补齐资源策略并做回归。

`archive-proxy/wrangler.toml` 为本机 Wrangler 配置，不含密钥；可继续保留本地使用，但不要把 Cloudflare 登录 token、账号敏感配置写入仓库。

## 5. 已发现的产品/代码不一致

这两项不是推测，来自当前 `dist/` 直接阅读：

1. `dist/index.html` 的文案仍说“鬼畜王兰斯不提供在线资源，请从本机选择文件”，但 `?game=ranceking` 的特殊路径实际会请求 Worker 公开资源并启动游戏。文案与真实行为冲突，应在 UI 整理时修正。
2. `games.ranceking.resourceStrategy` 仍标为 `local-import`，但 `startSelectedGame()` 对它做了 `startRanceKing()` 特判，后者使用公开 manifest。功能可运行，但语义绕；未来重构须先写测试，避免删掉特判后悄悄退回本地导入。

攻略和修改器入口仍是占位内容（`dist/index.html` 的“攻略与工具”）；现有 `tools-registry.js` 与 `tools/diag/verify-cheats.mjs` 有桥接/验证基础，但不要说已实现实时攻略或成品修改器。

## 6. 推荐下一步（按风险从低到高）

1. **先提交或丢弃 `rktest` 实验文件的明确决定**；在决定前不要让它污染后续验证。
2. 在 Android 真机用公开 URL 测鬼畜王冷缓存、热缓存、断网/恢复。记录首屏、下载失败提示和重复进入是否命中 `game-data-v1`。
3. 修正鬼畜王“仅本地导入”的过时 UI 文案，并为公开资源失败保留明确的重试/本地导入备用路径。
4. 若继续兰斯 4 文字修复：从**第 44 页的最小失败样本**开始，每次只做一处可预测变更，先跑 `enginetest.mjs`，再考虑合并到完整 ALD；不能直接把 `RANCE4SA-repaired.ALD` 覆盖线上文件。
5. 对任何 ALD/引擎变更，依次跑：静态检查 → 本地 harness → 可推进流程 → 公共 Pages `livecheck.mjs`。记录所测 wasm 的 hash。

## 7. 常用命令

```sh
cd /Users/cris/Documents/ChatGPT/兰斯4网页化/app

# 当前基础验证
node --test archive-proxy/worker.test.mjs
npm run build
gh run list --limit 10

# 兰斯 4 文本/数据诊断（游戏数据在仓库相邻的 ../games，或用 GAMES_DIR 指定）
python3 tools/diag/check_scenario.py
node tools/diag/enginetest.mjs /绝对路径/候选-SA.ALD
node tools/diag/localenv.mjs

# 公开站实测（不要把本地镜像结论当成线上结论）
node tools/diag/livecheck.mjs 'https://maho37523.github.io/rance4-web/?game=ranceking'
```

## 8. 交接纪律

- 不要覆盖当前未提交文件；先确认它们属于谁、是否为可复现资产。
- 不要根据旧截图或旧报告声称线上已修复；以 `main`、公开页面和本轮实际日志为准。
- 不要用删除 Range、缓存验证或引擎安全检查来“消除报错”；那会把数据损坏延后为不可定位的黑屏。
- 资源文件很大，避免把 `dist/` 或游戏数据做全量无意义重写；提交应最小、可审查、带验证结果。
