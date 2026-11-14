// DSH 0.2.2-rc.3: auto-review readDecision/parseDecision and BlockAssembler contracts.
// No permission changes or approval requests belong at this LLM middleware seam.
const DEFAULT_TOTAL_MS = 120000
const MAX_CHUNKS = 8192
const MAX_BYTES = 1024 * 1024

function cancelled(signal) {
  const error = new Error('auto-review cancelled by the caller', { cause: signal?.reason })
  error.cancelled = true
  return error
}

function checkCancelled(signal) {
  if (signal?.aborted) throw cancelled(signal)
}

function normalizeFailure(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : 'THROWN',
    message: error instanceof Error ? error.message : String(error?.message ?? error),
    ...(Number.isInteger(error?.status) ? { status: error.status } : {}),
  }
}

function mayRetry(failure) {
  if (failure.status !== undefined) return failure.status === 408 || failure.status === 429 || failure.status >= 500
  return ['TIMEOUT', 'TRANSPORT', 'RATE_LIMIT', 'SERVER', 'ABORTED'].includes(failure.code)
}

/** Validate with the same delta-only/first-close rules as the canonical assembler. */
export function validateReviewChunks(chunks) {
  const partials = new Map()
  let finished = false
  const ensure = (index, type) => {
    if (!partials.has(index)) partials.set(index, { type, text: '' })
    return partials.get(index)
  }
  for (const chunk of chunks) {
    if (finished) throw new Error('reviewer emitted data after terminal finish')
    switch (chunk.type) {
      case 'block-start': ensure(chunk.index, chunk.blockType); break
      case 'text-delta':
      case 'reasoning-delta': {
        const partial = ensure(chunk.index, chunk.type === 'text-delta' ? 'text' : 'reasoning')
        if (!partial.block) partial.text += chunk.text
        break
      }
      case 'block-end': {
        const partial = ensure(chunk.index, chunk.block.type)
        partial.block ??= chunk.block
        break
      }
      case 'usage': break
      case 'finish':
        if (chunk.reason?.kind !== 'stop') throw new Error('reviewer must finish with stop')
        finished = true
        break
      default: throw new Error('unexpected reviewer chunk')
    }
  }
  if (!finished) throw new Error('reviewer emitted no terminal finish')
  const blocks = [...partials.values()].map(partial => partial.block ?? partial)
  const final = blocks.at(-1)
  if (final?.type !== 'text' || blocks.slice(0, -1).some(block => block.type !== 'reasoning')) {
    throw new Error('reviewer must emit reasoning* followed by exactly one text block')
  }
  const decision = JSON.parse(final.text)
  // JSON.parse alone silently accepts duplicate keys; official parseDecision rejects them.
  let depth = 0, quoted = false, escaped = false, members = 0
  for (const char of final.text) {
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') depth--
    else if (char === ':' && depth === 1) members++
  }
  if (decision !== null && typeof decision === 'object' && members !== Object.keys(decision).length) throw new Error('review decision repeats a JSON member')
  if (decision === null || typeof decision !== 'object' || Array.isArray(decision)) throw new Error('review decision must be an object')
  const keys = Object.keys(decision)
  const validAllow = decision.decision === 'allow' && ['low', 'medium'].includes(decision.risk)
    && keys.length === 2 && keys.every(key => ['risk', 'decision'].includes(key))
  const validDeny = decision.decision === 'deny' && ['medium', 'high'].includes(decision.risk)
    && keys.every(key => ['risk', 'decision', 'reason'].includes(key))
    && (keys.length === 2 || (keys.length === 3 && typeof decision.reason === 'string'))
  if (!validAllow && !validDeny) throw new Error('invalid review decision shape or risk combination')
  return decision
}

