# NOTES-cheats.md — 攻略与修改器：事实清单（M0）

每条事实都标注来源：`源码路径:行`、数据文件字节、或一次实测。推测一律标「推测」。

范围：**兰斯 4 / 4.1 / 4.2**。**鬼畜王兰斯（RANCE KING）不在范围内，行为不得改变。**

## 1. 引擎归属

| 游戏 | 引擎 | 依据 |
| --- | --- | --- |
| 兰斯 4 | xsystem35 | `games/RANCE4/System39.ain` 存在；`shell/loadersource.ts` 的 `detectEngine` 走 `loadXsystem35()` |
| 兰斯 4.1 | system3 | `games/RANCE4.1/system3.exe` 存在；走 `loadModule('system3')` |
| 兰斯 4.2 | system3 | `games/RANCE4.2/system3.exe` 存在；同上 |
| 鬼畜王兰斯 | xsystem35（本地导入） | `dist/autostart.js` 中 `ranceking.resourceStrategy === 'local-import'` |

两套 C 代码、两套 CMake 导出配置，因此所有引擎侧改动都做了两遍。

引擎**版本**（不是"哪套代码"，而是 Alice Soft 的引擎代次）：

| 游戏 | Alice Soft 引擎代次 | 依据 |
| --- | --- | --- |
| 兰斯 4 | System 3.5 系 | `games/RANCE4/System39.ain` 存在，xsystem35 走 System3.9 兼容路径 |
| 兰斯 4.1 | **初代 System 3** | `system3-sdl2/src/sys/game_id.cpp:153` → `{GameId::RANCE41, "rance41", 3, ...}`，`sys_ver = 3` |
| 兰斯 4.2 | **初代 System 3** | `system3-sdl2/src/sys/game_id.cpp:155` → `{GameId::RANCE42, "rance42", 3, ...}`，`sys_ver = 3` |

> 更正一条外部说法。`ai/guide-research/rance42.md` 与部分 wiki 把 4.1/4.2 记为「System3.9」，
> 但引擎自己的 `game_id.cpp` 分类表把它们标成 `sys_ver = 3`（`NACT::create` 里 `case 3` → `NACT_Sys3`），
> 而且 System3 与 System3.5+ 互不兼容。所以本项目的 UI 与文档一律写 **System 3**。
> （`system3-sdl2` 是**引擎实现**的名字，它同时支持 System 1/2/3；别把它和引擎代次混为一谈。）

## 2. 变量存储（这是修改器能成立的根本原因）

### xsystem35（兰斯 4）

| 存储 | 类型 | 规模 | 来源 |
| --- | --- | --- | --- |
| `sysVar[]` | `uint16` (`vmvar_t`) | `SYSVAR_MAX = 65537` | `xsystem35-sdl2/src/variable.c:33,46` |
| `varPage[]` | `struct VarPage` | `PAGE_MAX = 256` | `xsystem35-sdl2/src/variable.c:37,50` |
| `longVar[]` | `double` | `SYSVARLONG_MAX = 128` | `xsystem35-sdl2/src/variable.c:36,52` |
| 字符串变量 | `char*` | `STRVAR_MAX = 5000` | `xsystem35-sdl2/src/variable.c:34`，经 `svar_get/svar_set` 访问 |

`vmvar_t` 定义：`xsystem35-sdl2/src/portab.h:31` → `typedef uint16_t vmvar_t;`

### system3（兰斯 4.1 / 4.2）

| 存储 | 类型 | 规模 | 来源 |
| --- | --- | --- | --- |
| `NACT::var[]` | `uint16` | `MAX_VAR = 768` | `system3-sdl2/src/sys/nact.h:29,94` |
| `NACT::tvar[]` | `std::string` | `MAX_STRVAR = 10` | `system3-sdl2/src/sys/nact.h:30,96` |
| `NACT::var_stack[][]` | `uint16` | 30 × 20 | `system3-sdl2/src/sys/nact.h:95`（函数局部栈，不是持久状态） |

`RND` 就是 `var[0]`：`system3-sdl2/src/sys/nact.h:25` → `#define RND var[ 0]`。
system3 没有数组页，也没有 64bit 变量。

## 3. 变量名

- **兰斯 4 有真名表。** `System39.ain` 的 `VARI` 段含 1001 个名字；解析器在
  `xsystem35-sdl2/src/s39ain.c:139-151`。实测（本次会话用 Python 复现 `s39ain.c`
  的解码流程）其中 382 个不是 `VAR####` 形式，例如
  `VAR0009_menuCurrentStringNumber`、`VAR0118_currentCharacter`、`VAR0233_menuFirstStringNumber`、
  `VAR0271_mapX`、`VAR0272_mapY`、`VAR0353_roomImage`、`VAR0354_roomNumber`、`VAR0363_selectedSkill`。
  这些是引擎/系统变量，**不是**金钱之类的剧情数据。
