// -*- coding: utf-8 -*-
/**
 * whale_craft / plugins.mjs —— 外部 mineflayer 插件集成层
 * ============================================================================
 * 目的：把社区那套"能力插件"接进本插件的机器人，而不是让用户自己写脚本。
 *
 *   · **mineflayer-pathfinder** —— 真正的寻路（爬楼梯/绕障碍/垫脚搭路）。所有需要"走到某处"的
 *     操作（合成台、采集、goto）在有它时走它，没有就退回 `core.walkTo`（手写走路，能用的老路）。
 *   · **mineflayer-tool**        —— **自动选最合适的工具**（按 digTime 排序，用到耐久/附魔）。
 *     本插件把它接进 `dig` / `breakBlock`：有它就一定比"背包里第一个能挖的"挖得快。
 *   · **mineflayer-auto-eat**    —— 自动进食（血量/饥饿阈值触发）。生存模式挂机必备。
 *   · **mineflayer-collectblock**—— 就近采集一批方块（自动走过去 + 挖）。
 *   · **mineflayer-pvp**         —— 自动反击/追击。
 *
 * 🔴 铁律：**这些包全部是可选依赖**。装不上、版本不兼容、加载抛错 —— 一律降级跳过 + 记一行日志，
 *    绝不让"某个社区插件没装"把整棵树搞挂（宿主是 fail-loud 的，一个 unhandled rejection 就 exit(1)）。
 *
 * 依赖解析锚点：优先从 **mineflayer 自己的 node_modules** 解析（和 minecraft-protocol /
 * prismarine-* 用同一份），解析不到才退回本包。这样"用户把插件装在 profile 层"和"装在插件包里"
 * 两种部署都成立，而且**同一个包只会被加载一次**（模块级缓存 ⇒ bot.loadPlugin 的 hasPlugin 去重有效）。
 * ============================================================================
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const requireHere = createRequire(import.meta.url)

/** 解析锚点（模块级算一次：保证同一个包在不同 bot 上拿到**同一个函数引用**，去重才成立） */
const ANCHOR = (() => {
  try { return createRequire(requireHere.resolve('mineflayer')) } catch { return requireHere }
})()

/**
 * 插件清单。字段含义：
 *   key       程序内标识（mc_plugins 里看到的名字）
 *   pkg       npm 包名
 *   export    CJS/ESM 里那个"plugin 函数"的导出名（`loader` 是 auto-eat 的叫法）
 *   property  bot 上出现的属性名（判断"装上了没有"就看它）
 *   needs     依赖的其它插件（按顺序先加载）
 *   esm       只是提示（真加载时以实际报错为准，见 loadOne）
 *   label     人话名字（报错/返回给模型用）
 */
export const PLUGIN_SPECS = [
  { key: 'pathfinder', pkg: 'mineflayer-pathfinder', export: 'pathfinder', property: 'pathfinder', label: '寻路' },
  { key: 'tool', pkg: 'mineflayer-tool', export: 'plugin', property: 'tool', needs: ['pathfinder'], label: '自动选工具' },
  { key: 'autoeat', pkg: 'mineflayer-auto-eat', export: 'loader', property: 'autoEat', esm: true, label: '自动进食' },
  { key: 'collectblock', pkg: 'mineflayer-collectblock', export: 'plugin', property: 'collectBlock', needs: ['pathfinder', 'tool'], label: '就近采集' },
  { key: 'pvp', pkg: 'mineflayer-pvp', export: 'plugin', property: 'pvp', needs: ['pathfinder'], label: '自动战斗' },
]

/** key → spec */
const SPEC_BY_KEY = new Map(PLUGIN_SPECS.map((s) => [s.key, s]))

/** 包名 → {path, mod} 缓存（**同一个模块实例**是 bot.loadPlugin 去重的前提） */
const modCache = new Map()

/** 从可用锚点解析包路径；解析不到返回 null（= 这个部署没装，正常降级） */
export function resolvePluginPath (pkg) {
  for (const req of [ANCHOR, requireHere]) {
    try { return req.resolve(pkg) } catch { /* 换下一个锚点 */ }
  }
  return null
}

/** 这个部署装了哪些插件（不加载、不连服，纯探测；给 mc_capabilities / mc_plugins 用） */
export function pluginAvailability () {
  const out = {}
  for (const spec of PLUGIN_SPECS) {
    const path = resolvePluginPath(spec.pkg)
    let version = null
    if (path) {
      try { version = ANCHOR(`${spec.pkg}/package.json`)?.version ?? null } catch {
        try { version = requireHere(`${spec.pkg}/package.json`)?.version ?? null } catch { version = null }
      }
    }
    out[spec.key] = { pkg: spec.pkg, label: spec.label, installed: Boolean(path), version }
  }
  return out
}

