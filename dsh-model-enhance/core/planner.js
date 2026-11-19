// Pure settings planner. It never writes settings or performs model inference.
const DANGEROUS = new Set(['__proto__', 'prototype', 'constructor'])
export const own = (object, key) => object != null && Object.hasOwn(object, key)
export const clone = value => value === undefined ? undefined : structuredClone(value)
// SettingsForms resolves object fields in schema order. JSON object key order
// is not a value change; array order and every actual field still must match.
export function equal(a, b) {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]))
  }
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && equal(a[key], b[key]))
}
export function safeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !DANGEROUS.has(value)
}
export function at(object, path) {
  return path.reduce((value, key) => own(value, key) ? value[key] : undefined, object)
}
function schemaHasPiAi(schema) {
  // settings.describe() returns Schemastery serialization, NOT the JSON Schema
  // projection exposed by Config Inspect. Follow only root.providers -> profile;
  // a similar-looking object elsewhere must never authorize this write path.
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (!object(schema)) return false
  const refs = object(schema.refs) ? schema.refs : {}
  const resolve = value => {
    const seen = new Set()
    while (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || seen.has(value) || !own(refs, value)) return undefined
      seen.add(value)
      value = refs[value]
    }
    return object(value) ? value : undefined
  }
  const root = resolve(own(schema, 'uid') ? schema.uid : schema)
  if (root?.type !== 'object' || !object(root.dict) || !own(root.dict, 'providers')) return false
  const providers = resolve(root.dict.providers)
  if (providers?.type !== 'dict') return false
  const profile = resolve(providers.inner)
  if (profile?.type !== 'object' || !object(profile.dict)) return false
  const fields = profile.dict
  const expected = { models: 'array', modelOverrides: 'dict', reasoning: 'union', api: 'union' }
  return Object.entries(expected).every(([key, type]) => own(fields, key) && resolve(fields[key])?.type === type)
}
export function routeTarget(directory, descriptors, provider) {
  const entry = directory.find(item => item.provider === provider)
  if (!entry) throw new Error('Model route is not configurable')
  if (entry.error) throw new Error('Provider configuration has an adapter error; repair it before injection')
  const descriptor = descriptors.find(item => item.ns === entry.settingsNs)
  const path = entry.settingsPath
  if (!descriptor || !Array.isArray(path) || path.length !== 2 || path[0] !== 'providers'
      || path[1] !== provider || !safeId(provider) || !schemaHasPiAi(descriptor.schema)) {
    throw new Error('Only generic pi-ai provider settings are supported in this version')
  }
  if (!Number.isSafeInteger(descriptor.revision)) throw new Error('Settings revision is unavailable')
  const profile = at(descriptor.value, path) ?? {}
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Invalid provider profile')
  return { entry, descriptor, path, profile }
}
function changedFields(before, after, prefix) {
  return Object.entries(after).filter(([key, value]) => !equal(before?.[key], value))
    .map(([key, value]) => ({ field: `${prefix}.${key}`, before: clone(before?.[key]) ?? null, after: clone(value) }))
}
const validMapping = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.entries(value).some(([key, wire]) => key !== 'off' && typeof wire === 'string' && wire.length > 0)

/** Minimal one-model edits. Provider/session defaults are deliberately untouched. */
export async function planInjection({ target, modelId, recommendation, request, knownModels }) {
  if (!safeId(modelId)) throw new Error('Invalid actual model ID')
  if (!knownModels.some(model => model.id === modelId)) throw new Error('Model is not in the DSH added-model list')
  const { descriptor, path, profile } = target
  const warnings = [...(recommendation.warnings ?? [])]
  const fields = clone(recommendation.fields)
  for (const key of ['contextWindow', 'maxTokens']) {
    if (fields[key] !== undefined && (!Number.isSafeInteger(fields[key]) || fields[key] <= 0)) throw new Error('Invalid recommended ' + key)
  }
  if (fields.input !== undefined && (!Array.isArray(fields.input) || !fields.input.length
      || fields.input.some(kind => !['text', 'image'].includes(kind))
      || new Set(fields.input).size !== fields.input.length)) throw new Error('Invalid recommended input')
  // Only these persisted model fields can come from a recommendation.
  for (const key of Object.keys(fields)) if (!['contextWindow', 'maxTokens', 'input', 'reasoningEfforts'].includes(key)) throw new Error('Unsupported recommended field')
  const explicit = Array.isArray(profile.models)
  if (!explicit && own(profile, 'models')) throw new Error('Invalid existing model list')
  let before, index = -1
  if (explicit) {
    if (profile.models.some(model => !model || !safeId(model.id))) throw new Error('Existing model list cannot be safely edited')
    if (new Set(profile.models.map(model => model.id)).size !== profile.models.length) throw new Error('Existing model list contains duplicate IDs')
    index = profile.models.findIndex(model => model.id === modelId)
    if (index < 0) throw new Error('Model is not in the saved provider model list')
    before = profile.models[index]
  } else {
    const overrides = profile.modelOverrides ?? {}
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('Invalid model overrides')
    before = overrides[modelId] ?? {}
  }
  const after = { ...before }
  // pi-ai's schema materializes an absent input as []; resolution treats it as inheritance.
  const emptyInput = Array.isArray(before.input) && before.input.length === 0
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'reasoningEfforts') continue
    if (request.overwrite || !own(before, key) || (key === 'input' && emptyInput)) after[key] = clone(value)
    else if (key === 'input' && !equal(before.input, value)) {
      warnings.push('Existing input modalities are preserved. To apply the catalog image capability, enable overwrite and confirm the preview.')
    }
  }
  const recommended = fields.reasoningEfforts
  const prior = before.reasoningEfforts
  const mapping = request.overwrite && recommended !== undefined ? recommended : prior ?? recommended
  if (mapping === false) {
    after.reasoningEfforts = false
    warnings.push('Non-reasoning capability is preserved as false.')
  } else if (validMapping(mapping)) {
    // Remove off regardless of its wire value; keep every other spelling intact.
    after.reasoningEfforts = Object.fromEntries(Object.entries(clone(mapping)).filter(([key]) => key !== 'off'))
    if (prior && typeof prior === 'object' && own(prior, 'off')) {
      warnings.push('The existing off level is removed from the reasoning mapping; review the change before applying.')
    }
  } else {
    warnings.push('No reliable non-off effort mapping is available; original reasoning capability is preserved and no level is invented.')
  }
  if (fields.maxTokens !== undefined) warnings.push('Maximum output is a catalog limit, not a recommended routine request budget.')
  warnings.push('Default reasoning selection and repair are deferred (see TODO.md); provider and explicit session defaults are not changed or certified.')
  const changes = changedFields(before, after, modelId)
  const ops = []
  if (!equal(before, after)) {
    if (explicit) {
      const models = clone(profile.models)
      models[index] = after
      ops.push({ op: 'set', path: [...path, 'models'], value: models })
    } else ops.push({ op: 'set', path: [...path, 'modelOverrides', modelId], value: after })
  }
  return { ns: descriptor.ns, revision: descriptor.revision, ops, changes, warnings, blockers: [],
    requiresConfirmation: changes.some(change => change.before !== null && !(change.field === `${modelId}.input` && emptyInput)), canApply: ops.length > 0 }
}
export function verifyOperations(descriptor, ops) {
  return ops.every(op => equal(at(descriptor.value, op.path), op.value))
}
