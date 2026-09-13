# 第 9 轮实测结论（PC 口径钉死 + 第 7 页文本运行越界修复 + 第 69 页遗留缺陷）

## 0. 交付状态

| 项 | 值 |
| --- | --- |
| 基线 | `c61afdb0b15ffe9c3a483edaa4947aa82608e0fd` |
| 源码改动 | `xsystem35-sdl2/src/{cmd_check.c,scenario.c,scenario.h}`，共 +98 行 |
| `dist/xsystem35.wasm` | 已重建，sha256 `9539d55733ca9f9c14c7ef31d55469463581716e4711fea861886c359cca2ac2` |
| 第 69 页 | **已修复**：ALD 条目 size 4489→4733（纯数据）；实测越界 213→0，流程通过 |
| 引擎修复提交 | `e6d0c93`（cmd_check.c / scenario.c / scenario.h + dist/xsystem35.wasm） |
| `dist/xsystem35.js` | 与 HEAD 逐字节相同（导出表未变），无需提交 |
| 插桩 | 已全部移除（`nact_diag.*` 与所有调用点）；产物验证过无 `DIAG`/`NEARCALL` 字样 |
| 证据与工具 | `.diag-archive/round9/`（含测试台、分析器、截图、日志） |

---

## 1. 钉死 PC 口径（第 8 轮遗留的第一件事）——结论：偏移 0

用生产 `婼抺墹SA.ALD`（sha256 `f425fb4f…`）按 `dri.c` 的算法定位第 7 页：

```text
entryOff = 72704  ptr = 32  size = 1058  sl_sco 起始文件偏移 = 72736
```

对照引擎 `P7MSG`/轨迹上报的字节窗口：

| pc | 引擎上报 6 字节 | `file[72736+pc]` | 判定 |
| --- | --- | --- | --- |
| 350 | `a4a2a4a4a4a6` | `a4a2a4a4a4a6` | 一致 |
| 380 | `52a4bfa4c1a4` | `52a4bfa4c1a4` | 一致 |
| 481 | `59417f407fa5` | `59417f407fa5` | 一致 |
| 617 | `59417f407fb0` | `59417f407fb0` | 一致 |
| 650 | `52b5c1d95ccd` | `52b5c1d95ccd` | 一致 |
| 654 | `5ccdf5989484` | `5ccdf5989484` | 一致 |

**`sl_sco[i] == file[entryOff + ptr + i]`，没有任何 ±8 偏差。**
第 8 轮怀疑的 +8 来自把 ALD 条目头（`ptr`=32）与页头混算。

复现：`python3 .diag-archive/round9/pc_verify.py`

### 由此推翻的两条旧结论

1. **「例程 345 缺返回」不成立。**
   第 7 页每张字符表末尾的 `5c 00 00 00 00`（近返回）**都被执行到了**：
   轨迹显示 `pc=345 → … → pc=481 NEARRET>72`、`pc=481 → … → pc=617 NEARRET>90`、
   `pc=617 → … → pc=1057` 等，逐段正确。
   例程 345/481/617/794/1001 后面直接跟字符表数据，这是**该页的原始排版**，
   不是翻译损坏：第 7 页在生产版、v4 补丁版、fondly160314、fondly160604
   四个版本里**逐字节完全相同**（含 `dword@4 = 32`、`dword@8 = 1140`）。
2. **第 8 轮观察到的 `STOP c0=52` 是正确终止**，`0x52` 是消息终止/换行字节，
   `654` 处的 `0x5c` 是 GBK 字符 `d9 5c` 的尾字节，不是返回指令。

---

## 2. 真正的根因：第 7 页最后一串文本到达页尾且没有终止字节

第 7 页最后一张表（item 6）从 1035 开始：

```text
1032: 87 ed 52 95 f8 f0 5e be de b4 f3 89 f4 c3 df d1
1048: d0 be bf c4 a7 b7 a8 cb f9 b7        <- 1057 是页的最后一个字节
```