- **4.1 / 4.2 没有名字表。** 两个游戏目录里没有任何 `.ain` / `.symbols` / `.dbg`
  （`find games/RANCE4.1 games/RANCE4.2 -type f` 的扩展名统计：无 `.ain`）。
  system3 的调试符号只从 `DSYM` 文件读（`system3-sdl2/src/debugger/debug_info.cpp:125-175`），
  而随游戏发布的数据里没有这种文件。**推测**（未验证）：本地化版删掉了符号文件。

> 修正一条外部调研里的猜测。`ai/guide-research/cheats.md` 第 2.3 节根据「`VARI` 段来自
> System39.ain，而 System3.5 游戏不带这个档」推测「兰斯 4 很可能没有变量名表，4.1/4.2 可能有」。
> 实测结论**正好相反**：兰斯 4 的 `System39.ain` 存在且有 1001 个名字（见上），4.1/4.2 完全没有
> 名字表。以本节实测为准。这条也说明：拿不确证的推论去设计 UI 会做反方向。

结论：修改器不能只靠名字。UI 因此以「数值搜索」为主，名字只作为兰斯 4 的辅助列。

## 4. 引擎导出（改动前后）

改动前两个 `CMakeLists.txt` 只导出 `_main,_malloc`，`EMSCRIPTEN_KEEPALIVE` 的存量函数有
`save_screenshot`、`ags_*`、`ald_*`、`msgskip_*`（`grep -rn EMSCRIPTEN_KEEPALIVE`）。
xsystem35 另外已有 `nact_current_page()` / `nact_current_addr()`（`xsystem35-sdl2/src/nact.c:202-203`），
但 system3 当时**没有**页号导出。

本次新增（两边同名同签名，TS 侧因此可以用同一个适配器）：

| 函数 | xsystem35 | system3 |
| --- | --- | --- |
| `cheat_engine_id()` | 返回 1 | 返回 2 |
| `cheat_page()` / `cheat_addr()` | `nact_current_page/addr` | `sco.page()/cmd_addr()` |
| `cheat_var_count()` / `cheat_var_ptr()` | `sysVar` 基址 | `NACT::var` 基址（新增 `var_data()`，`nact.h:74`） |
| `cheat_get_var(i)` / `cheat_set_var(i,v)` | `sysVar[i]` | `get_var/set_var` |
| `cheat_var_name(i)` | `v_name(i)` → UTF-8 | `VAR<i>`（无名字表） |
| `cheat_strvar_count/get/set` | `svar_*` | `tvar[]`，经 `Encoding::toUtf8/fromUtf8` |
| `cheat_page_count/size/saveflag/ptr/get/set` | 完整实现 | 返回 0 / -1（无此概念） |
| `cheat_longvar_count/get/set` | `longVar[]` | 返回 0（无此概念） |

新增文件：`xsystem35-sdl2/src/cheat.c`（加入 `src/CMakeLists.txt` 的 `target_sources`，**不进** `src_lib`，
因为它要用 NACT 页号）。system3 侧直接加在既有的 `src/emscripten/nact_emscripten.cpp` 的 `extern "C"` 块里。

辅助改动（只为让上面的代码拿到只读信息，不改变任何行为）：
`variable.h/.c` 新增 `v_get_encoding()`、`v_sysvar_max()`、`v_page_max()`、`v_longvar_max()`。

## 5. 存档格式（本轮未用，但已查清，留给以后的 L2 路线）

`xsystem35-sdl2/src/savedata.h:41-45`：

```c
enum save_format { SAVEFMT_XSYS35, SAVEFMT_SYS36, SAVEFMT_SYS38 };
```

签名（档头 32 字节）、`version == 0x350200`、以及 `asd_baseHdr` 里的
`int varSys[256]`（每个变量页的**绝对档偏移**，0 = 该页未保存）等细节，
已由 `ai/guide-research/cheats.md` 第 3 节按 `savedata.c` 逐字段整理。
关键点：**页 0 = 系统变量且必定保存**，所以金钱一定落在页 0 内（下标仍未知）。

`save_loadAll/save_saveAll/save_loadPartial/save_savePartial` 对外可用，网页端 `/save` 由
`shell/savedata.ts` 用 IDBFS 管理，并已有 ZIP 导出/恢复。
**本轮没有走存档路线**：运行期读写变量的成本更低、可核对性更强，且不需要解析格式。

## 6. 尚未确定的事（不要当成已知）

- **金钱、等级、道具对应哪个变量编号：未确定。** 中/日/英文检索都**没有**任何公开的
  「金钱 = VAR_xxx」映射表（`ai/guide-research/cheats.md` 第 2.1 节）。现存的公开修改器
  （2DFan 的 CT 表、SpoilerAL + SSG、金山游侠类）全部是内存扫描型。而且猫缶Index 留言板
  明确记载新版/合集版的兰斯 4 已改成**动态地址**，老 SSG 失效——按固定地址写内存的思路不可靠。
  因此 `shell/cheat-presets.ts` 保持为空，修改器以「数值搜索」为主，而不是伪造一组固定地址。
- system3 的 `var[]` 与存档字段的对应关系未逐字段核对。
- xsystem35 的 `varPage` 中哪一页是角色数据：未确定，UI 目前把已分配的页原样列出。
- 兰斯 4 原版是否有内置调试模式：未找到公开资料（倾向没有）。

