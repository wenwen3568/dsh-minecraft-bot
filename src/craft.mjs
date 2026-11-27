// -*- coding: utf-8 -*-
/**
 * dsh_minecraft_bot / craft.mjs —— 合成 / 冶炼 / 工作台能力（纯逻辑，不依赖 DSH）
 * ============================================================================
 * 用户要的："**可以加上使用工作台进行物品合成**"。所以这里把 MC 的合成链做全：
 *
 *   · **2×2（背包网格）** —— 木板、木棍、工作台、火把这类不需要台子的配方；
 *   · **3×3（工作台）**   —— 需要台子的配方。台子来自三种途径，按优先级：
 *       ① 附近已有的 `crafting_table` 方块（走过去用）；
 *       ② 背包里有 `crafting_table` → 自己放一个（放完记住，后续复用，必要时再挖回来）；
 *       ③ 背包里连台子都没有 → **先合成一个**（`planks×4`，2×2 就行）。
 *   · **自动补中间材料** —— 要木棍但只有原木？先合成木板再合成木棍。BFS 递归，带深度/次数上限。
 *   · **缺口报告** —— 差什么、差多少，一次性说清（而不是"missing ingredient"这种废话）。
 *
 * 关键约束（与 core.mjs 的注释一致）：
 *   ① `bot.craft()` 是**等服务端 ack** 的 promise ⇒ 调用方必须套 `withTimeout`/`raceAbort`；
 *   ② `bot.recipesFor(id, null, 1, table)` 的 `table` 必须是 **Block 实例**（不是坐标），
 *      2×2 时才传 `null`；
 *   ③ 所有返回值必须是**纯 JSON**（不能把 Item/Block 实例直接回给宿主）。
 * ============================================================================
 */

/** 一次合成最多"自动补"几层（原木→木板→木棍→…）。防止配方环把栈吃掉。 */
export const MAX_CRAFT_DEPTH = 4
/** 一次 mc_craft 最多迭代几次 craft 调用（每个产物一次）。防手滑 + 防死循环。 */
export const MAX_CRAFT_ITERATIONS = 256
/** 同一个中间产物最多试几条候选配方（木棍有 12 条：oak/spruce/birch/…，得能换着试） */
const MAX_RECIPE_CANDIDATES = 6

/** 哪些方块算"工作台"（版本间命名一致的只有这一个；其它合成站另走 use） */
export const CRAFTING_TABLE = 'crafting_table'

/** 熔炉族：燃料/冶炼用（`mc_smelt`） */
export const FURNACE_NAMES = ['furnace', 'blast_furnace', 'smoker']

/**
 * 背包里某物品的总数（跨所有槽位）。
 * @param {any} bot
 * @param {string} name 物品英文 id
 */
export function countItem (bot, name) {
  if (!bot?.inventory) return 0
  try {
    return bot.inventory.items().filter((i) => i.name === name).reduce((s, i) => s + i.count, 0)
  } catch { return 0 }
}

/** 背包总览：`{ 名字: 数量 }`（给缺口报告用，也是纯 JSON） */
export function inventoryCounts (bot) {
  const m = {}
  try {
    for (const it of bot.inventory.items()) m[it.name] = (m[it.name] ?? 0) + it.count
  } catch { /* 没背包就空对象 */ }
  return m
}

/** 物品名 → 注册表条目（拿不到就是 null） */
export function itemOf (bot, name) {
  const n = String(name ?? '').trim()
  if (!n) return null
  return bot?.registry?.itemsByName?.[n] ?? null
}

/** 物品 id → 名字（缺口报告要给人话） */
export function nameOfId (bot, id) {
  if (id == null || id < 0) return null
  try { return bot?.registry?.items?.[id]?.name ?? null } catch { return null }
}

/**
 * 从一条 recipe 里抽出"要消耗什么"（**只取负 count 的 delta 项**）。
 * @returns {Array<{name:string, id:number, count:number}>}
 */
export function recipeCost (bot, recipe) {
  const out = []
  for (const d of recipe?.delta ?? []) {
    if (typeof d?.count !== 'number' || d.count >= 0) continue
    out.push({ name: nameOfId(bot, d.id) ?? `#${d.id}`, id: d.id, count: -d.count })
  }
  return out
}

/** 这条配方产出的物品（`{name, count}`） */
export function recipeResult (bot, recipe) {
  const id = recipe?.result?.id
  return { name: nameOfId(bot, id) ?? `#${id}`, count: Number(recipe?.result?.count ?? 1) }
}

/** 需要工作台吗 */
export const recipeNeedsTable = (recipe) => Boolean(recipe?.requiresTable)

