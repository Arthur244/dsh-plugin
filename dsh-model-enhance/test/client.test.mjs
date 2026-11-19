import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const plain = (value) => JSON.parse(JSON.stringify(value))
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const status = () => ({
  catalog: { available: true, bundled: true, generatedAt: '2026-01-01T00:00:00Z', models: 10000, providers: 12, source: 'bundled-official' },
  routes: [{ provider: 'target', displayName: 'Target', writable: true, settingsNs: 'llm-pi-ai' }],
  sourceProviders: [{ id: 'source', name: 'Source' }],
})
const candidate = (key = 'source/model') => ({ key, provider: 'source', id: 'model', name: 'Model', confidence: 'exact' })
const scan = (models) => ({ provider: 'target', models: models ?? [{ id: 'wire-id', name: 'Model', match: { status: 'matched', candidates: [candidate()] } }], warnings: [] })
const preview = (extra = {}) => ({
  token: 'host-token', changes: [{ field: 'contextWindow', before: undefined, after: 128000 }], warnings: [], blockers: [],
  requiresConfirmation: false, canApply: true, ...extra,
})

async function harness(overrides = {}) {
  const requests = []
  const effects = []
  const registrations = []
  const dictionaries = new Map()
  const localeListeners = new Set()
  let loaded, registrationRemoved = 0, localeRemoved = 0, injectRemoved = 0, remoteRemoved = 0
  const contributions = []
  const required = []
  const frames = new Map()
  const focusEvents = []
  let hookValues, hookIndex, pendingEffects, lastId = 0
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((value) => value !== null && value !== undefined && value !== false) }),
    useRef: (initial) => hookValues[hookIndex++] ??= { current: initial },
    useId: () => hookValues[hookIndex++] ??= `:test-${++lastId}:`,
    useEffect: (effect, deps) => {
      const index = hookIndex++
      const previous = hookValues[index]
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        const next = { deps }
        pendingEffects.push(() => { previous?.cleanup?.(); next.cleanup = effect() })
        hookValues[index] = next
      }
    },
  }
  const scope = {
    window: { __ModuleLoader__: { load: (entry) => { loaded = entry } } },
    setTimeout: overrides.timers?.setTimeout ?? setTimeout,
    clearTimeout: overrides.timers?.clearTimeout ?? clearTimeout,
  }
  const clearFrame = (frame) => { for (const hook of frame) hook?.cleanup?.() }
  vm.runInNewContext(source, scope, { filename: 'client.js' })
  assert.equal(loaded.id, 'dsh-model-enhance')
  assert.equal(required.length, 0, 'factory stays lazy')
  const plugin = loaded.factory((name) => { required.push(name); assert.equal(name, 'react'); return React })
  assert.deepEqual(required, ['react'])
  assert.deepEqual(plain(plugin.inject), ['locale', 'remote', 'slots'])
  const service = {}
  const defaults = {
    status: async () => status(), scan: async () => scan(),
    preview: async () => preview(), apply: async () => ({ saved: true, verified: true, warnings: [] }),
  }
  for (const method of Object.keys(defaults)) {
    service[method] = async (input) => {
      requests.push([method, input === undefined ? undefined : plain(input)])
      if (overrides[method]) return overrides[method](input)
      return { ok: true, value: await defaults[method](input) }
    }
  }
  const ctx = {
    inject(deps, callback) {
      assert.deepEqual(plain(deps), ['remote.modelEnhance'])
      assert.equal(contributions.length, 1, 'namespace injection must follow mounting')
      const child = Object.create(ctx)
      child.remote = Object.create(ctx.remote)
      Object.defineProperty(child.remote, 'modelEnhance', { value: service })
      return callback(child)
    },
    remote: {
      get modelEnhance() { throw new Error('cannot get property "remote.modelEnhance" without inject') },
      $mount: async (contribution) => {
        // Match rc.3 ClientRemote.$mount: permissive input codecs must fail
        // before any slot is registered (the original real-GUI regression).
        for (const descriptor of contribution.descriptors) {
          for (const parameter of descriptor.parameters) {
            assert.equal(parameter.codec.mode, 'strict', `${descriptor.method} input must be strict`)
            assert.equal(typeof parameter.codec.create().parse, 'function')
          }
        }
        contributions.push(plain(contribution))
        if (overrides.mount) await overrides.mount(contribution)
        let live = true
        return async () => {
          if (!live) return
          live = false
          remoteRemoved++
        }
      },
    },
    locale: {
      register: (ns, dicts) => {
        assert.equal(ns, 'settings.dsh-model-enhance')
        assert.deepEqual(Object.keys(dicts.zh).sort(), Object.keys(dicts.en).sort())
        dictionaries.set(ns, dicts)
        return () => { localeRemoved++; dictionaries.delete(ns) }
      },
      // The real slot runtime handles locale subscriptions, not this plugin.
      subscribe: (fn) => { localeListeners.add(fn); return () => localeListeners.delete(fn) },
    },
    effect: (fn) => { const cleanup = fn(); if (typeof cleanup === 'function') effects.push(cleanup) },
    slots: {
      register: (options, Component) => {
        registrations.push({ options, Component })
        return () => { registrationRemoved++ }
      },
      inject: (name, fn) => {
        assert.equal(name, 'settings.models.footer')
        const cleanup = fn()
        effects.push(() => { cleanup(); injectRemoved++ })
      },
    },
  }
  const probe = {
    requests, registrations, contributions,
    dispose: () => {
      const pending = []
      for (const frame of frames.values()) clearFrame(frame)
      frames.clear()
      while (effects.length) pending.push(effects.pop()())
      return Promise.all(pending)
    },
    counts: () => ({ registrationRemoved, localeRemoved, injectRemoved, remoteRemoved, localeListeners: localeListeners.size }),
  }
  overrides.observe?.(probe)
  try { await plugin.apply(ctx) } catch (error) { await probe.dispose(); throw error }
  const registration = registrations[0]
  if (!registration) return probe
  const injected = registration.options.inject()
  const actions = injected.actions
  const render = (language = 'en') => {
    const dictionary = dictionaries.get('settings.dsh-model-enhance')[language]
    pendingEffects = []
    const rendered = new Set()
    const expand = (node, path) => {
      if (!node || typeof node !== 'object') return node
      if (typeof node.type === 'function') {
        rendered.add(path)
        if (!frames.has(path)) frames.set(path, [])
        hookValues = frames.get(path)
        hookIndex = 0
        return expand(node.type(node.props), `${path}/output`)
      }
      return { ...node, children: node.children.map((child, index) => expand(child, `${path}/${child?.props?.key ?? index}`)) }
    }
    const tree = expand(React.createElement(registration.Component, {
      ...injected,
      useEnhance: (selector) => selector(injected.hooks.enhance.getSnapshot()),
      t: (key) => { assert.ok(Object.hasOwn(dictionary, key), `Missing locale key: ${key}`); return dictionary[key] },
    }), 'panel')
    for (const [path, frame] of frames) {
      if (!rendered.has(path)) { clearFrame(frame); frames.delete(path) }
    }
    for (const node of nodes(tree)) {
      if (node.props.ref) node.props.ref.current = { focus: () => focusEvents.push(allText(node)) }
    }
    for (const effect of pendingEffects) effect()
    return tree
  }
  return {
    ...probe, actions, render, focusEvents, get state() { return injected.hooks.enhance.getSnapshot() },
    subscribe: injected.hooks.enhance.subscribe,
  }
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...(tree.children ?? []).flatMap(nodes)]
}
function allText(tree) {
  if (tree === null || tree === undefined) return ''
  if (typeof tree !== 'object') return String(tree)
  if (tree.type === 'style') return ''
  return (tree.children ?? []).map(allText).join(' ')
}
async function choose(h) {
  await flush()
  h.actions.setProvider('target')
  await h.actions.scan()
  h.actions.selectModel('wire-id')
  await flush()
}

