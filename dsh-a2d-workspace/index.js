/**
 * `dsh-a2d-workspace` — 把外部（ACP/Zed 等）产生的持久会话按 cwd 自动归入
 * 桌面端的工作区（Workspace），让它们在会话侧栏里按工作区名分组显示。
 *
 * 根因：ACP profile 不挂载 workspace 服务，dsh-acp 也不会调用 workspaceRegistry，
 * 所以 Zed 里创建的会话虽然在 header 里带 cwd，但在桌面端的 workspace 表里没有归属，
 * 只能落入 "Ungrouped"。桌面端 workspaceRegistry 只做首次 bootstrap 归组，也没有
 * "自动按 cwd 给新会话归组" 的钩子。
 *
 * 本插件在桌面端（web profile）运行：启动时 + 定时 + 每次会话创建时，扫描
 * sessionPersistence 里所有根会话，按其 header.cwd 找到（或新建）对应 Workspace，
 * 并 attachSession。attach/create 均幂等，且不会改动已改过名的工作区标题。
 *
 * @module dsh-a2d-workspace
 */

import { isAbsolute } from 'node:path'

export const name = 'dsh-a2d-workspace'
export const inject = ['workspaceRegistry', 'sessionPersistence']

/** 根会话才会归组；子会话/subagent 与 ACP 的 session/list 语义保持一致，不挂进工作区。 */
function isGroupable(header) {
  if (header.origin === 'subagent') return false
  if (header.parentSession !== undefined) return false
  if (header.cwd === undefined || !isAbsolute(header.cwd)) return false
  return true
}

/** 扫描一次：把所有还没归属的根会话按 cwd 归入工作区。 */
async function reconcile(ctx) {
  const registry = ctx.workspaceRegistry
  const owned = new Set(registry.list().flatMap((workspace) => workspace.sessionIds))
  const snapshots = await ctx.sessionPersistence.list()
  for (const { header } of snapshots) {
    if (owned.has(header.id) || !isGroupable(header)) continue
    try {
      let workspace = await registry.resolveByPath(header.cwd)
      if (workspace === undefined) workspace = await registry.create(header.cwd)
      await workspace.attachSession(header.id)
      owned.add(header.id)
    } catch (error) {
      ctx.logger.warn(`dsh-a2d-workspace: session ${header.id} (cwd ${header.cwd}) 未归组: ${error?.message ?? error}`)
    }
  }
}

export function apply(ctx, config = {}) {
  const intervalMs = Number.isFinite(config.intervalMs) ? config.intervalMs : 30000
  const run = () => { void reconcile(ctx).catch((error) => ctx.logger.warn(`dsh-a2d-workspace: ${error?.message ?? error}`)) }

  ctx.on('session/created', () => run())
  run()
  ctx.effect(() => {
    const timer = setInterval(run, intervalMs)
    return () => clearInterval(timer)
  }, 'dsh-a2d-workspace.interval')
}

export default { name, inject, apply }
