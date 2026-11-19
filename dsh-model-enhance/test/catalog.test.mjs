import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCatalog, matchModel, recommendModel } from '../core/catalog.js'

function model(id, extra = {}) {
  return { id, name: id, reasoning: true, limit: { context: 128000, output: 8192 },
    modalities: { input: ['text', 'image', 'audio'] },
    reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high'] }], ...extra }
}
function directory(models = { alpha: model('alpha') }) {
  return { provider: { id: 'provider', name: 'Provider', models } }
}

test('normalizes only supported detached fields and preserves safe capability information', () => {
  const raw = directory({ alpha: model('alpha', { canonical_model_id: 'canonical/alpha' }) })
  const catalog = normalizeCatalog(raw)
  assert.equal(catalog.ignored, 0)
  assert.deepEqual(catalog.providers, [{ id: 'provider', name: 'Provider' }])
  assert.deepEqual(catalog.records[0], {
    key: JSON.stringify(['provider', 'alpha']), provider: 'provider', providerName: 'Provider',
    id: 'alpha', name: 'alpha', canonical: 'canonical/alpha', contextWindow: 128000,
    maxTokens: 8192, input: ['text', 'image'], efforts: ['none', 'low', 'medium', 'high'],
    reasoning: true, reasoningKinds: ['effort'],
  })
  raw.provider.models.alpha.modalities.input.push('video')
  assert.deepEqual(catalog.records[0].input, ['text', 'image'])
})

test('rejects invalid roots and skips dangerous identifiers without prototype pollution', () => {
  for (const raw of [null, [], 'directory']) assert.throws(() => normalizeCatalog(raw), TypeError)
  const raw = JSON.parse('{"__proto__":{"models":{"evil":{}}},"safe":{"models":{"constructor":{},"ok":{"id":"ok","name":"OK","__proto__":{"polluted":true}}}}}')
  const result = normalizeCatalog(raw)
  assert.equal(result.records.length, 1)
  assert.equal(result.ignored, 2)
  assert.equal({}.polluted, undefined)
  assert.equal(Object.hasOwn(result.records[0], '__proto__'), false)
})

test('capacity values must be positive safe integers; unsupported-only inputs are omitted', () => {
  for (const value of [0, -1, 1.5, '128000', Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const record = normalizeCatalog(directory({ alpha: model('alpha', {
      limit: { context: value, output: value }, modalities: { input: ['video', 'audio'] },
    }) })).records[0]
    assert.equal(record.contextWindow, undefined)
    assert.equal(record.maxTokens, undefined)
    assert.equal(record.input, undefined)
  }
})

test('handles map-style reasoning options without guessing toggle or budgets', () => {
  const record = normalizeCatalog(directory({ alpha: model('alpha', {
    reasoning_options: { effort: { values: ['low', 'low', 'high'] }, toggle: {}, budget_tokens: { min: 1, max: 1024 } },
  }) })).records[0]
  assert.deepEqual(record.efforts, ['low', 'high'])
  assert.deepEqual(record.reasoningKinds, ['effort', 'toggle', 'budget_tokens'])
  const result = recommendModel(record, { api: 'openai-responses' })
  assert.deepEqual(result.fields.reasoningEfforts, { low: 'low', high: 'high' })
  assert.ok(result.warnings.some(message => message.includes('informational')))
})

test('retains cross-provider ambiguity and uses explicitly supplied provider scope', () => {
  const records = normalizeCatalog({
    one: { models: { alpha: model('alpha') } }, two: { models: { alpha: model('alpha') } },
  }).records
  assert.equal(matchModel({ id: 'alpha' }, records).status, 'ambiguous')
  const exact = matchModel({ id: 'alpha' }, records, { sourceProvider: 'two' })
  assert.equal(exact.status, 'matched')
  assert.equal(exact.candidates[0].provider, 'two')
  assert.equal(exact.candidates[0].confidence, 'exact-id')
  assert.equal(matchModel({ id: 'alpha' }, records, { sourceProvider: 'missing' }).status, 'unmatched')
  assert.equal(matchModel({ id: 'alpha' }, records, { routeProvider: 'custom-gateway' }).status, 'ambiguous')
})

test('matches canonical IDs and conservatively normalizes names without removing versions', () => {
  const records = normalizeCatalog(directory({ alpha: model('upstream-v2', {
    name: 'Model 2 Preview', canonical_model_id: 'canonical/model-v2',
  }) })).records
  assert.equal(matchModel({ id: 'canonical/model-v2' }, records).candidates[0].confidence, 'canonical')
  assert.equal(matchModel({ name: 'model_2_preview' }, records).candidates[0].confidence, 'normalized-name')
  assert.equal(matchModel({ name: 'Model 1 Preview' }, records).status, 'unmatched')
  assert.equal(matchModel({ name: 'Model 2' }, records).status, 'unmatched')
  assert.equal(matchModel({ name: 'Model 2 Preview Latest' }, records).status, 'unmatched')
})

test('only known OpenAI wire spellings pass through; none never becomes off', () => {
  const record = normalizeCatalog(directory()).records[0]
  for (const api of ['openai-completions', 'openai-responses']) {
    const result = recommendModel(record, { api })
    assert.deepEqual(result.fields.reasoningEfforts, { low: 'low', medium: 'medium', high: 'high' })
    assert.equal(Object.hasOwn(result.fields.reasoningEfforts, 'off'), false)
    assert.equal(Object.hasOwn(result.fields, 'reasoning'), false)
    assert.equal(Object.hasOwn(result.fields, 'defaultEffort'), false)
    assert.ok(result.warnings.some(message => message.includes('none')))
  }
  for (const api of [undefined, 'anthropic-messages', 'unknown']) {
    const result = recommendModel(record, { api })
    assert.equal(result.fields.reasoningEfforts, undefined)
    assert.ok(result.warnings.length)
  }
})

test('advertised reasoning without usable effort data does not invent a mapping', () => {
  const record = normalizeCatalog(directory({ alpha: model('alpha', {
    reasoning_options: [{ kind: 'budget_tokens', min: 0 }],
  }) })).records[0]
  assert.equal(recommendModel(record, { api: 'openai-completions' }).fields.reasoningEfforts, undefined)
  const plain = normalizeCatalog(directory({ alpha: model('alpha', { reasoning: false, reasoning_options: [] }) })).records[0]
  assert.equal(recommendModel(plain).fields.reasoningEfforts, false)
})

test('missing reasoning data is unknown, never a declaration to disable reasoning', () => {
  const record = normalizeCatalog({ source: { models: { id: { id: 'id', name: 'Unknown' } } } }).records[0]
  assert.equal(record.reasoning, undefined)
  const recommendation = recommendModel(record, { api: 'openai-completions' })
  assert.equal(Object.hasOwn(recommendation.fields, 'reasoningEfforts'), false)
  assert.ok(recommendation.warnings.some(message => message.includes('unknown')))
})

test('image support and text-only metadata recommend explicit persisted input arrays', () => {
  for (const input of [['text', 'image', 'audio'], ['text']]) {
    const record = normalizeCatalog(directory({ alpha: model('alpha', { modalities: { input } }) })).records[0]
    const result = recommendModel(record)
    assert.deepEqual(result.fields.input, input.filter(kind => ['text', 'image'].includes(kind)))
    assert.equal(result.warnings.some(message => message.includes('input modalities are unknown')), false)
  }
})
test('missing, empty and unsupported input metadata remains unknown instead of disabling images', () => {
  for (const modalities of [undefined, {}, { input: null }, { input: 'image' }, { input: [] }, { input: ['audio'] }]) {
    const record = normalizeCatalog(directory({ alpha: model('alpha', { modalities }) })).records[0]
    const result = recommendModel(record)
    assert.equal(Object.hasOwn(result.fields, 'input'), false)
    assert.ok(result.warnings.some(message => message.includes('input modalities are unknown')))
  }
})
test('invalid source rows and duplicate resolved IDs are ignored, not silently overwritten', () => {
  const result = normalizeCatalog({ provider: { models: { one: model('same'), two: model('same'), bad: [] } }, invalid: null })
  assert.equal(result.records.length, 1)
  assert.equal(result.ignored, 3)
})