test('Remote contribution is mounted before namespace calls or footer registration', async () => {
  const mounting = deferred()
  let probe
  const ready = harness({ mount: () => mounting.promise, observe: (value) => { probe = value } })
  await flush()
  assert.equal(probe.registrations.length, 0)
  assert.equal(probe.requests.length, 0, 'namespace cannot be used before mounting completes')
  assert.equal(probe.contributions.length, 1)
  const contribution = probe.contributions[0]
  assert.equal(contribution.package, 'dsh-model-enhance')
  assert.deepEqual(contribution.descriptors, ['status', 'scan', 'preview', 'apply'].map((method) => ({
    id: `dsh-model-enhance:modelEnhance/${method}`,
    service: 'modelEnhance', namespace: 'modelEnhance', method, invocation: { kind: 'direct' },
    parameters: method === 'status' ? [] : [
      { name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: `dsh-model-enhance.${method}.Request` } },
    ],
    result: { mode: 'src-json' },
  })))
  mounting.resolve()
  const h = await ready
  await flush()
  assert.equal(h.registrations.length, 1)
  assert.equal(h.requests[0][0], 'status')
  await h.dispose()
  await h.dispose()
  assert.deepEqual(h.counts(), { registrationRemoved: 1, localeRemoved: 1, injectRemoved: 1, remoteRemoved: 1, localeListeners: 0 })
})

test('Client strict request codecs validate malformed and privileged inputs', async () => {
  const h = await harness({ mount: (contribution) => {
    const examples = {
      scan: { provider: 'target' },
      preview: { provider: 'target', modelId: 'model', sourceKey: 'source', overwrite: false },
      apply: { token: 'plan', confirm: false },
    }
    for (const descriptor of contribution.descriptors) {
      if (!descriptor.parameters.length) continue
      const parse = descriptor.parameters[0].codec.create().parse
      const good = examples[descriptor.method]
      assert.equal(parse(good), good)
      for (const bad of [null, [], {}, { ...good, ops: [] }, { ...good, [Object.keys(good)[0]]: '' }]) {
        assert.throws(() => parse(bad), /Invalid|Expected/)
      }
      if (descriptor.method === 'apply') assert.throws(() => parse({ ...good, confirm: 'yes' }), /boolean/)
      if (descriptor.method === 'scan') assert.throws(() => parse({ ...good, sourceProvider: '' }), /Invalid/)
      if (descriptor.method === 'preview') {
        for (const removed of ['repairDefault', 'metadataOnly']) assert.throws(() => parse({ ...good, [removed]: true }), /Invalid/)
      }
    }
  } })
  await h.dispose()
})

test('mount rejection propagates without exposing a half-initialized footer or locale', async () => {
  const failure = new Error('Remote mounting failed')
  let probe
  await assert.rejects(harness({ mount: async () => { throw failure }, observe: (value) => { probe = value } }), (error) => error === failure)
  assert.equal(probe.contributions.length, 1)
  assert.equal(probe.registrations.length, 0)
  assert.equal(probe.requests.length, 0)
  assert.deepEqual(probe.counts(), { registrationRemoved: 0, localeRemoved: 0, injectRemoved: 0, remoteRemoved: 0, localeListeners: 0 })
  await probe.dispose()
})

test('disposing while mount is pending releases the late Remote without registering UI', async () => {
  const mounting = deferred()
  let probe
  const ready = harness({ mount: () => mounting.promise, observe: (value) => { probe = value } })
  await flush()
  await probe.dispose()
  mounting.resolve()
  const h = await ready
  assert.equal(h.registrations.length, 0)
  assert.equal(h.requests.length, 0)
  assert.deepEqual(h.counts(), { registrationRemoved: 0, localeRemoved: 0, injectRemoved: 0, remoteRemoved: 1, localeListeners: 0 })
  await h.dispose()
  assert.equal(h.counts().remoteRemoved, 1)
})

test('lazy factory registers only the footer and removes registrations, locale and pending listeners', async () => {
  const waiting = deferred()
  const h = await harness({ status: () => waiting.promise })
  const registration = h.registrations[0]
  assert.equal(registration.options.name, 'settings.models.footer')
  assert.equal(registration.options.id, 'dsh-model-enhance')
  assert.equal(registration.options.locale, 'settings.dsh-model-enhance')
  assert.ok(registration.options.inject().hooks.enhance)
  let changes = 0
  const unsubscribe = h.subscribe(() => changes++)
  const original = h.state
  h.dispose()
  waiting.resolve({ ok: true, value: status() })
  await flush()
  assert.equal(h.state, original, 'late completion after disposal is ignored')
  assert.equal(changes, 0)
  unsubscribe()
  assert.deepEqual(h.counts(), { registrationRemoved: 1, localeRemoved: 1, injectRemoved: 1, remoteRemoved: 1, localeListeners: 0 })
})