/** Abort the producer AND bound the consumer. Cleanup is observed, never awaited. */
async function collectAttempt(ctx, options, signal, timeoutMs) {
  checkCancelled(signal)
  const controller = new AbortController()
  const merged = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  let iterator
  let done = false
  let waiting = false
  let interruptedFailure
  let rejectInterrupt
  const interrupted = new Promise((_, reject) => { rejectInterrupt = reject })
  // A cancellation may happen before the first race attaches.
  void interrupted.catch(() => {})
  const interrupt = (failure) => {
    interruptedFailure = failure
    rejectInterrupt(failure)
    controller.abort(failure)
  }
  const onAbort = () => interrupt(cancelled(signal))
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  const timer = setTimeout(() => interrupt({ code: 'TIMEOUT', message: `review attempt exceeded ${timeoutMs}ms` }), timeoutMs)
  const chunks = []
  let bytes = 0
  try {
    checkCancelled(signal)
    const stream = ctx.llm.stream({ ...options, signal: merged })
    iterator = stream[Symbol.asyncIterator]?.() ?? stream[Symbol.iterator]?.()
    if (!iterator) throw new TypeError('review stream is not iterable')
    while (true) {
      checkCancelled(signal)
      waiting = true
      const pending = Promise.resolve().then(() => iterator.next())
      // Keep observing a producer that ignores abort, without delaying this call.
      void pending.then(() => { waiting = false }, () => { waiting = false })
      const item = await Promise.race([pending, interrupted])
      checkCancelled(signal)
      if (item.done) { done = true; break }
      const chunk = item.value
      if (chunk.type === 'finish' && ['error', 'aborted'].includes(chunk.reason?.kind)) {
        return { failure: normalizeFailure(chunk.reason.failure), pending: false }
      }
      bytes += Buffer.byteLength(JSON.stringify(chunk), 'utf8')
      if (chunks.length >= MAX_CHUNKS || bytes > MAX_BYTES) {
        return { failure: { code: 'BUFFER_LIMIT', message: 'review output exceeded bounded buffer' }, pending: false }
      }
      chunks.push(chunk)
    }
    try { validateReviewChunks(chunks) } catch (error) {
      return { failure: { code: 'PROTOCOL', message: error.message }, pending: false }
    }
    return { chunks }
  } catch (error) {
    checkCancelled(signal)
    return { failure: normalizeFailure(interruptedFailure ?? error), pending: waiting }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    if (!done) {
      controller.abort()
      // AsyncIteratorClose can hang too. Do not put it on the decision's critical path.
      void Promise.resolve().then(() => iterator?.return?.()).catch(() => {})
    }
  }
}

async function pause(ms, signal) {
  checkCancelled(signal)
  await new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve() }
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(cancelled(signal)) }
    const timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

/** A bounded route plan. Valid denials are final decisions, never technical failures. */
export async function* resilientStream(ctx, options, config, signal, onExhausted) {
  const read = (key, fallback) => config[key]?.get?.() ?? fallback
  const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback
  const totalMs = positive(read('totalTimeoutMs', DEFAULT_TOTAL_MS), DEFAULT_TOTAL_MS)
  const deadline = performance.now() + totalMs
  const attempts = Math.min(10, Math.max(1, Math.trunc(read('retryAttempts', 3))))
  const routes = [
    { provider: read('reviewProvider', ''), model: read('reviewModel', ''), attempts, timeout: read('timeoutMs', 30000) },
    { provider: read('fallbackProvider', ''), model: read('fallbackModel', ''), attempts: 1, timeout: read('fallbackTimeoutMs', 60000) },
    { provider: options.provider, model: options.model, attempts: 1, timeout: read('fallbackTimeoutMs', 60000) },
  ]
  const seen = new Set()
  let lastFailure = { code: 'BUDGET', message: 'review total deadline exceeded' }
  let stop = false
  for (const route of routes) {
    checkCancelled(signal)
    if (!route.provider || !route.model) continue
    const key = JSON.stringify([route.provider, route.model])
    if (seen.has(key)) continue
    seen.add(key)
    for (let attempt = 1; attempt <= route.attempts; attempt++) {
      checkCancelled(signal)
      const remaining = deadline - performance.now()
      if (remaining <= 0) { lastFailure = { code: 'BUDGET', message: 'review total deadline exceeded' }; stop = true; break }
      const limit = Math.min(positive(route.timeout, remaining), remaining)
      const result = await collectAttempt(ctx, { ...options, provider: route.provider, model: route.model }, signal, limit)
      checkCancelled(signal)
      if (result.chunks) {
        for (const chunk of result.chunks) { checkCancelled(signal); yield chunk }
        checkCancelled(signal)
        return
      }
      lastFailure = result.failure
      // Do not multiply orphan requests when a producer ignored cancellation.
      if (result.pending) { stop = true; break }
      if (!mayRetry(lastFailure) || attempt === route.attempts) break
      const backoff = Math.min(300 * 2 ** (attempt - 1), Math.max(0, deadline - performance.now()))
      await pause(backoff, signal)
    }
    if (stop) break
  }
  checkCancelled(signal)
  const outcome = onExhausted(lastFailure)
  if (outcome instanceof Error) throw outcome
  for (const chunk of outcome) { checkCancelled(signal); yield chunk }
  checkCancelled(signal)
}