主循环 `pc=0x0fcd(4045)` 调用 `Y` 跳到第 7 页 617，`message()` 从 622 开始读：

```text
622: b0 b3 98 94 b5 ee ba c3 a4 df a4 ce c5 ae a4 ce d7 d3
638: 8e a2 ... 52
651: 95 f8 f0 5e ... b7        ← 一直读到 1057，无终止字节
```

到 1057 时 `sl_getc()` 读到页外，越界把 wasm 模块打崩。
修复前实测：`pc=1057 op=0xb7 SEQ>1057` 无限自身循环，`r=3 w=0 oob=1`。

**修复（`cmd_check.c` `message()`）**：文本运行走到页尾时，
若当前在近调用内，调用 `sl_retNear()` 回到调用者，而不是让读头滑出页面。
`sl_retNear()` 自己会回退读头，因此该分支不再执行 `sl_ungetc()`。

---

## 3. 三处配套加固（保留）

| 位置 | 内容 |
| --- | --- |
| `scenario.h` `sl_getc()` | 页尾越界时返回 0 且不推进读头；新增 `extern int sl_sco_size` |
| `scenario.c` `sl_getString()` | 512 字节缓冲边界检查 |
| `scenario.c` `sl_jmpFar()` | 页头入口索引必须在页内，否则回落到 `SL_BODY_OFFSET`(32) |
| `scenario.c` `sl_jmpNear()` | 近跳转目标越界时忽略该跳转（防止 `memory access out of bounds`） |

`sl_sco_size` 在 `sl_jmpFar` / `sl_jmpFar2` 里由 `dfile->size` 赋值。

---

## 4. 修复后实测（已通过）

测试台：`.diag-archive/round9/harness.mjs`（本地 4173 起站 + 4190 收集信标 +
Brave headless + CDP 注入鼠标/键盘）。生产 ALD 经 `dist/games/ranceking-test/`
符号链接本地加载，不依赖 Worker。

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 中文字幕正常渲染 | 通过 | 序章中文逐字正确（临时目录已清理，可用第 6 节命令复现） |
| 标题画面完整渲染 | 通过 | `.diag-archive/round9/ranceking-title-screen.png`（Load/Start/logo 全在） |
| 进入输入等待 | 通过 | `w` 由 0 升至 1183+ |
| 渲染持续增长 | 通过 | `r` 由 3 升至 39 |
| 无越界 | 通过 | 第 7 页路径 `oob=0` |
| 鼠标点击生效 | 通过 | 点 Start 后 `p=11 → p=196 → p=10 → p=69` |
| 画面比例 | 通过 | canvas 640×400，letterbox 正常 |
| 兰斯4 回归 | 通过 | `.diag-archive/round9/run/reg-rance4-04.png`（剧情+中文对话） |
| 兰斯4.1 回归 | 通过 | `.diag-archive/round9/run/reg-rance41-04.png`（标题菜单） |
| 兰斯4.2 回归 | 通过 | `.diag-archive/round9/run/reg-rance42-04.png`（标题菜单） |

---

## 5. 第 69 页缺陷：已定位、已修复（纯数据修复，静态验证通过）

### 5.1 日文原版已取回

官方免费配布归档 `KICHIKU_WIN.RAR`（479050169 字节，见 5b）已下载并解包，
从 `KICHIKUOU.img`（raw 2352 字节/扇区 MODE1）中取出日文原版 ALD：

```text
JA_SA.ALD  3274000  sha256 2fda9060fa41095086025009357c0df0c47674a5af8557acdc5ccfc88a059328
JA_GA.ALD 29054224  sha256 5ae182d7a79be5818d0df3cecf269e68a1d951fdc1c195c8f8240aa2f394eeb7
JA_GB.ALD 19082256  sha256 5e829bee326c679995108db8fe1be5d517062e47a93b30d02772fc28bd4d3adb
JA_WA.ALD  2150928  sha256 159612c81aa858fcd54a20215e6771bc55901b7c298a4302b4fd65398b810ce1
```

