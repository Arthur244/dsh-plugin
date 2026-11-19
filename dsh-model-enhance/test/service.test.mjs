import test from 'node:test'
import assert from 'node:assert/strict'
import { ModelEnhanceController, validateRequest } from '../core/service.js'
import { normalizeCatalog } from '../core/catalog.js'
import { at } from '../core/planner.js'
import { createDescriptors, hostContribution } from '../protocol.js'

const schema = { uid: 1, refs: {
  1: { type: 'object', dict: { providers: 2 } }, 2: { type: 'dict', inner: 3 },
  3: { type: 'object', dict: { api: 4, reasoning: 4, models: 5, modelOverrides: 6 } },
  4: { type: 'union' }, 5: { type: 'array' }, 6: { type: 'dict' },
} }
function fixture({ profile, unavailable = false } = {}) {
  const descriptor = { ns: 'pi', schema, revision: 1, value: { providers: { route: profile ?? {
    api: 'openai-completions', baseURL: 'https://private.example/v1', models: [{ id: 'wire' }],
  } } } }
  const raw = { source: { name: 'Source', models: { upstream: { id: 'upstream', name: 'Model', reasoning: true,
    limit: { context: 10000, output: 3000 }, modalities: { input: ['text'] },
    reasoning_options: [{ type: 'effort', values: ['low', 'high'] }],
  } } } }
  let revision = 1, counter = 0, now = 0
  const calls = []
  const catalogSource = {
    catalog: normalizeCatalog(raw), disposed: false,
    info: () => ({ available: !unavailable, models: 1, providers: 1, bundled: true, generatedAt: '2026-01-01T00:00:00Z', source: 'bundled-official' }),
    dispose: () => { catalogSource.disposed = true },
  }
  const settings = {
    describe: () => [{ ...structuredClone(descriptor), revision }],
    mutate: async (ns, ops, expectedRevision) => {
      calls.push({ ns, ops: structuredClone(ops), expectedRevision })
      assert.equal(expectedRevision, revision)
      for (const op of ops) {
        assert.equal(op.op, 'set')
        let parent = descriptor.value
        for (const segment of op.path.slice(0, -1)) parent = parent[segment] ??= {}
        parent[op.path.at(-1)] = structuredClone(op.value)
      }
      revision++
    },
  }
  const llm = {
    listConfigurableProviders: () => [{ provider: 'route', displayName: 'Route', settingsNs: 'pi', settingsPath: ['providers', 'route'] }],
    listProviders: () => [{ id: 'route', name: 'Route' }],
    discoverModels: async () => { calls.push({ discovery: true }); throw new Error('Upstream discovery is forbidden') },
    listModels: async provider => { calls.push({ localCatalog: provider }); return [{ id: 'wire', name: 'Model' }] },
    resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'high' } }),
  }
  const service = new ModelEnhanceController({ llm, settings, catalogSource, now: () => now, token: () => `token-${++counter}` })
  const preview = async (extra = {}) => {
    await service.scan({ provider: 'route', sourceProvider: 'source' })
    return service.preview({ provider: 'route', modelId: 'wire', sourceKey: '["source","upstream"]',
      overwrite: false, ...extra })
  }
  return { service, descriptor, catalogSource, settings, llm, calls, preview, setRevision: value => { revision = value }, setNow: value => { now = value } }
}