## 7. 怎么用修改器找到某个数值（这是可复现的方法，不是猜测）

1. 进游戏，打开修改器 →「数值搜索」。
2. 记下游戏里显示的数值（例如金钱），输入后点「首次扫描」。
3. 回游戏让这个数值变化（买东西、打一场）。
4. 回修改器，选「增加了 / 减少了 / 发生了变化」，点「再次扫描」。
5. 重复 3-4，直到候选只剩 1-2 个。
6. 在候选行里直接改数值，回到游戏确认画面上的数字变了。
7. 确认后再把它记进 `shell/cheat-presets.ts`，并在本文件第 6 节把它从未知移走。

## 8. 实测验证（M1 / M2 证据）

工具：`node tools/diag/verify-cheats.mjs --game rance4|rance41|rance42`
（自带 dist 静态服务器 + Brave/CDP，截图落在 `tools/diag/run/`）。

三作全部通过，检查项与结果：

| 检查 | 含义 | rance4 | rance41 | rance42 |
| --- | --- | --- | --- | --- |
| `engine_id_matches_expected_game` | 桥接选中的引擎和作品一致 | xsystem35 | system3 | system3 |
| `view_matches_scalar_getter` | 批量指针视图 == 逐项 getter | 201/201 | 256/256 | 256/256 |
| `table_is_not_all_zero` | 读到的是活数据不是空表 | 102/65537 | 13/768 | 10/768 |
| `write_read_round_trip` | 写入→读回→视图可见→还原 | 通过 | 通过 | 通过 |
| `page_matches_pre_existing_export` | 页号 == 原有 `_nact_current_page()` | 16 == 16 | 不适用 | 不适用 |
| `var_names_match_offline_ain_decode` | 变量名 == 离线解出的 AIN 名字 | 4/4 一致 | 不适用 | 不适用 |
| `var1to4_match_host_clock` | `VAR0001..0004` == 浏览器时钟的年月日时 | `[2026,9,13,23]` == 同值 | 不适用 | 不适用 |
| `strvar_round_trip` | 字符串变量写入→读回→还原 | `TRAINER-PROBE` | 同 | 同 |

`var1to4_match_host_clock` 是本次最有力的「读的是真内存」证据：兰斯 4 标题画面上
`VAR0001..VAR0004` 正好等于**浏览器自己的 `Date`** 的年、月、日、时（四个分量同时相等）。
这四个值不是我们写进去的，是引擎自己从系统时钟取的，属于与被测代码完全独立的参照物。
（顺带说明：`VAR0001..VAR0004` 在兰斯 4 里是引擎写入的时间变量，不是剧情数据。）

另外在运行中的游戏里做了端到端搜索：写入 `var[700] = 4242` → 打开「数值搜索」→
输入 4242 →「首次扫描」→ 候选恰好 1 个。这同时证明了三件事：搜索读的是**实时**内存、
候选定位准确、UI 的读写路径和引擎导出是同一份数据。

回归：《鬼畜王兰斯》用 `?game=rkt` 本地数据启动，仍进入序章文本画面，
工具栏**没有**新增的「攻略 / 修改器」按钮（`activeGame()` 返回 null 时整个模块不安装）。
`tools/diag/prepare-testdata.mjs --clean` 后 `git diff dist/autostart.js` 为空。

## 9. 二进制指纹

改动后重建（本地 emsdk 4.0.23）：

| 文件 | sha256 |
| --- | --- |
| `dist/xsystem35.wasm` | `1bba748edb58b4e816cb8a52ae111ae7a46d885d13e69e13fc7a146b61c15f68` |
| `dist/system3.wasm` | `5dd916cdfded09c1812fbc81473dfcaf7aaa9c9af7e5f539984773ca28e18af2` |
| `dist/jspi/xsystem35.wasm` | `6fd94565f79ab97789286d5f71334388662d1e812eddb5f61bd467bb538d4749` |
| `dist/jspi/system3.wasm` | `b940f6a58b0ee37938592d1446691c117ebf86e052ae0645a43a579629edebe4` |

CI 用的是 emsdk 6.0.8（`.github/workflows/build.yml`），本地是 4.0.23，所以**不能**拿本地 hash 去对 CI 产物。

## 10. 本地 `npm run type` 的两个既有报错（与本次改动无关）

本机 emsdk 4.0.23 生成的 `shell/*.d.ts` 里 `FS` 没有 `link`，而 `@irori/idbfs` 6.0.8 的
`FS` 类型要求它，于是 `savedata.ts:17` 与 `shell.ts:178` 各报一个 TS2322/TS2345。
把本次改动 `git stash` 后重跑 `tsc`，这两个报错**依旧存在**，所以它们是本地工具链版本错配，
不是本次引入的。CI 用 emsdk 6.0.8，不受影响。本次新增/修改的 TS 文件报错数为 0
（`npx tsc 2>&1 | grep -c "error TS"` == 2，且两个都在上述既有文件里）。
