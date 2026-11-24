# 工具目录（41 个）

> 快照：**0.2.0**（开发中，未发布）。注册全部在 `index.js` 的 `apply()` 内（`ctx.tools.register(asTool({...}))`），
> 分四段：`mc_*`（游戏内，33）/ `mc_kit_*`（游戏外辅助，5）/ `mc_admin_*`（管理，1）/ `mc_debug_*`（调试，2）。
> 可见性按模式分档（2026-10-04）：**MC模式** 只见 mc/mckit + 文件工具 + `job_*`/`goal_*`/`todo_write` + 宿主 `web_search`（**不含** present：交付走 `mc_kit_express`）；**MC+模式** 全量可见（含 admin）；
> **其他模式** 隐藏 mc_* / mc_kit_*（仅保留 `mc_admin_*`），另有 guard 硬拒兜底。
> 🔴 **调试工具（`mc_debug_*`）另受「MC设置 → 调试」的 `exposeDebugTools` 开关门控**（2026-10-05）：关时在 MC/MC+ 也不暴露（白名单 / MC+ deny / guard 三处）。
> 🔴 **宿主 `web_search` 受「MC设置 → 联网搜索」的 `allowWebSearch` 门控（2026-10-08，默认开）**：MC 模式关时摘掉 + guard 硬拒；**MC+ 不受限**（其组成本来就有 tool-web）。
> 🔴 **`mc_kit_web_fetch` 受「MC设置 → 联网搜索 → 网页抓取」门控**（2026-10-08）：`webFetchEnabled`（默认关）+ 域名表（`webFetchDomains` / `allowAllFetchDomains`）+「允许的内容类型」三开关（`webFetchAllowHtml` / `webFetchAllowText` / `webFetchAllowImage`，默认都开）。**MC 与 MC+ 都过**（白名单 + guard；内容类型只能拿到响应后判，见工具一节）。
> 🆕 **2026-11-23：工作方块 + 外部 mineflayer 插件集成（新增 7 个工具，26 → 33 个 `mc_*`）** ——
> 「可以用工作台做东西」+「把 mineflayer-auto-eat / -tool 等插件的能力集成进来」。见 §四之二。

## 通用约定

- **必须经 `asTool()` 注册**：它做两件事 —— ① 对返回值做 `lossless()` 无损化（类实例只留自有可枚举属性、Vec3→`{x,y,z}`、Date→ISO、NaN/±Inf→null、`-0`→0；宿主校验要求纯 JSON，Vec3 实例曾让 5 个工具全挂）；② 把 `exec.signal` 注入 `bot.setAbortSignal`（宿主取消能中断走路/挖掘循环）。
- **超时纪律**：调 `src/core.mjs` 的方法已自带超时/中断；扩展自己写 mineflayer 调用时**必须**套 `withTimeout` / `raceAbort`（宿主无法硬杀同进程代码）。
- **错误形态**：工具失败直接抛错（`mcTimeout:true` / `mcAborted:true` 标记可辨）；HTTP 设置 API 相反——统一 200+`{ok:false,...}`。
- 工具名列表由 `ourToolNames` 收集（注册时自动登记）：MC 模式白名单用它 + `MC_FILE_TOOLS` + `MC_EXTRA_HOST_TOOLS`（宿主 `job_*` / `goal_*` / `todo_write`）+ `MC_WEB_SEARCH_TOOL`（宿主 `web_search`，按 `allowWebSearch` 开关）+ `present`；其中 `mc_kit_web_fetch` 与 `mc_debug_*` 按各自开关从白名单里摘（`hidden` 判定）。其他模式的 deny 名单也用它（`mc_kit_*` + 非 admin 的 `mc_*`）。

---

## 一、连接与会话（8）