/** 这个物品有没有配方（= 能不能现做，而不是必须去挖/捡） */
function isCraftable (bot, name) {
  const it = itemOf(bot, name)
  if (!it) return false
  try { return usableRecipes(bot, it.id).length > 0 } catch { return false }
}

/**
 * 递归可达性：拿 `need` 个 `name` 这件事，**只靠背包 + 合成**能不能办到。
 *
 * 这是本文件最容易写错的一段，所以单独抽出来讲清楚：
 *   只看"这东西有没有配方"是**不够**的（2026-11-23 真机踩到）——
 *   `cherry_planks` 有配方（cherry_log→4 板），所以"有配方 = 补得动"，但它要的 `cherry_log`
 *   背包里没有、也没有配方 ⇒ 实际上**根本补不出来**。于是评分时 cherry 和 oak 并列，
 *   排序一抖动就挑中 cherry，最后报"cherry_log 差 1"。
 *   ⇒ 必须一路问到"**最终底层原料**"是不是背包里真有。
 *
 * @param {any} bot
 * @param {string} name 物品
 * @param {number} need 需要几个
 * @param {number} depth 还能往下问几层
 * @param {Set<string>} seen 路径上的物品（防配方环）
 */
function reachable (bot, name, need, depth, seen) {
  if (countItem(bot, name) >= need) return true
  if (depth <= 0) return false
  if (seen.has(name)) return false
  const it = itemOf(bot, name)
  if (!it) return false
  let recipes = []
  try { recipes = usableRecipes(bot, it.id) } catch { return false }
  if (!recipes.length) return false
  const next = new Set(seen)
  next.add(name)
  const short = need - countItem(bot, name)
  for (const r of recipes) {
    const per = Math.max(Number(r?.result?.count ?? 1), 1)
    const times = Math.max(1, Math.ceil(short / per))
    let ok = true
    for (const c of recipeCost(bot, r)) {
      if (!reachable(bot, c.name, c.count * times, depth - 1, next)) { ok = false; break }
    }
    if (ok) return true
  }
  return false
}

/**
 * 给一条配方打分（**越小越好**）。用于在"同一个产物的多条配方"里挑一条能落地的。
 *
 * 🔴 为什么必须打分而不是"取第一条"（2026-11-23 真机，1.21.11 踩到）：
 *    木棍有 **12 条**配方（oak/spruce/birch/cherry/… 各一套）。取第一条会挑中 cherry_planks，
 *    而背包里明明全是 oak_log ⇒ 递归去补 cherry_planks ⇒ 报"cherry_log 差 1"。
 *    打分要能表达"这条配方我**现在真的做得出**"：
 *      · short   —— 还缺几种材料（越少越好，0 = 立刻能做）
 *      · blocked —— 缺的材料里**递归到底也补不动**的有几种（真·必须去挖的）
 *      · cells   —— 配方本身要摆几格（越少越省事）
 */
function scoreRecipe (bot, recipe, depth = MAX_CRAFT_DEPTH) {
  const cost = recipeCost(bot, recipe)
  let short = 0
  let blocked = 0
  for (const c of cost) {
    if (countItem(bot, c.name) >= c.count) continue
    short++
    if (!reachable(bot, c.name, c.count, depth, new Set())) blocked++
  }
  return { short, blocked, cells: cost.length }
}

/** 按"能不能真做出来"排序候选配方（最好的在前） */
function rankRecipes (bot, recipes, depth = MAX_CRAFT_DEPTH) {
  return recipes
    .map((r) => ({ r, s: scoreRecipe(bot, r, depth) }))
    .sort((a, b) => (a.s.blocked - b.s.blocked) || (a.s.short - b.s.short) || (a.s.cells - b.s.cells))
    .map((x) => x.r)
}

/** 安全取某物品的全部配方（出错/未知一律空数组，调用方不用 try） */
function safeRecipes (bot, name) {
  const it = itemOf(bot, name)
  if (!it) return []
  try { return usableRecipes(bot, it.id) } catch { return [] }
}

/** 背包物品总件数 —— 判断"这一轮到底有没有进展"（防补料锯齿死循环） */
function totalItems (bot) {
  try { return bot.inventory.items().reduce((s, i) => s + i.count, 0) } catch { return 0 }
}

/**
 * 列出一个物品**所有已知配方**（含"材料不够"的那些，用于缺口报告）。
 * @returns {Array<{recipe:any, cost:Array<{name:string,count:number}>, result:{name:string,count:number}, needsTable:boolean, canMake:boolean, shortfall:Array<{name:string,need:number,have:number}>}>}
 */
