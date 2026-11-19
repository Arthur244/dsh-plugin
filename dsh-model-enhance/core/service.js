import { randomUUID } from 'node:crypto'
import { matchModel, recommendModel } from './catalog.js'
import { routeTarget, planInjection, verifyOperations, safeId, equal, clone } from './planner.js'

const METHODS = {
  scan: ['provider', 'sourceProvider'],
  preview: ['provider', 'modelId', 'sourceKey', 'overwrite'],
  apply: ['token', 'confirm'],
}
export function validateRequest(method, value) {
  const allowed = METHODS[method]
  if (!allowed || !value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid request fields')
  for (const key of allowed) {
    if (['overwrite', 'confirm'].includes(key)) {
      if (typeof value[key] !== 'boolean') throw new Error(`Expected boolean ${key}`)
    } else if (key === 'sourceProvider' && value[key] === undefined) continue
    else if (typeof value[key] !== 'string' || value[key].length === 0 || value[key].length > 4096) throw new Error(`Invalid ${key}`)
  }
  return value
}
const publicCandidate = record => ({ key: record.key, provider: record.provider, id: record.id, name: record.name,
  confidence: record.confidence, ...(record.input ? { input: clone(record.input) } : {}) })

/** Read-only local catalog matching plus server-owned, revision-fenced, single-use mutation plans. */
export class ModelEnhanceController {
  constructor({ llm, settings, catalogSource, now = Date.now, token = randomUUID, planTtlMs = 600000, modelListTimeoutMs = 20000 }) {
    this.llm = llm
    this.settings = settings
    this.catalogSource = catalogSource
    this.now = now
    this.token = token
    this.planTtlMs = planTtlMs
    this.plans = new Map()
    this.scans = new Map()
    this.pendingLists = new Set()
    this.modelListTimeoutMs = modelListTimeoutMs
    this.disposed = false
  }
  active() { if (this.disposed) throw new Error('Model enhancement service is disposed') }
  descriptors() { return this.settings.describe({ redactSecrets: true }) }
  directory() { return this.llm.listConfigurableProviders() }
  target(provider) { return routeTarget(this.directory(), this.descriptors(), provider) }
  status() {
    this.active()
    const directory = this.directory()
    const descriptors = this.descriptors()
    const registered = new Set(this.llm.listProviders().map(item => item.id))
    return {
      catalog: this.catalogSource.info(),
      routes: directory.filter(entry => registered.has(entry.provider)).map(entry => {
        let writable = false
        let reason
        try {
          routeTarget(directory, descriptors, entry.provider)
          writable = typeof this.settings.mutate === 'function' && !entry.error
          if (entry.error) reason = 'Provider configuration has an adapter error'
        } catch (error) { reason = error.message }
        return { provider: entry.provider, displayName: entry.displayName, settingsNs: entry.settingsNs,
          writable, ...(reason ? { reason } : {}) }
      }),
      sourceProviders: this.catalogSource.catalog?.providers ?? [],
    }
  }
  async scan(request) {
    this.active()
    validateRequest('scan', request)
    if (!this.catalogSource.info().available) throw new Error('Bundled official recommendations are unavailable; repair the installed package data')
    const target = this.target(request.provider)
    const abort = new AbortController()
    this.pendingLists.add(abort)
    let onAbort
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(abort.signal.reason)
      abort.signal.addEventListener('abort', onAbort, { once: true })
    })
    const timer = setTimeout(() => abort.abort(new Error('Local model catalog lookup timed out')), this.modelListTimeoutMs)
    let models
    try {
      // Use only the registered pi-ai adapter's configured local catalog: the
      // same models already offered by DSH. Never interrogate the endpoint.
      models = await Promise.race([this.llm.listModels(request.provider), cancelled])
    } finally {
      clearTimeout(timer)
      abort.signal.removeEventListener('abort', onAbort)
      this.pendingLists.delete(abort)
    }
    this.active()
    if (!Array.isArray(models) || models.length > 20000) throw new Error('Invalid or oversized provider model list')
    const seen = new Set()
    const safe = models.filter(model => safeId(model?.id) && !seen.has(model.id) && seen.add(model.id))
      .map(model => ({ id: model.id, name: typeof model.name === 'string' ? model.name.slice(0, 4096) : model.id }))
    const current = this.target(request.provider)
    if (current.descriptor.ns !== target.descriptor.ns || current.descriptor.revision !== target.descriptor.revision
        || !equal(current.profile, target.profile)) throw new Error('Settings changed while reading the local catalog; reload added models')
    const snapshot = { ns: target.descriptor.ns, revision: target.descriptor.revision, profile: clone(target.profile),
      models: safe, sourceProvider: request.sourceProvider, at: this.now(), catalog: this.catalogSource.catalog }
    for (const [key, value] of this.scans) if (this.now() - value.at >= this.planTtlMs) this.scans.delete(key)
    this.scans.delete(request.provider)
    while (this.scans.size >= 50) this.scans.delete(this.scans.keys().next().value)
    this.scans.set(request.provider, snapshot)
    return { provider: request.provider, models: safe.map(model => {
      const result = matchModel(model, this.catalogSource.catalog.records, { sourceProvider: request.sourceProvider, routeProvider: request.provider })
      return { ...model, match: { status: result.status, candidates: result.candidates.map(publicCandidate) } }
    }), warnings: ['Only models already available in DSH for this provider are listed. No provider model-discovery or inference request was made.'] }
  }
  checkedScan(provider, scanned) {
    this.active()
    if (!scanned || this.scans.get(provider) !== scanned || this.now() - scanned.at >= this.planTtlMs
        || scanned.catalog !== this.catalogSource.catalog) throw new Error('Reload added models before previewing or applying')
    const target = this.target(provider)
    if (target.descriptor.ns !== scanned.ns || target.descriptor.revision !== scanned.revision
        || !equal(target.profile, scanned.profile)) throw new Error('Settings changed since catalog loading; reload added models')
    return target
  }
  async buildPlan(target, request, record) {
    const knownModels = await this.llm.listModels(request.provider)
    this.active()
    return planInjection({ target, modelId: request.modelId,
      recommendation: recommendModel(record, { api: target.profile.api ?? (target.entry.declared ? 'openai-completions' : undefined) }), request, knownModels })
  }
  async preview(request) {
    this.active()
    validateRequest('preview', request)
    const scanned = this.scans.get(request.provider)
    const target = this.checkedScan(request.provider, scanned)
    const model = scanned.models.find(item => item.id === request.modelId)
    if (!model) throw new Error('Actual model ID was not present in the added model list')
    const matches = matchModel(model, this.catalogSource.catalog.records, {
      sourceProvider: scanned.sourceProvider, routeProvider: request.provider,
    })
    const record = matches.candidates.find(item => item.key === request.sourceKey)
    if (!record) throw new Error('Selected source is not a matching candidate')
    const plan = await this.buildPlan(target, request, record)
    // A new local scan or settings edit may have happened during planning awaits.
    this.checkedScan(request.provider, scanned)
    // Bound memory and invalidate old plans without retaining profile secrets in Client responses.
    for (const [key, value] of this.plans) if (this.now() - value.createdAt >= this.planTtlMs) this.plans.delete(key)
    while (this.plans.size >= 100) this.plans.delete(this.plans.keys().next().value)
    const token = this.token()
    this.plans.set(token, { ...clone(plan), provider: request.provider, createdAt: this.now(), profile: clone(target.profile),
      request: clone(request), record: clone(record), scanned })
    return { token, changes: plan.changes, warnings: plan.warnings, blockers: plan.blockers,
      requiresConfirmation: plan.requiresConfirmation, canApply: plan.canApply }
  }
  async apply(request) {
    this.active()
    validateRequest('apply', request)
    const plan = this.plans.get(request.token)
    if (!plan || this.now() - plan.createdAt >= this.planTtlMs) throw new Error('Preview expired or already used; generate a fresh preview')
    // Consume before the first await; even a rejected write cannot be replayed blindly.
    this.plans.delete(request.token)
    if (!plan.canApply || plan.blockers.length) throw new Error('Preview cannot be applied')
    if (plan.requiresConfirmation && !request.confirm) throw new Error('Impact confirmation is required')
    const current = this.target(plan.provider)
    if (current.descriptor.ns !== plan.ns || current.descriptor.revision !== plan.revision || !equal(current.profile, plan.profile)) {
      throw Object.assign(new Error('Settings changed; reload and generate a new preview'), { code: 'settings/conflict' })
    }
    this.checkedScan(plan.provider, plan.scanned)
    const rebuilt = await this.buildPlan(current, plan.request, plan.record)
    this.checkedScan(plan.provider, plan.scanned)
    if (!rebuilt.canApply || !equal(rebuilt.ops, plan.ops)) {
      throw new Error('Effective model capabilities changed; generate a fresh preview')
    }
    await this.settings.mutate(plan.ns, clone(plan.ops), plan.revision)
    this.active()
    let verified = false
    const warnings = [...plan.warnings]
    try {
      const after = this.descriptors().find(item => item.ns === plan.ns)
      verified = !!after && verifyOperations(after, plan.ops)
    } catch { /* Persistence is already committed; never imply it was rolled back. */ }
    if (!verified) warnings.push('Settings write completed, but read-back did not verify the expected fields. Do not blindly repeat it.')
    return { saved: true, verified, warnings }
  }
  dispose() {
    this.disposed = true
    for (const abort of this.pendingLists) abort.abort(new Error('Model enhancement service is disposed'))
    this.pendingLists.clear()
    this.plans.clear()
    this.scans.clear()
    this.catalogSource.dispose()
  }
}