test('English and Chinese labels use locale dictionaries; controls are native keyboard targets', async () => {
  const h = await harness()
  await flush()
  assert.match(allText(h.render('en')), /Model recommendations/)
  assert.match(allText(h.render('zh')), /模型资料增强/)
  assert.match(allText(h.render('zh')), /读取已添加模型并匹配/)
  assert.match(allText(h.render('en')), /Load and match added models/)
  assert.doesNotMatch(allText(h.render('zh')), /拉取并匹配模型/)
  const tree = h.render()
  const controls = nodes(tree).filter((node) => ['button', 'select', 'input'].includes(node.type))
  assert.ok(controls.length >= 4)
  for (const button of controls.filter((node) => node.type === 'button')) assert.equal(button.props.type, 'button')
  for (const label of nodes(tree).filter((node) => node.type === 'label')) {
    assert.ok(label.children.some((child) => child && typeof child === 'object' && ['input', 'select'].includes(child.type)))
  }
  assert.match(allText(tree), /Bundled metadata generated at/)
  assert.match(allText(tree), /original-vendor catalogs/)
  assert.match(allText(tree), /Injected reasoning levels exclude off/)
  assert.match(allText(h.render('zh')), /注入的思考档位不包含 off/)
  assert.doesNotMatch(allText(tree), /off:null omits/)
  assert.doesNotMatch(allText(tree), /Update models.dev|Check and repair default reasoning|Save metadata only|Default reasoning status/)
  h.dispose()
})

test('selected vendor candidates show localized image support, non-support and unknown without endpoint promises', async () => {
  for (const [input, enState, zhState] of [
    [['text', 'image'], 'Supported', '支持'],
    [['text'], 'Not supported', '不支持'],
    [undefined, 'Unknown (no change)', '未知（不修改）'],
    [[], 'Unknown (no change)', '未知（不修改）'],
    [null, 'Unknown (no change)', '未知（不修改）'],
  ]) {
    const h = await harness({
      scan: async () => ({ ok: true, value: scan([{ id: 'wire-id', name: 'Model', match: {
        status: 'matched', candidates: [{ ...candidate(), ...(input === undefined ? {} : { input }) }],
      } }]) }),
      preview: async () => ({ ok: true, value: preview({ changes: [], canApply: false }) }),
    })
    await choose(h)
    for (const [language, heading, expected, caveat] of [
      ['en', 'Image input in original-vendor metadata', enState, 'does not guarantee actual image-input support at the current endpoint'],
      ['zh', '原厂资料的图片输入', zhState, '不承诺当前端点真实支持图片输入'],
    ]) {
      const notice = nodes(h.render(language)).find((node) => node.props.role === 'status' && node.props.className === 'dme-notice')
      assert.ok(notice)
      assert.equal(notice.props['aria-live'], 'polite')
      assert.ok(allText(notice).replace(/\s+/g, ' ').includes(`${heading} : ${expected}`), allText(notice))
      assert.ok(allText(notice).includes(caveat))
    }
    assert.deepEqual(h.requests.find(([method]) => method === 'preview')[1], {
      provider: 'target', modelId: 'wire-id', sourceKey: 'source/model', overwrite: false,
    }, 'metadata remains display-only; request fields are unchanged')
    assert.equal(h.requests.filter(([method]) => method === 'apply').length, 0)
    await h.dispose()
  }
})

test('candidate image status appears only after selection and follows the current choice even while preview is pending', async () => {
  const pending = deferred()
  const h = await harness({
    scan: async () => ({ ok: true, value: scan([{ id: 'wire-id', name: 'Model', match: {
      status: 'ambiguous', candidates: [
        { ...candidate('vision'), input: ['text', 'image'] },
        { ...candidate('text'), input: ['text'] }, candidate('unknown'),
      ],
    } }]) }),
    preview: () => pending.promise,
  })
  await choose(h)
  const notice = () => nodes(h.render()).find((node) => node.props.role === 'status' && node.props.className === 'dme-notice')
  assert.equal(notice(), undefined, 'an unselected candidate is not reported as unknown')
  h.actions.selectCandidate('vision')
  assert.match(allText(notice()), /metadata :\s+Supported/)
  h.actions.selectCandidate('text')
  assert.match(allText(notice()), /metadata :\s+Not supported/)
  h.actions.selectCandidate('unknown')
  assert.match(allText(notice()), /metadata :\s+Unknown \(no change\)/)
  h.actions.selectCandidate('')
  assert.equal(notice(), undefined)
  pending.resolve({ ok: true, value: preview() })
  await flush()
  assert.equal(h.state.preview, null, 'stale previews do not restore cleared candidate details')
  await h.dispose()
})

test('input preview localizes the field and before/after meanings while retaining raw JSON', async () => {
  for (const [before, after, enBefore, enAfter, zhBefore, zhAfter] of [
    [[], ['text', 'image'], 'Unspecified / inherited', 'Supported', '未指定／继承', '支持'],
    [null, ['text'], 'Unspecified / inherited', 'Not supported', '未指定／继承', '不支持'],
    [['text'], ['text', 'image'], 'Not supported', 'Supported', '不支持', '支持'],
    [['text', 'image'], ['text'], 'Supported', 'Not supported', '支持', '不支持'],
    [['text'], [], 'Not supported', 'Unspecified / inherited', '不支持', '未指定／继承'],
    [['text', 'image'], null, 'Supported', 'Unspecified / inherited', '支持', '未指定／继承'],
    [undefined, ['text', 'image'], 'Unspecified / inherited', 'Supported', '未指定／继承', '支持'],
  ]) {
    const h = await harness({ preview: async () => ({ ok: true, value: preview({ changes: [
      { field: 'wire-id.input', before, after }, { field: 'wire-id.contextWindow', before: 1000, after: 2000 },
    ] }) }) })
    await choose(h)
    for (const [language, field, meanings, raw] of [
      ['en', 'Image input capability (input)', [enBefore, enAfter], 'Raw JSON'],
      ['zh', '图片输入能力（input）', [zhBefore, zhAfter], '原始 JSON'],
    ]) {
      const rows = nodes(h.render(language)).filter((node) => node.type === 'section' && node.props['aria-label'])
      const inputRow = rows.find((node) => node.props['aria-label'] === field)
      assert.ok(inputRow)
      const cells = nodes(inputRow).filter((node) => Object.hasOwn(node.props, 'data-after'))
      assert.equal(cells.length, 2)
      assert.deepEqual(cells.map((node) => node.props['data-after']), [false, true])
      for (const [index, value] of [before, after].entries()) {
        const valueNode = cells[index].children[1]
        assert.equal(allText(valueNode.children[0].children[0]), meanings[index])
        assert.ok(allText(cells[index]).includes(raw))
        const json = nodes(cells[index]).find((node) => node.type === 'code')
        assert.equal(allText(json), value === undefined ? '—' : JSON.stringify(value))
      }
      const otherRow = rows.find((node) => node.props['aria-label'] === 'wire-id.contextWindow')
      assert.deepEqual(nodes(otherRow).filter((node) => Object.hasOwn(node.props, 'data-after')).map((node) => allText(node.children[1])), ['1000', '2000'])
    }
    await h.dispose()
  }
})