| 工具 | 职责 | 关键点 |
| --- | --- | --- |
| `mc_status` | 连接态 | `connection`（host/port/**version**）+ online/lastError/reconnecting/ghost；在线时内联 `mc_context`。**不含**改版前的 modeView/最近聊天（2026-10-05 去掉，待重做） |
| `mc_lan` | 找**局域网房间** | **只听**原版多播公告（`224.0.2.60:4445`，`[MOTD]…[/MOTD][AD]端口[/AD]`）；`seconds` 夹 [1,15] 默认 3，**恒定按时返回**（不扫端口）；多播被挡 → 空结果，请对方直接报地址。**`mode` 参数已删**（它本来就没被读，2026-10-05） |
| `mc_ping` | **已知地址**的探路 | 发一次 STATUS ping（握手+状态请求），**不登录、不用账户、不进服**；参数只有 `address`（host[:port]，端口默认 25565）+ `timeoutMs`（默认 5s 上限 30s）；拿通不通/版本/协议号/MOTD/人数/延迟；错误说人话。**`subserver`/`port` 已删**（2026-10-05：地址自带端口；无子服概念） |
| `mc_connect` | 进服（唯一连接入口） | 参数只有 `address`（host[:port]）+ `account`（innerID）。**不再有 `host/port/subserver/version`**；地址内部 `parseAddress`，握手 serverHost 就用该地址（DNS+Velocity 自行路由）；**版本永远自动探测**；版本不受支持（mineflayer 无该版本协议数据）→ **建连期间快速失败 + 明确版本错误**（不是"连接超时"；另有 spawn 后 `isVersionSupported` 兜底，复用 `src/mcversion.mjs`）；连接后等区块、**自动挂看门狗**、`learnName`；**返回 = `mc_status` 的内容** |
| `mc_accounts` | 账户管理（会话内） | `list/search/refresh`（**`use` 已删**，2026-10-05）；`refresh` 走 `bot.authOnly`（只认证不连接），`innerID` 缺省用本会话选定/默认；返回值**永不含密码/token** |
| `mc_disconnect` | 主动退服 | 看门狗 `disarm(notify:true)`（提醒 AI 已不在游戏）+ 优雅 quit |
| `mc_stop` | 停本会话 | 等价强制停止但 `cancelTurn: false`（**防自我 abort**；HTTP 的 `/api/mc/stop` 用 `cancelTurn:true`） |
| `mc_capabilities` | 能力/限制自述 | 报 plugin 版本、mineflayer testedVersions、超时上限、指令白名单等 |

> `mc_sessions` / `mc_diag` 已改名并移入「调试」（见 §七）。

## 二、观察（8）

| 工具 | 职责 | 关键点 |
| --- | --- | --- |
| `mc_context` | 游戏上下文 | basic = 模式/维度/坐标/朝向；survival 段（血量/吸收/饱食/饱和/气泡/装备/经验 + buff + 坐骑/骑乘者）——生存/冒险默认给，`survival:true` 强制给。底层 `core.context()` |
| `mc_players` | 在线玩家 | tab 栏名 / 档案名 / uuid（含自己）。底层 `core.players()` |
| `mc_map` | 地表方块图 | `format: chars / image`（**`both` 已删**）；`image` 渲染真彩俯视图 → 手工 PNG（`encodePng`）；🔴 **2026-10-05 改版**：`out` → **`dist`**（结果文件路径；空=不写文件）+ **`reply`**（默认 true=结果回复到上下文；false=只写文件/stub）；无默认输出目录；相对路径以**工作区根**为基准；chars 存 `.txt`；附图前先查模型是否接受视觉（`ctx.llm.resolveModelInfo`），不接受则跳过附图并给警告 |
| `mc_height` | 高度（地势）图 | 每列一个地表 Y（startY 处无方块→向下找第一个方块；有方块→向上找第一个空格取 Y−1；startY 空=当前 Y）；按 `glyphStep` 抽样省算力；`ignoreLiquid:true` 把液体当空气（水面/岩浆下的地面才算地表）。`format: chars / image / full`（分层设色等高图 / 字符模拟 / **逐格高度值 CSV**——一格一个 Y、非 x/y/z 坐标）；`scale` 仅 image；chars→.txt、full→.csv；`reply`/`dist` 同 `mc_map`。**网格上北下南·左西右东**。底层 `core.heightGrid/heightImage/heightGlyphs` |
| `mc_scan` | 范围扫描 | 半径 ≤24、高 ≤16；25 类方块计数或按名搜索 |
| `mc_entities` | 附近实体 | 半径默认 24，返回前 40 |
| `mc_inventory` | 背包 | — |
| `mc_events` | 事件队列（拉） | `limit ≤100`、`waitSec ≤120`（阻塞等新事件，**只是兜底**）；被看门狗唤醒打断时返回 `interrupted:true` + `interruptReason` + "先别再 wait"提示；内部 `timeoutMs` 130s。⚠️ 被传送/捡物/上下线**不在这个队列**（只进看门狗留档） |

## 三、看门狗控制（2）

| 工具 | 职责 | 关键点 |
| --- | --- | --- |
| `mc_watch` | 唤醒通道的唯一控制面 | `action: status / arm / disarm / log`；`log` 返回 `{armed, stats, recent: 留档末 30 条}`。进服默认自动 arm |
| `mc_config` | 改看门狗参数 | `patch`（点号键如 `wakeOn.pushed`）/ `reset`；响应附 `WATCH_DEFAULTS`。**只能改本会话的看门狗**，全局配置在 `mc_admin_config` |

## 四、交互与动作（8）

| 工具 | 职责 | 关键点 |
| --- | --- | --- |
| `mc_say` | 公屏说话 | 换行折空格、截 220 字符 |
| `mc_move` | 走/飞/跳 | `jump` 无需坐标；创造模式缺省 fly；生存走路上限 ~90s；走路**一直按住 forward**、卡住自跳 |
| `mc_act` | 单动作 | 8 种子模式：`look/toward/place/break/use/attack/equip/toss`；`toward` = 看向+走近+再看 |
| `mc_dig` | 挖掘 | `name` 或 `pos`；`count ≤16`；距离 ≤6；非创造自动换 `harvestTools` 里最好的工具 |
| `mc_build` | 长方体搭建 | 尺寸夹 [1,256]；失败 5 个即停；创造缺方块自动取 |
| `mc_give` | 拿物品 | **协议级 `set_creative_slot`**（创造模式即可，**不需要 OP**）；`clearAll` = 清背包；自动找空槽（优先同物品/快捷栏） |
| `mc_sequence` | 连串动作 | **最多 64 步**；`stopOnError` 默认 true；`budgetMs ≤570s`、`timeoutMs 600s`；步类型 wait≤30s/move/look/toward/place/break/dig/use/attack/equip/give/toss/say/jump/**craft/smelt/collect/goto/fight/follow/eat**（2026-11-23 扩）。比让模型写脚本稳 |
| `mc_command` | 服务器指令 | **最后手段**：要 OP、受白名单（`commandWhitelist` 精确名/`/正则/`/`"*"`；`allowAllCommands` 全放行） |

## 四之二、工作方块与外部插件（7，2026-11-23 新增）

> 用户要求：「可以加上使用工作台进行物品合成，比如 mineflayer-auto-eat 和 mineflayer-tool 同时确保能用，
> 把 mineflayer 等插件的功能集成在里面」。这一组就是那件事的落地。
> 分工：**先看再算（`mc_recipes`）→ 动手（`mc_craft` / `mc_smelt`）→ 生态（`mc_plugins` / `mc_collect` / `mc_fight` / `mc_follow`）**。

| 工具 | 职责 | 关键点 |
| --- | --- | --- |
| `mc_recipes` | **只读**查配方 | 某个物品的**所有**已知配方：材料、数量、够不够、要不要工作台、摆法（`shape` 如 `"XXX / _X_ / _X_"`）。想知道"这东西怎么做/我还差什么"先看它，再决定 `mc_craft` 还是先去挖 |
| `mc_craft` | **合成**（含工作台） | 🔴 核心能力。① **材料不够自动补**（原木→木板→木棍，递归深≤4）；② **台子自动解决**：附近有→走过去用 / 背包有→自己放 / 连台子都没有→**先合一个**（4 木板，2×2）；③ 2×2 能做的（木板/木棍/台子/火把）**不乱放台子**；④ 补不了就回**缺口清单**（差什么/差几个）；⑤ 合成后**核对背包数量**，不报假成功。`plan:true` = 只算账 |
| `mc_smelt` | **熔炉冶炼** | 找炉（32 格）→ 走过去 → 自动挑燃料（煤/木炭/木板/原木…）→ 放料 → 等烧完 → **取出产物**。没炉子时**先报"没炉子"再报"没原料"**（顺序有讲究，见下） |
| `mc_plugins` | 插件现状与控制 | `status`（默认）：每个插件装了没/挂上了没/自动进食开没开；`attach`：手动重挂；`enable`/`disable`/`opts`/`eat`：**自动进食**控制（`opts` 可调 `minHunger`/`minHealth`/`priority`/`bannedFood`） |
| `mc_collect` | 走过去收方块 | 会**跑到**目标那里再挖（需要寻路）；装了 `mineflayer-collectblock` 就用它，没有就降级成"逐个走过去再挖"。与 `mc_dig` 分工：`mc_dig` 只挖**够得着**的 |
| `mc_fight` | 战斗 | 追着打（`mineflayer-pvp`），否则降级单次攻击；`attack`/`stop`/`status`；**血量 ≤4 自动停手** |
| `mc_follow` | 跟随 | 跟玩家/实体走（pathfinder `GoalFollow`），没装就朝对方走；`distance` 保持距离、`budgetMs` 跟多久 |

### 五个外部插件（全部**可选依赖**）

| 插件 | 装进哪 | 集成方式 | 没装时 |
| --- | --- | --- | --- |
| `mineflayer-pathfinder` | `src/plugins.mjs` → `pathfinder` | `gotoPoint` / `mc_collect` / `mc_follow` / `mc_craft` 走台子 | 降级内置 `walkTo`（`mode:'pathfinder→walk'`） |
| `mineflayer-tool` | 同上 → `tool` | `mc_dig` 用 `equipForBlock` 挑**最合适**的工具（含附魔/耐久） | 退回 `harvestTools` 里最好的那把 |
| `mineflayer-auto-eat` | 同上 → `autoeat` | `mc_plugins` 的 enable/disable/opts/eat；进服可选自动开 | 相关 action 报"插件没加载" |
| `mineflayer-collectblock` | 同上 → `collectblock` | `mc_collect` | 降级成 goto + breakBlock |
| `mineflayer-pvp` | 同上 → `pvp` | `mc_fight` | 降级成单次 `attack` |

> 🔴 **挂载时机**：`connect()` 里 spawn 之后（`attachExternalPlugins`，fire-and-forget 不阻塞进服）。
> 不放 `createBot({plugins})` 的三个理由：① auto-eat 是 **ESM**，`plugins:` 要求同步函数；② 要"装不上就跳过"的容错，
> `plugins:` 里抛错会直接炸建连；③ spawn 后挂，`inject_allowed` 早过了，`loadPlugin` 立即生效。
> 🔴 **绝不因为插件缺失而失败**：`attachPlugins` 逐项 try/catch，`report.failed` 只记日志。

### 真机踩过的坑（都是 2026-11-23 在 1.21.11 上撞出来的）

1. **`recipesAll(id, meta, table)` 第三个参数传 `null` 会把所有 3×3 配方过滤掉** —— 木镐直接报"没有已知配方"。
   传 `true` 才是"把需要工作台的也列出来"（`node_modules/mineflayer/lib/plugins/craft.js:217`）。
2. **木棍有 12 条配方**（oak/spruce/birch/cherry/…）。"取第一条"会挑中 `cherry_planks`，而背包全是 `oak_log`
   ⇒ 递归去补 cherry ⇒ 报"cherry_log 差 1"。必须**递归可达性打分**（`reachable()`），不能只看"有没有配方"。
3. **共享原料要轮转补**：木镐 = `3 木板 + 2 木棍`，而木棍耗木板 —— 挨个补完木板再补木棍，木板又被吃掉，
   最后报"oak_planks 差 1"（明明还有原木）。要**每补一项重算缺口**。
4. **台子"够得着"不等于"能用"**：走不到的台子传进 `bot.craft()` 会死等 `windowOpen` **20 秒**再抛错。
   必须校验距离（≤4.5 格），走不到就换下一个候选。
5. **放下的台子要等它真进世界**：`placeBlock` 返回 ok 只代表本地发了包，紧接着拿去 craft 会**静默没产出**
   （偶发 1/4）。放完轮询确认方块存在（≤3s）。
6. **熔炉必须用 `bot.openFurnace(block)`**：`activateBlock` + `windowOpen` 拿到的是**裸窗口**，
   调 `putFuel` 直接 `not a function`；`openBlock` 也不行（只有 `openFurnace` 会挂 furnace 方法）。
7. **等冶炼完成不能看背包产物**（产物在熔炉输出槽里）：要看 `window.outputItem()` 或输入消耗；
   而"数量不动"的判定阈值**必须大于一个冶炼周期（10s）**，否则刚放完料就以为卡住了。
8. **`gotoPoint` 的飞行会撞墙**：`flyTo` 走直线，撞上就原地卡住，返回 `arrived:false` 却不算失败
   （调用方拿到一次"没动"的移动）。要**量真实位移**，几乎没动就降级 pathfinder / 走路。
9. 🔴 **`mineflayer-tool@1.2.0` 的 `equipForBlock` 会无限递归吃爆内存（进程级事故！）**
   —— 详见下一节。

### 🔴 P0：`mineflayer-tool` 的 `equipForBlock` 无限递归（2026-11-23，OOM 杀进程）

**症状**：一调 `mc_collect` 进程就 **OOM 被杀**（不是工具报错，是**整个 DSH 消失**）。
512MB 堆 12 秒内打满，日志只有一行 `FATAL ERROR: Ineffective mark-compacts near heap limit`。

**根因**（`lib/Tool.js` 的 `equipForBlock`）：

```js
// 背包里没有能采掘该方块的物品，且 options.getFromChest 为真时：
yield retrieveTools(bot, { chestLocations: this.chestLocations /* 默认 [] */, ... })
yield this.equipForBlock(block, options)   // ← 原参数递归调自己！
```

而 `retrieveTools` 在 `chestLocations` 为**空**时，`while` 循环一次都不进，**什么都不做就 resolve**。
于是 ① 空转 → ② 递归 → ① 空转 → …，每圈新建一层 promise 链 ⇒ 堆一路涨到 OOM。

**触发条件**（三者同时）：
1. 装了 `mineflayer-tool`；
2. `equipForBlock(block, { getFromChest: true })` —— **`mineflayer-collectblock` 内部正是这么调的**
   （`lib/CollectBlock.js` 的 `equipToolOptions = {requireHarvest:true, getFromChest:true, maxTools:2}`）；
3. 背包里**没有**能采掘目标方块的物品（初生号挖草方块、没镐挖石头…极其常见）。

**A/B 对照证据**（真机实测）：
| 参数 | 结果 |
| --- | --- |
| `{requireHarvest:true, getFromChest:false}` | 立刻抛 `NoItem`，堆 72MB，**正常** |
| `{requireHarvest:true, getFromChest:true}` | **无限递归 → OOM** |

**修法**（`src/plugins.mjs` 的 `guardToolPlugin`）：给 `equipForBlock` 包一层守卫，
**没有可为空的箱子时强制 `getFromChest:false`**（上游那分支本来就空转，关掉只会从"递归到炸"变成"正常抛 NoItem"），
再加一层递归深度保险（≥2 直接抛 `ToolRecursionGuard`）。**不 patch `node_modules`**，
有箱子时的正常行为完全不变。守卫在 `attachPlugins()` 末尾自动装上，幂等（`__wcGuarded` 标记）。

> ⚠️ **教训**：引入第三方插件**必须**检查它的递归/循环边界。这类 bug 离线自检抓不到
> （要真服务端 + 真背包状态），而且后果是**进程级**的，不能靠 try/catch 兜。
> 回归断言：`tools/e2e-plugins.mjs` §10 —— `mc_collect` 必须 <15s 完成（事故时是 40s 超时 + OOM）。

> 验证脚本：`node tools/e2e-plugins.mjs`（连真服，26 条断言：插件挂载 / 2×2 / 自动补料 / 台子自动造放 /
> 3×3 合成 / 熔炉冶炼 / 自动进食 / 寻路 / 配方查询）。详见 [dev-workflow.md](dev-workflow.md)。

## 五、游戏外辅助（5，`mc_kit_*`）

| 工具 | 职责 | 关键点 |
| --- | --- | --- |
| `mc_kit_rules` | 规则策略**只读**查询 | 按 `type` 回当前生效的策略（读的是 `mc_admin_config` 同一份 config，用户改完立即反映）：`command` → `commandWhitelist` + `allowAllCommands`；`web_fetch` → `webFetchEnabled` + 域名表 + 内容类型三开关（含内置图片格式）。补 MC 模式"看不见管理工具却要知道放行了什么"的缺口；`mc_command` / `mc_kit_web_fetch` 的描述指向它 |
| `mc_kit_image` | 图像处理 | `info/embed/render/grid/save`：SVG→PNG 光栅化（`sharp`，可选依赖，缺失只影响 `render`）、引图进 SVG、拼网格（≤64 张，返回 SVG）、落盘。输入输出都限制在本会话工作区内（`insideWorkspace`） |
| `mc_kit_fs` | 文件系统操作 | `copy/move/delete/make_dir`（都递归）。末尾 `/*` 只选目录下**直接**子项；**保留符号链接（不跟随）**。`to` 以分隔符结尾=放进该目录（目标父目录自动创建）；`overwrite=false` 默认不覆盖；**预检失败零副作用、错误一律中文**。沙箱按模式：**MC** 限 `.minecraft-bot/`、**MC+** 放工作区；相对路径以工作区根为基准。受保护文件（RULES.md/AGENTS.md/config.json）与凭据路径**不可删改**（`src/fsops.mjs` 权威 + guard 第二道锁，大小写不敏感） |
| `mc_kit_express` | 把发布区文件换成"给用户的东西" | 路径解析先记忆根后 cwd；只认 `.express/`（目录即白名单）；**按宿主模式回不同 URL** —— web：`base + /api/minecraft-bot/express/<uuid>/…`；desktop：`http://localhost:<port>/<uuid>/…`（端口服务没起来回占用文案）；关闭恒回"文件分享已关闭…绝对路径…"；工作区 uuid 查不到即拒。宿主另有 `present`（显式文件交付组，MC 模式白名单里放行）——两者互补 |
| `mc_kit_web_fetch` | 抓网页（文本 + 图片） | 参数：`url` + 我们自己加的 `reply`/`dist`（语义照 `mc_map`：`reply=false` 只写文件回 stub）。🔴 **抓取全自研**：文本与图片都走 `src/webget.mjs`（唯一出网口：公网地址校验 + 地址钉死 + 只跟同源跳转 + 限 5MB / 10 万字符 / 20MB / 30s），**一次请求**、按真实 Content-Type 判型、**不经宿主 `ctx.web`**；输出形态照抄宿主（`Fetched <url> (HTTP <status>)` + 反注入声明 + 正文 + 截断尾注，上限 200000 字符；HTML 用 `src/webfetch.mjs` 的轻量转换，非 turndown）。**图片只支持内置四种** png/jpeg/gif/webp（= 宿主附件服务认的），其余一律算不支持；模型有视觉就直接附图，否则可落盘。**默认关**，受 `webFetchEnabled` + 域名表（`webFetchDomains` / `allowAllFetchDomains`）+「允许的内容类型」三开关（`webFetchAllowHtml` / `webFetchAllowText` / `webFetchAllowImage`，默认都开）门控；**MC 与 MC+ 两档都过** |

## 六、管理（1，`mc_admin_*`）

| 工具 | 职责 | 关键点 |
| --- | --- | --- |
| `mc_admin_config` | 全局配置读写 | `get/set/unset/reset/list` 点号键；改完**立即热生效**（消费方每次过 getter）。**MC 模式会话看不见、也调不动**（白名单隐藏 + guard 硬拒双保险）；普通模式与 **MC+模式** 可见可用（MC+ 系用户 2026-10-04 定）。只含全局键——提示词三开关已下放为**按工作区**（`<工作区>/.minecraft-bot/config.json`，在「MC设置→提示词」改），不在本工具里 |

## 七、调试（2，`mc_debug_*`）

| 工具 | 职责 | 关键点 |
| --- | --- | --- |
| `mc_debug_sessions` | 列全部会话实例 | （原 `mc_sessions`）每会话独立性的直观证据 |
| `mc_debug_diag` | 诊断快照 | （原 `mc_diag`）物理状态/控制位/收包统计/事件队列 + `promptInjection` |

> 两者受「MC设置 → 调试」的 `exposeDebugTools` 开关门控（默认关）+ **只在 MC/MC+ 模式**暴露；其他模式一律摘掉。

---

## 超时基线（`src/core.mjs` → `TIMEOUTS` / `DEFAULTS`）

| 项 | 默认 |
| --- | --- |
| 建连（等着 spawn） | 45s |
| 走路预算 | 40s（工具侧 ≤90s） |
| 等区块 | 20s |
| 飞行预算 | 20s（2500ms 无进展早停） |
| `mc_events` 等待 | `waitSec ≤120` + 1 个轮询周期，内部兜底 130s |
| `mc_sequence` 总预算 | 300s（DEFAULTS）/ 工具上限 570s |
| 聊天历史 | 300 条 |

## 历史变更（防混淆）

- **`mc_kit_memory` 已删除**（2026-10-07）：长期记忆改由**宿主受限文件工具**（`read/write/edit/glob/grep/read_image`，MC 模式 guard 已限在 `.minecraft-bot/` 内）直接读写。**同日又去掉 README 索引的自动注入**（`memoryIndexText` 已删）：`README.md` 作为目录约定仍在，由 agent 按 RULES.md 自行阅读/维护，插件不再往上下文里注入它；`MemoryStore`（`src/memory.mjs`）保留为库。自检里有"mc_kit_memory 已移除 / 记忆索引不再自动注入"的断言——老名字不要再出现。已知缺口（等宿主补）：宿主暂无删文件工具、也无二进制 `put`。
- **`mc_kit_share`（及 `mc_map` 的 `share` 参数）已删除**（2026-09-16）：它只是在调宿主**另装**的 `dsh-file-host`，插件本身没有文件服务器。"让用户看到文件"改走：宿主 `present`（显式文件交付）+ 本插件的 `mc_kit_express`。自检里有"mc_kit_share 已移除 / 源码无文件服务器残留"的断言——老名字不要再出现。
- 文件分享 2026-10-04 起是**开关**（`expressEnabled`），不再有"模式"；老配置里的 `expressMode`（含 `local`）由 `PluginConfig.migrate` 搬成布尔（`online`→`true`，其余→`false`）。
- **2026-10-07 文件分享按宿主模式拆键**：`expressEnabled`/`expressBase` → **web 那套** `expressWebEnabled`/`expressWebBase`；新增 **desktop 那套** `expressDesktopEnabled`/`expressDesktopPort`（默认 16049，独立端口只监听 localhost）。从哪种模式（宿主 profile）进来只认哪套；`expressMode` 与两个旧键都由 `migrate` 逐档搬（见 architecture §10）。
- **2026-10-08 网页抓取 `mc_kit_web_fetch`（新工具）**：宿主 `web_fetch` 在 MC 模式被我们关掉（preset 的 tool-web 只挂 search），这个补位。初版是「文本走宿主 `ctx.web` seam、图片走自己的下载器」；**当天用户定「全改成自己的可控逻辑，宿主的强关联就不要了」** ⇒ 文本与图片统一到 `src/webget.mjs`（唯一出网口；防 SSRF 规则照宿主但**更严**：tunnelling / 转换前缀按内嵌 IPv4 复核；不依赖 ipaddr.js）。收益：**一次请求**（按真实 Content-Type 判型，不用先试一次宿主）、不依赖宿主 `web` 服务、类型判定精确；代价：charset / 解压 / 分类 / 上限自己扛，且**没有代理支持**。HTML→markdown 仍用 `src/webfetch.mjs` 的轻量转换（**不引 turndown**：实测宿主对非 link 插件的 CJS 依赖树有解析 bug）。内置图片格式**不可配置**（用户：「只有内置的格式和未知的格式」）。参数另加 `reply` / `dist`（语义照 `mc_map`）。
- **2026-10-05 工具面改动**：① `mc_connect`/`mc_ping` 收成单一 `address`（删 `host/port/subserver/version`；版本永远自动探测，连上后版本不支持则强制断开）② `mc_accounts` 删 `use` ③ `mc_lan` 删 `mode` ④ 新增 `mc_context`/`mc_players` ⑤ `mc_sessions`/`mc_diag` → `mc_debug_sessions`/`mc_debug_diag`（受 `exposeDebugTools` 门控）⑥ `mc_status` 改为"连接态 + 在线内联 context" ⑦ `mc_map` 改版：`out`→`dist` + `reply`、去 `both`、无默认输出目录、相对路径以工作区根为基准、chars 存 .txt、附图前查视觉；新增 **`mc_height`**（高度/地势图，chars/image/full）。工具总数 29 → **32**。
