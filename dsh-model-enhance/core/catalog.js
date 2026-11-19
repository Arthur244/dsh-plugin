const BLOCKED = new Set(['__proto__', 'prototype', 'constructor'])
const PASS_THROUGH_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh'])
const PASS_THROUGH_APIS = new Set(['openai-completions', 'openai-responses'])

function object(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function text(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value)
}

function identifier(value) {
  return text(value) && !BLOCKED.has(value)
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function own(value, key) {
  return Object.hasOwn(value, key) ? value[key] : undefined
}

function reasoningOptions(value) {
  if (Array.isArray(value)) return value.filter(object)
  if (!object(value)) return []
  if (typeof own(value, 'type') === 'string' || typeof own(value, 'kind') === 'string') return [value]
  return Object.entries(value).flatMap(([kind, details]) => {
    if (!identifier(kind)) return []
    if (Array.isArray(details)) return [{ kind, values: details }]
    return object(details) ? [{ ...details, kind }] : []
  })
}

/** Reduce the untrusted models.dev directory to explicitly supported, detached fields. */
export function normalizeCatalog(raw) {
  if (!object(raw)) throw new TypeError('Catalog must be an object keyed by provider')
  const records = []
  const providers = []
  let ignored = 0
  for (const [provider, entry] of Object.entries(raw)) {
    if (!identifier(provider) || !object(entry) || !object(own(entry, 'models'))) {
      ignored++
      continue
    }
    const providerName = text(own(entry, 'name')) ? entry.name : provider
    let validModels = 0
    const seen = new Set()
    for (const [sourceId, model] of Object.entries(entry.models)) {
      if (!identifier(sourceId) || !object(model)) { ignored++; continue }
      const id = own(model, 'id') ?? sourceId
      if (!identifier(id) || seen.has(id)) { ignored++; continue }
      seen.add(id)
      const name = text(own(model, 'name')) ? model.name : id
      const record = { key: JSON.stringify([provider, id]), provider, providerName, id, name }
      if (identifier(own(model, 'canonical_model_id'))) record.canonical = model.canonical_model_id
      const limit = own(model, 'limit')
      if (object(limit)) {
        if (positiveInteger(own(limit, 'context'))) record.contextWindow = limit.context
        if (positiveInteger(own(limit, 'output'))) record.maxTokens = limit.output
      }
      const modalities = own(model, 'modalities')
      if (object(modalities) && Array.isArray(own(modalities, 'input'))) {
        const input = ['text', 'image'].filter(kind => modalities.input.includes(kind))
        if (input.length) record.input = input
      }
      const efforts = []
      const kinds = []
      for (const option of reasoningOptions(own(model, 'reasoning_options'))) {
        const kind = own(option, 'type') ?? own(option, 'kind')
        if (!identifier(kind)) continue
        if (!kinds.includes(kind)) kinds.push(kind)
        if (kind !== 'effort' || !Array.isArray(own(option, 'values'))) continue
        for (const effort of option.values) {
          if (identifier(effort) && !efforts.includes(effort)) efforts.push(effort)
        }
      }
      record.efforts = efforts
      if (own(model, 'reasoning') === true || efforts.length > 0 || kinds.length > 0) record.reasoning = true
      else if (own(model, 'reasoning') === false) record.reasoning = false
      record.reasoningKinds = kinds
      records.push(record)
      validModels++
    }
    if (validModels) providers.push({ id: provider, name: providerName })
  }
  return { records, providers, ignored }
}

// Only normalize typography/separators. Never remove versions, dates, or model suffixes.
function normalizedName(value) {
  return text(value) ? value.normalize('NFKC').toLowerCase().replace(/[\s_]+/gu, '-') : ''
}

/** Match the strongest available evidence, retaining cross-provider ambiguity. */
export function matchModel({ id, name } = {}, records = [], { sourceProvider, routeProvider } = {}) {
  let pool = Array.isArray(records) ? records : []
  if (sourceProvider !== undefined) pool = pool.filter(record => record.provider === sourceProvider)
  else if (identifier(routeProvider) && pool.some(record => record.provider === routeProvider)) {
    pool = pool.filter(record => record.provider === routeProvider)
  }
  const stages = [
    ['exact-id', record => text(id) && record.id === id],
    ['canonical', record => text(id) && record.canonical === id],
    ['exact-name', record => text(name) && record.name === name],
    ['normalized-name', record => normalizedName(name) !== '' && normalizedName(record.name) === normalizedName(name)],
  ]
  for (const [confidence, matches] of stages) {
    const candidates = pool.filter(matches).map(record => ({ ...record, confidence }))
    if (candidates.length) return { status: candidates.length === 1 ? 'matched' : 'ambiguous', candidates }
  }
  return { status: 'unmatched', candidates: [] }
}

/** Recommend only persisted capability fields; never invent a per-model default. */
export function recommendModel(record, { api } = {}) {
  const fields = {}
  const warnings = []
  if (!object(record)) return { fields, warnings: ['No valid model record was supplied.'] }
  if (positiveInteger(record.contextWindow)) fields.contextWindow = record.contextWindow
  if (positiveInteger(record.maxTokens)) {
    fields.maxTokens = record.maxTokens
    warnings.push('maxTokens is the catalog output limit, not a recommended routine request budget.')
  }
  if (Array.isArray(record.input)) {
    const input = ['text', 'image'].filter(kind => record.input.includes(kind))
    if (input.length) fields.input = input
  }
  if (!fields.input) warnings.push('Source input modalities are unknown; existing image capability is preserved and no input setting is imported.')
  if (record.reasoning === false) fields.reasoningEfforts = false
  else if (record.reasoning === true) {
    const efforts = Array.isArray(record.efforts) ? record.efforts : []
    if (PASS_THROUGH_APIS.has(api)) {
      const supported = efforts.filter(effort => PASS_THROUGH_EFFORTS.has(effort))
      if (supported.length) fields.reasoningEfforts = Object.fromEntries(supported.map(effort => [effort, effort]))
      if (efforts.some(effort => !PASS_THROUGH_EFFORTS.has(effort))) {
        warnings.push('Some source efforts have no verified protocol mapping; none is never converted to off.')
      }
    } else if (efforts.length) {
      warnings.push('This API has no verified direct reasoning-effort mapping; configure its wire values manually.')
    }
    if (!fields.reasoningEfforts) warnings.push('Reasoning is advertised, but no safe effort mapping could be recommended.')
    if (Array.isArray(record.reasoningKinds) && record.reasoningKinds.some(kind => kind !== 'effort')) {
      warnings.push('Toggle, token-budget, or unknown reasoning options are informational; they are not converted into effort levels.')
    }
  } else warnings.push('Source reasoning capability is unknown; no reasoning configuration is imported.')
  return { fields, warnings }
}
