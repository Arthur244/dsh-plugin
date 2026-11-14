import { Config } from './schema.js'

export const name = 'dsh-autorevivw-hold'
export const inject = ['permissionPresets', 'sessions']
export { Config }

/** Whether startup may supply a default without replacing an existing permission decision. */
function isFreshRoot(session, source) {
  const header = session.header
  if (source !== 'startup' || header.isSeeded !== false) return false
  if (header.origin === 'subagent' || header.parentSession !== undefined) return false
  if (session.firstLiveSeq !== 0 || session.inheritedEventCount !== 0) return false
  return !session.snapshotEvents().some((event) =>
    event.type === 'permission/preset'
    || event.type === 'sandbox/mode'
    || event.type === 'approval/policy')
}

/**
 * Apply the default only to fresh root agents, preserving delegated and restored permissions.
 * @param ctx - plugin context with the permissionPresets and sessions services.
 * @param config - validated plugin config (defaultAutoReview, skipAutoReviewWarning).
 */
export function apply(ctx, config) {
  let active = true
  ctx.effect(() => () => { active = false }, 'auto-review-default.lifecycle')

  // permissionPresets is already active, so its prepend listener is registered.
  // Our prepend runs first, after factory setup; its initial pin then preserves Auto.
  ctx.on('agent/created', ({ agent, source, signal }) => {
    if (!active || signal?.aborted || !config.defaultAutoReview.get()) return
    const session = agent.session
    if (!isFreshRoot(session, source)) return
    try {
      ctx.permissionPresets.resolve('auto')
      ctx.permissionPresets.set(session, 'auto')
    } catch (error) {
      ctx.logger.warn(`dsh-autorevivw-hold: Auto review is unavailable: ${error?.message ?? error}`)
    }
  }, { global: true, prepend: true })
}
