// Run with the installed Electron binary in ELECTRON_RUN_AS_NODE mode, passing
// the installed dsh runtime directory. This creates no profile or live server.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import vm from 'node:vm'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

if (!process.argv[2]) throw new Error('Pass the installed dsh runtime directory as the first argument')
const runtime = resolve(process.argv[2])
const library = name => pathToFileURL(join(runtime, 'node_modules', name, 'lib', 'index.js')).href
const { evaluatePluginCompatibility, getDshRuntimeVersion } = await import(library('@deepseek-ai/dsh-app-boot'))
const runtimeVersion = getDshRuntimeVersion()
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
// Check the same admission rule as the Host before the test-only peer resolver
// can mask an obsolete manifest. An explicit engine otherwise hides peer drift.
assert.equal(evaluatePluginCompatibility(manifest), undefined, `plugin must admit installed DSH ${runtimeVersion}`)
const { engines, ...peerManifest } = manifest
assert.equal(evaluatePluginCompatibility(peerManifest), undefined, 'DSH peer requirements must also admit the installed runtime')
const protocolManifest = JSON.parse(await readFile(join(runtime, 'node_modules', '@deepseek-ai/dsh-typert-protocol', 'package.json'), 'utf8'))
assert.equal(evaluatePluginCompatibility(peerManifest, {}, protocolManifest.version), undefined, 'installed protocol peer must satisfy its declared requirement')
const oldIssue = evaluatePluginCompatibility({ ...manifest, engines: { dsh: '0.2.2-rc.3' } }, {}, '0.2.2-rc.5')
assert.deepEqual(oldIssue.requirements, { 'engines.dsh': '0.2.2-rc.3' })
assert.equal(oldIssue.exempted, false, 'reproduce the original rejection without granting any exemption')
for (const unverified of ['0.2.2-rc.4', '0.2.2-rc.6', '0.2.2', '0.3.0']) {
  assert.ok(evaluatePluginCompatibility(manifest, {}, unverified), `unverified DSH ${unverified} must remain blocked`)
}
const { Context, Service } = await import(library('@deepseek-ai/cordis'))
const { TypertRegistry } = await import(library('@deepseek-ai/dsh-typert-registry'))
const { TypertGatewayService } = await import(library('@deepseek-ai/dsh-api-gateway'))
const { Config: PiAiConfig } = await import(library('@deepseek-ai/dsh-llm-pi-ai'))
const { SettingsForms } = await import(library('@deepseek-ai/dsh-settings'))
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/dsh-typert-protocol') return { url: library(specifier), shortCircuit: true }
  return nextResolve(specifier, context)
} })
const plugin = await import('../index.js')
const clientRemote = await import(pathToFileURL(join(runtime, 'node_modules', '@deepseek-ai/dsh-api-gateway', 'lib', 'client.node.js')).href)
const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const home = await mkdtemp(join(tmpdir(), 'dsh-model-enhance-runtime-'))
const originalHome = process.env.DSH_HOME
const rawConfig = { providers: { fixture: { api: 'openai-completions', baseURL: 'https://fixture.invalid/v1', headers: { 'X-Fixture': 'preserved' }, models: [{ id: 'gpt-daybreak-red-latest', input: [] }] } } }
assert.deepEqual(PiAiConfig({ providers: { fixture: { api: 'openai-completions', models: [{ id: 'example' }] } } }).providers.get().fixture.models[0].input, [], 'real schema materializes unset input as inheritance')
const entry = { id: 'fixture-pi', options: { id: 'fixture-pi', config: rawConfig }, fiber: undefined }
let writes = 0
process.env.DSH_HOME = home
class FixtureLlm extends Service {
  constructor(ctx) { super(ctx, 'llm') }
  listConfigurableProviders() { return [{ provider: 'fixture', settingsNs: 'fixture-pi', settingsPath: ['providers', 'fixture'], displayName: 'Fixture' }] }
  listProviders() { return [{ id: 'fixture', name: 'Fixture' }] }
  async listModels(provider) { assert.equal(provider, 'fixture'); return [{ id: 'gpt-daybreak-red-latest', name: 'Daybreak Red' }] }
  async resolveModelInfo() { return { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'high' } } }
}
// Only the profile persistence seam is in memory. Schema projection, redaction,
// revision checks, volatile-path validation and path mutations are real DSH code.
class FixtureConfigEditor extends Service {
  constructor(ctx) { super(ctx, 'configEditor') }
  entries() { return [entry] }
  configuration() { return [{ entry, inherited: {}, override: entry.options.config }] }
  async edit(selected, change) {
    assert.equal(selected, entry)
    const next = await change(structuredClone(entry.options.config), {})
    // Apply through the real schema-owning fiber, without a profile or disk edit.
    await entry.fiber.update(next, true)
    entry.options.config = next
    writes++
  }
}
class FixtureProfileContext extends Service {
  constructor(ctx) { super(ctx, 'profileContext'); this.home = home; this.name = 'fixture' }
}
class FixtureLoader extends Service {
  constructor(ctx) { super(ctx, 'loader') }
  async await() {}
}
class FixtureAccess extends Service {
  constructor(ctx) { super(ctx, 'remoteAccess') }
  decide() { return { kind: 'deny', reason: 'fixture-not-owner' } }
}
const ctx = new Context()
const peerControl = new AbortController()
const peer = { id: 'fixture-owner', ctx, principal: { kind: 'owner' }, signal: peerControl.signal,
  interactions: 'none', dispose: async () => { peerControl.abort() } }
