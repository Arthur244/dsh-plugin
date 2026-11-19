import test from 'node:test'
import assert from 'node:assert/strict'
import { routeTarget, planInjection, verifyOperations } from '../core/planner.js'

// Same uid/refs/dict/inner format as settings.describe(), not Config Inspect.
export const schema = { uid: 1, refs: {
  1: { type: 'object', dict: { providers: 2 } },
  2: { type: 'dict', inner: 3 },
  3: { type: 'object', dict: { api: 4, models: 5, modelOverrides: 6, reasoning: 4 } },
  4: { type: 'union', list: [] }, 5: { type: 'array', inner: 7 },
  6: { type: 'dict', inner: 7 }, 7: { type: 'object', dict: {} },
} }
const info = (efforts = ['low', 'high'], defaultEffort = 'high') => ({ reasoning: {
  efforts: efforts.map(id => ({ id })), ...(defaultEffort ? { defaultEffort } : {}),
} })
const target = profile => routeTarget([{ provider: 'route', settingsNs: 'pi', settingsPath: ['providers', 'route'] }], [
  { ns: 'pi', revision: 3, schema, value: { providers: { route: profile } } },
], 'route')
const plan = (profile, extra = {}) => planInjection({
  target: target(profile), modelId: 'model', recommendation: { fields: { contextWindow: 12000 }, warnings: [] },
  request: { overwrite: false }, knownModels: [{ id: 'model' }],
  resolveInfo: async () => info(), ...extra,
})

