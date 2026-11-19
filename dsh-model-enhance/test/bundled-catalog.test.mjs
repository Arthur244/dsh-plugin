import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { BundledCatalog } from '../core/bundled-catalog.js'

const policyFile = new URL('../data/official-vendors.json', import.meta.url)
const snapshot = () => ({ version: 1, policyVersion: 1, source: 'https://models.dev/api.json',
  generatedAt: '2026-11-18T00:00:00Z', sourceSha256: 'a'.repeat(64), modelCount: 1,
  providers: { openai: { id: 'openai', sourceProvider: 'openai', name: 'OpenAI', models: {
    'gpt-example': { id: 'gpt-example', name: 'Example', modalities: { input: ['text'], output: ['text'] },
      reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high'] }] },
  } } } })
async function fixture(t, value = snapshot()) {
  const dir = await mkdtemp(join(tmpdir(), 'dme-bundled-test-'))
  t.after(async () => { assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(dir.includes('dme-bundled-test-')); await rm(dir, { recursive: true, force: true }) })
  const file = join(dir, 'snapshot.json')
  await writeFile(file, JSON.stringify(value))
  return { file, source: new BundledCatalog({ file, policyFile }) }
}
test('package contains only approved first-party source families and no runtime updater', async () => {
  const source = new BundledCatalog()
  const info = await source.load()
  assert.equal(info.available, true, info.lastError)
  assert.equal(info.bundled, true)
  assert.equal(info.source, 'bundled-official')
  assert.ok(info.models > 100)
  assert.equal(typeof source.refresh, 'undefined')
  assert.ok(source.catalog.providers.some(provider => provider.id === 'openai'))
  assert.ok(source.catalog.providers.some(provider => provider.id === 'alibaba'))
  for (const forbidden of ['openrouter', 'azure', 'amazon-bedrock', 'google-vertex', 'together', 'deepinfra']) {
    assert.equal(source.catalog.providers.some(provider => provider.id === forbidden), false)
  }
  assert.equal(source.catalog.records.some(record => record.provider === 'nvidia' && !record.id.startsWith('nvidia/')), false)
  assert.equal(source.catalog.records.some(record => record.provider === 'alibaba' && !/^(qwen|qwq-|qvq-)/.test(record.id)), false)
  source.dispose()
})
test('loader reads engineering snapshot without network or cache writes', async t => {
  const { file, source } = await fixture(t)
  const before = await readFile(file, 'utf8')
  const original = globalThis.fetch
  globalThis.fetch = () => { throw Error('Network is forbidden at runtime') }
  try {
    assert.equal((await source.load()).available, true)
    assert.equal(source.catalog.records[0].id, 'gpt-example')
    assert.equal(await readFile(file, 'utf8'), before)
  } finally { globalThis.fetch = original; source.dispose() }
})
test('third-party provider rows and hosted third-party families are rejected, not loaded', async t => {
  for (const mutation of [
    value => { value.providers.openrouter = value.providers.openai },
    value => { value.providers.openai.models['gpt-example'].id = 'claude-hosted' },
    value => { value.providers.openai.sourceProvider = 'openrouter' },
  ]) {
    const data = snapshot(); mutation(data)
    const { source } = await fixture(t, data)
    const info = await source.load()
    assert.equal(info.available, false)
    assert.match(info.lastError, /Unapproved/)
  }
})
test('bad envelope, duplicates, count mismatch and malformed files fail closed', async t => {
  for (const mutation of [
    value => { value.policyVersion = 2 }, value => { value.sourceSha256 = 'invalid' },
    value => { value.modelCount = 3 }, value => { value.generatedAt = 'bad-time' },
    value => { value.providers.openai.models.duplicate = value.providers.openai.models['gpt-example'] },
  ]) {
    const data = snapshot(); mutation(data)
    const { source } = await fixture(t, data)
    assert.equal((await source.load()).available, false)
    assert.equal(source.catalog.records.length, 0)
  }
  const { file, source } = await fixture(t)
  await writeFile(file, '{bad')
  assert.equal((await source.load()).available, false)
})
test('missing file does not download a replacement and disposed loader cannot reload', async t => {
  const { file, source } = await fixture(t)
  source.file = `${file}.missing`
  assert.equal((await source.load()).available, false)
  source.dispose()
  await assert.rejects(source.load(), /disposed/)
})