test('theme CSS scopes native controls, popups and interaction states to live DSH aliases', async () => {
  const h = await harness()
  await choose(h)
  const styles = nodes(h.render()).filter((node) => node.type === 'style')
  assert.equal(styles.length, 1)
  const css = styles[0].children.join('')
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  assert.ok(rules.length > 20)
  for (const [, selectors] of rules) {
    for (const selector of selectors.split(',')) assert.ok(selector.trim().startsWith('[data-dme]'), selector)
  }
  const rule = (selector) => {
    const found = rules.filter(([, selectors]) => selectors.split(',').some((part) => part.trim() === selector))
    assert.ok(found.length, `Missing scoped style: ${selector}`)
    return found.map((entry) => entry[2]).join('\n')
  }
  assert.match(rule('[data-dme]'), /color-scheme:\s*inherit/)
  assert.match(rule('[data-dme] select'), /background:\s*var\(--dsw-alias-bg-layer-1\)/)
  const option = rule('[data-dme] select option')
  assert.match(option, /color:\s*var\(--dsw-alias-label-primary\)/)
  assert.match(option, /background:\s*var\(--dsw-alias-bg-overlay\)/)
  assert.match(rule('[data-dme] input[type=\'checkbox\']'), /accent-color:\s*var\(--dsw-alias-brand-primary\)/)
  assert.match(rule('[data-dme] :focus-visible'), /outline:.*var\(--dsw-alias-brand-primary\)/)
  assert.match(rule('[data-dme] button:hover:not(:disabled)'), /var\(--dsw-alias-bg-layer-2\)/)
  assert.match(rule('[data-dme] select:disabled'), /var\(--dsw-alias-label-secondary\)/)
  assert.match(rule('[data-dme] select:disabled'), /opacity:\s*1/)
  assert.match(rule('[data-dme] .dme-diff-column'), /var\(--dsw-alias-bg-base\)/)
  assert.match(rule('[data-dme] .dme-diff-grid'), /auto-fit.*minmax\(min\(100%, 230px\)/)
  assert.match(rule('[data-dme] .dme-values'), /overflow-wrap:\s*anywhere/)
  assert.doesNotMatch(rule('[data-dme] .dme-header'), /display:\s*none/)
  assert.match(rule('[data-dme] .dme-warning'), /state-warn-primary\) 8%, var\(--dsw-alias-bg-layer-1\)/)
  assert.match(rule('[data-dme] button.dme-warning-trigger'), /border-radius:\s*50%.*background:\s*var\(--dme-warning-bg\)/)
  const popover = rule('[data-dme] .dme-warning-popover')
  assert.match(popover, /position-try-fallbacks:.*flip-block/)
  assert.match(popover, /max-block-size:.*dvh.*overflow:\s*auto.*overflow-wrap:\s*anywhere/)
  assert.doesNotMatch(popover, /display:/, 'native popover controls default visibility')
  for (const [kind, token] of [['error', 'error'], ['warning', 'warn'], ['success', 'success']]) {
    assert.ok(rule(`[data-dme] .dme-notice-${kind}`).includes(`var(--dsw-alias-state-${token}-primary)`))
  }
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(|prefers-color-scheme|color-scheme:\s*(?:light|dark)\b/i,
    'Do not hardcode a palette or override the app theme with the OS preference')
  await h.dispose()
})

test('detail alerts and saved result expose distinct semantic theme states', async () => {
  const h = await harness({ preview: async () => ({ ok: true, value: preview({ warnings: ['Check upstream'], blockers: ['Unsafe default'], canApply: false }) }) })
  await choose(h)
  h.actions.publish({ error: { code: 'fixture', message: 'Failed operation' } })
  const tree = nodes(h.render())
  assert.ok(tree.some((node) => node.props.className === 'dme-muted'))
  assert.ok(tree.some((node) => node.props['data-tone'] === 'matched'))
  assert.ok(tree.some((node) => node.props.role === 'alert' && node.props.className.includes('dme-notice-error')))
  for (const kind of ['warning', 'error']) {
    assert.ok(tree.some((node) => node.props.className?.split(' ').includes(`dme-notice-${kind}`)), kind)
  }
  h.actions.publish({ result: { saved: true, verified: true, warnings: [] } })
  assert.ok(nodes(h.render()).some((node) => node.props.className?.includes('dme-notice-success') && nodes(node).some((child) => child.props.role === 'status')))
  assert.doesNotMatch(allText(h.render()), /Default reasoning status/)
  await h.dispose()
})