/**
 * 安全取某物品的**所有可用**配方（出错/未知一律空数组）。
 *
 * 🔴 要剔掉两类"不是工作台配方"的数据（2026-11-25 真机逐条核对过）：
 *    ① **结果是空气**（`result.id === 0`）：注册表里 `air` 居然挂了一条
 *       "paper×8 + filled_map → air" 的配方，纯属坏数据。不滤掉的话
 *       `mc_recipes{name:"air"}` 会报"空气能合成"，助理照着去凑纸和地图。
 *    ② 既没有 `inShape`（格子摆法）也没有 `ingredients`（无形状材料）的：
 *       没有任何材料信息，`bot.craft` 必然失败。
 *
 * ⚠️ 别用"`inShape` 为空就丢弃"这种粗暴判断 —— 木板 / 木棍 / 花岗岩这类
 *    **无形状配方**的 `inShape` 就是 `null`，靠 `ingredients` 描述材料
 *    （`oak_planks` = `[{id:134,count:-1}]`，`granite` = `[diorite, quartz]`）。
 *    早先版本按 `inShape` 判断，会把花岗岩、闪长岩这些真配方一起误杀。
 */
function usableRecipes (bot, itemId) {
  let all = []
  try { all = bot.recipesAll(itemId, null, true) ?? [] } catch { return [] }
  return all.filter((r) => {
    if (!r) return false
    // ① 产物是空气 = 坏数据
    if (Number(r.result?.id) === 0) return false
    // ② 至少要有材料信息，否则 bot.craft 无从下手
    const hasShape = Array.isArray(r.inShape) && r.inShape.length > 0
    const hasIngredients = Array.isArray(r.ingredients) && r.ingredients.length > 0
    return hasShape || hasIngredients
  })
}

export function listRecipes (bot, name) {
  const item = itemOf(bot, name)
  if (!item) throw new Error(`未知物品：${name}（要英文 id，如 oak_planks / stick / crafting_table）`)
  const inv = inventoryCounts(bot)
  const all = usableRecipes(bot, item.id)
  return all.map((recipe) => {
    const cost = recipeCost(bot, recipe)
    const shortfall = cost
      .map((c) => ({ name: c.name, need: c.count, have: inv[c.name] ?? 0 }))
      .filter((s) => s.have < s.need)
    return {
      result: recipeResult(bot, recipe),
      cost: cost.map(({ name: n, count }) => ({ name: n, count })),
      needsTable: recipeNeedsTable(recipe),
      canMake: shortfall.length === 0,
      shortfall,
      recipe,
    }
  })
}

/* ───────────────────────── 工作台获取 ───────────────────────── */

/**
 * 在半径内找最近的已加载工作台方块。返回 Block 实例或 null。
 * @param {any} bot
 * @param {number} [maxDistance]
 */
export function findCraftingTable (bot, maxDistance = 24) {
  try {
    return bot.findBlock({ matching: (blk) => blk?.name === CRAFTING_TABLE, maxDistance }) ?? null
  } catch { return null }
}

/** 把 Block 说成人话（纯 JSON） */
const blockPos = (blk) => (blk ? { x: blk.position.x, y: blk.position.y, z: blk.position.z } : null)

/* ───────────────────────── 主流程 ───────────────────────── */

/**
 * 合成某个物品到 `count` 个（**含自动补中间材料**）。
 *
 * 与"直接调 bot.craft"的区别（都是真机上被投诉过的点）：
 *   ① 材料不够时**递归去补**（原木→木板→木棍），而不是直接报 missing ingredient；
 *   ② 补不了就把**缺口清单**回给模型（差什么、差几个、从哪来），模型能据此先 mc_dig；
 *   ③ 台子自动找/放/造（见文件头三条途径）；
 *   ④ 每一步都**验证产物数量真的涨了**，不报假成功。
 *
 * @param {any} bot mineflayer bot（已在线）
 * @param {object} api 由 core 注入的最小能力集（保持本模块可独立测试）：
 *   `{ craftOnce, placeTable, tableAt, walkNear, settle }`
 *   —— 见 src/core.mjs 的 `#craftDeps()`；测试里可以塞假实现。
 * @param {string} name 目标物品（英文 id）
 * @param {number} [count] 想要几个
 * @param {{ useTable?: boolean, tablePos?: {x,y,z}|null, autoRefill?: boolean, maxDepth?: number }} [opts]
 */
