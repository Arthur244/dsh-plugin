/**
 * Tool-level behaviour of `find_dsh_plugin`: the happy path is unchanged, and a
 * rate-limited or unreachable GitHub falls back to curated keyword matches.
 *
 * Kept in its own file on purpose: the github/registry suites swap
 * `globalThis.fetch` per test and restore it, which would tear down the router
 * installed here. Separate files run in separate processes.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { apply } = await import(new URL('../lib/index.js', import.meta.url).href)

const LONG_DESCRIPTION = 'x'.repeat(400)
const REGISTRY = {
  updated: '2026-09-08',
  count: 3,
  categories: { memory: { en: 'Memory', zh: '记忆' } },
  plugins: [
    { name: 'in-both', owner: 'acme', url: 'https://github.com/acme/in-both', category: 'memory', description: { en: 'Curated description', zh: 'curated 描述' }, install: 'dsh plugin --profile web add github:acme/in-both', added: '2026-09-01', stars: 100 },
    { name: 'curated-only', owner: 'acme', url: 'https://github.com/acme/curated-only/', category: 'memory', description: { en: 'Only in curated', zh: '只在 curated' }, install: 'dsh plugin --profile web add github:acme/curated-only', added: '2026-09-02', stars: 5 },
    { name: 'long-desc', owner: 'acme', url: 'https://github.com/acme/long-desc', category: 'memory', description: { en: LONG_DESCRIPTION, zh: '长描述' }, install: 'dsh plugin --profile web add github:acme/long-desc', added: '2026-09-03', stars: 1 },
  ],
}

const ghItem = (name, stars) => ({
  name, full_name: `acme/${name}`, html_url: `https://github.com/acme/${name}`, description: `${name} from github`,
  stargazers_count: stars, pushed_at: '2026-09-01T00:00:00Z', owner: { login: 'acme' },
})

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/** Auth header seen per query, so assertions never depend on test ordering. */
const seenAuth = new Map()

globalThis.fetch = async (url, init) => {
  const target = String(url)
  if (target.includes('api.github.com')) {
    const query = new URL(target).searchParams.get('q') ?? ''
    seenAuth.set(query, init?.headers?.authorization ?? null)
    // Only the degradation cases are rate limited — keyed off the query.
    if (query.includes('degrade')) {
      return json({ message: 'API rate limit exceeded' }, 403, {
        'x-ratelimit-limit': '10', 'x-ratelimit-remaining': '0', 'retry-after': '0',
      })
    }
    return json({ items: [ghItem('in-both', 100), ghItem('from-github', 50)] }, 200, { etag: 'W/"t"' })
  }
  if (target.includes('awesome-dsh-plugin.com')) return json(REGISTRY, 200, { etag: 'W/"t"' })
  throw new Error(`unexpected fetch: ${target}`)
}

const home = await mkdtemp(join(tmpdir(), 'findp-tool-'))
process.env.DSH_HOME = home

let registered = null
// `inject` mirrors cordis: the callback runs once the named services exist. This
// fake runs it immediately against the same context; the tool suite does not
// exercise the prompt section, it only has to keep `apply` from throwing.
const baseCtx = {
  tools: { register: (def) => { registered = def } },
  get: () => undefined,
  inject: (_deps, callback) => { callback(baseCtx) },
}

/** A context whose `get` follows one rule, plus the `inject` shim `apply` needs. */
function ctxWith(get, register = (def) => { capturedDef = def }) {
  const ctx = { tools: { register }, get, inject: (_deps, callback) => { callback(ctx) } }
  return ctx
}
let capturedDef = null
const render = (out) => registered.output.render({}, out).map((block) => block.text).join('')

test('contract: name, parameters, timeout and description', () => {
  apply(baseCtx)
  assert.equal(registered.name, 'find_dsh_plugin')
  assert.equal(registered.parameters.type, 'object')
  assert.ok(registered.parameters.properties.query)
  assert.equal(registered.timeoutMs, 25000)
  assert.match(registered.description, /curated/)
})

test('happy path: live GitHub results, enriched with curated descriptions', async () => {
  apply(baseCtx)
  const out = await registered.execute({ query: 'memory baseline', limit: 5 }, undefined)
  assert.deepEqual(out.results.map((r) => r.name), ['in-both', 'from-github'])
  assert.equal(out.results[0].description, 'Curated description', 'the curated bilingual description wins')
  assert.match(out.note, /Live GitHub/)
  assert.match(render(out), /install: dsh plugin --profile web add github:acme\/in-both/)
})

