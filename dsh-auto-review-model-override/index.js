/** Route only official Auto review requests; never change session permissions.
 * Verified against DSH 0.2.2-rc.3: llm/stream is a no-argument-next waterfall,
 * requests are frozen, and deny + approval=never is a final official rejection.
 */
import { Config } from './schema.js'
import { resilientStream } from './resilience.js'
import { reviewDispatch } from './review-dispatch.js'

export { Config }
export const name = 'auto-review-model-override'
export const inject = ['llm']

const REVIEW_POLICY_PREFIX = 'REVIEW_POLICY\n'
const OVERRIDDEN = Symbol.for('dsh-auto-review-model-override.applied')

function describeFailure(failure) {
  switch (failure?.code) {
    case 'TIMEOUT':
    case 'ABORTED': return 'review model did not respond in time'
    case 'BUDGET': return 'review total time budget exhausted'
    case 'NO_ADAPTER': return 'review model is not configured'
    case 'TRANSPORT': return 'cannot reach the review service'
    case 'RATE_LIMIT': return 'review service is rate limiting'
    case 'PROTOCOL': return 'review model returned an invalid decision'
    case 'BUFFER_LIMIT': return 'review model output exceeded the safety limit'
    case 'PI_AI_ERROR':
    case 'SERVER': return failure.status === 404 ? 'review model endpoint not found' : 'review service returned an error'
    default: return String(failure?.message ?? '').split('<')[0].replace(/\s+/g, ' ').trim().slice(0, 120) || 'review service unavailable'
  }
}

// 'ask' means a synthetic denial, not a direct approval request. The official
// gate keeps delegated children at never, and only interactive ask sessions may prompt.
function* synthesizeDecision(kind, detail) {
  const text = kind === 'allow'
    ? JSON.stringify({ risk: 'medium', decision: 'allow' })
    : JSON.stringify({ risk: 'medium', decision: 'deny', reason: `review model unavailable (${detail})` })
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

export function apply(ctx, config) {
  ctx.on('llm/stream', (options, next) => {
    if (typeof options.system !== 'string' || !options.system.startsWith(REVIEW_POLICY_PREFIX)) return next()
    if (options[OVERRIDDEN] === true) return reviewDispatch(ctx.llm, options, next)
    // Empty selectors keep the session route, not the inherited effort.
    const reviewOptions = { ...options, [OVERRIDDEN]: true }
    delete reviewOptions.reasoningEffort
    if (config.reviewProvider.get() === '' || config.reviewModel.get() === '') return ctx.llm.stream(reviewOptions)
    const policy = config.onFailure.get()
    const onExhausted = (failure) => {
      const detail = describeFailure(failure)
      ctx.logger?.warn?.(`auto-review-model-override: session=${options.sessionId ?? 'unknown'} exhausted (${failure?.code ?? 'unknown'}); policy=${policy}`)
      if (policy === 'deny') return new Error(`auto-review failed after retries: ${detail}`)
      return synthesizeDecision(policy === 'allow' ? 'allow' : 'deny', detail)
    }
    return resilientStream(ctx, reviewOptions, config, options.signal, onExhausted)
  })
}