test('requires actual generic pi-ai schema and settings path', () => {
  assert.throws(() => routeTarget([{ provider: 'route', settingsNs: 'pi', settingsPath: ['models'] }], [{ ns: 'pi', revision: 3, schema, value: {} }], 'route'))
  assert.throws(() => routeTarget([{ provider: 'route', settingsNs: 'pi', settingsPath: ['providers', 'route'] }], [{ ns: 'pi', revision: 3, schema: {}, value: {} }], 'route'))
})
test('native schema follows referenced providers profile without mutating it', () => {
  const original = structuredClone(schema)
  assert.equal(target({ models: [] }).path.join('.'), 'providers.route')
  assert.deepEqual(schema, original)
})
test('inline native schema and shared references are supported', () => {
  const inline = { type: 'object', dict: { providers: { type: 'dict', inner: {
    type: 'object', dict: { api: { type: 'union' }, reasoning: { type: 'union' },
      models: { type: 'array' }, modelOverrides: { type: 'dict' } },
  } } } }
  const result = routeTarget([{ provider: 'route', settingsNs: 'pi', settingsPath: ['providers', 'route'] }], [
    { ns: 'pi', revision: 1, schema: inline, value: { providers: { route: {} } } },
  ], 'route')
  assert.deepEqual(result.profile, {})
})
test('unrelated, broken, recursive and wrong-type schema cannot authorize a provider write', () => {
  const bad = []
  for (const change of [
    s => { s.refs[1].dict = { unrelated: 2 } },
    s => { s.refs[2].inner = 999 },
    s => { s.refs[2].inner = 8; s.refs[8] = 9; s.refs[9] = 8 },
    s => { s.refs[2].type = 'array' },
    s => { s.refs[3].dict.models = 4 },
    s => { delete s.refs[3].dict.api },
    s => { s.uid = '1' },
  ]) {
    const copy = structuredClone(schema); change(copy); bad.push(copy)
  }
  bad.push({ properties: { providers: { additionalProperties: { properties: { models: {}, modelOverrides: {}, api: {}, reasoning: {} } } } } })
  for (const candidate of bad) assert.throws(() => routeTarget([
    { provider: 'route', settingsNs: 'pi', settingsPath: ['providers', 'route'] },
  ], [{ ns: 'pi', revision: 1, schema: candidate, value: {} }], 'route'), /Only generic pi-ai/)
})
test('editing saved models preserves array order and unknown fields', async () => {
  const profile = { models: [{ id: 'other', extra: { x: 1 } }, { id: 'model', custom: 7 }], endpoint: 'preserved' }
  const before = structuredClone(profile), result = await plan(profile)
  assert.deepEqual(profile, before)
  assert.equal(result.ops[0].op, 'set')
  assert.deepEqual(result.ops[0].value, [{ id: 'other', extra: { x: 1 } }, { id: 'model', custom: 7, contextWindow: 12000 }])
})
test('ordinary existing fields remain unchanged unless overwrite is explicit', async () => {
  const profile = { models: [{ id: 'model', contextWindow: 4000, extra: 7 }] }
  assert.equal((await plan(profile)).canApply, false)
  const result = await plan(profile, { request: { overwrite: true } })
  assert.equal(result.requiresConfirmation, true)
  assert.equal(result.ops[0].value[0].extra, 7)
  assert.equal(result.ops[0].value[0].contextWindow, 12000)
})
test('implicit catalog uses model overrides, never an expanded model list', async () => {
  const result = await plan({ modelOverrides: { model: { name: 'Custom' }, other: { maxTokens: 3 } } })
  assert.deepEqual(result.ops[0].path, ['providers', 'route', 'modelOverrides', 'model'])
  assert.deepEqual(result.ops[0].value, { name: 'Custom', contextWindow: 12000 })
})
test('cannot add models absent from the DSH list or explicit saved profile', async () => {
  await assert.rejects(plan({}, { knownModels: [] }), /added-model list/)
  await assert.rejects(plan({ models: [{ id: 'other' }] }), /saved provider model list/)
})
test('duplicate and dangerous IDs and invalid capacities are rejected', async () => {
  await assert.rejects(plan({ models: [{ id: 'model' }, { id: 'model' }] }), /duplicate/)
  await assert.rejects(plan({ models: [] }, { modelId: '__proto__' }), /Invalid actual/)
  for (const number of [0, -1, 1.5, Infinity]) await assert.rejects(plan({ models: [{ id: 'model' }] }, { recommendation: { fields: { contextWindow: number } } }), /Invalid recommended/)
})
test('existing mapping preserves wire values without adding off or requiring confirmation for a fill', async () => {
  const result = await plan({ models: [{ id: 'model', reasoningEfforts: { low: 'lite', high: 'ultra' } }] })
  assert.deepEqual(result.ops[0].value[0].reasoningEfforts, { low: 'lite', high: 'ultra' })
  assert.equal(result.requiresConfirmation, false)
})
test('existing off is removed with confirmation; the resulting mapping is idempotent', async () => {
  for (const wire of [null, 'none']) {
    const profile = { models: [{ id: 'model', contextWindow: 12000, reasoningEfforts: { off: wire, low: 'lite', high: 'ultra' } }] }
    const before = structuredClone(profile)
    const result = await plan(profile)
    assert.deepEqual(profile, before)
    assert.deepEqual(result.ops[0].value[0].reasoningEfforts, { low: 'lite', high: 'ultra' })
    assert.equal(result.requiresConfirmation, true)
    assert.ok(result.warnings.some(w => w.includes('off level is removed')))
    const again = await plan({ models: result.ops[0].value })
    assert.equal(again.ops.length, 0)
  }
})
test('recommended mappings never inject off in fill or overwrite mode', async () => {
  for (const overwrite of [false, true]) {
    for (const wire of [null, 'none']) {
      const result = await plan({ models: [{ id: 'model' }] }, {
        request: { overwrite }, recommendation: { fields: { reasoningEfforts: { off: wire, low: 'low', high: 'high' } } },
      })
      assert.deepEqual(result.ops[0].value[0].reasoningEfforts, { low: 'low', high: 'high' })
      assert.deepEqual(result.blockers, [])
    }
  }
})
test('model overrides remove off without changing unrelated models', async () => {
  const profile = { modelOverrides: { model: { reasoningEfforts: { off: null, low: 'lite' } }, other: { reasoningEfforts: { off: null, high: 'high' } } } }
  const before = structuredClone(profile)
  const result = await plan(profile)
  assert.deepEqual(result.ops[0].path, ['providers', 'route', 'modelOverrides', 'model'])
  assert.deepEqual(result.ops[0].value.reasoningEfforts, { low: 'lite' })
  assert.equal(result.requiresConfirmation, true)
  assert.deepEqual(profile, before)
})
test('existing off-only mappings are not replaced by an invalid empty mapping', async () => {
  const result = await plan({ models: [{ id: 'model', reasoningEfforts: { off: null } }] })
  assert.deepEqual(result.ops[0].value[0].reasoningEfforts, { off: null })
  assert.ok(result.warnings.some(w => w.includes('No reliable non-off')))
})
test('non-reasoning false and unknown capabilities follow the confirmed valid-config exception', async () => {
  const plain = await plan({ models: [{ id: 'model', reasoningEfforts: false }] }, { recommendation: { fields: { contextWindow: 12000, reasoningEfforts: { low: 'low', off: null } } } })
  assert.equal(plain.ops[0].value[0].reasoningEfforts, false)
  const unknown = await plan({ models: [{ id: 'model' }] }, { recommendation: { fields: { contextWindow: 12000, reasoningEfforts: { off: null } } } })
  assert.equal(Object.hasOwn(unknown.ops[0].value[0], 'reasoningEfforts'), false)
  assert.ok(unknown.warnings.some(w => w.includes('No reliable non-off')))
})
test('incompatible provider defaults no longer block or change unrelated model updates', async () => {
  const profile = { reasoning: 'max', models: [{ id: 'other', reasoningEfforts: false }, { id: 'model' }] }
  let calls = 0
  const result = await plan(profile, { recommendation: { fields: { reasoningEfforts: { off: null, low: 'low' } } }, resolveInfo: async () => { calls++; throw Error('Default repair is deferred') } })
  assert.equal(result.canApply, true)
  assert.equal(calls, 0)
  assert.equal(profile.reasoning, 'max')
  assert.equal(result.ops.some(op => op.path.at(-1) === 'reasoning'), false)
  assert.equal('defaultStatus' in result, false)
})
test('recommended provider-default fields cannot be injected through model updates', async () => {
  await assert.rejects(plan({ models: [{ id: 'model' }] }, { recommendation: { fields: { reasoning: 'low' } } }), /Unsupported recommended field/)
})
test('adapter-error routes cannot bypass Client read-only restrictions', () => {
  assert.throws(() => routeTarget([{ provider: 'route', error: 'invalid', settingsNs: 'pi', settingsPath: ['providers', 'route'] }], [
    { ns: 'pi', revision: 3, schema, value: { providers: { route: {} } } },
  ], 'route'), /adapter error/)
})
test('read-back allows schema object-key ordering but not changed values or array order', () => {
  const op = { op: 'set', path: ['models'], value: [{ id: 'model', compat: {}, contextWindow: 16000 }] }
  assert.equal(verifyOperations({ value: { models: [{ contextWindow: 16000, id: 'model', compat: {} }] } }, [op]), true)
  assert.equal(verifyOperations({ value: { models: [{ contextWindow: 8000, id: 'model', compat: {} }] } }, [op]), false)
  assert.equal(verifyOperations({ value: { models: [{ contextWindow: 16000, id: 'model', compat: {}, extra: 1 }] } }, [op]), false)
  assert.equal(verifyOperations({ value: { models: [2, 1] } }, [{ op: 'set', path: ['models'], value: [1, 2] }]), false)
})
test('image capability fills absent and schema-default empty inputs in both storage forms', async () => {
  for (const input of [undefined, []]) {
    for (const explicit of [true, false]) {
      for (const recommended of [['text', 'image'], ['text']]) {
        const model = { ...(explicit ? { id: 'model' } : {}), ...(input === undefined ? {} : { input }) }
        const profile = explicit ? { models: [model] } : { modelOverrides: { model } }
        const original = structuredClone(profile)
        const result = await plan(profile, { recommendation: { fields: { input: recommended } } })
        const saved = explicit ? result.ops[0].value[0] : result.ops[0].value
        assert.deepEqual(saved.input, recommended)
        assert.equal(result.requiresConfirmation, false, 'empty input means inherit, not an explicit capability')
        assert.deepEqual(result.changes, [{ field: 'model.input', before: input ?? null, after: recommended }])
        assert.deepEqual(profile, original)
        const again = await plan(explicit ? { models: [saved] } : { modelOverrides: { model: saved } }, {
          recommendation: { fields: { input: recommended } },
        })
        assert.equal(again.canApply, false)
      }
    }
  }
})
test('explicit input capabilities are preserved unless overwrite is confirmed', async () => {
  for (const explicit of [true, false]) {
    for (const [before, after] of [[['text'], ['text', 'image']], [['text', 'image'], ['text']]]) {
      const model = { ...(explicit ? { id: 'model' } : {}), input: before, custom: 7 }
      const profile = explicit ? { models: [model] } : { modelOverrides: { model } }
      const recommendation = { fields: { input: after } }
      const preserved = await plan(profile, { recommendation })
      assert.equal(preserved.canApply, false)
      assert.ok(preserved.warnings.some(warning => warning.includes('Existing input modalities')))
      const result = await plan(profile, { recommendation, request: { overwrite: true } })
      assert.equal(result.requiresConfirmation, true)
      assert.deepEqual(result.changes, [{ field: 'model.input', before, after }])
      assert.equal((explicit ? result.ops[0].value[0] : result.ops[0].value).custom, 7)
    }
  }
})
test('unknown image capability does not erase or invent input settings', async () => {
  for (const input of [undefined, [], ['text'], ['text', 'image']]) {
    for (const overwrite of [false, true]) {
      const model = { id: 'model', ...(input === undefined ? {} : { input }) }
      const result = await plan({ models: [model] }, { recommendation: { fields: {} }, request: { overwrite } })
      assert.equal(result.canApply, false)
      assert.deepEqual(result.changes, [])
    }
  }
})
test('invalid recommended input arrays cannot reach settings writes', async () => {
  for (const input of [null, false, 'image', [], ['audio'], ['text', 'image', 'image'], ['text', null]]) {
    await assert.rejects(plan({ models: [{ id: 'model' }] }, { recommendation: { fields: { input } } }), /Invalid recommended input/)
  }
})
test('read-back verification checks only planned paths', () => {
  assert.equal(verifyOperations({ value: { x: 3, extra: 1 } }, [{ op: 'set', path: ['x'], value: 3 }]), true)
  assert.equal(verifyOperations({ value: { x: 4 } }, [{ op: 'set', path: ['x'], value: 3 }]), false)
})