test('a rate limit degrades to curated keyword matches instead of failing', async () => {
  apply(baseCtx)
  const out = await registered.execute({ query: 'memory degrade', limit: 5 }, undefined)
  assert.deepEqual(out.results.map((r) => r.name).sort(), ['curated-only', 'in-both', 'long-desc'])
  assert.match(out.note, /GitHub search is rate limited/)
  assert.match(out.note, /Falling back to keyword matches/)
  assert.match(out.note, /source=/)
  assert.match(out.note, /GITHUB_TOKEN/)
})

test('a degraded search with no match still explains the source', async () => {
  apply(baseCtx)
  const out = await registered.execute({ query: 'zzz-no-such-capability degrade', limit: 3 }, undefined)
  assert.deepEqual(out.results, [])
  assert.match(out.note, /Falling back/)
  assert.match(render(out), /No matching plugins found/)
})

test('curated descriptions are truncated to 240 characters', async () => {
  apply(baseCtx)
  const out = await registered.execute({ query: 'memory degrade truncate', limit: 5 }, undefined)
  const long = out.results.find((r) => r.name === 'long-desc')
  assert.ok(long, `expected the long description entry, got: ${out.results.map((r) => r.name).join(',')}`)
  assert.equal(long.description.length, 240)
  assert.match(long.description, /…$/)
})

test('the GITHUB_TOKEN credential is forwarded as a bearer token', async () => {
  let captured = null
  apply(ctxWith(
    (service) => (service === 'credentials' ? { resolve: async () => ({ value: 'ghp_from_dsh' }) } : undefined),
    (def) => { captured = def },
  ))
  await captured.execute({ query: 'memory token path', limit: 2 }, undefined)
  const query = [...seenAuth.keys()].find((key) => key.includes('memory token path'))
  assert.equal(seenAuth.get(query), 'Bearer ghp_from_dsh')
})

test('a missing credentials service degrades to anonymous', async () => {
  apply(baseCtx)
  await registered.execute({ query: 'memory no creds', limit: 2 }, undefined)
  const query = [...seenAuth.keys()].find((key) => key.includes('memory no creds'))
  assert.equal(seenAuth.get(query), null)
})

test('a failing credentials service degrades to anonymous instead of erroring', async () => {
  let captured = null
  apply(ctxWith(
    () => ({ resolve: async () => { throw new Error('credentials service down') } }),
    (def) => { captured = def },
  ))
  const out = await captured.execute({ query: 'memory creds throw', limit: 2 }, undefined)
  const query = [...seenAuth.keys()].find((key) => key.includes('memory creds throw'))
  assert.equal(seenAuth.get(query), null)
  assert.ok(out.results.length > 0)
})

test('limit is clamped to 1..20', async () => {
  apply(baseCtx)
  assert.equal((await registered.execute({ query: 'memory clamp high', limit: 999 }, undefined)).results.length, 2)
  assert.equal((await registered.execute({ query: 'memory clamp low', limit: 0 }, undefined)).results.length, 1)
})

// ── adaptations for the current host (0.2.1-rc.5) ──────────────────────────

test('a credentials service that throws from ctx.get() itself degrades to anonymous', async () => {
  // Cordis resolves unknown services with `strict`, so `ctx.get('credentials')`
  // throws on a host that does not provide the service. The tool must still run.
  let captured = null
  apply(ctxWith(
    (service) => { throw new Error(`unknown service: ${service}`) },
    (def) => { captured = def },
  ))
  const out = await captured.execute({ query: 'memory strict get ' + Date.now(), limit: 2 }, undefined)
  assert.ok(out.results.length > 0)
})

test('non-numeric limit is rejected before execution; empty lang falls back to en', async () => {
  // The current host validates declared parameter types in `defineTool`, so the
  // numeric-safe clamp inside `execute` is defence in depth for direct callers.
  apply(baseCtx)
  await assert.rejects(
    () => registered.execute({ query: 'memory nan limit ' + Date.now(), limit: 'abc' }, undefined),
    (error) => error?.code === 'INVALID_ARGS',
  )
  const low = await registered.execute({ query: 'memory trunc limit ' + Date.now(), limit: 2.9, lang: '' }, undefined)
  assert.ok(low.results.length <= 2)
})

test('the run context signal is forwarded to the GitHub request', async () => {
  let seen = null
  const previous = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.github.com')) { seen = init?.signal; }
    return previous(url, init)
  }
  try {
    apply(baseCtx)
    const controller = new AbortController()
    await registered.execute({ query: 'memory signal ' + Date.now(), limit: 2 }, { signal: controller.signal })
    assert.ok(seen instanceof AbortSignal, 'fetch must receive a signal')
  } finally { globalThis.fetch = previous }
})

test.after(async () => {
  delete process.env.DSH_HOME
  await rm(home, { recursive: true, force: true })
})