test('public status reports only registered, schema-compatible routes and public metadata', () => {
  const f = fixture()
  assert.equal(f.service.status().routes[0].writable, true)
  assert.equal(JSON.stringify(f.service.status()).includes('private.example'), false)
  assert.deepEqual(f.service.status().sourceProviders, [{ id: 'source', name: 'Source' }])
})
test('scan uses only the selected provider local catalog without endpoint discovery or secret leakage', async () => {
  const f = fixture()
  const result = await f.service.scan({ provider: 'route', sourceProvider: 'source' })
  assert.equal(result.models[0].match.status, 'matched')
  assert.equal(result.models[0].id, 'wire')
  assert.equal(JSON.stringify(result).includes('private.example'), false)
  assert.deepEqual(f.calls, [{ localCatalog: 'route' }])
  assert.match(result.warnings[0], /already available in DSH/)
})
test('scan exposes detached image metadata without changing authoritative recommendations', async () => {
  for (const input of [['text', 'image'], ['text'], undefined]) {
    const f = fixture()
    const record = f.catalogSource.catalog.records[0]
    if (input === undefined) delete record.input
    else record.input = [...input]
    const result = await f.service.scan({ provider: 'route', sourceProvider: 'source' })
    const candidate = result.models[0].match.candidates[0]
    assert.deepEqual(candidate.input, input)
    if (candidate.input) {
      candidate.input.push('audio')
      assert.deepEqual(record.input, input, 'Client candidate must not mutate Host catalog')
    } else assert.equal(Object.hasOwn(candidate, 'input'), false)
  }
})
test('Host saves image capability from schema-default empty input and verifies it', async () => {
  for (const input of [['text', 'image'], ['text']]) {
    for (const explicit of [true, false]) {
      const model = { ...(explicit ? { id: 'wire' } : {}), input: [] }
      const profile = { api: 'openai-completions', ...(explicit ? { models: [model] } : { modelOverrides: { wire: model } }) }
      const f = fixture({ profile })
      f.catalogSource.catalog.records[0].input = input
      const preview = await f.preview()
      assert.equal(preview.requiresConfirmation, false)
      assert.ok(preview.changes.some(change => change.field === 'wire.input' && JSON.stringify(change.after) === JSON.stringify(input)))
      const result = await f.service.apply({ token: preview.token, confirm: false })
      assert.equal(result.saved && result.verified, true)
      const saved = f.descriptor.value.providers.route
      assert.deepEqual(explicit ? saved.models[0].input : saved.modelOverrides.wire.input, input)
      assert.equal((await f.preview()).canApply, false)
    }
  }
})
test('Host requires confirmation before replacing explicit image capability in either direction', async () => {
  for (const [before, after] of [[['text'], ['text', 'image']], [['text', 'image'], ['text']]]) {
    const f = fixture({ profile: { api: 'openai-completions', models: [{ id: 'wire', input: before }] } })
    f.catalogSource.catalog.records[0].input = after
    const preserved = await f.preview()
    assert.equal(preserved.changes.some(change => change.field === 'wire.input'), false)
    const blocked = await f.preview({ overwrite: true })
    assert.equal(blocked.requiresConfirmation, true)
    await assert.rejects(f.service.apply({ token: blocked.token, confirm: false }), /confirmation/)
    assert.equal(f.calls.some(call => call.ops), false)
    const confirmed = await f.preview({ overwrite: true })
    assert.equal((await f.service.apply({ token: confirmed.token, confirm: true })).verified, true)
    assert.deepEqual(f.descriptor.value.providers.route.models[0].input, after)
  }
})
test('empty added-model catalog remains empty and never falls back to upstream or models.dev records', async () => {
  const f = fixture()
  f.llm.listModels = async () => []
  const result = await f.service.scan({ provider: 'route', sourceProvider: 'source' })
  assert.deepEqual(result.models, [])
  assert.equal(f.calls.some(call => call.discovery), false)
  await assert.rejects(f.service.preview({ provider: 'route', modelId: 'upstream', sourceKey: '["source","upstream"]',
    overwrite: false }), /added model list/)
})
test('failed local catalog lookup reports failure without requesting the provider endpoint', async () => {
  const f = fixture()
  f.llm.listModels = async () => { throw new Error('Local adapter unavailable') }
  await assert.rejects(f.service.scan({ provider: 'route' }), /Local adapter unavailable/)
  assert.equal(f.calls.some(call => call.discovery), false)
  assert.equal(f.service.pendingLists.size, 0)
})
test('preview is read-only and Client cannot supply operations or another actual ID', async () => {
  const f = fixture()
  const result = await f.preview()
  assert.equal(result.canApply, true)
  assert.equal('ops' in result, false)
  assert.equal(f.calls.filter(call => call.ops).length, 0)
  await assert.rejects(f.service.preview({ provider: 'route', modelId: 'unseen', sourceKey: 'x', overwrite: false }), /added model list/)
  assert.throws(() => validateRequest('apply', { token: result.token, confirm: false, ops: [] }), /Invalid request fields/)
})
test('apply is persistent through settings path ops and verifies read-back', async () => {
  const f = fixture()
  const plan = await f.preview()
  const result = await f.service.apply({ token: plan.token, confirm: false })
  assert.equal(result.saved, true)
  assert.equal(result.verified, true)
  assert.equal(at(f.descriptor.value, ['providers', 'route', 'models'])[0].contextWindow, 10000)
  assert.equal(at(f.descriptor.value, ['providers', 'route', 'baseURL']), 'https://private.example/v1')
  assert.equal(f.calls.filter(call => call.ops).length, 1)
})
test('removing an existing off level requires confirmation and preserves other wire values', async () => {
  for (const wire of [null, 'none']) {
    const f = fixture({ profile: { api: 'openai-completions', models: [{ id: 'wire', reasoningEfforts: { off: wire, low: 'lite', high: 'ultra' } }] } })
    const plan = await f.preview()
    assert.equal(plan.requiresConfirmation, true)
    await assert.rejects(f.service.apply({ token: plan.token, confirm: false }), /confirmation/)
    assert.equal(f.calls.some(call => call.ops), false)
    assert.equal(f.descriptor.value.providers.route.models[0].reasoningEfforts.off, wire)
    const next = await f.preview()
    const result = await f.service.apply({ token: next.token, confirm: true })
    assert.equal(result.saved, true)
    assert.equal(result.verified, true)
    assert.deepEqual(f.descriptor.value.providers.route.models[0].reasoningEfforts, { low: 'lite', high: 'ultra' })
    assert.equal((await f.preview()).canApply, false)
  }
})
test('single-use preview prevents concurrent or repeated writes', async () => {
  const f = fixture()
  const plan = await f.preview()
  const first = f.service.apply({ token: plan.token, confirm: false })
  await assert.rejects(f.service.apply({ token: plan.token, confirm: false }), /already used/)
  await first
  assert.equal(f.calls.filter(call => call.ops).length, 1)
})
test('revision changes reject stale plans before writing', async () => {
  const f = fixture()
  const plan = await f.preview()
  f.setRevision(2)
  await assert.rejects(f.service.apply({ token: plan.token, confirm: false }), error => error.code === 'settings/conflict')
  assert.equal(f.calls.filter(call => call.ops).length, 0)
})
test('profile changes under the same revision are also fenced', async () => {
  const f = fixture()
  const plan = await f.preview()
  f.descriptor.value.providers.route.baseURL = 'https://changed.invalid'
  await assert.rejects(f.service.apply({ token: plan.token, confirm: false }), /Settings changed/)
})
test('expired or unconfirmed destructive plans do not write', async () => {
  const f = fixture({ profile: { api: 'openai-completions', models: [{ id: 'wire', contextWindow: 5 }] } })
  const plan = await f.preview({ overwrite: true })
  assert.equal(plan.requiresConfirmation, true)
  await assert.rejects(f.service.apply({ token: plan.token, confirm: false }), /confirmation/)
  const next = await f.preview({ overwrite: true })
  f.setNow(600000)
  await assert.rejects(f.service.apply({ token: next.token, confirm: true }), /expired/)
})
test('failed writes consume the token and do not claim success', async () => {
  const f = fixture()
  const plan = await f.preview()
  f.settings.mutate = async () => { throw new Error('settings/conflict') }
  await assert.rejects(f.service.apply({ token: plan.token, confirm: false }), /conflict/)
  await assert.rejects(f.service.apply({ token: plan.token, confirm: false }), /already used/)
})
test('successful write with failed read-back remains saved but unverified', async () => {
  const f = fixture()
  const plan = await f.preview()
  f.settings.mutate = async () => {}
  const result = await f.service.apply({ token: plan.token, confirm: false })
  assert.equal(result.saved, true)
  assert.equal(result.verified, false)
})
test('runtime has no refresh method and missing bundled data fails without fallback', async () => {
  const f = fixture({ unavailable: true })
  assert.equal(typeof f.service.refresh, 'undefined')
  await assert.rejects(f.service.scan({ provider: 'route' }), /Bundled official recommendations are unavailable/)
  assert.equal(f.calls.length, 0)
  f.service.dispose()
  assert.equal(f.catalogSource.disposed, true)
  assert.throws(() => f.service.status(), /disposed/)
})
const previewRequest = { provider: 'route', modelId: 'wire', sourceKey: '["source","upstream"]', overwrite: false }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('scan rejects settings changes while local catalog loading is still in flight', async () => {
  const f = fixture(), gate = deferred()
  f.llm.listModels = () => gate.promise
  const pending = f.service.scan({ provider: 'route', sourceProvider: 'source' })
  f.descriptor.value.providers.route.baseURL = 'https://new.invalid'
  gate.resolve([{ id: 'wire', name: 'Model' }])
  await assert.rejects(pending, /Settings changed while reading the local catalog/)
})
test('scan to preview is fenced by revision and profile, not only preview to apply', async () => {
  for (const change of [f => f.setRevision(2), f => { f.descriptor.value.providers.route.baseURL = 'https://new.invalid' }]) {
    const f = fixture()
    await f.service.scan({ provider: 'route', sourceProvider: 'source' })
    change(f)
    await assert.rejects(f.service.preview(previewRequest), /Settings changed since catalog loading/)
  }
})
test('re-reading the added model list invalidates an in-flight old preview', async () => {
  const f = fixture(), gate = deferred()
  await f.service.scan({ provider: 'route', sourceProvider: 'source' })
  f.llm.listModels = () => gate.promise
  const pending = f.service.preview(previewRequest)
  f.llm.listModels = async () => [{ id: 'wire', name: 'Model' }]
  await f.service.scan({ provider: 'route', sourceProvider: 'source' })
  gate.resolve([{ id: 'wire', name: 'Model' }])
  await assert.rejects(pending, /Reload added models/)
  assert.equal(f.service.plans.size, 0)
})
test('removed default features are rejected and shared defaults stay untouched', async () => {
  const f = fixture({ profile: { api: 'openai-completions', reasoning: 'max', models: [{ id: 'wire' }] } })
  assert.throws(() => validateRequest('preview', { ...previewRequest, repairDefault: true }), /Invalid request fields/)
  assert.throws(() => validateRequest('preview', { ...previewRequest, metadataOnly: true }), /Invalid request fields/)
  f.llm.resolveModelInfo = async () => { throw Error('Default analysis must not run') }
  const plan = await f.preview()
  assert.equal('defaultStatus' in plan, false)
  const result = await f.service.apply({ token: plan.token, confirm: false })
  assert.equal(result.saved, true)
  assert.equal('defaultVerified' in result, false)
  assert.equal(f.descriptor.value.providers.route.reasoning, 'max')
  const mapping = f.descriptor.value.providers.route.models[0].reasoningEfforts
  assert.ok(Object.keys(mapping).length > 0)
  assert.equal(Object.hasOwn(mapping, 'off'), false)
})
test('model removed from added catalog after preview cannot be re-injected', async () => {
  const f = fixture(), plan = await f.preview()
  f.llm.listModels = async () => []
  await assert.rejects(f.service.apply({ token: plan.token, confirm: false }), /added-model list/)
  assert.equal(f.calls.some(call => call.ops), false)
})
test('local catalog timeout and disposal fence pending adapter lookups without upstream fallback', async () => {
  const f = fixture()
  f.service.modelListTimeoutMs = 1
  f.llm.listModels = () => new Promise(() => {})
  await assert.rejects(f.service.scan({ provider: 'route' }), /timed out/)
  assert.equal(f.service.pendingLists.size, 0)
  const other = fixture()
  other.llm.listModels = () => new Promise(() => {})
  const pending = other.service.scan({ provider: 'route' })
  other.service.dispose()
  await assert.rejects(pending, /disposed/)
  assert.equal(other.service.pendingLists.size, 0)
  assert.equal(f.calls.some(call => call.discovery), false)
  assert.equal(other.calls.some(call => call.discovery), false)
})

test('protocol declares four endpoints without refresh or default repair with strict request validation', () => {
  const descriptors = createDescriptors()
  assert.equal(descriptors.length, 4)
  assert.deepEqual(hostContribution().invocations.map(item => item.method), ['status', 'scan', 'preview', 'apply'])
  const apply = descriptors.find(item => item.method === 'apply')
  assert.throws(() => apply.parameters[0].codec.create().parse({ token: 'x', confirm: 'yes' }), /boolean/)
  assert.deepEqual(apply.result.create().parse({ saved: true, optional: undefined }), { saved: true })
})