export async function craftItem (bot, api, name, count = 1, opts = {}) {
  const target0 = String(name ?? '').trim()
  if (!target0) throw new Error('要给物品名（英文 id，如 oak_planks / stick / crafting_table）')
  if (!itemOf(bot, target0)) throw new Error(`未知物品：${target0}（要英文 id，如 oak_planks / stick / crafting_table）`)

  const maxDepth = Math.min(Math.max(Number(opts.maxDepth ?? MAX_CRAFT_DEPTH), 0), 8)
  const autoRefill = opts.autoRefill !== false
  /** 本次调用的完整动作日志（回给模型，便于它理解"它到底做了什么"） */
  const log = []
  /** 已经"自己放过"的台子（后续复用；记下来好回报） */
  const state = { placedTable: null, tablePos: null }

  const want0 = Math.max(1, Math.floor(Number(count) || 1))
  const start0 = countItem(bot, target0)
  if (start0 >= want0) {
    return {
      crafted: target0, requested: want0, made: 0, have: start0,
      note: `背包里已经有 ${start0} 个 ${target0}，不用再合成`,
      log,
    }
  }

  /**
   * 放台子 + **等它真的进世界**再返回（`null` = 放不出来）。
   *
   * 🔴 为什么必须等（2026-11-23 真机，偶发 1/4 失败）：`placeBlock` 返回 ok 只代表**本地发了包**，
   *    服务端确认 + 区块更新有几十到几百毫秒延迟。紧接着拿这个 Block 去 `bot.craft()`，
   *    mineflayer 会 `activateBlock` 一个"服务端还没认"的方块 ⇒ 服务端不理，静默没产出
   *    （更糟时死等 windowOpen 20 秒）。所以放完要**轮询确认方块已存在**，最多等 3 秒。
   *
   * ⚠️ 必须定义在 `craftItem` 顶层（**不能**塞进 `ensureTable`）——`run()` 里台子兜底重试也要用它。
   *    曾经因为塞进去，`run` 里报 `ReferenceError: placeAndWait is not defined`，
   *    而 `node --check` 抓不到（语法合法、运行期才炸）。
   */
  const placeAndWait = async () => {
    const placed = await api.placeTable()
    if (!placed?.ok) return null
    state.placedTable = CRAFTING_TABLE
    state.tablePos = placed.at ?? null
    log.push(`放了一个工作台 @ ${JSON.stringify(placed.at)}`)
    const want = placed.at
    for (let i = 0; i < 15; i++) {
      await api.settle?.()
      let blk = null
      try {
        blk = want
          ? bot.blockAt({ x: Math.floor(want.x), y: Math.floor(want.y), z: Math.floor(want.z) })
          : findCraftingTable(bot, 6)
      } catch { blk = findCraftingTable(bot, 6) }
      if (blk?.name === CRAFTING_TABLE) {
        // 🔴 客户端"看得见方块"≠"服务端已经认了它"（2026-11-25 真机踩到）。
        //    刚放下的那一刻，本地世界先有方块（乐观预测），服务端还在处理 place 包。
        //    这时立刻 activateBlock 开台子，服务端视角那格还是空气 ⇒ **静默不理会**，
        //    mineflayer 不抛错、只是没产出。
        //
        //    正确做法：**等服务端把这一格的 blockUpdate 推回来**（那是"服务端认了"的硬证据），
        //    而不是瞎等固定毫秒数（网络抖动会让它时好时坏，实测 5 轮里 3 轮翻车）。
        //    拿不到 blockUpdate（老版本/服务端不推）就退化成让出几个 tick。
        await api.settle?.()
        try {
          await api.waitBlockConfirmed?.(blk.position, 2_500)
        } catch { /* 等不到也继续，下面的重试能兜住 */ }
        return blk
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    // 没等到也别死磕：退回"按位置找最近的台子"
    return findCraftingTable(bot, 6) ?? null
  }

  /**
   * 拿一个可用的工作台（Block 实例）或 null（= 只能 2×2）。
   * `opts.useTable === false` 时不碰台子（强制 2×2，配方不允许就直接报错）。
   *
   * 🔴 关键：找到的台子必须**真的够得着**（≤4.5 格）才返回。
   *    2026-11-23 真机踩到：32 格内有个残留台子但走不过去（隔着墙/在洞里），
   *    把 Block 传进 `bot.craft()` 后它会去 `activateBlock`，然后死等 `windowOpen` 20 秒，
   *    最后抛 "Event windowOpen did not fire within timeout of 20000ms" —— 既慢又难懂。
   *    所以这里走不到就**换下一个候选**，全都不行就当作没有台子（自己放/自己造）。
   */
  const ensureTable = async (needed) => {
    if (!needed) return null
    if (opts.useTable === false) return null

    /** 到台子的距离够近吗（mineflayer 的手够长约 4.5 格） */
    const reachable = (blk) => {
      try {
        const me = bot.entity?.position
        return Boolean(me && blk?.position && me.distanceTo(blk.position) <= 4.5)
      } catch { return false }
    }

    /** 试着走到台子旁边；成功（够得着）返回它，否则 null */
    const tryUse = async (blk, label) => {
      if (!blk) return null
      if (reachable(blk)) return blk
      try {
        await api.walkNear(blockPos(blk), { arrive: 3, budget: 20_000 })
      } catch { /* 走不过去 */ }
      if (reachable(blk)) return blk
      log.push(`${label} 的台子 @ ${JSON.stringify(blockPos(blk))} 走不过去（还差 `
        + `${(() => { try { return bot.entity.position.distanceTo(blk.position).toFixed(1) } catch { return '?' } })()} 格），跳过`)
      return null
    }

    // ⓪ 用户指定了坐标：先确认那格真的是台子
    if (opts.tablePos) {
      const blk = api.tableAt?.(opts.tablePos) ?? null
      if (blk) {
        const ok = await tryUse(blk, '指定的')
        if (ok) return ok
      } else {
        log.push(`指定的工作台坐标 ${JSON.stringify(opts.tablePos)} 那格不是 ${CRAFTING_TABLE}，改走自动寻找`)
      }
    }
    // ① 附近现成的：**逐个试**（最近的先试，走不到就换下一个）
    let nearby = []
    try {
      const me = bot.entity?.position
      const found = (typeof bot.findBlocks === 'function')
        ? (bot.findBlocks({ matching: (x) => x?.name === CRAFTING_TABLE, maxDistance: 32, count: 6 }) ?? [])
        : []
      nearby = found
        .map((p) => { try { return bot.blockAt(p) } catch { return null } })
        .filter((b) => b?.name === CRAFTING_TABLE)
        .sort((a, c) => (me ? a.position.distanceTo(me) - c.position.distanceTo(me) : 0))
    } catch { /* 找不到就算了，走放台子那条路 */ }
    for (const blk of nearby) {
      const ok = await tryUse(blk, '附近')
      if (ok) return ok
    }

    // ② 背包里有台子 → 放一个
    if (countItem(bot, CRAFTING_TABLE) > 0) {
      const table2 = await placeAndWait()
      if (table2) return table2
    }
    // ③ 连台子都没有 → 先合成一个（4 个木板，2×2 就够）
    if (autoRefill && countItem(bot, CRAFTING_TABLE) === 0) {
      try {
        const made = await run(CRAFTING_TABLE, 1, maxDepth - 1, null, { useTable: false })
        log.push(`先合成了工作台：${made.made} 个`)
      } catch (e) {
        log.push(`合不出工作台：${e.message}`)
      }
      if (countItem(bot, CRAFTING_TABLE) >= 1) {
        const table3 = await placeAndWait()
        if (table3) return table3
      }
    }
    return null
  }

  /**
   * 真正把材料凑齐：不够就递归合成（自动补中间材料）。
   *
   * 🔴 为什么是"**轮转补料**"而不是"把缺口挨个补一遍"（2026-11-23 真机踩到，1.21.11）：
   *    合成木镐要 `3 木板 + 2 木棍`，而木棍本身要耗木板。背包有 2 木板 0 木棍时：
   *      ① 补木板（2→3）；② 补木棍 —— 做 2 根木棍正好**吃掉那 1 块木板** ⇒ 回头木板又只剩 2，
   *      最后报"oak_planks 差 1"（明明还有原木）。
   *    共享原料在树状依赖里是常态，所以这里**每补一项就重新算一遍缺口，直到补齐或不再有进展**。
   *
   * @returns {Promise<{ok:boolean, gaps?:any[], made?:any[]}>}
   */
  const satisfy = async (recipe, times, depth) => {
    const cost = recipeCost(bot, recipe).map((c) => ({ ...c, count: c.count * times }))
    const gapsNow = () => cost
      .map((c) => ({ name: c.name, need: c.count, have: countItem(bot, c.name) }))
      .filter((g) => g.have < g.need)
      .map((g) => ({ ...g, missing: g.need - g.have }))

    if (!gapsNow().length) return { ok: true, made: [] }
    if (!autoRefill || depth >= maxDepth) return { ok: false, gaps: gapsNow() }

    const made = []
    /** 轮转上限：每次至少补成一项，理论上 depth 层足够；给点冗余防锯齿。 */
    for (let round = 0; round < 8; round++) {
      let gaps = gapsNow()
      if (!gaps.length) return { ok: true, made }

      // 先补"缺得最多"的？不 —— 先补**它自己不依赖别的缺口**的（能立刻做），
      // 这样每轮至少有一项净增长，避免"补 A 吃 B、补 B 吃 A"的空转。
      gaps = gaps.sort((a, b) => {
        const ra = rankRecipes(bot, safeRecipes(bot, a.name), MAX_CRAFT_DEPTH - depth)
        const rb = rankRecipes(bot, safeRecipes(bot, b.name), MAX_CRAFT_DEPTH - depth)
        const sa = ra[0] ? scoreRecipe(bot, ra[0], MAX_CRAFT_DEPTH - depth) : { blocked: 99, short: 99, cells: 99 }
        const sb = rb[0] ? scoreRecipe(bot, rb[0], MAX_CRAFT_DEPTH - depth) : { blocked: 99, short: 99, cells: 99 }
        return (sa.blocked - sb.blocked) || (sa.short - sb.short) || (b.missing - a.missing)
      })

      const gap = gaps[0]
      // 只有"有配方"的东西才尝试补；原木/圆石这类原料必须自己去挖
      const recipes = safeRecipes(bot, gap.name)
      if (!recipes.length) {
        // 这一项补不动：如果它是必须的原料，就如实报缺口（别白转）
        const blocked = gaps.filter((g) => safeRecipes(bot, g.name).length === 0)
        return { ok: false, gaps: blocked.length ? blocked : gaps }
      }

      const beforeTotal = totalItems(bot)
      // 🔴 逐个候选**真的试一遍**（不同木材的配方必须能兜住）：第一条补不动就换下一条。
      let done = null
      let bestGaps = gaps
      for (const cand of rankRecipes(bot, recipes, MAX_CRAFT_DEPTH - depth).slice(0, MAX_RECIPE_CANDIDATES)) {
        try {
          const res = await run(gap.name, gap.need, depth + 1, cand, null)
          if (res.have >= gap.need) { done = res; break }
        } catch (e) {
          // 记住"最像样的"缺口报告（缺口种类最少的那个）
          if (Array.isArray(e?.gaps) && e.gaps.length && e.gaps.length <= bestGaps.length) bestGaps = e.gaps
        }
      }
      if (!done) {
        // 这一项彻底补不出来；如果别的项还有救就继续轮转，否则报缺口
        const remaining = gapsNow().filter((g) => g.name !== gap.name)
        if (!remaining.length || totalItems(bot) === beforeTotal) return { ok: false, gaps: bestGaps }
        continue
      }
      made.push({ name: gap.name, made: done.made, have: done.have })
      log.push(`自动补材料：${gap.name} +${done.made}（现在 ${done.have}）`)
    }

    // 轮转用尽还没补齐 → 如实报缺口
    const still = gapsNow()
    return still.length ? { ok: false, gaps: still } : { ok: true, made }
  }

  /**
   * 把 `targetName` 合到 `want` 个。
   * @param {any|null} forcedRecipe 指定配方（递归补料时用；null = 自己挑最好的一条）
   * @param {{useTable?:boolean}|null} overrides 临时覆盖（合台子时强制 2×2）
   */
  const run = async (targetName, want, depth, forcedRecipe, overrides) => {
    const item = itemOf(bot, targetName)
    if (!item) throw new Error(`未知物品：${targetName}`)
    const useTable = overrides?.useTable ?? opts.useTable
    const have = () => countItem(bot, targetName)
    const before = have()
    let table = null
    let iterations = 0

    while (have() < want) {
      if (iterations++ >= MAX_CRAFT_ITERATIONS) {
        log.push(`达到单次合成的迭代上限（${MAX_CRAFT_ITERATIONS}），停止`)
        break
      }
      // 每轮重新取配方（背包变了，可用配方也变）
      let recipes = []
      if (forcedRecipe) recipes = [forcedRecipe]
      else {
        try { recipes = usableRecipes(bot, item.id) } catch (e) {
          log.push(`读配方失败：${e.message}`); break
        }
      }
      if (!recipes.length) {
        const err = new Error(`没有 ${targetName} 的已知配方（它是原料、或只能在工作站做：切石机 / 锻造台等）`)
        err.gaps = []
        throw err
      }

      // 需要台子就先备台子（台子只备一次，后续复用）
      if (recipes.some(recipeNeedsTable) && useTable !== false) table = table ?? await ensureTable(true)

      const usable = recipes.filter((r) => !recipeNeedsTable(r) || (useTable !== false && table))
      if (!usable.length) {
        const err = new Error(`${targetName} 需要工作台，但没找到也放不出台子（背包里没有 ${CRAFTING_TABLE}，且合不出）`)
        err.gaps = [{ name: CRAFTING_TABLE, need: 1, have: 0, missing: 1 }]
        throw err
      }
      // 挑一条最可能落地的配方（打分见 scoreRecipe 的注释）
      const chosen = forcedRecipe ?? rankRecipes(bot, usable)[0]
      if (!chosen) {
        const err = new Error(`找不到能合成 ${targetName} 的配方`)
        err.gaps = []
        throw err
      }

      const per = Math.max(recipeResult(bot, chosen).count, 1)
      const times = Math.max(1, Math.ceil((want - have()) / per))

      const prep = await satisfy(chosen, times, depth)
      if (!prep.ok) {
        const err = new Error(`材料不够，合不出 ${targetName}：`
          + prep.gaps.map((g) => `${g.name} 差 ${g.missing ?? (g.need - g.have)}（要 ${g.need}，有 ${g.have}）`).join('；'))
        err.gaps = prep.gaps
        err.craftLog = log
        throw err
      }

      let tableForCraft = recipeNeedsTable(chosen) ? (table ?? await ensureTable(true)) : null
      if (recipeNeedsTable(chosen) && !tableForCraft) {
        const err = new Error(`${targetName} 需要工作台，台子没准备好`)
        err.gaps = [{ name: CRAFTING_TABLE, need: 1, have: 0, missing: 1 }]
        throw err
      }

      const b4 = have()
      // ⚠️ 每个产物一次 craft（times 由我们控制，不用它的第二参：那个参数内部循环且不校验）
      for (let t = 0; t < times; t++) {
        if (have() >= want) break
        try {
          await api.craftOnce(chosen, tableForCraft)
        } catch (e) {
          // 🔴 台子"看着有、其实用不了"（走不过去/被方块挡住/区块卸载）时，mineflayer 会死等
          //    windowOpen 20 秒再抛错。这里**降级重试一次**：丢掉这个台子，自己现放一个。
          const why = String(e?.message ?? e)
          if (tableForCraft && /windowOpen|timed? ?out|timeout/i.test(why) && autoRefill) {
            log.push(`台子 @ ${JSON.stringify(blockPos(tableForCraft))} 用不了（${why.slice(0, 80)}），改自己放一个`)
            table = null
            tableForCraft = await placeAndWait()
            if (tableForCraft) {
              log.push(`放了新台子 @ ${JSON.stringify(blockPos(tableForCraft))}，重试`)
              await api.craftOnce(chosen, tableForCraft)
            } else { throw e }
          } else { throw e }
        }
        await api.settle?.()
        if (have() <= b4 + t * per) {
          // 🔴 没产出 —— mineflayer 的 craft 有时**不抛错**、只是静默没做（服务端不回 ack）。
          //    原因和对应处理（2026-11-25 真机逐个验过）：
          //
          //    ① **刚放下的台子还没被服务端认**：`placeBlock` 只看客户端世界有没有方块，
          //       服务端还在处理 place 包。此时 activateBlock 打过去，服务端视角那格还是空气。
          //       ⇒ 先**关掉缓存的窗口**（关键！mineflayer 的 craft 插件把台子窗口缓存在闭包里，
          //          不关就永远不会重新 activateBlock，只会对着旧窗口点格子），同一台子再来一次。
          //    ② 台子**真的坏了**（幽灵方块 / 区块回滚 / 被别的插件占着）：重试没用，
          //       才拆掉自己放一个新的。
          //
          //    ⚠️ 别再想"预开窗口探测服务端"——试过更糟：craft 插件的 windowOpen 监听会被抢，
          //       缓存指向已关窗口，5 轮里 3 轮直接失败。
          if (tableForCraft && autoRefill) {
            const samePos = blockPos(tableForCraft)
            let got = false
            // ① 关窗口 + 同一台子重试（最多 2 次：第一次多半是服务端还没认）
            for (let k = 0; k < 2 && !got; k++) {
              log.push(`用台子 @ ${JSON.stringify(samePos)} 合成 ${targetName} 没产出，关窗后同一台子重试（${k + 1}/2）`)
              try { await api.closeCraftWindow?.() } catch { /* 没窗口就算了 */ }
              await api.settle?.()
              await new Promise((r) => setTimeout(r, 200))
              try {
                await api.craftOnce(chosen, tableForCraft)
                await api.settle?.()
                got = have() > b4 + t * per
              } catch { /* 抛错了就走下一步 */ }
            }

            // ② 还不行 = 台子真坏了 → 拆掉换新的
            if (!got) {
              log.push(`台子 @ ${JSON.stringify(samePos)} 确实用不了，拆掉换新的重试`)
              try {
                await api.breakBlock?.(samePos)
                await api.settle?.()
              } catch { /* 拆不掉也没关系，下面会找别的空位 */ }
              table = null
              const fresh = await placeAndWait()
              if (fresh) {
                tableForCraft = fresh
                log.push(`放了新台子 @ ${JSON.stringify(blockPos(fresh))}，重试`)
                // 旧窗口（对应刚拆掉的台子）不清掉，新台子也不会被 activateBlock
                try { await api.closeCraftWindow?.() } catch { /* 没窗口就算了 */ }
                await api.craftOnce(chosen, fresh)
                await api.settle?.()
              }
            }
          }
          if (have() <= b4 + t * per) break   // 还是没涨 = 真失败，别空转
        }
      }
      if (have() <= b4) {
        log.push(`合成 ${targetName} 没有产出（服务端可能拒了；背包数量停在 ${have()}）`)
        break
      }
    }
    return { made: have() - before, have: have() }
  }

  await run(target0, want0, Number(opts._depth ?? 0), null, null)

  const end = countItem(bot, target0)
  return {
    crafted: target0,
    requested: want0,
    made: end - start0,
    have: end,
    ok: end >= want0,
    ...(end >= want0 ? {} : {
      note: `只合成出 ${end - start0} 个（目标 ${want0}）。可能是材料不足或服务端拒绝——看 log。`,
    }),
    table: state.placedTable ? { name: state.placedTable, at: state.tablePos } : null,
    log,
  }
}

/* ───────────────────────── 冶炼（同属"工作方块"能力） ───────────────────────── */

/** 燃料（1.13+ 的常规燃料，按"能烧几个"降序取前几档；够用即可，缺了会报给模型） */
export const FUELS = [
  { name: 'lava_bucket', burns: 100 },
  { name: 'coal_block', burns: 80 },
  { name: 'dried_kelp_block', burns: 20 },
  { name: 'blaze_rod', burns: 12 },
  { name: 'coal', burns: 8 },
  { name: 'charcoal', burns: 8 },
  { name: 'oak_planks', burns: 1.5 },
  { name: 'spruce_planks', burns: 1.5 },
  { name: 'birch_planks', burns: 1.5 },
  { name: 'jungle_planks', burns: 1.5 },
  { name: 'acacia_planks', burns: 1.5 },
  { name: 'dark_oak_planks', burns: 1.5 },
  { name: 'oak_log', burns: 1.5 },
  { name: 'stick', burns: 0.5 },
]

/**
 * 从背包里挑一种燃料。返回 `{name, count, burns, enough}` 或 null。
 * @param {any} bot
 * @param {number} needBurnTicks 需要烧几个物品（1 个物品 = 10 秒 = 200 tick = 1 "burn"）
 */
export function pickFuel (bot, needBurnTicks = 1) {
  const inv = inventoryCounts(bot)
  for (const f of FUELS) {
    if ((inv[f.name] ?? 0) > 0) {
      return { name: f.name, count: inv[f.name], burns: f.burns, enough: f.burns * inv[f.name] >= needBurnTicks }
    }
  }
  return null
}

/**
 * 缺口报告：为了合成 `name` 还差什么（**不实际合成**，只算账）。
 * 这就是"别让模型瞎猜"的那份清单。
 */
export function craftPlan (bot, name, count = 1) {
  const target = String(name ?? '').trim()
  const want = Math.max(1, Math.floor(Number(count) || 1))
  const item = itemOf(bot, target)
  if (!item) throw new Error(`未知物品：${target}`)
  const inv = inventoryCounts(bot)
  const have = inv[target] ?? 0
  if (have >= want) return { item: target, want, have, need: [], steps: [], note: '已经够了' }

  const steps = []
  const need = new Map()
  const visit = (n, qty, depth) => {
    const it = itemOf(bot, n)
    if (!it) { need.set(n, (need.get(n) ?? 0) + qty); return }
    const already = steps.filter((s) => s.output === n).reduce((a, s) => a + s.qty, 0)
    const cur = (inv[n] ?? 0) - already
    const missing = qty - Math.max(cur, 0)
    if (missing <= 0) return
    if (depth > MAX_CRAFT_DEPTH) { need.set(n, (need.get(n) ?? 0) + missing); return }
    let recipes = []
    try { recipes = usableRecipes(bot, it.id) } catch { recipes = [] }
    // 优先"递归到底真能做出来"且是 2×2 的那条（见 rankRecipes / reachable 的注释）
    const ranked = rankRecipes(bot, recipes, MAX_CRAFT_DEPTH - depth)
    const pick = ranked.find((r) => !recipeNeedsTable(r)) ?? ranked[0]
    if (!pick) { need.set(n, (need.get(n) ?? 0) + missing); return }
    const per = Math.max(recipeResult(bot, pick).count, 1)
    const times = Math.ceil(missing / per)
    steps.push({ output: n, qty: times * per, times, needsTable: recipeNeedsTable(pick), atDepth: depth })
    for (const c of recipeCost(bot, pick)) visit(c.name, c.count * times, depth + 1)
  }
  visit(target, want - have, 0)

  return {
    item: target,
    want,
    have,
    steps,
    need: [...need.entries()].map(([n, q]) => ({
      name: n, count: q, have: inv[n] ?? 0, missing: Math.max(q - (inv[n] ?? 0), 0),
    })),
    note: 'need = 必须自己搞到的原料（挖/捡/买）；steps = 中间合成顺序',
  }
}

export default {
  craftItem, craftPlan, listRecipes, findCraftingTable, countItem, inventoryCounts,
  pickFuel, FUELS, CRAFTING_TABLE, FURNACE_NAMES, MAX_CRAFT_DEPTH,
}
