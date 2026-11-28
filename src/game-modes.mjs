// -*- coding: utf-8 -*-
/**
 * dsh_minecraft_bot / game-modes.mjs —— 「机器人游戏模式」的唯一定义处
 * ============================================================================
 * 「连接到MC」弹窗里有一排模式卡片（生存 / 创造 / 冒险）。用户选的那个**不是**"服务器模式"
 * ——服务器给什么模式是服务器说了算（`bot.game.gameMode`），插件改不了，也**不能**假装改得了。
 *
 * 所以这里把"模式"定义成 **用户在告诉插件：这局要按哪种玩法来**，它有两个真实作用：
 *
 *   ① **提示词**：连接时往注入正文里追加一行（见 `modePromptLine`），AI 一上来就知道
 *      "这局是生存，别想着直接拿钻石剑"。
 *   ② **能力门控**：`modeAllows()` 决定哪些能力**直接拒掉**（而不是让 AI 撞服务器拒绝）。
 *      典型：生存模式下 `mc_give` 直接报"生存模式不给东西"，创造模式下才放行。
 *
 * 🔴 门控的最终判据是**两者取严**（见 `effectiveCapabilities`）：
 *      · 用户选的模式说"不给" → 就是不给（哪怕服务器实际是创造）；
 *      · 服务器实际模式说"不可能" → 也不给（比如服务器是生存，创造能力本来就用不了）。
 *    这样"生存模式真的禁用创造专属能力"这条要求才成立，且不会在创造服里误伤。
 * ============================================================================
 */

/**
 * 三种模式。`desc` 是弹窗卡片上那一行小字（**一行说完**，用户要求"不要太多"）。
 * `id` 会出现在 HTTP body / 提示词 / mc_status 里，**不要随便改**。
 */
export const GAME_MODES = [
  {
    id: 'survival',
    label: '生存',
    desc: '自己挖矿合成，不给物品、不能飞',
  },
  {
    id: 'creative',
    label: '创造',
    desc: '无限方块、可飞行，适合快速搭建',
  },
  {
    id: 'adventure',
    label: '冒险',
    desc: '不能破坏和放置方块，只能探索交互',
  },
]

export const GAME_MODE_IDS = GAME_MODES.map((m) => m.id)

/** 默认模式：没选过就是生存（绝大多数服务器都是生存） */
export const DEFAULT_GAME_MODE = 'survival'

/**
 * 校验 + 归一化。认不出来的一律返回 null（调用方自己决定是报错还是回默认）。
 * @param {unknown} value
 * @returns {'survival'|'creative'|'adventure'|null}
 */
export function normalizeGameMode (value) {
  const v = String(value ?? '').trim().toLowerCase()
  return GAME_MODE_IDS.includes(v) ? v : null
}

/** 模式的展示信息（拿不到就返回 null） */
export function modeInfo (id) {
  const v = normalizeGameMode(id)
  return v ? GAME_MODES.find((m) => m.id === v) : null
}

/** 中文标签（日志/报错用；认不出来就原样回显） */
export function modeLabel (id) {
  return modeInfo(id)?.label ?? String(id ?? '未知')
}

/**
 * 每种模式**允许**的能力（用户意图层）。
 *
 * 能力名（`CAPS`）与真实工具/代码的对应关系：
 *   · `give`   —— `mc_give` / `mc_give{clearAll}` / 放置时自动取物（`placeBlock` 的创造分支）
 *   · `fly`    —— `mc_move{mode:"fly"}` / `gotoPoint{mode:"fly"}`（创造直飞）
 *   · `place`  —— `mc_act{mode:"place"}` / `mc_build`
 *   · `break`  —— `mc_act{mode:"break"}` / `mc_dig` / `mc_collect`（采集要挖方块）
 *   · `attack` —— `mc_act{mode:"attack"}` / `mc_fight`
 *   · `use`    —— `mc_act{mode:"use"}`（开门/按钮/喂动物）
 *   · `cheat`  —— `mc_command` 里的作弊类指令（gamemode/give/setblock/fill/…）
 */
const MODE_CAPS = {
  // 生存：能挖能放能打，但**没有任何创造福利**
  survival: { give: false, fly: false, place: true, 'break': true, attack: true, use: true, cheat: false },
  // 创造：全开（飞、取物、作弊指令都行）
  creative: { give: true, fly: true, place: true, 'break': true, attack: true, use: true, cheat: true },
  // 冒险：不能动世界（原版冒险模式里破坏/放置本来就被服务端拒），但能打、能交互、能跑图
  adventure: { give: false, fly: false, place: false, 'break': false, attack: true, use: true, cheat: false },
}

