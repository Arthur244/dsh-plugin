import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import { validateReviewChunks } from '../resilience.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const ref = value => ({ get: () => value })
const refs = values => Object.fromEntries(Object.entries({
  reviewProvider: 'review', reviewModel: 'r', retryAttempts: 1, timeoutMs: 30,
  fallbackTimeoutMs: 30, totalTimeoutMs: 200, fallbackProvider: '', fallbackModel: '', onFailure: 'ask', ...values,
}).map(([key, value]) => [key, ref(value)]))
const options = Object.freeze({ provider: 'session', model: 's', system: 'REVIEW_POLICY\npolicy', messages: [], sessionId: 'child', purpose: 'auto-review' })
function* text(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}
const deny = () => text('{"risk":"medium","decision":"deny","reason":"no"}')
const allow = () => text('{"risk":"low","decision":"allow"}')
const error = (code = 'TRANSPORT', status) => [{ type: 'finish', reason: { kind: 'error', failure: { code, message: 'fixture failure', ...(status ? { status } : {}) } } }]
async function drain(iterable) { const out = []; for await (const chunk of iterable) out.push(chunk); return out }
const decision = chunks => validateReviewChunks(chunks)
function fixture(adapter, values = {}) {
  let hook
  const calls = []
  const config = refs(values)
  const ctx = { on(event, listener) { assert.equal(event, 'llm/stream'); hook = listener }, llm: {
    stream(o) { return hook(o, () => { calls.push(o); return adapter(o) }) },
  } }
  apply(ctx, config)
  return { calls, config,
    stream: (changes = {}) => ctx.llm.stream({ ...options, ...changes }),
    run: (changes = {}) => drain(ctx.llm.stream({ ...options, ...changes })),
  }
}
async function bounded(work, ms = 600) {
  let timer
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('test operation hung')), ms) })]) }
  finally { clearTimeout(timer) }
}

test('valid deny is final, frozen input preserved, no recursive interception', async () => {
  const f = fixture(deny, { retryAttempts: 3 })
  assert.equal(decision(await f.run()).decision, 'deny')
  assert.equal(f.calls.length, 1)
  assert.equal(options.provider, 'session')
  assert.ok(Object.isFrozen(options))
})

test('primary failure falls back to session; no approval service is accessed', async () => {
  const f = fixture(o => o.provider === 'review' ? error() : allow())
  assert.equal(decision(await f.run()).decision, 'allow')
  assert.deepEqual(f.calls.map(o => o.provider), ['review', 'session'])
})

test('explicit backup and session routes are deduplicated against all tried routes', async () => {
  const f = fixture(() => error('NO_ADAPTER'), { fallbackProvider: 'review', fallbackModel: 'r', retryAttempts: 3 })
  assert.equal(decision(await f.run()).decision, 'deny')
  assert.deepEqual(f.calls.map(o => o.provider), ['review', 'session'])
})

test('same review/session route is tried once when retries disabled', async () => {
  const f = fixture(() => error(), { reviewProvider: 'session', reviewModel: 's' })
  assert.equal(decision(await f.run()).decision, 'deny')
  assert.equal(f.calls.length, 1)
})

for (const code of ['PERMISSION_DENIED', 'AUTH', 'NO_ADAPTER', 'INVALID_REQUEST']) {
  test(`${code} skips same-route retries but may try a distinct backup`, async () => {
    const f = fixture(() => error(code), { retryAttempts: 3 })
    await f.run()
    assert.deepEqual(f.calls.map(o => o.provider), ['review', 'session'])
  })
}

test('thrown errors preserve HTTP status for retry classification', async () => {
  const f = fixture(() => { throw Object.assign(new Error('forbidden'), { code: 'HTTP', status: 403 }) }, { retryAttempts: 3 })
  await f.run()
  assert.equal(f.calls.length, 2)
})

test('transient failure retries within budget then returns a valid decision', async () => {
  let count = 0
  const f = fixture(() => ++count === 1 ? error('RATE_LIMIT', 429) : allow(), { retryAttempts: 2, totalTimeoutMs: 1500 })
  assert.equal(decision(await bounded(f.run(), 2000)).decision, 'allow')
  assert.equal(f.calls.length, 2)
})

for (const invalid of [
  'not JSON', '{"risk":"high","decision":"allow"}', '{"risk":"low","decision":"deny"}',
  '{"risk":"low","risk":"medium","decision":"allow"}',
  '{"risk":"medium","decision":"deny","reason":3}',
  '{"risk":"low","decision":"allow","extra":true}',
]) {
  test(`invalid protocol falls back: ${invalid}`, async () => {
    const f = fixture(o => o.provider === 'review' ? text(invalid) : deny())
    assert.equal(decision(await f.run()).decision, 'deny')
    assert.deepEqual(f.calls.map(o => o.provider), ['review', 'session'])
  })
}

