// Developer-only generator. This file is not imported by the plugin and is
// excluded from the runtime package. It never reads profiles or credentials.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const source = 'https://models.dev/api.json'
const policy = JSON.parse(await readFile(new URL('../data/official-vendors.json', import.meta.url), 'utf8'))
const response = await fetch(source, { signal: AbortSignal.timeout(45000), redirect: 'error', credentials: 'omit' })
if (!response.ok) throw new Error(`Public catalog HTTP ${response.status}`)
const chunks = []
let bytes = 0
for await (const chunk of response.body) {
  bytes += chunk.byteLength
  if (bytes > 64 * 1024 * 1024) throw new Error('Public catalog exceeds developer download limit')
  chunks.push(Buffer.from(chunk))
}
const body = Buffer.concat(chunks)
const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
const providers = {}
const report = []
for (const vendor of policy.vendors) {
  const provider = Object.hasOwn(raw, vendor.id) ? raw[vendor.id] : undefined
  if (!provider || typeof provider !== 'object' || !provider.models || Array.isArray(provider.models)) {
    report.push({ vendor: vendor.id, included: 0, reason: 'No exact first-party provider in this source snapshot' })
    continue
  }
  const models = {}
  for (const [key, model] of Object.entries(provider.models)) {
    if (!model || typeof model !== 'object' || Array.isArray(model)) continue
    const id = model.id ?? key
    if (typeof id !== 'string' || !vendor.prefixes.some(prefix => id.startsWith(prefix))) continue
    // Only language models with a text output belong in this plugin. Exclude
    // third-party families, embeddings and image/audio-only endpoints.
    if (!Array.isArray(model.modalities?.output) || !model.modalities.output.includes('text')) continue
    models[key] = Object.fromEntries(['id', 'name', 'family', 'canonical_model_id', 'limit', 'modalities',
      'reasoning', 'reasoning_options', 'tool_call', 'temperature', 'structured_output', 'status',
      'release_date', 'last_updated'].filter(field => Object.hasOwn(model, field)).map(field => [field, model[field]]))
  }
  const included = Object.keys(models).length
  if (included) providers[vendor.id] = { id: vendor.id, name: vendor.name, officialWebsite: vendor.website,
    sourceProvider: vendor.id, models }
  report.push({ vendor: vendor.id, sourceName: provider.name, sourceDocumentation: provider.doc, included })
}
const count = Object.values(providers).reduce((sum, provider) => sum + Object.keys(provider.models).length, 0)
if (!count) throw new Error('No first-party language models passed the inclusion policy')
const snapshot = { version: 1, policyVersion: policy.version, source, generatedAt: new Date().toISOString(),
  sourceSha256: createHash('sha256').update(body).digest('hex'), modelCount: count, providers }
await writeFile(new URL('../data/official-models.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ source, generatedAt: snapshot.generatedAt, sourceSha256: snapshot.sourceSha256,
  models: count, providers: Object.keys(providers).length, report }, null, 2))