/**
 * 服务器**实际**模式带来的硬限制（跟用户选什么无关：服务器不给你就是不给）。
 * `null` = 未知（还没进服/拿不到），按"不额外限制"处理，只受用户模式约束。
 */
const SERVER_CAPS = {
  survival: { give: false, fly: false, place: true, 'break': true, attack: true, use: true, cheat: false },
  creative: { give: true, fly: true, place: true, 'break': true, attack: true, use: true, cheat: true },
  adventure: { give: false, fly: false, place: false, 'break': false, attack: true, use: true, cheat: false },
  spectator: { give: false, fly: true, place: false, 'break': false, attack: false, use: false, cheat: false },
}

/** 用户选的模式是否允许某个能力 */
export function modeAllows (mode, cap) {
  const m = normalizeGameMode(mode) ?? DEFAULT_GAME_MODE
  return MODE_CAPS[m]?.[cap] !== false
}

/**
 * 最终能力表 = 用户意图 ∩ 服务器实际模式（**取严**）。
 *
 * @param {string|null} userMode 用户在弹窗里选的模式（null = 没选，按默认）
 * @param {string|null} serverMode 服务器实际模式（null = 未知，不额外限制）
 * @returns {Record<string, boolean>}
 */
export function effectiveCapabilities (userMode, serverMode) {
  const user = MODE_CAPS[normalizeGameMode(userMode) ?? DEFAULT_GAME_MODE] ?? MODE_CAPS[DEFAULT_GAME_MODE]
  const srv = SERVER_CAPS[String(serverMode ?? '').toLowerCase()] ?? null
  const out = {}
  for (const cap of Object.keys(user)) out[cap] = user[cap] && (srv ? srv[cap] !== false : true)
  return out
}

/**
 * 每个能力被拒时给 AI 看的**人话**（不要出现"capability/policy"这种词）。
 * `mode` 是用户选的模式（用来提示"去弹窗改模式"）。
 */
export function denyReason (cap, { userMode = null, serverMode = null } = {}) {
  const label = modeLabel(userMode ?? DEFAULT_GAME_MODE)
  const srv = String(serverMode ?? '').toLowerCase()
  // 服务器模式的锅优先说（改选模式也没用，得让服务器给权限）
  if (srv === 'adventure' && (cap === 'place' || cap === 'break')) {
    return `服务器把你放在冒险模式里，破坏/放置方块会被服务端拒绝。`
  }
  if (srv === 'spectator' && cap !== 'fly') {
    return '服务器把你放在旁观模式里，只能看和飞，动手一律会被拒。'
  }
  switch (cap) {
    case 'give':
      return `当前是**${label}模式**，不提供"直接拿物品"（那是创造专属）。`
        + '要材料就 `mc_dig` 挖、`mc_craft` 合成、`mc_collect` 采集；'
        + '确实该用创造，请让用户在「连接到MC」里把游戏模式改成**创造**。'
    case 'fly':
      return `当前是**${label}模式**，不能飞行（飞行是创造专属）。用 \`mc_move{mode:"walk"}\` 走过去。`
    case 'place':
      return `当前是**${label}模式**，不能放置方块。`
    case 'break':
      return `当前是**${label}模式**，不能破坏方块。`
    case 'attack':
      return `当前是**${label}模式**，不能攻击。`
    case 'use':
      return `当前是**${label}模式**，不能使用方块/实体。`
    case 'cheat':
      return `当前是**${label}模式**，作弊类指令（gamemode/give/setblock/fill…）一律不给用。`
    default:
      return `当前是**${label}模式**，这个操作不允许。`
  }
}

/** `mc_command` 里算"作弊/创造"的指令（生存和冒险模式一律拒） */
export const CHEAT_COMMANDS = new Set([
  'gamemode', 'give', 'setblock', 'fill', 'clone', 'summon',
  'effect', 'enchant', 'xp', 'experience', 'clear', 'defaultgamemode',
])

/**
 * 连接提示词里追加的那一行（英文——连接提示词正文一直是英文，保持一致）。
 * @param {string} mode
 */
export function modePromptLine (mode) {
  const id = normalizeGameMode(mode) ?? DEFAULT_GAME_MODE
  if (id === 'creative') {
    return 'The user selected **creative** game mode: `mc_give` and flying (`mc_move{mode:"fly"}`) are allowed.'
  }
  if (id === 'adventure') {
    return 'The user selected **adventure** game mode: do not break or place blocks (`mc_dig` / `mc_act{place|break}` / `mc_build` are disabled); explore, interact and fight instead.'
  }
  return 'The user selected **survival** game mode: no creative shortcuts — `mc_give` and flying are disabled; gather and craft materials yourself.'
}