**`JA_WA.ALD` 与生产清单里的 `WA.ALD` 哈希完全相同** —— 汉化只改了 SA/GA/GB。

### 5.2 现象：244 个近调用全部偏移 +244

日文与中文第 69 页**页体长度完全一样**（都是 4489 字节），但：

| | 页体长度 | 页头 `dword@8` | 页内可达的近调用目标 |
| --- | --- | --- | --- |
| 日文原版 | 4489 | 4489 | **244 / 244** |
| 中文生产版 | 4489 | 4733 | **31 / 244**（213 个越界） |

把两版的近调用操作数按出现顺序配对，规律完全一致：

```text
全部 244 个 0x5c 操作数：  中文目标 = 日文目标 + 244
而调用点自身只位移 +0..+18（中文文本更长）
```

`244` 恰好是中文页头 `dword@8`(4733) − 日文页头 `dword@8`(4489)。

### 5.3 根因：页尾 244 字节被 orphan，长度字段少写 244

那 244 字节**没有丢失**，就在页体之后、下一页入口之前：

```text
page 69 body : [634656, 639145)  4489 字节
gap          : [639145, 639488)   343 字节      ← page 70 的 entryOff = 639488
gap[0:244]   : 7f 25 48 7f 5c 00 00 00 00 21 c2 09 01 37 7f 25 48 7f 5c …
               正是日文版那张 22 行 `LET v0x09xx / %48` 表里后 17 行的续接
```

所以事实是：**这一页正确的长度就是 4733 字节**，汉化把页头 `dword@8` 写对了(4733)，
却忘了把 ALD 条目的 `size` 字段从 4489 改成 4733，于是页尾 244 字节成了 orphan，
而操作数已经按 4733 的地址空间做了 +244。

（第 8/10 轮"页尾被截断"的说法不准确：字节一直在文件里，只是长度字段不对。）

### 5.4 修复：只改 ALD 条目的 size 字段

`.diag-archive/round9/patch_page69.py` 只改一个 32 位字段：

| 位置 | 原值 | 改为 |
| --- | --- | --- |
| ALD 条目 `size`（entryOff+4） | 4489 | **4733** |

内置前提校验：`body_start + 4733 <= 下一页 entryOff` → `639389 <= 639488` ✓
（页头 `dword@8` 本来就是 4733，无需改动。）

**静态验证结果**：

```text
修复前：page69 size=4489  越界近调用 213 / 244
修复后：page69 size=4733  越界近调用   0 / 244
```

产物：`.diag-archive/round9/testdata/SA-page69-repaired.ALD`
= 3912464 字节（与原件等长），sha256 `8a2e6446e478a1c379e0ffcccdf66ca77c8f1541f0e6b0eddb21a2a80a048262`
原件备份：`.diag-archive/round9/testdata/SA-original.ALD`（sha256 `f425fb4f…`，**未改动**）。

**这是纯数据修复，引擎无需改动。** 生产 `婼抺墹SA.ALD` 尚未被修改，
是否应用由用户决定（见第 8 节）。

### 5.5 浏览器实测（已通过）

补丁**已应用**到生产 `婼抺墹SA.ALD`（原件备份为 `婼抺墹SA.ALD.orig-backup`，
sha256 `f425fb4f…` 未变；修补后 sha256 `8a2e6446…`）。用带 `PAGE`/`BADJMP`
探针的构建跑完整流程：

```text
进入过的页: 0 1 3 4 5 6 7 8 9 10 11 33 35 69 196
BADJMP 计数: 0          ← 第 69 页的 213 个越界近调用全部消失
第 69 页进入次数: 1，随后继续推进
```

画面证据：`.diag-archive/round9/ranceking-past-page69.png`
（立绘 + 对话框 + 中文台词「兰斯打了希露的头。」，画面比例正常）。

