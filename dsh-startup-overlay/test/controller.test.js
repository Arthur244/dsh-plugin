import assert from 'node:assert/strict'
import test from 'node:test'
import { waitForStartup } from '../src/client.js'

// Pure shared-service port tests. No DOM, React, or visual emulation.
function fixture({ settingsReady = false, accountReady = false } = {}) {
  let settings = { status: settingsReady ? 'ready' : 'loading', view: settingsReady ? {} : undefined, error: null }
  let account = { view: accountReady ? { status: 'signed-out' } : undefined, failed: false }
  let time = 0
  let nextId = 0
  let rejectEnsure
  const settingsListeners = new Set()
  const accountListeners = new Set()
  const timers = new Map()
  const flags = []
  const controller = new AbortController()
  const counters = { ensure: 0 }
  const port = {
    settings: {
      getSnapshot: () => settings,
      subscribe(fn) { settingsListeners.add(fn); return () => settingsListeners.delete(fn) },
      ensure() { counters.ensure++; return new Promise((_, reject) => { rejectEnsure = reject }) },
    },
    account: { getSnapshot: () => account },
    subscribeAccount(fn) { accountListeners.add(fn); return () => accountListeners.delete(fn) },
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, at: time + delay }); return id },
    clearTimeout(id) { timers.delete(id) },
    now: () => time,
    report: value => flags.push(value),
  }
  const promise = waitForStartup(port, { signal: controller.signal })
  let settled = false
  promise.then(() => { settled = true })
  return {
    promise, port, timers, counters, flags, controller,
    get settled() { return settled },
    setSettings(value, notify = true) {
      settings = { ...settings, ...value }
      if (notify) for (const listener of [...settingsListeners]) listener()
    },
    setAccount(value, notify = true) {
      account = { ...account, ...value }
      if (notify) for (const listener of [...accountListeners]) listener()
    },
    rejectEnsure(error) { rejectEnsure(error) },
    tick(ms) {
      time += ms
      for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn() }
    },
    assertClean() {
      assert.equal(settingsListeners.size, 0)
      assert.equal(accountListeners.size, 0)
      assert.equal(timers.size, 0)
    },
  }
}
const readySettings = { status: 'ready', view: {} }
const accountView = status => ({ view: { status } })

test('already-settled reads release immediately, without ensure or a minimum delay', async () => {
  const f = fixture({ settingsReady: true, accountReady: true })
  assert.deepEqual(await f.promise, { reason: 'ready', settings: 'ready', account: 'ready', elapsedMs: 0 })
  assert.equal(f.counters.ensure, 0)
  f.assertClean()
})

test('regression: signed-in account first must still wait for saved settings (both host loading branches)', async () => {
  const f = fixture()
  f.setAccount(accountView('credential-stored'))
  await Promise.resolve()
  assert.equal(f.settled, false)
  f.tick(1200)
  f.setSettings(readySettings)
  assert.equal((await f.promise).elapsedMs, 1200)
  assert.equal(f.counters.ensure, 1)
  f.assertClean()
})

test('settings first still waits for the account first frame', async () => {
  const f = fixture()
  f.setSettings(readySettings)
  await Promise.resolve()
  assert.equal(f.settled, false)
  f.setAccount(accountView('credential-stored'))
  assert.equal((await f.promise).reason, 'ready')
  f.assertClean()
})

test('signed-out is a valid terminal first frame; no login/profile/balance is awaited', async () => {
  const f = fixture({ settingsReady: true })
  f.setAccount(accountView('signed-out'))
  assert.equal((await f.promise).reason, 'ready')
  f.assertClean()
})

test('settings error fails open even if account never answers', async () => {
  const f = fixture()
  f.setSettings({ error: 'read refused' })
  assert.equal((await f.promise).reason, 'settings-error')
  f.assertClean()
})

test('account failure fails open even if settings never answers', async () => {
  const f = fixture()
  f.setAccount({ failed: true })
  assert.equal((await f.promise).reason, 'account-error')
  f.assertClean()
})