const invoke = (method, request) => ctx.typertGateway.invoke({ namespace: 'modelEnhance', method,
  args: request === undefined ? {} : { request }, peer })
async function verifyClientMount() {
  const client = new Context()
  let factory
  const registrations = []
  vm.runInNewContext(clientSource, { window: { __ModuleLoader__: { load(entry) { factory = entry.factory } } } })
  const ui = factory(name => {
    assert.equal(name, 'react')
    return { createElement: () => null }
  })
  class FixtureConnection extends Service {
    constructor(scope) {
      super(scope, 'connection')
      this.interactions = 'none'
      this.rpc = {
        open() { throw new Error('No stream transport is expected') },
        async call(path, endpoint, payload) {
          assert.equal(path, '/api')
          const [namespace, method] = endpoint.split('/')
          return { ok: true, value: await ctx.typertGateway.invoke({ namespace, method,
            // Emulate the JSON transport across VM realms, as HTTP does.
            args: JSON.parse(JSON.stringify(payload.args)), peer }) }
        },
      }
    }
  }
  class FixtureLocale extends Service {
    constructor(scope) { super(scope, 'locale') }
    register() { return () => {} }
  }
  class FixtureSlots extends Service {
    constructor(scope) { super(scope, 'slots') }
    inject(name, fn) {
      assert.equal(name, 'settings.models.footer')
      this.ctx.effect(fn)
    }
    register(options) {
      registrations.push(options)
      return () => { registrations.splice(registrations.indexOf(options), 1) }
    }
  }
  let uiOwner
  try {
    await client.plugin(TypertRegistry)
    await client.plugin(FixtureConnection)
    await client.plugin(FixtureLocale)
    await client.plugin(FixtureSlots)
    await client.plugin(clientRemote)
    // A real plugin fiber enforces inject; root/plain-object contexts do not.
    uiOwner = client.plugin(ui)
    await uiOwner
    const actions = registrations[0]?.inject().actions
    assert.ok(actions, 'footer must expose the controller')
    await actions.load()
    const snapshot = registrations[0].inject().hooks.enhance.getSnapshot()
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error))
    assert.equal(snapshot.status.routes[0].provider, 'fixture')
    assert.ok(snapshot.status.sourceProviders.some(item => item.id === 'openai'))
    // Drive the same controller actions as the buttons/dropdowns, not calls
    // from an unchecked root Context. All external services remain fixtures.
    await actions.load(true)
    actions.setProvider('fixture')
    actions.setSource('openai')
    await actions.scan()
    const matched = registrations[0].inject().hooks.enhance.getSnapshot()
    assert.equal(matched.error, null, JSON.stringify(matched.error))
    assert.equal(matched.scan?.models[0].id, 'gpt-daybreak-red-latest')
    assert.deepEqual(JSON.parse(JSON.stringify(matched.scan.models[0].match.candidates[0].input)), ['text', 'image'])
    actions.selectModel('gpt-daybreak-red-latest')
    await actions.preview()
    const populated = registrations[0].inject().hooks.enhance.getSnapshot()
    assert.equal(populated.error, null, JSON.stringify(populated.error))
    assert.equal(populated.preview.canApply, true)
    assert.equal(writes, 0, 'data loading and preview do not change settings')
    assert.equal(registrations.length, 1, 'real Client Remote must mount before the footer registers')
    assert.equal(registrations[0].id, 'dsh-model-enhance')
    assert.equal((await client.remote.modelEnhance.status()).ok, true)
    assert.equal((await client.remote.modelEnhance.scan({ provider: 'fixture' })).ok, true)
    assert.equal((await client.remote.modelEnhance.apply({ token: 'x', confirm: 'yes' })).ok, false)
    assert.equal(writes, 0, 'malformed Client request cannot reach settings writes')
    await uiOwner.dispose()
    assert.equal(registrations.length, 0)
    assert.equal(client.remote.modelEnhance, undefined)
    // Real Client mount rejects the old src-json request descriptor, proving
    // that this regression is caught independently of the VM test's mocks.
    await assert.rejects(client.remote.$mount({ package: 'fixture-weak', descriptors: [{
      id: 'fixture:weak/apply', service: 'weak', namespace: 'weak', method: 'apply', invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'src-json' } }], result: { mode: 'src-json' },
    }] }), /no strict codec/)
  } finally {
    await client.fiber.dispose()
  }
}
try {
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(FixtureLlm)
  entry.fiber = ctx.plugin({ name: 'fixture-pi-schema', Config: PiAiConfig, apply() {} }, rawConfig)
  await entry.fiber
  await ctx.plugin(FixtureConfigEditor)
  await ctx.plugin(FixtureProfileContext)
  await ctx.plugin(FixtureLoader)
  await ctx.plugin(SettingsForms)
  const actual = ctx.settings.describe({ redactSecrets: true })[0]
  assert.equal(actual.ns, 'fixture-pi')
  assert.ok(actual.schema.refs && Number.isInteger(actual.schema.uid), 'must use the actual native SettingsForms projection')
  assert.equal(actual.schema.properties, undefined)
  assert.equal(actual.value.providers.fixture.baseURL, rawConfig.providers.fixture.baseURL)
  await ctx.plugin(FixtureAccess)
  await ctx.plugin(TypertGatewayService)
  const owner = ctx.plugin(plugin)
  await owner
  const status = await invoke('status')
  assert.equal(status.catalog.bundled, true)
  assert.equal(status.catalog.available, true)
  assert.equal(status.routes[0].writable, true)
  await verifyClientMount()
  const scanned = await invoke('scan', { provider: 'fixture', sourceProvider: 'openai' })
  assert.equal(scanned.models[0].match.status, 'matched')
  const preview = await invoke('preview', { provider: 'fixture', modelId: 'gpt-daybreak-red-latest',
    sourceKey: scanned.models[0].match.candidates[0].key, overwrite: false })
  assert.equal(preview.canApply, true)
  assert.equal(preview.requiresConfirmation, false)
  assert.deepEqual(preview.changes.find(change => change.field === 'gpt-daybreak-red-latest.input'), {
    field: 'gpt-daybreak-red-latest.input', before: [], after: ['text', 'image'],
  })
  assert.equal(writes, 0)
  const result = await invoke('apply', { token: preview.token, confirm: false })
  assert.equal(result.saved, true)
  assert.equal(result.verified, true, JSON.stringify({ result, value: ctx.settings.describe()[0].value, changes: preview.changes }))
  assert.equal(writes, 1)
  assert.equal(ctx.settings.describe()[0].value.providers.fixture.models[0].contextWindow, 400000)
  assert.equal(entry.options.config.providers.fixture.models[0].contextWindow, 400000)
  assert.deepEqual(entry.options.config.providers.fixture.models[0].input, ['text', 'image'])
  assert.deepEqual(ctx.settings.describe()[0].value.providers.fixture.models[0].input, ['text', 'image'])
  const mapping = entry.options.config.providers.fixture.models[0].reasoningEfforts
  assert.ok(mapping && Object.keys(mapping).length > 0)
  assert.equal(Object.hasOwn(mapping, 'off'), false)
  assert.deepEqual(ctx.settings.describe()[0].value.providers.fixture.models[0].reasoningEfforts, mapping)
  assert.equal(entry.options.config.providers.fixture.baseURL, rawConfig.providers.fixture.baseURL)
  assert.deepEqual(entry.options.config.providers.fixture.headers, { 'X-Fixture': 'preserved' })
  assert.doesNotThrow(() => PiAiConfig(entry.options.config))
  assert.notEqual(ctx.settings.describe()[0].revision, actual.revision)
  const rescanned = await invoke('scan', { provider: 'fixture', sourceProvider: 'openai' })
  const unchanged = await invoke('preview', { provider: 'fixture', modelId: 'gpt-daybreak-red-latest',
    sourceKey: rescanned.models[0].match.candidates[0].key, overwrite: false })
  assert.equal(unchanged.canApply, false)
  assert.deepEqual(unchanged.changes, [])
  assert.equal(writes, 1, 'repeating the same recommendation causes no write')
  await assert.rejects(invoke('apply', { token: preview.token, confirm: false }), /used|expired/)
  await assert.rejects(invoke('apply', { token: 'x', confirm: 'yes' }), error => error.code === 'gateway/input-invalid' && error.field === 'request')
  await assert.rejects(invoke('status', { unexpected: true }), /argument|field|parameter/i)
  await owner.dispose()
  await assert.rejects(invoke('status'), /withdrawn|unavailable/i)
  const second = ctx.plugin(plugin)
  await second
  assert.equal((await invoke('status')).catalog.available, true)
  await second.dispose()
  console.log(`PASS: installed DSH ${runtimeVersion}; engine + protocol peer compatibility without exemptions; real pi-ai Config + SettingsForms + bundled catalog + local added-model matching + scoped Client controller + Host Gateway; four endpoints, image input from schema-default empty arrays through save/read-back, reasoning mappings without off, default selection deferred, revisions, strict validation, save/read-back, single-use token, unload/HMR cleanup. No live profile, network or model calls.`)
} finally {
  peerControl.abort()
  await ctx.fiber.dispose()
    if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  hook.deregister()
  // Only the exact mkdtemp result under the OS temp directory may be removed.
  const absolute = resolve(home)
  assert.equal(absolute, home)
  assert.equal(resolve(home, '..'), resolve(tmpdir()))
  assert.ok(home.startsWith(join(tmpdir(), 'dsh-model-enhance-runtime-')))
  await rm(absolute, { recursive: true, force: true })
}