对比修复前：同一流程在第 69 页触发 20+ 次 `BADJMP` 后停住。

**结论：第 69 页缺陷已修复，且修复是纯数据的（引擎无需为该页做任何特判）。**

## 5b. 日文原版的获取路径（已完成）

要补回第 69 页缺失的 244 字节，需要**未汉化的日文原版 `婼抺墹SA.ALD`**。
本机不含该文件（`find` 全盘只找到生产版、三个汉化补丁版、兰斯4 系列）。
已核实的合法来源（AliceSoft「配布フリー宣言」对象作品）：

| 来源 | 说明 |
| --- | --- |
| `http://retropc.net/alice/30.html` → `files/KICHIKU_WIN.RAR` | 官方免费配布归档。需带 `Referer: http://retropc.net/alice/30.html`，否则 302 回首页。**已实测可达**：HTTP 200，`Content-Length: 479050169`，`Last-Modified: 2008-05-30`，支持 Range。 |
| 该项目自带说明 `说明文件/ISO magnet link.txt` | 同一份数据的磁力链接（btih `B18D639813042FFFA3D3AD11AB79851A5261CD89`）。 |
| `https://archive.org/details/kichikuou_rance` | Internet Archive 镜像，同一 `KICHIKU_WIN.RAR`（479050169 字节，与官方站一致）。 |

归档内部结构（用 Range 读取 4 MB 头解析）：`KICHIKUOU.cue` + `KICHIKUOU.img`（.img 内才有 ALD）。
因此取数流程是：下载 `KICHIKU_WIN.RAR` → 解出 `.img` → 从 ISO 镜像中提取日文 `SA.ALD` →
只取第 69 页正文 4733 字节 → 与生产页逐字节对齐后补回尾部 244 字节。

`SA.ALD` 在该 .img 内、且归档为压缩 RAR，**必须先取得完整 479 MB 归档再解压**，无法只按偏移取单文件。
本机无 `unrar`/`7z` 命令行工具，但项目已依赖 `node_modules/7z-wasm`（含 `7zz.wasm`），可用于解压。

**本轮已获用户授权并完成**：归档已下载（479050169 字节，HTTP 200）、7z-wasm 解出
`KICHIKUOU.img`（687324960 字节）、`iso_extract.mjs` 从 raw MODE1 镜像中取出四个
日文 ALD（见 5.1）。临时的大文件（RAR 479 MB、IMG 687 MB）已删除，只保留解出的 ALD
（合计 51 MB）在 `.diag-archive/round9/ja/`。

## 6. 复现方式

```sh
cd /Users/cris/Documents/ChatGPT/兰斯4网页化/app
# 1. 起本地站（测试台自带 4173/4190）
node .diag-archive/round9/harness.mjs --wait-ms 90000 --shot demo --auto-advance \
  --url "http://127.0.0.1:4173/index.html?game=rancekingtest&fast=1"
# 2. 静态核对
python3 .diag-archive/round9/pc_verify.py
python3 .diag-archive/round9/analyze_beacon.py <beacon.log> --markers
```

`dist/games/ranceking-test/` 是本地测试用符号链接目录（已删除），
重建方法见本轮记录；生产 `manifest.json` 未被修改。

---

## 7. 本轮用到的纪律修正

1. **信标日志是平方级增长**：每行都带完整 160 条历史。分析必须先取每行最后一条
   再去重，否则会把重复记录当成新事件（本轮曾因此误读 958 万条"page 7 记录"）。
2. **不要用 grep 计数判断循环**：`SEQ7` 出现在历史里，要按状态序列判断。
3. **引擎上报的 `index` 才是权威 PC**，不要用相邻地址差反推指令长度。
4. **合成鼠标事件可行**：CDP `Input.dispatchMouseEvent` 在 headless Brave 下
   能进到 emscripten canvas（已在 `probe_mouse.mjs` 中独立验证）。