/** ESM 包用 require 会抛这个；据此决定要不要改走动态 import */
function isEsmRequireError (e) {
  const code = String(e?.code ?? '')
  const msg = String(e?.message ?? '')
  return code === 'ERR_REQUIRE_ESM'
    || /Cannot use import statement outside a module/.test(msg)
    || /must be loaded using the `import`/.test(msg)
    || /require\(\) of ES Module/.test(msg)
}

/**
 * 取一个插件的模块对象（带缓存）。
 * 先 `require`（绝大多数插件是 CJS），遇到 ESM 专用报错再 `import()` —— 两条路都拿同一个路径。
 */
async function getModule (spec) {
  if (modCache.has(spec.pkg)) return modCache.get(spec.pkg)
  const path = resolvePluginPath(spec.pkg)
  if (!path) { const miss = { missing: true }; modCache.set(spec.pkg, miss); return miss }
  let mod
  try {
    mod = ANCHOR(spec.pkg)
  } catch (e) {
    if (!isEsmRequireError(e)) throw e
    mod = await import(pathToFileURL(path).href)
  }
  const entry = { path, mod }
  modCache.set(spec.pkg, entry)
  return entry
}

/** 从模块对象里挑出 plugin 函数（兼容 CJS 的具名导出 / ESM 的 default 包装） */
function pickPluginFn (mod, exportName) {
  if (!mod) return null
  const candidates = [
    mod[exportName],
    mod?.default?.[exportName],
    typeof mod?.default === 'function' ? mod.default : null,
    typeof mod === 'function' ? mod : null,
  ]
  for (const c of candidates) if (typeof c === 'function') return c
  return null
}

/**
 * 🔴 **修 mineflayer-tool 的无限递归 OOM**（`mineflayer-tool@1.2.0`，2026-11-23 真机撞的）。
 *
 * 上游 `Tool.equipForBlock()` 在"背包里没有能采掘该方块的物品"且 `getFromChest:true` 时：
 *   ① `retrieveTools()` 拿 `chestLocations`（默认 `[]`）→ `while` 不进 → **什么都不做就 resolve**；
 *   ② 紧接着 `yield this.equipForBlock(block, options)` —— **原参数递归调自己**；
 *   ③ 于是 ①→②→①… 每圈都新建一层 promise 链 ⇒ 堆内存一路涨到 **OOM 杀进程**。
 *      （实测：512MB 堆 12 秒内打满；`getFromChest:false` 则立刻抛 `NoItem`，一切正常 —— A/B 对照确认。）
 *
 * 🔴 **这里是进程级事故**：OOM 不是"某个工具失败"，而是**整个 DSH 进程被内核杀掉**，
 *    用户看到的是"DSH 突然没了"。而 `mineflayer-collectblock` 内部正是用
 *    `{requireHarvest:true, getFromChest:true, maxTools:2}` 调它 ⇒ 一用 `mc_collect` 就炸。
 *
 * **修法**：给 `equipForBlock` 包一层守卫（我们只包一次，`_wcGuarded` 标记防重复）：
 *   - 没有可为空的箱子时**强制 `getFromChest:false`** —— 反正上游那分支也是空转，
 *     去掉它只会从"递归到炸"变成"正常抛 NoItem"；
 *   - 再加上递归深度保险（`maxTools` 那一项换成深度计数），异常情况也不至于把进程带走。
 * 这样**不动 node_modules**（不 patch 别人的包），也不影响有箱子时的正常行为。
 *
 * @param {import('mineflayer').Bot} bot
 */
export function guardToolPlugin (bot) {
  const tool = bot?.tool
  if (!tool || typeof tool.equipForBlock !== 'function') return false
  if (tool.__wcGuarded) return true
  const orig = tool.equipForBlock.bind(tool)
  let depth = 0
  tool.equipForBlock = async function (block, options = {}, cb) {
    // 回调式调用直接透传（上游自己也不推荐，别搅进来）
    if (typeof cb === 'function') return orig(block, options, cb)
    const opts = { ...options }
    // ① 没有箱子可拿 ⇒ 上游那分支只会空转递归，直接关掉
    const hasChests = Array.isArray(tool.chestLocations) && tool.chestLocations.length > 0
    if (opts.getFromChest && !hasChests) opts.getFromChest = false
    // ② 深度保险：真碰上别的递归路径也最多两层
    if (depth >= 2) {
      const err = new Error('equipForBlock 递归过深，已中止（防止耗尽内存）')
      err.name = 'ToolRecursionGuard'
      throw err
    }
    depth++
    try {
      return await orig(block, opts)
    } finally {
      depth--
    }
  }
  tool.__wcGuarded = true
  return true
}

/**
 * 把外部插件挂到一个 bot 上。**幂等**（已挂过就跳过）、**永不抛错**（失败进 report）。
 *
 * @param {import('mineflayer').Bot} bot
 * @param {{ only?: string[], log?: (line:string)=>void }} [opts]
 * @returns {Promise<{loaded:string[], skipped:Array<{key:string,reason:string}>, failed:Array<{key:string,error:string}>}>}
 */
