// -*- coding: utf-8 -*-
/**
 * dsh_minecraft_bot / check-lock-sync.mjs —— package-lock.json 与 package.json 是否同步
 * ============================================================================
 * 为什么单独有这个脚本（2026-11 真事）：
 *   给 `optionalDependencies` 加了五个 mineflayer 插件，只改了 package.json、忘了重生成 lock，
 *   于是 CI 的 `npm ci` 在**四个 job 上全红**，而原始报错只有一行
 *       npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.
 *       npm error Missing: mineflayer-pathfinder@2.4.5 from lock file
 *   看的人只知道"不同步"，不知道"该跑 npm install"。
 *
 * 这个脚本在 `npm ci` **之前**跑，直接给出缺哪几个包 + 修法。
 *
 * 🔴 用 .mjs 而不是写在 workflow 的 run: 里：CI 的 Windows runner 默认是 PowerShell，
 *    bash 的 `set -euo pipefail` 在 PowerShell 下会直接把这一步搞红（第一次就踩了）。
 *    写成 node 脚本，三个平台行为一致，本地也能跑。
 *
 * 只做**声明层面**的比对（不校验版本是否精确解析、不联网）：
 *   package.json 里 dependencies / optionalDependencies / devDependencies 声明的每个包，
 *   lock 的根条目（packages[""]）里必须有对应记录。
 * ============================================================================
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readJson (name) {
  try {
    return JSON.parse(readFileSync(join(ROOT, name), 'utf8'))
  } catch (e) {
    console.error(`❌ 读不到 / 解析不了 ${name}：${e?.message ?? e}`)
    process.exit(1)
  }
}

const pkg = readJson('package.json')
const lock = readJson('package-lock.json')

/** 三类依赖合并（同名以先出现的为准，与 npm 的合并语义一致） */
const want = {
  ...(pkg.devDependencies ?? {}),
  ...(pkg.optionalDependencies ?? {}),
  ...(pkg.dependencies ?? {}),
}

const rootEntry = lock.packages?.[''] ?? {}
const declared = {
  ...(rootEntry.devDependencies ?? {}),
  ...(rootEntry.optionalDependencies ?? {}),
  ...(rootEntry.dependencies ?? {}),
}

const missing = Object.keys(want).filter((name) => !declared[name])
const extra = Object.keys(declared).filter((name) => !(name in want))

// 包名本身也要一致（改过名的项目最容易漏：lock 里还留着旧名）
const nameMismatch = []

if (lock.name && pkg.name && lock.name !== pkg.name) nameMismatch.push(`lock.name=${lock.name} ≠ package.json name=${pkg.name}`)
if (rootEntry.name && pkg.name && rootEntry.name !== pkg.name) nameMismatch.push(`lock.packages[""].name=${rootEntry.name} ≠ ${pkg.name}`)

if (missing.length || nameMismatch.length) {
  for (const m of nameMismatch) console.error(`::error::${m}`)
  if (missing.length) {
    console.error(`::error::package-lock.json 与 package.json 不同步，缺少：${missing.join(', ')}`)
  }
  console.error('修法：在仓库根目录跑  npm install --package-lock-only  然后提交 package-lock.json')
  process.exit(1)
}

if (extra.length) {
  // 不算失败：lock 里可能留着刚移除的包（下次 npm install 会清）。
  // 但打出来，方便发现"从 package.json 删了依赖却没重生成 lock"。
  console.log(`⚠️ lock 里多出 ${extra.length} 条 package.json 已不再声明的项（不阻塞，重生成 lock 即清）：${extra.join(', ')}`)
}

console.log(`✅ lock 与 package.json 同步（package.json 声明 ${Object.keys(want).length} 条，包名 ${pkg.name}）`)
