/**
 * Request-local compatibility bridge for DSH 0.2.2-rc.3 / pi-ai 1.3.0.
 * DSH has no public payload hook. Never patch the registered runtime, adapter,
 * collection, profile, prototype or global fetch: only fork this call's views.
 */
export function omitWireEffort(payload) {
  const clean = { ...payload }
  delete clean.reasoning_effort
  if (clean.reasoning && typeof clean.reasoning === 'object' && !Array.isArray(clean.reasoning)) {
    clean.reasoning = { ...clean.reasoning }
    delete clean.reasoning.effort
    if (Object.keys(clean.reasoning).length === 0) delete clean.reasoning
  }
  return clean
}

function unsupported() {
  return Object.assign(new Error('review effort filter is incompatible with this DSH adapter; no review request was sent'), {
    code: 'REVIEW_EFFORT_FILTER_UNSUPPORTED',
  })
}

export function reviewDispatch(llm, options, next) {
  if (typeof llm.registration !== 'function') throw unsupported()
  const registration = llm.registration(options.provider)
  const adapter = registration.adapter
  // Other adapters still receive the filtered GenerateOptions through DSH.
  if (adapter?.constructor?.name !== 'PiAiAdapter') return next()
  if (typeof llm.adapterStream !== 'function' || typeof adapter.current !== 'function'
    || typeof adapter.streamWithSnapshot !== 'function') throw unsupported()
  const snapshot = adapter.current()
  if (!(snapshot?.profiles instanceof Map) || typeof snapshot.models?.streamSimple !== 'function') throw unsupported()

  const profiles = new Map(snapshot.profiles)
  const profile = profiles.get(options.provider)
  if (!profile) throw unsupported()
  const reviewProfile = { ...profile }
  delete reviewProfile.reasoning
  profiles.set(options.provider, reviewProfile)

  const streamSimple = (model, context, sdkOptions) => {
    const filtered = { ...sdkOptions }
    delete filtered.reasoning
    const prepare = filtered.onPayload
    filtered.onPayload = async (payload, target) => {
      const prepared = await prepare?.(payload, target)
      return omitWireEffort(prepared === undefined ? payload : prepared)
    }
    return snapshot.models.streamSimple(model, context, filtered)
  }
  const models = new Proxy(snapshot.models, { get(target, key) {
    if (key === 'streamSimple') return streamSimple
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  const scopedSnapshot = { ...snapshot, profiles, models }
  const scopedAdapter = Object.create(adapter)
  Object.defineProperty(scopedAdapter, 'current', { value: () => scopedSnapshot })
  const scopedRuntime = Object.create(llm)
  Object.defineProperty(scopedRuntime, 'registration', { value: provider => {
    if (provider !== options.provider) throw unsupported()
    return { ...registration, adapter: scopedAdapter }
  } })
  // Retain DSH preparation/projection/error handling. This terminal dispatch
  // intentionally bypasses later stream hooks; see README for replay limits.
  return scopedRuntime.adapterStream(options)
}