test('ensure rejection resolves rather than rejecting boot', async () => {
  const f = fixture()
  f.rejectEnsure(new Error('connection closed'))
  assert.equal((await f.promise).reason, 'settings-error')
  f.assertClean()
})

test('missing first frames release at the hard 8000 ms deadline', async () => {
  const f = fixture()
  f.tick(7999)
  await Promise.resolve()
  assert.equal(f.settled, false)
  f.tick(1)
  assert.deepEqual(await f.promise, { reason: 'timeout', settings: 'pending', account: 'pending', elapsedMs: 8000 })
  f.assertClean()
})

test('deadline resamples current snapshots even when a notification was lost', async () => {
  const f = fixture()
  f.setSettings(readySettings, false)
  f.setAccount(accountView('signed-out'), false)
  f.tick(8000)
  assert.equal((await f.promise).reason, 'ready')
  f.assertClean()
})

test('unload aborts the barrier, removes subscriptions and cancels the deadline', async () => {
  const f = fixture()
  f.controller.abort()
  f.controller.abort()
  assert.equal((await f.promise).reason, 'disposed')
  f.assertClean()
  f.setSettings(readySettings)
  f.setAccount(accountView('credential-stored'))
  f.rejectEnsure(new Error('late rejection'))
  await Promise.resolve()
  assert.equal((await f.promise).reason, 'disposed')
})

test('a pre-aborted lifetime neither subscribes nor starts reads', async () => {
  const f = fixture()
  f.controller.abort()
  const result = await waitForStartup(f.port, { signal: f.controller.signal })
  assert.equal(result.reason, 'disposed')
  assert.equal(f.counters.ensure, 1) // Only the initial fixture barrier called ensure.
  f.assertClean()
})

test('snapshot regressions before completion do not release on stale readiness', async () => {
  const f = fixture({ settingsReady: true })
  f.setSettings({ status: 'loading', view: undefined })
  f.setAccount(accountView('credential-stored'))
  await Promise.resolve()
  assert.equal(f.settled, false)
  f.setSettings(readySettings)
  assert.equal((await f.promise).reason, 'ready')
  f.assertClean()
})

test('subscriber setup and snapshot exceptions fail open and clean partial resources', async () => {
  for (const field of ['subscribe', 'getSnapshot', 'ensure']) {
    const f = fixture()
    f.controller.abort()
    const broken = { ...f.port, settings: { ...f.port.settings, [field]() { throw new Error('broken adapter') } } }
    const result = await waitForStartup(broken)
    assert.equal(result.reason, 'adapter-error')
    f.assertClean()
  }
})

test('throwing cleanup adapters cannot leave the main Promise pending or skip other disposers', async () => {
  const f = fixture()
  f.controller.abort()
  const baseSubscribe = f.port.settings.subscribe
  const port = { ...f.port,
    clearTimeout(id) { f.port.clearTimeout(id); throw new Error('timer cleanup failed') },
    settings: { ...f.port.settings,
      subscribe(fn) {
        const dispose = baseSubscribe(fn)
        return () => { dispose(); throw new Error('unsubscribe failed') }
      },
    },
  }
  const pending = waitForStartup(port)
  f.setSettings(readySettings)
  f.setAccount(accountView('signed-out'))
  assert.equal((await pending).reason, 'ready')
  f.assertClean()
})

test('diagnostic callback exceptions fail open instead of blocking resolution', async () => {
  const f = fixture()
  f.controller.abort()
  const port = { ...f.port, report() { throw new Error('diagnostics failed') } }
  assert.equal((await waitForStartup(port)).reason, 'adapter-error')
  f.assertClean()
})

test('synchronous callbacks during subscribe do not leak the returned disposer', async () => {
  const f = fixture({ settingsReady: true, accountReady: true })
  let disposed = 0
  const port = { ...f.port, settings: { ...f.port.settings,
    subscribe(fn) { fn(); return () => { disposed++ } },
  } }
  assert.equal((await waitForStartup(port)).reason, 'ready')
  assert.equal(disposed, 1)
  f.assertClean()
})
