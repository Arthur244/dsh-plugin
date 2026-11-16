import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const root = new URL('../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')

// A service/lifetime adapter fixture, not a DOM, React, Cordis or visual emulator.
async function runtime({ desktop = true } = {}) {
  let registration
  let time = 0
  const timers = new Map()
  const services = {}
  const dependencies = []
  const rootCleanups = []
  const sandbox = {
    window: { __ModuleLoader__: { load(row) { registration = row } } },
    performance: { now: () => time }, AbortController,
    setTimeout(fn, delay) { const id = {}; timers.set(id, { fn, at: time + delay }); return id },
    clearTimeout(id) { timers.delete(id) },
  }
  if (desktop) sandbox.dshDesktop = {}
  vm.runInNewContext(await read('client.js'), sandbox)
  const plugin = registration.factory()
  const activate = entry => {
    if (entry.active || !entry.keys.every(key => key in services)) return
    entry.active = true
    const scope = { ...services,
      on: (event, fn) => ctx.on(event, fn),
      effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') entry.cleanups.push(cleanup) },
    }
    entry.callback(scope)
  }
  const listeners = new Set()
  const ctx = {
    inject(keys, callback) {
      const entry = { keys, callback, active: false, cleanups: [] }
      dependencies.push(entry)
      activate(entry)
    },
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') rootCleanups.push(cleanup) },
    on(event, fn) {
      assert.equal(event, 'account-ui/change')
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  let settings = { status: 'loading', view: undefined, error: null }
  let account = { view: undefined, failed: false }
  const settingsListeners = new Set()
  const mirror = {
    getSnapshot: () => settings,
    subscribe(fn) { settingsListeners.add(fn); return () => settingsListeners.delete(fn) },
    ensure: () => new Promise(() => {}),
  }
  let provider = null
  let providerDisposals = 0
  return {
    plugin, ctx, registration, timers, dependencies,
    provide(key, value) { services[key] = value; for (const entry of dependencies) activate(entry) },
    core() {
      this.provide('configForms', { describe: () => mirror })
      this.provide('accountUi', { getSnapshot: () => account })
    },
    diagnostic() {
      this.provide('cordisInspect', { register(value) {
        provider = value
        return () => { provider = null; providerDisposals++ }
      } })
    },
    status: () => provider.query('status'),
    readySettings() { settings = { status: 'ready', view: {}, error: null }; for (const fn of [...settingsListeners]) fn() },
    account(status = 'credential-stored') { account = { view: { status }, failed: false }; for (const fn of [...listeners]) fn() },
    revokeCore() {
      for (const entry of dependencies.filter(row => row.keys.includes('accountUi'))) {
        for (const cleanup of entry.cleanups.splice(0).reverse()) cleanup()
      }
    },
    dispose() {
      for (const cleanup of rootCleanups.splice(0).reverse()) cleanup()
      for (const entry of dependencies) for (const cleanup of entry.cleanups.splice(0).reverse()) cleanup()
    },
    tick(ms) {
      time += ms
      for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn() }
    },
    assertClean() { assert.equal(settingsListeners.size, 0); assert.equal(listeners.size, 0); assert.equal(timers.size, 0) },
    get providerDisposals() { return providerDisposals },
  }
}

test('Client factory is lazy, self-contained and declares no hard service dependency', async () => {
  const f = await runtime()
  assert.equal(f.registration.id, 'dsh-startup-overlay')
  assert.deepEqual(Array.from(f.plugin.inject), [])
  assert.equal(f.dependencies.length, 0)
  assert.equal(f.timers.size, 0)
})

test('apply Promise remains pending until both shared states arrive; caller can await before mount', async () => {
  const f = await runtime()
  let nextStep = false
  const applying = f.plugin.apply(f.ctx).then(() => { nextStep = true })
  f.core()
  f.account() // Real host regression: account first can produce classed loading even for a saved done user.
  await Promise.resolve()
  assert.equal(nextStep, false)
  f.readySettings()
  await applying
  assert.equal(nextStep, true)
  f.assertClean()
  f.dispose()
})

test('missing services still time out from main apply, and late provision does not start another wait', async () => {
  const f = await runtime()
  const applying = f.plugin.apply(f.ctx)
  assert.equal(f.timers.size, 1)
  f.tick(8000)
  await applying
  f.diagnostic()
  assert.equal((await f.status()).result.reason, 'timeout')
  f.core()
  f.assertClean()
  f.dispose()
})

test('only one readiness service is insufficient and is still bounded', async () => {
  const f = await runtime()
  f.provide('accountUi', { getSnapshot: () => ({ view: undefined, failed: false }) })
  const applying = f.plugin.apply(f.ctx)
  f.tick(8000)
  await applying
  f.assertClean()
  f.dispose()
})

test('late diagnostic service reads the completed history without re-running the barrier', async () => {
  const f = await runtime()
  f.core()
  const applying = f.plugin.apply(f.ctx)
  f.readySettings()
  f.account('signed-out')
  await applying
  f.diagnostic()
  const status = await f.status()
  assert.equal(status.version, '0.2.0')
  assert.equal(status.strategy, 'readiness-barrier')
  assert.equal(status.phase, 'released')
  assert.equal(status.result.reason, 'ready')
  assert.equal(status.history.at(-1).phase, 'released')
  assert.ok(status.history.length <= 16)
  f.assertClean()
  f.dispose()
  assert.equal(f.providerDisposals, 1)
})

test('dependency revocation releases main apply and removes outstanding subscriptions', async () => {
  const f = await runtime()
  f.core()
  f.diagnostic()
  const applying = f.plugin.apply(f.ctx)
  f.revokeCore()
  await applying
  assert.equal((await f.status()).result.reason, 'services-revoked')
  f.assertClean()
  f.dispose()
})

test('unloading during wait resolves main apply and cleans its owned resources', async () => {
  const f = await runtime()
  f.core()
  const applying = f.plugin.apply(f.ctx)
  f.dispose()
  await applying
  f.assertClean()
})

test('broken optional diagnostic registration never rejects or holds main apply', async () => {
  for (const failure of ['inject', 'register']) {
    const f = await runtime()
    f.core()
    f.readySettings()
    f.account('signed-out')
    if (failure === 'inject') {
      const original = f.ctx.inject
      f.ctx.inject = (keys, callback) => {
        if (keys.includes('cordisInspect')) throw new Error('diagnostic injection failed')
        return original(keys, callback)
      }
    } else {
      f.provide('cordisInspect', { register() { throw new Error('diagnostic registration failed') } })
    }
    await f.plugin.apply(f.ctx)
    f.assertClean()
    f.dispose()
  }
})

test('service-face construction exceptions also release instead of escaping apply', async () => {
  const f = await runtime()
  f.provide('configForms', { describe() { throw new Error('bad settings face') } })
  f.provide('accountUi', { getSnapshot: () => ({ view: undefined, failed: false }) })
  f.diagnostic()
  await f.plugin.apply(f.ctx)
  assert.equal((await f.status()).result.reason, 'adapter-error')
  f.assertClean()
  f.dispose()
})

test('plain Web skips waiting and only exposes optional diagnostics', async () => {
  const f = await runtime({ desktop: false })
  await f.plugin.apply(f.ctx)
  f.diagnostic()
  assert.equal((await f.status()).phase, 'skipped')
  assert.equal(f.dependencies.length, 1)
  f.assertClean()
  f.dispose()
})

test('source no longer reads/writes overlay DOM, inline opacity or interaction locks', async () => {
  const source = await read('src/client.js')
  assert.doesNotMatch(source, /\bdocument\b|MutationObserver|querySelector|\.inert\b|\.opacity\b|createStartupStyles|createStartupController/)
  assert.doesNotMatch(source, /async\s+scope\s*=>|await\s+ctx\.inject/)
})

test('manifest exports, exact runtime version and display resources are complete', async () => {
  const manifest = JSON.parse(await read('package.json'))
  assert.equal(manifest.name, 'dsh-startup-overlay')
  assert.equal(manifest.version, '0.2.0')
  assert.equal(manifest.engines.dsh, '0.2.2-rc.3')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  for (const path of Object.values(manifest.exports).filter(path => !path.includes('*'))) {
    assert.equal((await stat(new URL(path, root))).isFile(), true)
    assert.ok(manifest.files.includes(path.replace(/^\.\//, '')))
  }
  for (const locale of ['en', 'zh']) {
    const { meta } = JSON.parse(await read(`locale/${locale}.json`))
    assert.ok(meta.title.length > 0)
    assert.ok(meta.description.includes('8'))
    assert.ok(meta.description.includes('0.2.2-rc.3'))
  }
  const patch = await read('cordis.patch.yml')
  assert.match(patch, /id: dsh-startup-overlay\n\s+name: dsh-startup-overlay/)
  const icon = await read('icon.svg')
  assert.match(icon, /viewBox="0 0 36 36"/)
  assert.ok(Buffer.byteLength(icon) < 256 * 1024)
  assert.doesNotMatch(icon, /<(?:script|style|image|foreignObject|text)\b|\bon\w+=/)
})
