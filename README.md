# dsh-minecraft-bot

**[English ↓](#english)** · 中文 · [![CI](https://github.com/wenwen3568/dsh-minecraft-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/wenwen3568/dsh-minecraft-bot/actions/workflows/ci.yml)

**让 DSH 玩 MC** —— 一个 DSH（DeepSeek Harness）原生插件
把一台无头 Minecraft 机器人（mineflayer）跑在 DSH 进程里，让它进入到MC服务器中，通过工具调用与世界和玩家交互，完成创造、生存任务。

- 🎮 **每会话一个独立机器人**：不同对话可以连不同服务器、用不同账号，互不干扰
- 👀 **看到这个世界**：地形图、高度图，以及方块、实体探索工具，帮助AI了解这个世界
- 🛠️ **会合成**：在工作台上做工具、装备、熔炉。材料不够会自己去补（原木→木板→木棍），
  没有工作台就**先造一个再合成**，做完核对背包里真的有
- 🔥 **会冶炼**：找熔炉 → 挑燃料 → 放料 → 等烧完 → 把铁锭**取出来**
- ⛏️ **会走过去干活**：收割远处的树和矿（不是只挖够得着的几格），会绕开障碍
- ⚔️ **会打架**：追着僵尸/玩家打，血少了会停手
- 🚶 **会跟着你**：一路跟过来，上下坡、绕墙都会
- 🍗 **会自己吃东西**：饿了自动吃，阈值可调（比如血量低于 16 也吃）
- 🔧 **会自己换工具**：挖什么方块就换最合适的那把（认附魔和耐久）
- 🔔 **单代理+看门狗**：使用一个主代理作为“大脑”，使用看门狗接收事件、记录消息。适时唤醒、打断AI，确保助理及时相应发生的各种事件，如玩家召唤
- 🧠 **长期记忆**：`<工作区>/.minecraft-bot/` 文档树，由助理自动维护，保证工作、冒险的可持续性
- 🖥️ **友好的 UI**：游戏状态条、停止按钮、MC设置，以及一键连接到MC，简单易用
- 🔒 **账户安全**：支持离线账户、第三方皮肤站账户。凭据写在宿主配置中，AI不会直接拿到，使用类似“凭据管理器”的机制进行操作
- 📢 **提示词调优**：插件内置提示词，教会AI如何与AI交互，如何存储记忆等，也提供“建出好建筑”的建议、引导。部分提示词还可自由修改

> 🧩 上面「会走过去干活 / 会打架 / 会跟着你 / 会自己吃东西 / 会自己换工具」这几项，
> 靠五个社区插件实现（寻路 / 选工具 / 自动进食 / 就近采集 / 战斗），
> **它们已经打包在本插件里，装本插件就自动带上、进服自动生效**，你不需要另外安装。
> 详见后文「[生存玩法](#生存玩法工作台合成与插件能力)」。

> ⚠️ **当前为预览版 `0.2.0-beta.4`**
>
> 预览版，面向 DSH **0.2.0-rc.2 及以上**（含 0.2.1-rc.2）。0.2.0 正式版功能尚未全部完成，本版本先行发布已完成功能，以及支持 DSH 0.2.0-rc.2 / 0.2.1-rc.2 和 DSH Desktop。**预览版可能存在未知问题，如遇到请向我们反馈。**
>
> ⚠️ **相对于 0.1 的破坏性变更**
>
> 1. 插件现要求DSH最低版本为 0.2.0-rc.2，不再支持更低版本。*解决方案：将你的DSH升级至 0.2.0-rc.2 及以上版本。*
> 2. 除了MC和MC+模式外，其余模式无法再调用MC游戏相关工具。*解决方案：将需要使用MC工具的会话迁移到MC+模式，找到助手的最后一个回答，点击“方块”图案的“创建MC+分支”按钮。*
> 3. 此前对Minecraft 26.2的临时支持已移除。*解决方案：等待后续版本。MineFlayer支持Minecraft 26.2后，我们会及时跟进。*

---

## 开始使用

1. 创建新对话，选中或新建一个工作区，选择“MC模式”；
2. 点击“连接到MC”按钮，选择好游戏账户，输入服务器地址并点击“连接”，或者点击连接到一个局域网服务器。
3. 在对话窗口下命令，或直接在游戏里聊天。

---

## 要求


| 项   | 要求                                                                    |
| ---- | ----------------------------------------------------------------------- |
| DSH  | 版本`>=0.2.0-rc.2 <0.3.0`                                               |
| Node | ≥ 22（与 DSH  要求一致）                                               |
| 可选 | npm `sharp`（SVG→PNG 光栅化）用于 `mc_kit_image` 的渲染，不影响其它功能 |

---

## 安装

> ⚠️ 需要重启
>
> 无论你从何种方式安装本插件，安装完成后，为保证所有功能正常，务必完全重启DSH实例。

对你的 AI 说：`帮我安装插件 npm:dsh_minecraft_bot@^0.2.0-beta.4`

### DSH 插件管理

在 DSH 主界面找到“插件”，点击打开插件页面，点击“添加插件”按钮，在输入框中输入 `dsh_minecraft_bot@^0.2.0-beta.4`，点击安装。

### 手动安装

本插件的 github 地址为 https://github.com/wenwen3568/dsh-minecraft-bot ，npm 包名为 `dsh_minecraft_bot`。

> 注意：包名用**下划线**、仓库名用**连字符**，这是 npm 与 GitHub 各自的命名习惯，不是笔误。

> 此处 profile 以 web 为例。DSH Desktop 的 profile 为 desktop，如果你使用了自己定义的 profile，情况有所不同。

从 github 仓库安装（**推荐**，无需等 npm 发布）：

```bash
dsh plugin --profile web add github:wenwen3568/dsh-minecraft-bot
```

从 npm 安装（**发布后可用**）：

```bash
dsh plugin --profile web add dsh_minecraft_bot@^0.2.0-beta.4
```

别忘了重启DSH。

---

## MC模式 / MC+模式 与权限隔离

> 不止是权限隔离，有限的工具暴露可以让 AI 更专注于 MC 交互。

| | MC模式 |	MC+模式 |
| --- | --- | --- |
| 工具面 | 只提供与MC游戏有关的工具，以及其他必要的工具 |	额外提供标准模式下的所有工具，如运行命令 |
| 文件工具边界	| 只允许操作工作区下.minecraft-bot 子目录内的文件 |	允许操作工作区所有文件，权限放开后允许操作所有文件 |
| 提示词注入	| RULES.md / 版本提示，可选注入工作区 AGENTS.md	| 同上，此外固定注入工作区 AGENTS.md |
| 看门狗 / 长期记忆 / MC设置 |	✓ |	✓ |

除这两个模式外，其他模式不再暴露  MC 游玩相关工具，MC 管理工具除外。

---

## 生存玩法：工作台合成与插件能力

> 从 `0.2.0-beta.4` 开始，助理**真的会做东西**了 —— 不只是挖和放，而是能砍树 → 做木板 → 做木棍 →
> 造工作台 → 合成工具/装备/熔炉，整条链路自己走完。

### 它现在会做什么

| 想干的事 | 它会怎么做 |
| --- | --- |
| 「做个木镐」 | 先补材料（原木→木板→木棍），没台子就**先造一个台子**再合成，最后核对背包数量 |
| 「看看铁镐要什么」 | 查配方（只读，不动手），告诉你材料清单和还差多少 |
| 「把这些矿烧成锭」 | 找熔炉 → 走过去 → 自动挑燃料 → 放料 → 等烧完 → **把产物取出来** |
| 「砍那棵树」 | 走到树那里再挖（不是只挖够得着的几格） |
| 「跟着我」 | 一路跟过来（会绕障碍） |
| 「打死那只僵尸」 | 追着打，血少了会自己停手 |
| 「饿了记得吃东西」 | 开自动进食，可调阈值（比如血量低于 16 就吃） |

### 五个插件能力，**装一个插件就全带上**

这五项能力分别由五个社区插件提供，但**你不需要单独装它们** —— 它们已经写进本插件的
`optionalDependencies`，`dsh plugin add` 装本插件时会**自动一起装上并自动挂载**，
进服即可用，不需要任何额外命令。

| 插件（自动装） | 提供的能力 | 万一没装上 |
| --- | --- | --- |
| `mineflayer-pathfinder` | 走路会**绕障碍、上下坡**，不撞墙 | 直线走，卡住就跳 |
| `mineflayer-tool` | 挖方块自动换**最合适**的工具（认附魔/耐久） | 用背包里第一把能挖的 |
| `mineflayer-auto-eat` | **饿了自己吃**东西 | 得你叫它吃 |
| `mineflayer-collectblock` | 就近采集更稳 | 逐个走过去再挖 |
| `mineflayer-pvp` | 战斗会**追击**目标 | 只打一下 |

> ✅ **验证过的**：干净环境里只装本插件一个包，五个插件全部自动装上（114 个包 / 14 秒），
> 连真服后 5/5 全部挂载成功。所以正常情况下你**什么都不用做**。

之所以写成 `optionalDependencies` 而不是 `dependencies`：某个插件装不上（网络、平台、版本冲突）
时，**不能因此让整个插件装不了**。少一个只是那项能力降级，其余照常工作，不会报错。

只有一种情况需要你手动补 —— 你的环境因为网络/代理导致可选依赖被跳过时，可以显式装一次：

```bash
# 以 web profile 为例；desktop 请把 --profile web 换成 --profile desktop
dsh plugin --profile web add mineflayer-pathfinder mineflayer-tool \
  mineflayer-auto-eat mineflayer-collectblock mineflayer-pvp
```

装完重启 DSH。之后在游戏里问助理「现在装了哪些插件」，它会用 `mc_plugins` 报给你
（装了没 / 生效没 / 自动进食开没开）。

### 怎么用（对着助理说话就行）

```
你：帮我做一把石镐
它：（查配方 → 发现没圆石 → 先去挖 → 回来合成 → 报告"做好了"）

你：饿了就自己吃东西，血低于 16 也吃
它：（打开自动进食并调阈值）

你：把这两块生铁烧成锭
它：（找熔炉 → 没找到 → 先合成一个熔炉放下 → 烧 → 把铁锭取出来给你看）
```

> 材料真的不够时，它不会含糊地说"缺材料"，而是给出**缺口清单**（差什么、差几个），
> 你可以直接让它去挖，或者自己去补。

---

## 落盘位置


| 东西               | 位置                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| 全局配置           | `$DSH_HOME/dsh_minecraft_bot/config.json`                                                                           |
| 账户元数据         | `$DSH_HOME/dsh_minecraft_bot/accounts.json`                                                                         |
| 插件日志           | `$DSH_HOME/dsh_minecraft_bot/logs/minecraft-bot.log`（可用 `MC_LOG` 覆盖）                                            |
| 会话锁（连服期间） | `$DSH_HOME/dsh_minecraft_bot/.instance.<会话>.json`                                                                 |
| 记忆 / 提示词      | **`<会话工作区>/.minecraft-bot/`**：`README.md`（AI 维护的总索引）+ `RULES.md`（行事准则）+ 任意文档/图片等文件 |
| 按工作区的配置     | `<会话工作区>/.minecraft-bot/config.json`（提示词三个开关 + 版本标记；对 MC模式 AI **只读**，MC+ 按宿主默认）   |
| 分享               | `<会话工作区>/.minecraft-bot/.express/`                                                                         |

> 记忆是**按会话工作区**的，与插件装在哪、DSH 装在哪都无关。

## 开发与自检

```bash
node tools/check-core.mjs     # 全树语法 + 动态 import + 私有字段一致性（改 core.mjs 必跑）
node selfcheck.mjs            # 1047 条离线断言（假 ctx，不需要 MC 服务器、不连网）
node tools/check-standalone-import.mjs   # 干净环境回归：pack → 独立目录 install → import 必须成功（慢，CI 跑）
# 起一个隔离 DSH 实例验证"整树加载"（需要一份 DSH checkout）：
DSH_ROOT=/path/to/deepseek-harness node tools/isolate.mjs start
```

`selfcheck.mjs` 覆盖：工具面与参数、每会话实例隔离、超时/中断、放置判据（与 `minecraft-data` 真值表比对）、
看门狗唤醒投递与 job 结算、未签名/系统位置聊天的识别、记忆树读写与路径穿越防护、**发布区的防穿透与真路由**、
**「文件分享」按宿主模式拆键（web=base / 桌面=独立端口）**、base 推导（含反代 `Referer` 一档）、账户库与凭据隔离、配置校验、
提示词注入去重与版本提示、preset 自检与重建、**强制停止的四步顺序**、
依赖面（含"`vec3` 与 `mineflayer` 必须是同一份"这类运行时断言），以及客户端 bundle 的静态检查。

CI 跑的就是这两条（`.github/workflows/ci.yml`）：**ubuntu（Node 22 / 24）+ windows（Node 22）**；
另有一个「打包产物」job，`npm pack` 之后核对 tarball 里该有的文件都在、且没混进 `node_modules` / 日志 / 账户，
再跑一遍 **干净环境回归**（pack → 独立目录 `npm install` → `import('dsh_minecraft_bot')` 必须成功 ——
本机 link 安装永远测不出「宿主包解析不到」，只有干净安装复现得了用户环境，见 issue #5）。

发布走 tag（`.github/workflows/release.yml`）：`git tag v0.1.7 && git push origin v0.1.7` →
先跑上面两条 + 校验 tag 与 `package.json` 版本一致，再 `npm pack` 并把 zip 挂到 GitHub Release
（正文取 `CHANGELOG.md` 里本版本那一节），最后**发 npm**（用仓库 secret `NPM_TOKEN`）。
`npm publish` 前还会自动跑一遍上面两条（`prepublishOnly`）—— **坏树发不出去**。

- 🔴 **npm 那步是"先探再发"**：仓库里配了 `NPM_TOKEN` 才发；**没配就明确跳过**（只发 Release，工作流照样绿）。
  加 secret 的位置：仓库 **Settings → Secrets and variables → Actions → New repository secret**，
  名字必须是 `NPM_TOKEN`，值是 npm 的 Automation token。
- 也可以**在本机手动发**（不依赖任何 secret）：`npm login` 后跑 `npm run publish:npm`
  —— 前置校验、失败即停、默认要确认，细则见 `agent-docs/release.md`。
- **每个版本改了什么**见 [`CHANGELOG.md`](CHANGELOG.md)（`0.2.0-beta.4`：新增工作台合成 / 冶炼 / 插件集成，
  修复创造模式移动卡住；`0.2.0-beta.3`：新增联网搜索 / 网页抓取 / 规则查看 / 文件系统工具、
  MC 模式工具面调整，修 DSH 0.2.1-rc.2 上新建会话报错；`0.2.0-beta.2`：修新 DSH 上装不上 / 跑不起来、
  新增 MC+模式、连接类工具收口；`0.1.7`：修 1.21/1.21.1 进服掉线、断线状态不同步、`mc_events` 等待堵住唤醒；
  `0.1.6`：修皮肤站登录 400；`0.1.5`：修"连不存在的服把整个 DSH 搞崩"、`mc_lan` 只留局域网公告、新增 `mc_ping`）。

---

## 已知限制

- **微软正版登录未实现**（只有离线 / Yggdrasil 皮肤站）。
- **文件分享默认是关的**：AI 画了图只会把**绝对路径**给你，要让它直接在对话里显示，
  得在「MC设置 → 文件分享」里**打开开关**。**配置按宿主模式分两套**（从哪种模式进来就只认哪种）：
  - **web 模式**（`expressWebBase`）：填你访问这台 DSH 用的 `base`（如 `https://example.com`）；
  - **桌面模式**（`expressDesktopPort`，默认 `16049`）：插件自起一个**只监听本机**的独立端口直接托管分享文件，
    地址形如 `http://localhost:16049/<工作区>/<文件名>`；端口被占用时设置页会红字提示，可改端口或恢复默认。
  前端只认绝对 http(s) 图片地址，所以关闭时的本地路径**不会**内联成图（这是设计如此，不是 bug）。
- 文件分享的 `base`（web）/ 端口（桌面）**不做连通性自检**：web 的 base 填错了只有你自己能发现（AI 拿到的 URL 打不开）；桌面端口占用会在设置页红字提示。
- **网页抓取默认是关的**：MC 模式的助手默认**不能抓网页**（MC+ 模式本身就有抓取工具；联网搜索另见「MC设置 → 联网搜索」，默认开）。
  要开放，去「MC设置 → 联网搜索 → 网页抓取」打开「允许网页抓取」，并按需填写**允许抓取的域名表**
  （一行一条，支持精确名 / `*.example.com` 通配 / `/正则/` / `*` 全部；默认放行 `minecraft.wiki` 及其子域），
  或直接打开「允许所有域名」。下面还有「允许的内容类型」三个开关（默认都开）：**网页 HTML**、**文本**（纯文本 / JSON / XML，含 SVG）、
  **图片**。三类都走插件**自己**的抓取（不依赖宿主），**一次请求**；**图片只支持 png / jpeg / gif / webp 四种**（别的格式一律算不支持），
  模型有视觉时直接把图给它看，也可以用 `dist` 参数把它存成文件。
  🔴 抓取**只能访问公网地址**（内网 / 本机 / 本机服务地址一律拒），图片同样；**不支持代理**（宿主有代理配置时也走直连）。
- 🔴 **行事准则为什么叫 `RULES.md`**（见上）：`AGENTS.md` 会被 DSH 当工作区指令自动注入到任何碰过该目录的会话，
  与 MC 模式无关 —— 所以这个名字是刻意的。
- 工具描述与文档目前是**中文**。
- **能连的 MC 版本取决于依赖里的 `mineflayer`**；想连官方还没支持的新版本，可以自行替换 profile 里的那一份。
- 归档保护依赖宿主内部方法，DSH 升级后可能需要跟进。

## AI 使用

本项目代码由 AI 生成，可能存在未知风险，请谨慎使用。

- 工具：DeepSeek Harness
- 模型：DeepSeek V4.1 Flash

## 许可

MIT（见 `LICENSE`）。第三方组件与许可见 `THIRD_PARTY_NOTICES.md`。

---

## English

**[↑ 中文版](#minecraft-bot--Minecraft Bot)**

**Let DSH play MC** — a native DSH (DeepSeek Harness) plugin that runs a headless Minecraft bot
(mineflayer) inside the DSH process, joins a Minecraft server, and interacts with the world and
players through tool calls to build, survive and finish tasks.

- 🎮 **One bot per conversation** — different chats can play on different servers with different accounts, independently.
- 👀 **It sees the world** — terrain and height maps, plus block/entity exploration tools, help the agent understand the world.
- 🛠️ **It crafts** — makes tools, gear and furnaces at a workbench. Short on materials it gathers them itself (log → planks → sticks), **builds a table first** if there isn't one, then verifies the result is really in the inventory.
- 🔥 **It smelts** — finds a furnace, picks fuel, loads it, waits, and **takes the ingots out**.
- ⛏️ **It walks over to work** — harvests trees and ore that are far away (not just whatever is in reach), navigating around obstacles.
- ⚔️ **It fights** — chases zombies/players, and backs off when health gets low.
- 🚶 **It follows you** — keeps up across hills and around walls.
- 🍗 **It eats on its own** — auto-eat when hungry, with a configurable threshold (e.g. also eat below 16 health).
- 🔧 **It picks the right tool** — swaps to the best tool for each block (honours enchantments and durability).
- 🔔 **One agent + a watchdog** — a single main agent is the "brain"; the watchdog receives events and logs messages, waking and interrupting the agent at the right moment so it reacts to what happens, e.g. a player calling it.
- 🧠 **Long-term memory** — a document tree under `<workspace>/.minecraft-bot/`, kept up to date by the agent, so work and adventures continue across sessions.
- 🖥️ **Friendly UI** — a game status chip, a stop button, MC Settings, and one-click "Connect to MC".
- 🔒 **Account safety** — offline and third-party (Yggdrasil) accounts. Credentials live in the host config and are never handed to the model directly, via a credential-manager-style flow.
- 📢 **Tuned prompts** — built-in prompts teach the agent how to interact with the world and how to keep memory, and give advice that guides good builds. Some prompts are freely editable.

> 🧩 The "walks over to work / fights / follows you / eats on its own / picks the right tool" items are
> powered by five community plugins (pathfinding, tool selection, auto-eat, nearby collecting, PvP).
> **They are bundled with this plugin** — installing this plugin brings them in and they attach
> automatically on spawn. You do not install them separately.
> See [Survival gameplay](#survival-gameplay-workbench-crafting-and-plugin-capabilities) below.

> ⚠️ **Preview release `0.2.0-beta.4`**
>
> For DSH **0.2.0-rc.2 and above** (including 0.2.1-rc.2). Not all 0.2.0 features are finished; this
> release ships what is done, plus support for DSH 0.2.0-rc.2 / 0.2.1-rc.2 and DSH Desktop. **A preview
> may have unknown issues — please report them if you hit any.**
>
> ⚠️ **Breaking changes from 0.1**
>
> 1. The plugin now requires DSH 0.2.0-rc.2 or newer; older versions are no longer supported.
>    *Fix: upgrade DSH to 0.2.0-rc.2 or above.*
> 2. Outside MC and MC+ mode, other modes can no longer call MC game tools. *Fix: move the session
>    that needs them to MC+ mode — find the last assistant reply and click the "box"-icon "Create MC+
>    branch" button.*
> 3. The earlier temporary support for Minecraft 26.2 has been removed. *Fix: wait for a later
>    release; we will follow up once MineFlayer supports Minecraft 26.2.*

---

## Getting started

1. Start a new conversation, pick or create a workspace, and choose **MC mode**.
2. Click **Connect to MC**, pick a game account, enter the server address and click **Connect** — or
   connect to a LAN server.
3. Give orders in the chat, or talk to the bot directly in game.

---

## Requirements


| Item     | Requirement                                                                                  |
| -------- | -------------------------------------------------------------------------------------------- |
| DSH      | version `>=0.2.0-rc.2 <0.3.0`                                                                |
| Node     | ≥ 22 (same as DSH)                                                                           |
| Optional | npm `sharp` (SVG→PNG rasteriser) for `mc_kit_image` rendering; nothing else is affected      |

---

## Install

> ⚠️ **A restart is required**
>
> However you install the plugin, fully restart the DSH instance afterwards so every feature works.

Tell your agent: *"install the plugin `npm:dsh_minecraft_bot@^0.2.0-beta.4`"*

### DSH plugin manager

Open **Plugins** from the DSH main UI, click **Add plugin**, enter `dsh_minecraft_bot@^0.2.0-beta.4`, and
install.

### Manual install

The GitHub repo is https://github.com/wenwen3568/dsh-minecraft-bot ; the npm package name is `dsh_minecraft_bot`.
The package name uses an **underscore** while the repo name uses **hyphens** — that is the npm/GitHub
convention, not a typo.

> The profile below is `web`. DSH Desktop's profile is `desktop`; a custom profile is different.

Install from the GitHub repo (**recommended**; no need to wait for an npm release):

```bash
dsh plugin --profile web add github:wenwen3568/dsh-minecraft-bot
```

Install from npm (**once published**):

```bash
dsh plugin --profile web add dsh_minecraft_bot@^0.2.0-beta.4
```

Don't forget to restart DSH.

---

## MC mode / MC+ mode and permission isolation

> Beyond isolation, a limited toolset also keeps the agent focused on MC interaction.

| | MC mode | MC+ mode |
| --- | --- | --- |
| Toolset | Only MC-game tools, plus other necessary tools | Additionally exposes all standard-mode tools, e.g. running commands |
| File tool boundary | Only files under the workspace's `.minecraft-bot/` | All files in the workspace (all files once permissions are relaxed) |
| Prompt injection | RULES.md / version note; workspace `AGENTS.md` optional | The same, plus workspace `AGENTS.md` always injected |
| Watchdog / long-term memory / MC Settings | ✓ | ✓ |

Outside these two modes, other modes no longer expose MC-play tools (MC admin tools excepted).

## Survival gameplay: workbench crafting and plugin capabilities

> Since `0.2.0-beta.4` the agent **actually makes things** — not just digging and placing, but the
> whole chain: chop a tree → planks → sticks → build a crafting table → craft tools, gear, a furnace.

### What it can do now

| You ask | What it does |
| --- | --- |
| "Craft a wooden pickaxe" | Fills in intermediate materials (log → planks → sticks), **crafts a table first** if there isn't one, then verifies the real inventory count |
| "What does an iron pickaxe need?" | Looks up recipes (read-only, changes nothing) and reports the materials and what's still missing |
| "Smelt these ores into ingots" | Finds a furnace → walks there → picks fuel → loads it → waits → **takes the output out** |
| "Chop that tree" | Walks to the tree first, then mines (not just whatever is within reach) |
| "Follow me" | Follows you around (navigating around obstacles) |
| "Kill that zombie" | Chases it down, and backs off when health is low |
| "Eat something when you get hungry" | Turns on auto-eat with a threshold you choose (e.g. eat below 16 health) |

### Five plugin-powered capabilities — **all bundled, one install**

These five capabilities come from five community plugins, but **you don't install them separately** —
they are declared in this plugin's `optionalDependencies`, so `dsh plugin add` on this plugin
**pulls them in and attaches them automatically**. They work as soon as the bot spawns.

| Plugin (auto-installed) | What it gives you | If it somehow isn't there |
| --- | --- | --- |
| `mineflayer-pathfinder` | Pathfinding that **goes around obstacles and up/down hills** | Straight-line walking, jumps when stuck |
| `mineflayer-tool` | Picks the **best** tool for each block (honours enchantments and durability) | First tool in the inventory that can mine it |
| `mineflayer-auto-eat` | **Eats on its own** when hungry | You have to ask it |
| `mineflayer-collectblock` | More reliable gather-what's-nearby | Walks to each block and mines it |
| `mineflayer-pvp` | Combat that **chases the target** | A single swing |

> ✅ **Verified**: in a clean environment, installing only this plugin pulls in all five
> (114 packages in 14 s), and after joining a real server all 5/5 attach successfully.
> In normal use there is **nothing for you to do**.

They are `optionalDependencies` rather than `dependencies` on purpose: if one of them fails to install
(network, platform, version conflict), that must not make **this plugin** uninstallable. A missing one
only degrades that single capability; everything else keeps working and nothing errors out.

The only case where you might add them by hand is if your network/proxy made npm skip the optional
dependencies:

```bash
# web profile shown; for desktop use --profile desktop
dsh plugin --profile web add mineflayer-pathfinder mineflayer-tool \
  mineflayer-auto-eat mineflayer-collectblock mineflayer-pvp
```

Restart DSH afterwards. In game, ask "which plugins are installed?" and it will report back via
`mc_plugins` (installed / loaded / auto-eat enabled).

### How to use it (just talk to the agent)

```
You: craft me a stone pickaxe
It:  (checks recipe → no cobblestone → goes mining → comes back and crafts → reports "done")

You: eat when you're hungry, and also below 16 health
It:  (enables auto-eat and sets the threshold)

You: smelt these two iron ores into ingots
It:  (looks for a furnace → none → crafts one and places it → smelts → hands you the ingots)
```

> When materials are genuinely short it doesn't just say "missing materials" — it reports a
> **gap list** (what's missing and how many), so you can send it mining or top up yourself.

## Where things live


| What               | Where                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Global config      | `$DSH_HOME/dsh_minecraft_bot/config.json`                                                                           |
| Account metadata   | `$DSH_HOME/dsh_minecraft_bot/accounts.json`                                                                         |
| Plugin log         | `$DSH_HOME/dsh_minecraft_bot/logs/minecraft-bot.log` (override with `MC_LOG`)                                         |
| Session lock (while connected) | `$DSH_HOME/dsh_minecraft_bot/.instance.<session>.json`                                                   |
| Memory / prompts   | **`<workspace>/.minecraft-bot/`**: `README.md` (the agent's index) + `RULES.md` (conduct) + any docs/images     |
| Per-workspace settings | `<workspace>/.minecraft-bot/config.json` (prompt toggles + version marker; **read-only** to the MC-mode agent, host default in MC+) |
| Sharing            | `<workspace>/.minecraft-bot/.express/`                                                                          |

> Memory is **per workspace** — independent of where the plugin or DSH is installed.

## Development and self-check

```bash
node tools/check-core.mjs     # whole-tree syntax + dynamic import + private-field consistency
node selfcheck.mjs            # 1047 offline assertions (fake ctx; no MC server, no network)
node tools/check-standalone-import.mjs   # clean-env regression: pack → install → import must succeed (slow; CI)
# run an isolated DSH instance to check whole-tree loading (needs a DSH checkout):
DSH_ROOT=/path/to/deepseek-harness node tools/isolate.mjs start
```

`selfcheck.mjs` covers: the tool surface and parameters, per-session instance isolation,
timeouts/interruption, placement rules (checked against the real `minecraft-data` table), watchdog
wake-up delivery and job settlement, recognition of unsigned / system-slot chat, memory-tree
read/write and path-traversal protection, **the publish area's traversal defences and real route**,
**the two file-sharing modes and `base` derivation** (including the reverse-proxy `Referer` case),
the account store and credential isolation, config validation, prompt-injection de-duplication and
version notes, preset self-check and rebuild, **the four-step stop sequence**, the dependency surface
(including runtime assertions like "`vec3` and `mineflayer` must be the same copy"), and a static
check of the client bundle.

CI runs exactly these two (`.github/workflows/ci.yml`): **ubuntu (Node 22 / 24) + windows (Node 22)**;
a separate "package" job runs `npm pack` and checks the tarball has the files it should and no
`node_modules` / logs / accounts, then runs the clean-env regression (pack → install in a separate
directory → `import('dsh_minecraft_bot')` must succeed — a local link install can never catch "host packages
not resolvable"; only a clean install reproduces the user's environment, see issue #5).

Releases go through a tag (`.github/workflows/release.yml`): `git tag v0.1.7 && git push origin v0.1.7`
→ run the two checks above + verify the tag matches the `package.json` version, then `npm pack` and
attach the zip to the GitHub Release (the body is taken from that version's section in `CHANGELOG.md`),
and finally publish to npm (using the repo secret `NPM_TOKEN`). `npm publish` also runs the two checks
first (`prepublishOnly`) — **a broken tree cannot be published**.

- 🔴 The npm step "checks before publishing": it only publishes when the repo has `NPM_TOKEN`; **if not,
  it skips explicitly** (Release only, the workflow still goes green). Add the secret at
  **Settings → Secrets and variables → Actions → New repository secret**, name `NPM_TOKEN`, value an
  npm Automation token.
- You can also **publish from your own machine** (no secret needed): `npm login`, then
  `npm run publish:npm` — pre-flight checks, stops on failure, asks for confirmation by default;
  details in `agent-docs/release.md`.
- **What changed in each version** — see [`CHANGELOG.md`](CHANGELOG.md) (`0.2.0-beta.4`: web search,
  web fetch, rules inspection and filesystem tools, MC-mode toolset changes, fix for session creation
  errors on DSH 0.2.1-rc.2; `0.2.0-beta.2`: fixes so it installs / runs on the new DSH, new MC+ mode,
  connection tools consolidated; `0.1.7`: 1.21/1.21.1 disconnect, connection state out of sync,
  `mc_events` wait blocking wake-ups; `0.1.6`: skin-site login 400; `0.1.5`: crash on a non-existent
  server, `mc_lan` kept to LAN announcements, new `mc_ping`).

---

## Known limitations

- **Microsoft (Mojang) login is not implemented** (offline / Yggdrasil only).
- **File sharing is off by default**: the agent only gives you an **absolute path**; to render inline in
  the chat, turn on the switch under **MC Settings → File sharing**. Settings come in **two sets, one per
  host mode** (only the current mode's set is used):
  - **web mode** (`expressWebBase`): set the `base` you use to reach this DSH (e.g. `https://example.com`);
  - **desktop mode** (`expressDesktopPort`, default `16049`): the plugin starts its own **loopback-only**
    port to serve shared files directly, e.g. `http://localhost:16049/<workspace>/<file>`; if the port is
    taken the settings page shows a red hint — change the port or restore the default.
  The frontend only accepts absolute http(s) image URLs, so a local path is **not** inlined (by design).
- File sharing's `base` (web) / port (desktop) has **no connectivity check**: a typo'd web base is only
  noticeable by you (the URL the agent gets won't open); a busy desktop port is flagged in the settings page.
- 🔴 **Why the conduct file is `RULES.md`**: `AGENTS.md` is picked up by DSH as a workspace instruction
  file and injected into any session that touched that directory, MC or not — so the name is deliberate.
- Tool descriptions and docs are currently in **Chinese**.
- **Which MC versions you can connect to depends on the bundled `mineflayer`**; to connect to a version
  the official one doesn't support yet, replace that copy in the profile.
- Archive protection relies on a host-internal method and may need follow-up after a DSH upgrade.

## AI usage

This project's code is generated by AI and may carry unknown risks — use with care.

- Tool: DeepSeek Harness
- Model: DeepSeek V4.1 Flash

## License

MIT (see `LICENSE`). Third-party components and licences in `THIRD_PARTY_NOTICES.md`.