export async function attachPlugins (bot, { only = null, log = () => {} } = {}) {
  const report = { loaded: [], skipped: [], failed: [] }
  if (!bot || typeof bot.loadPlugin !== 'function') {
    report.failed.push({ key: '*', error: '拿不到 bot.loadPlugin（bot 还没建好？）' })
    return report
  }
  const want = only ? new Set(only) : null
  const done = new Set()

  for (const spec of PLUGIN_SPECS) {
    if (want && !want.has(spec.key)) { report.skipped.push({ key: spec.key, reason: '未在本次加载列表里' }); continue }
    // 依赖没装上就别硬挂（pvp/collectblock 没 pathfinder 会在运行期莫名卡住）
    const missingDep = (spec.needs ?? []).find((k) => !done.has(k))
    if (missingDep) { report.skipped.push({ key: spec.key, reason: `依赖 ${missingDep} 没装上` }); continue }
    // 已经挂了（重复 attach / 插件自己内部加载过）
    if (bot[spec.property] != null) { done.add(spec.key); report.loaded.push(spec.key); continue }

    try {
      const entry = await getModule(spec)
      if (entry.missing) { report.skipped.push({ key: spec.key, reason: `没安装 ${spec.pkg}` }); continue }
      const fn = pickPluginFn(entry.mod, spec.export)
      if (!fn) { report.skipped.push({ key: spec.key, reason: `${spec.pkg} 里找不到 ${spec.export} 导出` }); continue }
      // loadPlugin 会把插件排队到 inject_allowed（还没到就晚一拍生效），不会同步抛
      bot.loadPlugin(fn)
      done.add(spec.key)
      report.loaded.push(spec.key)
      log(`外部插件已挂载：${spec.key}（${spec.pkg}）`)
    } catch (e) {
      // 🔴 单个插件挂不上绝不影响其它插件与整棵树
      report.failed.push({ key: spec.key, error: String(e?.message ?? e).slice(0, 200) })
      log(`外部插件挂载失败（已降级跳过）：${spec.key} —— ${String(e?.message ?? e).slice(0, 160)}`)
    }
  }
  // 🔴 挂完给 mineflayer-tool 加递归守卫（它有个会 OOM 的无限递归，详见 guardToolPlugin）
  try {
    if (guardToolPlugin(bot)) report.guarded = 'tool'
  } catch (e) {
    log(`给 tool 插件加守卫失败（不影响使用）：${String(e?.message ?? e).slice(0, 120)}`)
  }
  return report
}

/**
 * 当前 bot 上插件**实际**可用性（加载是异步生效的，所以按属性现查，不看上面那次 report）。
 * @param {import('mineflayer').Bot} bot
 */
export function pluginStatus (bot) {
  const avail = pluginAvailability()
  const out = {}
  for (const spec of PLUGIN_SPECS) {
    const a = avail[spec.key]
    const live = Boolean(bot && bot[spec.property] != null)
    out[spec.key] = {
      label: spec.label,
      pkg: spec.pkg,
      installed: a.installed,
      version: a.version,
      loaded: live,
      ...(spec.key === 'autoeat' && live ? { enabled: Boolean(bot.autoEat?.enabled), eating: Boolean(bot.autoEat?.isEating) } : {}),
    }
  }
  return out
}

/** 某个插件现在**能不能**用（加载是延迟的：刚 connect 完可能还没到 inject_allowed） */
export function hasPlugin (bot, key) {
  const spec = SPEC_BY_KEY.get(key)
  if (!spec) return false
  return Boolean(bot && bot[spec.property] != null)
}

/**
 * auto-eat 的开关/选项（**纯同步**，真调用在 core 里套超时）。
 * @param {any} bot
 * @param {{ action?: 'enable'|'disable'|'status'|'opts', opts?: object }} [args]
 */
export function autoEatControl (bot, { action = 'status', opts = null } = {}) {
  const ae = bot?.autoEat
  if (!ae) {
    const err = new Error('自动进食插件没加载（mineflayer-auto-eat 未安装或加载失败）；用 mc_plugins{action:"status"} 看详情')
    err.mcPluginMissing = true
    throw err
  }
  if (action === 'enable') ae.enableAuto()
  else if (action === 'disable') ae.disableAuto()
  else if (action === 'opts') {
    if (!opts || typeof opts !== 'object') throw new Error('opts 需要是对象，如 {"minHunger":16,"minHealth":16}')
    ae.setOpts(opts)
  } else if (action !== 'status') throw new Error(`未知 action："${action}"（可用 status / enable / disable / opts / eat）`)

  return {
    enabled: Boolean(ae.enabled),
    eating: Boolean(ae.isEating),
    opts: { ...ae.opts },
  }
}

/** 可调进食参数的白名单（`setOpts` 直接 Object.assign，喂错键会静默写脏 opts） */
export const AUTO_EAT_OPTS = Object.freeze([
  'priority', 'minHunger', 'minHealth', 'bannedFood', 'returnToLastItem',
  'offhand', 'eatingTimeout', 'strictErrors',
])
