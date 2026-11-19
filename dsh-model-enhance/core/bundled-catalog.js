import { readFile } from 'node:fs/promises'
import { normalizeCatalog } from './catalog.js'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (value, key) => Object.hasOwn(value, key)

/** Read only the package's curated first-party snapshot. No network or cache writes. */
export class BundledCatalog {
  constructor({ file = new URL('../data/official-models.json', import.meta.url),
    policyFile = new URL('../data/official-vendors.json', import.meta.url) } = {}) {
    this.file = file
    this.policyFile = policyFile
    this.catalog = { records: [], providers: [], ignored: 0 }
    this.generatedAt = null
    this.lastError = undefined
    this.disposed = false
  }
  info() {
    return { available: this.catalog.records.length > 0, bundled: true,
      generatedAt: this.generatedAt, models: this.catalog.records.length, providers: this.catalog.providers.length,
      source: 'bundled-official', ...(this.lastError ? { lastError: this.lastError } : {}) }
  }
  async load() {
    if (this.disposed) throw new Error('Bundled catalog is disposed')
    try {
      const [sourceText, policyText] = await Promise.all([readFile(this.file, 'utf8'), readFile(this.policyFile, 'utf8')])
      if (Buffer.byteLength(sourceText) > 16 * 1024 * 1024) throw new Error('Bundled catalog exceeds the size limit')
      const snapshot = JSON.parse(sourceText), policy = JSON.parse(policyText)
      if (snapshot.version !== 1 || policy.version !== 1 || snapshot.policyVersion !== policy.version
        || snapshot.source !== 'https://models.dev/api.json' || !/^[a-f0-9]{64}$/.test(snapshot.sourceSha256 ?? '')
        || !Number.isFinite(Date.parse(snapshot.generatedAt)) || !object(snapshot.providers)
        || !Array.isArray(policy.vendors)) throw new Error('Invalid bundled catalog envelope or policy')
      const vendors = new Map(policy.vendors.map(vendor => [vendor.id, vendor]))
      for (const [id, provider] of Object.entries(snapshot.providers)) {
        const vendor = vendors.get(id)
        if (!vendor || !object(provider) || provider.id !== id || provider.sourceProvider !== id
          || !object(provider.models) || !Array.isArray(vendor.prefixes)) {
          throw new Error(`Unapproved source provider in bundled catalog: ${id}`)
        }
        for (const [key, model] of Object.entries(provider.models)) {
          const modelId = model?.id ?? key
          if (!object(model) || typeof modelId !== 'string' || !vendor.prefixes.some(prefix => modelId.startsWith(prefix))
            || !model.modalities?.output?.includes('text')) throw new Error(`Unapproved model family: ${id}/${key}`)
        }
      }
      const catalog = normalizeCatalog(snapshot.providers)
      if (!catalog.records.length || catalog.ignored || catalog.records.length !== snapshot.modelCount) {
        throw new Error('Bundled catalog has invalid or duplicate model entries')
      }
      if (this.disposed) return this.info()
      this.catalog = catalog
      this.generatedAt = snapshot.generatedAt
      this.lastError = undefined
    } catch (error) {
      if (!this.disposed) {
        this.catalog = { records: [], providers: [], ignored: 0 }
        this.generatedAt = null
        this.lastError = error instanceof Error ? error.message : String(error)
      }
    }
    return this.info()
  }
  dispose() { this.disposed = true }
}
