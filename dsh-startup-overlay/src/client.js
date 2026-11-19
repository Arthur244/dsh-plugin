/** No hard dependency: the deadline starts even if core service provision is delayed. */
export const inject = []

/** One finite main-plugin startup task. The port only observes shared service reads. */
export function waitForStartup(port, { timeoutMs = 8000, signal } = {}) {
  return new Promise(resolve => {
    const startedAt = port.now()
    let done = false
    let sources = null
    let timer = null
    let last = { settings: 'pending', account: 'pending' }
    const disposers = []
    const own = dispose => {
      if (done) dispose()
      else disposers.push(dispose)
    }
    const finish = reason => {
      if (done) return
      done = true
      if (timer !== null) {
        try { port.clearTimeout(timer) } catch { /* Resolution must survive cleanup failures. */ }
      }
      for (const dispose of disposers.splice(0).reverse()) {
        try { dispose() } catch { /* Cleanup must not reject boot. */ }
      }
      resolve({ reason, ...last, elapsedMs: Math.max(0, Math.round(port.now() - startedAt)) })
    }
    const check = () => {
      if (done || sources === null) return
      try {
        const settings = sources.settings.getSnapshot()
        const account = sources.account.getSnapshot()
        last = {
          settings: settings.error != null ? 'error'
            : settings.status === 'ready' && settings.view !== undefined ? 'ready' : 'pending',
          account: account.failed ? 'error' : account.view !== undefined ? 'ready' : 'pending',
        }
        port.report?.({ ...last })
        if (last.settings === 'error') finish('settings-error')
        else if (last.account === 'error') finish('account-error')
        else if (last.settings === 'ready' && last.account === 'ready') finish('ready')
      } catch { finish('adapter-error') }
    }
    const attach = source => {
      if (done || sources !== null) return
      try {
        sources = typeof source === 'function' ? source() : source
        // Subscribe before sampling; synchronous subscription callbacks are also safe.
        own(sources.settings.subscribe(check))
        if (!done) own(sources.subscribeAccount(check))
        check()
        if (!done) {
          // Joins the shared describe; never cancels it or starts an independent RPC.
          Promise.resolve(sources.settings.ensure()).then(check, () => finish('settings-error'))
        }
      } catch { finish('adapter-error') }
    }
    try {
      if (signal?.aborted) { finish('disposed'); return }
      timer = port.setTimeout(() => { check(); finish('timeout') }, timeoutMs)
      if (signal) {
        const abort = () => finish('disposed')
        signal.addEventListener('abort', abort, { once: true })
        own(() => signal.removeEventListener('abort', abort))
      }
      if (port.connect) own(port.connect(attach, () => finish('services-revoked'), () => done))
      else attach(port)
    } catch { finish('adapter-error') }
  })
}

/** Cordis/Loader awaits this main apply Promise before mounting the application. */
export async function apply(ctx) {
  const desktop = 'dshDesktop' in globalThis
  const startedAt = performance.now()
  const history = []
  const record = (phase, fields = {}) => {
    history.push({ phase, atMs: Math.round(performance.now()), ...fields })
    if (history.length > 16) history.shift()
  }
  let phase = desktop ? 'waiting' : 'skipped'
  let result = null
  record(phase)

  // Optional, synchronous dependency callback. A late runner can read earlier history.
  // Neither the diagnostic dependency nor its child lifetime is awaited.
  try {
    ctx.inject(['cordisInspect'], scope => {
      try {
        scope.effect(() => scope.cordisInspect.register({
          manifest: {
            id: 'StartupOverlay',
            description: 'Read-only startup readiness timing and terminal flags; no page or account content.',
            methods: [{
              name: 'status', description: 'Return this activation’s bounded readiness barrier result.',
              inputSchema: { type: 'object', properties: {}, additionalProperties: false },
              outputSchema: { type: 'object' },
            }],
          },
          async query(method) {
            if (method !== 'status') throw new Error('Unknown StartupOverlay method')
            return { version: '0.2.1', strategy: 'readiness-barrier', desktop, timeoutMs: 8000,
              startedAtMs: Math.round(startedAt), phase, result, history: history.slice() }
          },
        }), 'startup-overlay: read-only diagnostics')
      } catch { record('diagnostics-unavailable') }
    })
  } catch { record('diagnostics-unavailable') }
  if (!desktop) return

  const controller = new AbortController()
  ctx.effect(() => () => { controller.abort() }, 'startup-overlay: barrier lifetime')
  result = await waitForStartup({
    // This callback does not return a pending Promise: only the main apply owns the gate.
    connect(attach, revoked, isDone) {
      ctx.inject(['configForms', 'accountUi'], scope => {
        if (isDone()) return
        scope.effect(() => {
          attach(() => ({
            settings: scope.configForms.describe(),
            account: scope.accountUi,
            subscribeAccount: listener => scope.on('account-ui/change', listener),
          }))
          return revoked
        }, 'startup-overlay: readiness services')
      })
      // Cordis owns the dependency child. Late activation checks isDone() before any work.
      return () => {}
    },
    now: () => performance.now(),
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: timer => globalThis.clearTimeout(timer),
    report(flags) {
      const previous = history.at(-1)
      if (previous?.settings !== flags.settings || previous?.account !== flags.account) record('waiting', flags)
    },
  }, { timeoutMs: 8000, signal: controller.signal })
  phase = 'released'
  record(phase, result)
}