for (const chunks of [
  [{ type: 'text-delta', index: 0, text: '{"risk":"low","decision":"allow"}' }],
  [...allow()].map(c => c.type === 'finish' ? { type: 'finish', reason: { kind: 'max-tokens' } } : c),
  [...allow(), { type: 'usage', usage: {} }],
  [...allow()].filter(c => c.type !== 'finish').concat([...deny()].map(c => 'index' in c ? { ...c, index: 1 } : c)),
]) {
  test('invalid stream structure is rejected before returning success', async () => {
    const f = fixture(o => o.provider === 'review' ? chunks : deny())
    await f.run()
    assert.deepEqual(f.calls.map(o => o.provider), ['review', 'session'])
  })
}

test('delta-only output and authoritative block-end match canonical assembler', () => {
  assert.equal(decision([{ type: 'text-delta', index: 0, text: '{"risk":"low","decision":"allow"}' }, { type: 'finish', reason: { kind: 'stop' } }]).decision, 'allow')
  assert.equal(decision([...deny()].map(c => c.type === 'text-delta' ? { ...c, text: 'ignored because block-end is authoritative' } : c)).decision, 'deny')
})

test('uncooperative next() cannot block timeout or multiply orphan requests', async () => {
  let release, aborted = false
  const gate = new Promise(resolve => { release = resolve })
  const f = fixture(o => (async function* () {
    o.signal.addEventListener('abort', () => { aborted = true }, { once: true })
    await gate; yield* deny()
  })(), { retryAttempts: 3 })
  try {
    const result = await bounded(f.run())
    assert.equal(decision(result).decision, 'deny')
    assert.equal(f.calls.length, 1)
    assert.equal(aborted, true)
  } finally { release(); await sleep(0) }
})

test('error chunk followed by never-ending cleanup does not block fallback', async () => {
  let release, closed = 0
  const gate = new Promise(resolve => { release = resolve })
  const f = fixture(o => o.provider === 'review' ? { [Symbol.asyncIterator]() { return {
    next: async () => ({ done: false, value: error('NO_ADAPTER')[0] }),
    async return() { closed++; await gate; return { done: true } },
  } } } : deny())
  try {
    assert.equal(decision(await bounded(f.run())).decision, 'deny')
    assert.equal(closed, 1)
    assert.equal(f.calls.length, 2)
  } finally { release(); await sleep(0) }
})

test('total budget bounds retries, backoff and zero attempt caps', async () => {
  const f = fixture(() => error(), { retryAttempts: 3, totalTimeoutMs: 25, timeoutMs: 0, fallbackTimeoutMs: 0 })
  assert.equal(decision(await bounded(f.run())).decision, 'deny')
  assert.equal(f.calls.length, 1)
})

test('caller cancellation interrupts uncooperative stream without synthetic allow', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const f = fixture(() => (async function* () { await gate; yield* allow() })(), { onFailure: 'allow' })
  const controller = new AbortController()
  const pending = f.run({ signal: controller.signal })
  controller.abort()
  try { await assert.rejects(bounded(pending), error => error.cancelled === true) }
  finally { release(); await sleep(0) }
  assert.equal(f.calls.length, 1)
})

test('already cancelled request never dispatches or synthesizes a decision', async () => {
  const controller = new AbortController(); controller.abort()
  const f = fixture(allow, { onFailure: 'allow' })
  await assert.rejects(f.run({ signal: controller.signal }), error => error.cancelled === true)
  assert.equal(f.calls.length, 0)
})

test('cancellation during retry backoff stops fallback and final synthesis', async () => {
  const controller = new AbortController()
  const f = fixture(() => error(), { retryAttempts: 3, onFailure: 'allow' })
  const pending = f.run({ signal: controller.signal })
  await sleep(5); controller.abort()
  await assert.rejects(bounded(pending), error => error.cancelled === true)
  assert.equal(f.calls.length, 1)
})

test('oversized review output is bounded and cannot be treated as success', async () => {
  const f = fixture(o => o.provider === 'review' ? [{ type: 'text-delta', index: 0, text: 'x'.repeat(1024 * 1024 + 1) }] : deny())
  assert.equal(decision(await bounded(f.run())).decision, 'deny')
  assert.equal(f.calls.length, 2)
})

test('onFailure deny remains hard failure; allow is explicit fail-open', async () => {
  const closed = fixture(() => error('NO_ADAPTER'), { onFailure: 'deny' })
  await assert.rejects(closed.run(), /auto-review failed after retries/)
  const opened = fixture(() => error('NO_ADAPTER'), { onFailure: 'allow' })
  assert.equal(decision(await opened.run()).decision, 'allow')
})

test('normal requests and empty review route pass through', async () => {
  const f = fixture(allow)
  await f.run({ system: 'normal model request' })
  assert.equal(f.calls[0].provider, 'session')
  f.config.reviewModel = ref('')
  await f.run()
  assert.equal(f.calls[1].provider, 'session')
})

for (const synthetic of [false, true]) {
  test(`cancellation during ${synthetic ? 'synthetic' : 'buffered'} allow output is terminal`, async () => {
    const f = fixture(synthetic ? () => error('NO_ADAPTER') : allow, { onFailure: 'allow' })
    const controller = new AbortController()
    const iterator = f.stream({ signal: controller.signal })[Symbol.asyncIterator]()
    assert.equal((await iterator.next()).done, false)
    controller.abort()
    await assert.rejects(iterator.next(), error => error.cancelled === true)
  })
}
