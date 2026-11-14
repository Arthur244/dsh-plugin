import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

function freshSession({ header = {}, events = [], firstLiveSeq = 0, inheritedEventCount = 0 } = {}) {
  const log = [...events]
  return {
    header: { id: 'root', isSeeded: false, ...header },
    firstLiveSeq,
    inheritedEventCount,
    snapshotEvents: () => log,
    append: (type, data) => log.push({ type, data }),
  }
}

function harness({ enabled = true, available = true } = {}) {
  const listeners = new Map()
  const cleanups = []
  const writes = []
  const warnings = []
  const order = []
  const setting = { value: enabled }
  const ctx = {
    on(event, listener, options = {}) {
      const row = { listener, options }
      const rows = listeners.get(event) ?? []
      if (options.prepend) rows.unshift(row)
      else rows.push(row)
      listeners.set(event, rows)
      const remove = () => { const index = rows.indexOf(row); if (index !== -1) rows.splice(index, 1) }
      cleanups.push(remove)
      return remove
    },
    effect(callback) {
      const cleanup = callback()
      cleanups.push(cleanup)
      return cleanup
    },
    permissionPresets: {
      resolve(name) {
        assert.equal(name, 'auto')
        if (!available) throw new Error('permission: unknown preset auto')
      },
      set(session, preset) {
        writes.push({ session, preset })
        order.push('auto-default')
        session.append('permission/preset', { preset })
        session.append('sandbox/mode', { mode: 'danger-full-access' })
        session.append('approval/policy', { policy: 'ask' })
      },
    },
    logger: { warn: message => warnings.push(message) },
  }
  // The real permission owner registers this before the injected plugin becomes active.
  ctx.on('agent/created', ({ agent }) => {
    order.push('official-pin')
    const session = agent.session
    if (!session.snapshotEvents().some(event => event.type === 'permission/preset')) {
      session.append('permission/preset', { preset: 'workspace-write' })
    }
  }, { prepend: true })
  apply(ctx, { defaultAutoReview: { get: () => setting.value } })
  const callback = listeners.get('agent/created')[0].listener
  const emit = (event, payload) => {
    for (const row of [...(listeners.get(event) ?? [])]) row.listener(payload)
  }
  return {
    writes, warnings, order, setting, listeners, callback,
    emit,
    create: (session, source = 'startup', signal) => emit('agent/created', { agent: { session }, source, signal }),
    dispose: () => { for (const cleanup of [...cleanups].reverse()) cleanup?.() },
  }
}

test('fresh root gets Auto synchronously before the official initial pin', () => {
  const h = harness()
  const session = freshSession()
  h.create(session)
  assert.deepEqual(h.order, ['auto-default', 'official-pin'])
  assert.equal(h.writes.length, 1)
  assert.equal(session.snapshotEvents().find(event => event.type === 'approval/policy').data.policy, 'ask')
  assert.deepEqual(h.listeners.get('agent/created')[0].options, { global: true, prepend: true })
  assert.equal(h.listeners.has('session/created'), false)
})

test('disabled default leaves the official initial pin in control', () => {
  const h = harness({ enabled: false })
  h.create(freshSession())
  assert.equal(h.writes.length, 0)
  assert.deepEqual(h.order, ['official-pin'])
})

test('live setting changes affect only subsequent eligible creations', () => {
  const h = harness({ enabled: false })
  const first = freshSession()
  h.create(first)
  h.setting.value = true
  const second = freshSession({ header: { id: 'second' } })
  h.create(second)
  h.setting.value = false
  h.create(freshSession({ header: { id: 'third' } }))
  assert.deepEqual(h.writes.map(write => write.session.header.id), ['second'])
  assert.equal(first.snapshotEvents()[0].data.preset, 'workspace-write')
})

for (const [name, options] of [
  ['subagent before descriptor exists', { header: { origin: 'subagent' } }],
  ['parent-linked session without origin', { header: { parentSession: 'parent' } }],
  ['seeded session', { header: { isSeeded: true } }],
  ['inherited prefix even without seeded flag', { inheritedEventCount: 1 }],
  ['restored log even without permission events', { firstLiveSeq: 1, events: [{ type: 'request/header' }] }],
]) {
  test(`does not default ${name}`, () => {
    const h = harness()
    h.create(freshSession(options))
    assert.equal(h.writes.length, 0)
  })
}

for (const source of ['resume', 'clear', 'compact']) {
  test(`does not apply startup defaults for ${source}`, () => {
    const h = harness()
    h.create(freshSession(), source)
    assert.equal(h.writes.length, 0)
  })
}

for (const [type, data] of [
  ['permission/preset', { preset: 'workspace-write' }],
  ['permission/preset', { preset: 'auto' }],
  ['approval/policy', { policy: 'never' }],
  ['sandbox/mode', { mode: 'read-only' }],
]) {
  test(`preserves existing ${type}: ${JSON.stringify(data)}`, () => {
    const h = harness()
    const session = freshSession({ events: [{ type, data }] })
    h.create(session)
    assert.equal(h.writes.length, 0)
    assert.deepEqual(session.snapshotEvents()[0], { type, data })
  })
}

test('factory setup permissions are preserved at agent creation', () => {
  const h = harness()
  const session = freshSession()
  h.emit('session/created', session)
  session.append('approval/policy', { policy: 'never', source: 'delegation' })
  h.create(session)
  assert.equal(h.writes.length, 0)
  assert.equal(session.snapshotEvents().filter(event => event.type === 'approval/policy').length, 1)
})

test('Auto plus never remains unchanged for delegated subagent', () => {
  const h = harness()
  const session = freshSession({ header: { origin: 'subagent', parentSession: 'parent' }, events: [
    { type: 'sandbox/mode', data: { mode: 'danger-full-access', source: 'delegation' } },
    { type: 'approval/policy', data: { policy: 'never', source: 'delegation' } },
    { type: 'permission/preset', data: { preset: 'auto' } },
  ] })
  const before = [...session.snapshotEvents()]
  h.create(session)
  assert.equal(h.writes.length, 0)
  assert.deepEqual(session.snapshotEvents(), before)
})

test('repeated announcement cannot reapply the default', () => {
  const h = harness()
  const session = freshSession()
  h.create(session)
  h.create(session)
  assert.equal(h.writes.length, 1)
})

test('cancelled creation does not change permission state', () => {
  const h = harness()
  const controller = new AbortController()
  controller.abort()
  h.create(freshSession(), 'startup', controller.signal)
  assert.equal(h.writes.length, 0)
})

test('missing Auto logs a warning without changing permissions', () => {
  const h = harness({ available: false })
  h.create(freshSession())
  assert.equal(h.writes.length, 0)
  assert.match(h.warnings[0], /Auto review is unavailable: permission: unknown preset auto/)
})

test('disposal between session and agent announcement leaves no delayed writes', async () => {
  const h = harness()
  const session = freshSession()
  h.emit('session/created', session)
  h.dispose()
  h.create(session)
  await Promise.resolve()
  assert.equal(h.writes.length, 0)
  assert.equal(h.listeners.get('agent/created').length, 0)
})

test('a callback captured before disposal cannot write after teardown', () => {
  const h = harness()
  const callback = h.callback
  h.dispose()
  callback({ agent: { session: freshSession() }, source: 'startup' })
  assert.equal(h.writes.length, 0)
})
