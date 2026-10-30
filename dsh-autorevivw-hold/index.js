import { Config } from './schema.js'

export const name = 'dsh-autorevivw-hold'
export const inject = ['permissionPresets', 'sessions']
export { Config }

/**
 * Apply the configured default to sessions created after the setting changes.
 * @param ctx - plugin context with the permissionPresets and sessions services.
 * @param config - validated plugin config (defaultAutoReview, skipAutoReviewWarning).
 */
export function apply(ctx, config) {
  const applyDefault = (session) => {
    if (!config.defaultAutoReview.get()) return
    try {
      // Throws when the experimental Auto integration is not active.
      ctx.permissionPresets.resolve('auto')
      ctx.permissionPresets.set(session, 'auto')
    } catch (error) {
      ctx.logger.warn(`dsh-autorevivw-hold: Auto review is unavailable: ${error?.message ?? error}`)
    }
  }

  ctx.on('session/created', (session) => {
    // Let the official permission owner finish its initial pin first.
    queueMicrotask(() => applyDefault(session))
  }, { global: true })
}