test('scan, preview and save warnings follow locale, deduplicate known language and preserve unknown diagnostics', async () => {
  const files = await Promise.all(['catalog.js', 'planner.js', 'service.js'].map((file) => readFile(new URL(`../core/${file}`, import.meta.url), 'utf8')))
  const hostWarnings = files.flatMap((file) => [...file.matchAll(/(?:warnings\.push\(|warnings: \[)'([^']+)'/g)].map((match) => match[1]))
  const scanWarning = hostWarnings.find((value) => value.startsWith('Only models'))
  const resultWarning = hostWarnings.find((value) => value.startsWith('Settings write completed'))
  const previewWarnings = hostWarnings.filter((value) => value !== scanWarning && value !== resultWarning)
  assert.ok(scanWarning && resultWarning && previewWarnings.length > 0)
  const h = await harness({
    scan: async () => ({ ok: true, value: { ...scan(), warnings: [scanWarning] } }),
    preview: async () => ({ ok: true, value: preview({ warnings: [...previewWarnings, 'future warning'] }) }),
    apply: async () => ({ ok: true, value: { saved: true, verified: false, warnings: [resultWarning, ...previewWarnings] } }),
  })
  const byClass = (tree, name) => nodes(tree).filter((node) => node.props.className?.split(' ').includes(name))
  const panels = (language) => byClass(h.render(language), 'dme-warning-popover')
  const checkCh = (text) => {
    assert.match(text, /[\u3400-\u9fff]/u)
    for (const value of hostWarnings) assert.ok(!text.includes(value), value)
  }
  await flush()
  assert.equal(panels('zh').length, 0, 'do not render empty icons')
  h.actions.setProvider('target')
  await h.actions.scan()
  assert.match(allText(panels('zh')[0]), /模型匹配注意事项.*未请求上游模型清单或调用模型/)
  assert.match(allText(panels('en')[0]), /Model matching warnings.*No upstream model list or inference/)
  h.actions.selectModel('wire-id')
  await flush()
  const [scanPanel, previewPanel] = panels('zh')
  assert.match(allText(scanPanel), /模型匹配注意事项/)
  assert.match(allText(previewPanel), /配置预览注意事项/)
  const localized = nodes(previewPanel).filter((node) => node.type === 'li').map(allText)
  assert.equal(localized.length, previewWarnings.length, 'two output-limit variants deduped, one unknown appended')
  assert.equal(localized.filter((value) => value.startsWith('maxTokens')).length, 1)
  assert.match(localized.at(-1), /未识别的注意事项.*future warning/)
  localized.forEach(checkCh)
  const beforeSave = h.render('zh')
  for (const container of byClass(beforeSave, 'dme-warning')) {
    assert.equal(allText(container.children[0]), '!')
    assert.equal(container.children[1].props.popover, 'auto')
    assert.equal(container.children[0].props.popovertarget, container.children[1].props.id)
  }
  assert.equal(new Set(byClass(beforeSave, 'dme-warning-popover').map((node) => node.props.id)).size, 2)
  await h.actions.apply()
  const saved = h.render('zh')
  const savePanel = panels('zh')[1]
  assert.match(allText(savePanel), /保存结果注意事项.*回读未能核对预期字段/)
  checkCh(allText(savePanel))
  assert.equal(byClass(saved, 'dme-warning-popover').some((node) => node.props.id === previewPanel.props.id), false)
  assert.ok(nodes(saved).some((node) => node.props.role === 'status' && /配置已保存，但验证未通过/.test(allText(node)) && !nodes(node).some((child) => child.props.popover)))
  await h.dispose()
})

test('warning event handlers honor hover grace, keyboard focus, touch, native dismissal and unmount cleanup', async () => {
  const scheduled = new Map()
  let job = 0
  const timers = { setTimeout: (fn) => { scheduled.set(++job, fn); return job }, clearTimeout: (id) => scheduled.delete(id) }
  const advance = () => { const callbacks = [...scheduled.values()]; scheduled.clear(); callbacks.forEach((fn) => fn()) }
  const h = await harness({ timers, preview: async () => ({ ok: true, value: preview({ warnings: ['fixture warning'] }) }) })
  await choose(h)
  const tree = h.render('zh')
  const group = nodes(tree).find((node) => node.props.className === 'dme-warning')
  const [button, popup] = group.children
  assert.equal(button.type, 'button')
  assert.equal(button.props['aria-label'], '配置预览注意事项 (1)')
  assert.equal(popup.props.tabIndex, 0)
  let opened = false, keyboard = false, inside = false
  const anchor = { matches: (selector) => selector === ':focus-visible' && keyboard }
  const panel = {
    matches: (selector) => selector === ':popover-open' ? opened : selector === ':focus-within' && inside,
    showPopover: ({ source }) => { assert.equal(source, anchor); opened = true },
    hidePopover: () => { opened = false },
    contains: (target) => target === panel,
  }
  button.props.ref.current = anchor
  popup.props.ref.current = panel
  const mouse = { pointerType: 'mouse' }
  const touch = { pointerType: 'touch' }
  const click = { preventDefault() {} }
  const focus = (relatedTarget = null) => button.props.onFocus({ currentTarget: anchor, relatedTarget })
  group.props.onPointerEnter(mouse)
  assert.equal(opened, true)
  group.props.onPointerLeave(mouse)
  assert.equal(opened, true, 'give the pointer time to enter the popover')
  group.props.onPointerEnter(mouse)
  advance()
  assert.equal(opened, true, 'popover content can be hovered')
  group.props.onPointerLeave(mouse)
  advance()
  assert.equal(opened, false)
  group.props.onPointerEnter(touch)
  assert.equal(opened, false)
  button.props.onClick(click)
  assert.equal(opened, true)
  group.props.onPointerLeave(mouse)
  advance()
  assert.equal(opened, true, 'click pins until dismissed')
  button.props.onClick(click)
  assert.equal(opened, false)
  keyboard = true
  focus()
  assert.equal(opened, true)
  group.props.onPointerLeave(mouse)
  advance()
  assert.equal(opened, true, 'keyboard focus is not dismissed by unrelated pointer movement')
  const currentTarget = { contains: (target) => target === panel }
  inside = true
  group.props.onBlur({ currentTarget, relatedTarget: panel })
  assert.equal(opened, true)
  opened = false // Simulate native Escape dismissing the auto popover.
  inside = false
  focus(panel)
  assert.equal(opened, false, 'native focus restoration must not reopen it')
  focus()
  group.props.onBlur({ currentTarget, relatedTarget: null })
  assert.equal(opened, false, 'tabbing out dismisses the popover')
  group.props.onPointerLeave(mouse)
  assert.equal(scheduled.size, 1)
  h.actions.backToModels()
  h.render()
  assert.equal(scheduled.size, 0)
  await h.dispose()
})

test('standard Remote failure and malformed response are visible without fake success', async () => {
  const h = await harness({ status: async () => ({ ok: false, error: { code: 'disconnected', message: 'Connection lost' } }) })
  await flush()
  assert.equal(h.state.error.message, 'Connection lost')
  assert.match(allText(h.render()), /Operation failed.*Connection lost/)
  assert.ok(nodes(h.render()).some((node) => node.props.role === 'alert'))
  h.dispose()
  const malformed = await harness({ status: async () => status() })
  await flush()
  assert.equal(malformed.state.error.code, 'model-enhance/client-response')
  assert.match(allText(malformed.render()), /invalid response/)
  malformed.dispose()
})

test('configuration reload uses status only, preserves old status on failure and invalidates preview', async () => {
  let fail = false
  const h = await harness({ status: async () => fail
    ? { ok: false, error: { code: 'disconnected', message: 'Read failed' } }
    : { ok: true, value: status() } })
  await choose(h)
  assert.equal(h.state.preview.token, 'host-token')
  const priorStatus = h.state.status
  fail = true
  await h.actions.load()
  assert.equal(h.state.status, priorStatus)
  assert.equal(h.state.preview, null)
  assert.equal(h.state.scan, null)
  assert.equal(h.state.error.message, 'Read failed')
  assert.ok(h.requests.every(([method]) => ['status', 'scan', 'preview', 'apply'].includes(method)))
  h.dispose()
})

test('bundled metadata failures are visible and never offer runtime download controls', async () => {
  const value = status()
  value.catalog.available = false
  value.catalog.lastError = 'Missing built-in snapshot'
  const h = await harness({ status: async () => ({ ok: true, value }) })
  await flush()
  assert.match(allText(h.render()), /Bundled vendor metadata is unavailable/)
  assert.match(allText(h.render()), /Missing built-in snapshot/)
  assert.doesNotMatch(allText(h.render()), /Update models.dev/)
  h.actions.setProvider('target')
  const scanButton = nodes(h.render()).find((node) => node.type === 'button' && allText(node) === 'Load and match added models')
  assert.equal(scanButton.props.disabled, true)
  await h.dispose()
})

test('provider/source changes send exact scan filters and reject stale discovery completions', async () => {
  const first = deferred()
  let count = 0
  const h = await harness({ scan: () => ++count === 1 ? first.promise : Promise.resolve({ ok: true, value: scan([]) }) })
  await flush()
  h.actions.setProvider('target')
  const pending = h.actions.scan()
  h.actions.setSource('source')
  await h.actions.scan()
  first.resolve({ ok: true, value: scan() })
  await pending
  assert.equal(h.state.scan.models.length, 0)
  assert.deepEqual(h.requests.filter(([method]) => method === 'scan').map(([, input]) => input), [
    { provider: 'target' }, { provider: 'target', sourceProvider: 'source' },
  ])
  h.dispose()
})

test('ambiguous source requires a candidate choice; selecting it automatically requests a preview', async () => {
  const h = await harness({ scan: async () => ({ ok: true, value: scan([{ id: 'wire-id', name: '<untrusted name>', match: { status: 'ambiguous', candidates: [candidate('a'), candidate('b')] } }]) }) })
  await choose(h)
  assert.equal(h.state.sourceKey, '')
  assert.equal(h.requests.filter(([method]) => method === 'preview').length, 0)
  h.actions.selectCandidate('missing')
  assert.equal(h.state.sourceKey, '')
  h.actions.selectCandidate('b')
  await flush()
  assert.deepEqual(h.requests.find(([method]) => method === 'preview')[1], {
    provider: 'target', modelId: 'wire-id', sourceKey: 'b', overwrite: false,
  })
  assert.ok(nodes(h.render()).every((node) => !Object.hasOwn(node.props, 'dangerouslySetInnerHTML')))
  assert.match(allText(h.render()), /<untrusted name>/)
  h.dispose()
})

test('late previews cannot replace a newer overwrite preview; removed options are ignored', async () => {
  const old = deferred()
  let count = 0
  const h = await harness({ preview: () => ++count === 1 ? old.promise : Promise.resolve({ ok: true, value: preview({ token: 'new-token', warnings: ['Check off mapping'] }) }) })
  await choose(h)
  assert.equal(h.state.preview, null)
  h.actions.setOption('metadataOnly', true)
  h.actions.setOption('repairDefault', true)
  assert.equal(h.requests.filter(([method]) => method === 'preview').length, 1)
  h.actions.setOption('overwrite', true)
  await flush()
  assert.equal(h.state.preview.token, 'new-token')
  old.resolve({ ok: true, value: preview({ token: 'old-token' }) })
  await flush()
  assert.equal(h.state.preview.token, 'new-token')
  const latest = h.requests.filter(([method]) => method === 'preview').at(-1)[1]
  assert.deepEqual(latest, { provider: 'target', modelId: 'wire-id', sourceKey: 'source/model', overwrite: true })
  assert.match(allText(h.render()), /Check off mapping/)
  assert.doesNotMatch(allText(h.render()), /Default reasoning status|Save metadata only/)
  h.dispose()
})

test('safe fill-empty applies with one click and submits only Host token and confirmation', async () => {
  const h = await harness()
  await choose(h)
  assert.equal(h.state.preview.requiresConfirmation, false)
  await h.actions.apply()
  const writes = h.requests.filter(([method]) => method === 'apply')
  assert.deepEqual(writes, [['apply', { token: 'host-token', confirm: false }]])
  assert.equal(h.state.preview, null)
  assert.equal(h.state.result.verified, true)
  await h.actions.apply()
  assert.equal(h.requests.filter(([method]) => method === 'apply').length, 1, 'consumed token cannot replay')
  h.dispose()
})

test('field-overwrite confirmation is enforced and resetting options invalidates it', async () => {
  const h = await harness({ preview: async () => ({ ok: true, value: preview({ requiresConfirmation: true }) }) })
  await choose(h)
  await h.actions.apply()
  assert.equal(h.requests.filter(([method]) => method === 'apply').length, 0)
  h.actions.confirm(true)
  h.actions.setOption('overwrite', true)
  await flush()
  assert.equal(h.state.confirmed, false)
  h.actions.confirm(true)
  await h.actions.apply()
  assert.deepEqual(h.requests.find(([method]) => method === 'apply')[1], { token: 'host-token', confirm: true })
  h.dispose()
})

test('blockers, read-only routes and canApply=false all prevent submission', async () => {
  for (const variant of ['blockers', 'read-only', 'canApply']) {
    const h = await harness({
      status: async () => { const value = status(); if (variant === 'read-only') value.routes[0].writable = false; return { ok: true, value } },
      preview: async () => ({ ok: true, value: preview(variant === 'blockers' ? { blockers: ['No compatible default'] } : variant === 'canApply' ? { canApply: false } : {}) }),
    })
    await choose(h)
    h.actions.confirm(true)
    await h.actions.apply()
    assert.equal(h.requests.filter(([method]) => method === 'apply').length, 0, variant)
    h.dispose()
  }
})

test('double-click cannot produce duplicate writes; saved but unverified retains warnings', async () => {
  const writing = deferred()
  const h = await harness({ apply: () => writing.promise })
  await choose(h)
  const first = h.actions.apply()
  await h.actions.apply()
  assert.equal(h.requests.filter(([method]) => method === 'apply').length, 1)
  assert.equal(h.state.loading, 'apply')
  writing.resolve({ ok: true, value: { saved: true, verified: false, warnings: ['Read-back remains unverified'] } })
  await first
  assert.match(allText(h.render()), /saved, but verification failed/)
  assert.match(allText(h.render()), /Read-back remains unverified/)
  assert.doesNotMatch(allText(h.render()), /was saved and verified/)
  h.dispose()
})

test('expired/rejected apply token clears preview and does not retry writes automatically', async () => {
  const h = await harness({ apply: async () => ({ ok: false, error: { code: 'model-enhance/expired', message: 'Preview expired' } }) })
  await choose(h)
  await h.actions.apply()
  assert.equal(h.state.preview, null)
  assert.equal(h.state.result, null)
  assert.match(allText(h.render()), /Preview expired/)
  await h.actions.apply()
  assert.equal(h.requests.filter(([method]) => method === 'apply').length, 1)
  h.dispose()
})

test('ten thousand discovered models never create an unbounded rendered list', async () => {
  const models = Array.from({ length: 10000 }, (_, i) => ({ id: `model-${i}`, name: `Model ${i}`, match: { status: 'unmatched', candidates: [] } }))
  const h = await harness({ scan: async () => ({ ok: true, value: scan(models) }) })
  await flush()
  h.actions.setProvider('target')
  await h.actions.scan()
  const modelRows = () => nodes(h.render()).filter((node) => node.props.className === 'dme-model')
  assert.equal(modelRows().length, 50)
  for (let i = 0; i < 100; i++) h.actions.showMore()
  assert.equal(modelRows().length, 200)
  h.actions.setFilter('model-9999')
  assert.equal(modelRows().length, 1)
  assert.equal(h.state.limit, 50)
  h.dispose()
})

test('guided navigation shows one phase, keeps filters on return and exposes match status to assistive readers', async () => {
  const h = await harness()
  await flush()
  const click = (label) => {
    const control = nodes(h.render()).find((node) => node.type === 'button' && allText(node) === label)
    assert.ok(control, label)
    assert.equal(control.props.disabled, false, label)
    control.props.onClick()
  }
  const currentStep = () => nodes(h.render()).filter((node) => node.props['aria-current'] === 'step').map(allText)
  assert.deepEqual(currentStep(), ['1 Choose provider'])
  assert.ok(nodes(h.render()).some((node) => node.type === 'details'))
  assert.equal(nodes(h.render()).filter((node) => node.type === 'select').length, 2)
  h.actions.setProvider('target')
  click('Load and match added models')
  await flush()
  assert.deepEqual(currentStep(), ['2 Match models'])
  h.actions.setFilter('wire')
  const row = nodes(h.render()).find((node) => node.type === 'button' && node.props['aria-label']?.includes('View recommendation'))
  assert.match(row.props['aria-label'], /Matched/)
  assert.equal(nodes(row).filter((node) => node.type === 'button').length, 1, 'rows contain no nested buttons')
  row.props.onClick()
  await flush()
  assert.deepEqual(currentStep(), ['3 Preview and apply'])
  assert.equal(nodes(h.render()).some((node) => node.props.className === 'dme-model'), false)
  assert.equal(nodes(h.render()).filter((node) => node.type === 'select').length, 1)
  const requests = h.requests.length
  click('Back to models')
  assert.equal(h.requests.length, requests, 'back navigation does not make a network or Host request')
  assert.equal(h.state.preview, null)
  assert.equal(h.state.confirmed, false)
  assert.equal(h.state.filter, 'wire')
  assert.deepEqual(currentStep(), ['2 Match models'])
  assert.deepEqual(h.focusEvents.slice(-3).map((value) => value.replace(/\s+/g, ' ')), ['Added models', 'Model — wire-id', 'Added models'])
  click('Change provider')
  assert.equal(h.state.scan, null)
  assert.equal(h.state.provider, 'target')
  assert.deepEqual(currentStep(), ['1 Choose provider'])
  assert.equal(h.focusEvents.at(-1), 'Choose matching scope')
  await h.dispose()
})

test('leaving a detail or matching scope discards late previews and scans', async () => {
  const latePreview = deferred()
  const h = await harness({ preview: () => latePreview.promise })
  await choose(h)
  h.actions.setFilter('wire')
  h.actions.backToModels()
  latePreview.resolve({ ok: true, value: preview({ requiresConfirmation: true }) })
  await flush()
  assert.equal(h.state.modelId, '')
  assert.equal(h.state.preview, null)
  assert.equal(h.state.loading, '')
  assert.equal(h.state.filter, 'wire')
  await h.dispose()
  const lateScan = deferred()
  const other = await harness({ scan: () => lateScan.promise })
  await flush()
  other.actions.setProvider('target')
  const scanning = other.actions.scan()
  other.actions.editSelection()
  lateScan.resolve({ ok: true, value: scan() })
  await scanning
  assert.equal(other.state.scan, null)
  assert.equal(other.state.loading, '')
  await other.dispose()
})

test('no routes, no added models, filtered empty results and no candidates have separate actionable states', async () => {
  const noRoutes = await harness({ status: async () => ({ ok: true, value: { ...status(), routes: [] } }) })
  await flush()
  assert.match(allText(noRoutes.render()), /No routes are available/)
  await noRoutes.dispose()
  const empty = await harness({ scan: async () => ({ ok: true, value: scan([]) }) })
  await flush()
  empty.actions.setProvider('target')
  await empty.actions.scan()
  assert.match(allText(empty.render()), /no added models.*native settings first/)
  assert.doesNotMatch(allText(empty.render()), /No models match this filter/)
  await empty.dispose()
  const unmatched = await harness({ scan: async () => ({ ok: true, value: scan([{ id: 'wire-id', name: 'Model', match: { status: 'unmatched', candidates: [] } }]) }) })
  await flush()
  unmatched.actions.setProvider('target')
  await unmatched.actions.scan()
  unmatched.actions.setFilter('missing')
  assert.match(allText(unmatched.render()), /No models match this filter/)
  unmatched.actions.setFilter('')
  unmatched.actions.selectModel('wire-id')
  const tree = unmatched.render()
  assert.match(allText(tree), /No vendor candidates found/)
  assert.equal(nodes(tree).find((node) => node.type === 'select').props.disabled, true)
  assert.equal(nodes(tree).find((node) => node.type === 'button' && allText(node) === 'Regenerate preview').props.disabled, true)
  assert.equal(unmatched.requests.filter(([method]) => method === 'preview').length, 0)
  await unmatched.dispose()
})

test('zero changes never claims configuration alignment and keeps warnings and blockers visible', async () => {
  const h = await harness({ preview: async () => ({ ok: true, value: preview({ changes: [], canApply: false, warnings: ['Existing value retained'], blockers: ['Unavailable metadata'] }) }) })
  await choose(h)
  assert.match(allText(h.render()), /No field changes/)
  assert.match(allText(h.render('zh')), /没有字段变更/)
  assert.match(allText(h.render()), /Existing value retained.*Unavailable metadata/)
  assert.doesNotMatch(allText(h.render()), /already matches|aligned|配置已与推荐一致/)
  assert.equal(nodes(h.render()).find((node) => node.type === 'button' && allText(node) === 'Apply recommended configuration').props.disabled, true)
  await h.dispose()
})

test('off removal is highlighted for null or string entries and for mappings replaced by false', async () => {
  for (const off of [null, 'disabled']) {
    for (const after of [{ high: 'high' }, false, { off, high: 'high' }]) {
      const h = await harness({ preview: async () => ({ ok: true, value: preview({ requiresConfirmation: true, changes: [
        { field: 'wire-id.reasoningEfforts', before: { off, high: 'high' }, after },
      ] }) }) })
      await choose(h)
      const removed = after === false || !Object.hasOwn(after, 'off')
      assert.equal(nodes(h.render()).some((node) => node.props.className === 'dme-off-removed'), removed)
      if (removed) assert.match(allText(h.render('zh')), /本次预览移除 off 档位/)
      assert.equal(nodes(h.render()).find((node) => node.type === 'button' && allText(node) === 'Apply recommended configuration').props.disabled, true)
      h.actions.confirm(true)
      h.actions.selectCandidate('')
      assert.equal(h.state.confirmed, false)
      assert.equal(h.state.preview, null)
      await h.dispose()
    }
  }
})

test('save result has three distinct states and returning reads a fresh model snapshot', async () => {
  for (const [saved, verified, message, tone] of [
    [true, true, /fields were saved and checked.*not verified/, 'success'],
    [true, false, /saved, but verification failed/, 'warning'],
    [false, false, /was not saved/, 'warning'],
  ]) {
    const h = await harness({ apply: async () => ({ ok: true, value: { saved, verified, warnings: ['Result details'] } }) })
    await choose(h)
    h.render()
    await h.actions.apply()
    const tree = h.render()
    assert.match(allText(tree), message)
    assert.match(allText(tree), /Result details/)
    assert.ok(nodes(tree).some((node) => node.props.className?.split(' ').includes(`dme-notice-${tone}`)
      && nodes(node).some((child) => child.props.role === 'status' && message.test(allText(child)))))
    assert.equal(nodes(tree).some((node) => node.type === 'button' && allText(node) === 'Apply recommended configuration'), false)
    assert.equal(nodes(tree).some((node) => node.type === 'select'), false)
    assert.ok(nodes(tree).some((node) => node.type === 'button' && allText(node) === 'Read latest models'))
    h.actions.backToModels()
    await flush()
    assert.equal(h.requests.filter(([method]) => method === 'scan').length, 2)
    assert.equal(h.state.result, null)
    assert.equal(h.state.preview, null)
    assert.equal(h.state.modelId, '')
    await h.dispose()
  }
})

test('failed writes restore focus to preview without replaying tokens or stealing candidate-change focus', async () => {
  const writing = deferred()
  const h = await harness({ apply: () => writing.promise })
  await choose(h)
  h.render()
  const pending = h.actions.apply()
  const during = h.render()
  assert.equal(nodes(during).filter((node) => node.type === 'button' && !node.props.disabled).length, 0)
  writing.resolve({ ok: false, error: { code: 'expired', message: 'Preview expired' } })
  await pending
  h.render()
  assert.equal(h.focusEvents.at(-1), 'Regenerate preview')
  const focusCount = h.focusEvents.length
  await h.actions.preview()
  h.render()
  h.actions.setOption('overwrite', true)
  await flush()
  h.render()
  assert.equal(h.focusEvents.length, focusCount, 'normal previews leave the invoking control focused')
  assert.equal(h.requests.filter(([method]) => method === 'apply').length, 1)
  await h.dispose()
})

test('long detail names and raw values remain complete instead of depending on tooltips', async () => {
  const name = 'Long model '.repeat(100)
  const id = 'vendor/'.repeat(100) + 'id'
  const mapping = { high: 'wire-value/'.repeat(100) }
  const h = await harness({
    scan: async () => ({ ok: true, value: scan([{ id, name, match: { status: 'matched', candidates: [{ ...candidate(), id, name }] } }]) }),
    preview: async () => ({ ok: true, value: preview({ changes: [{ field: `${id}.reasoningEfforts`, before: null, after: mapping }] }) }),
  })
  await flush()
  h.actions.setProvider('target')
  await h.actions.scan()
  h.actions.selectModel(id)
  await flush()
  const content = allText(h.render())
  assert.ok(content.includes(name))
  assert.ok(content.includes(id))
  assert.ok(content.includes(JSON.stringify(mapping)))
  assert.equal(nodes(h.render()).some((node) => node.props.title), false)
  await h.dispose()
})

test('Client has no direct fetch, settings writes, DOM injection or privileged operation payloads', () => {
  assert.doesNotMatch(source, /\bfetch\s*\(/)
  assert.doesNotMatch(source, /remote\.settings|\.mutate\s*\(/)
  assert.doesNotMatch(source, /document\.|dangerouslySetInnerHTML|innerHTML/)
  assert.doesNotMatch(source, /auto-review|REVIEW_POLICY/)
  assert.doesNotMatch(source, /\brefresh\b|repairDefault|metadataOnly|defaultStatus|defaultVerified|status\?\.cache/)
})
