/**
 * GitHub search resilience and curated-registry caching.
 *
 * Offline by default (mocked `fetch`); cases guarded by `FINDP_LIVE=1` hit the
 * real network:
 *
 *   node --test "test/**\/*.test.mjs"
 *   FINDP_LIVE=1 node --test test/rate-limit.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const realFetch = globalThis.fetch
const restore = () => { globalThis.fetch = realFetch }
let seq = 0
/** Each call returns a fresh module instance (isolates module-level caches). */
const load = (name) => import(`${new URL(`../lib/${name}`, import.meta.url).href}?t=${seq++}`)

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/** 403 with an exhausted anonymous search window; `retry-after: 0` keeps tests fast. */
const rateLimited = () => json({ message: 'API rate limit exceeded' }, 403, {
  'x-ratelimit-limit': '10',
  'x-ratelimit-remaining': '0',
  'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 30),
  'retry-after': '0',
})

const ghItem = (name, stars, full = `acme/${name}`) => ({
  name,
  full_name: full,
  html_url: `https://github.com/${full}`,
  description: `${name} from github`,
  stargazers_count: stars,
  pushed_at: '2026-09-01T00:00:00Z',
  owner: { login: full.split('/')[0] },
})

const registryFixture = () => ({
  updated: '2026-09-08',
  count: 2,
  categories: { memory: { en: 'Memory', zh: '记忆' } },
  plugins: [
    { name: 'in-both', owner: 'acme', url: 'https://github.com/acme/in-both', category: 'memory', description: { en: 'Curated description', zh: 'curated 描述' }, install: 'dsh plugin --profile web add github:acme/in-both', added: '2026-09-01', stars: 100 },
    { name: 'curated-only', owner: 'acme', url: 'https://github.com/acme/curated-only', category: 'memory', description: { en: 'Only in curated', zh: '只在 curated' }, install: 'dsh plugin --profile web add github:acme/curated-only', added: '2026-09-02', stars: 5 },
  ],
})

async function withTempHome(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'findp-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    return await fn(dir)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
}

// ── github.js ────────────────────────────────────────────────────────────────

test('anonymous search sends no Authorization header', async () => {
  const { searchGitHub } = await load('github.js')
  let headers = null
  globalThis.fetch = async (_url, init) => { headers = init.headers; return json({ items: [ghItem('a', 1)] }) }
  try {
    const out = await searchGitHub('anon', 5)
    assert.equal(headers.authorization, undefined)
    assert.equal(out[0].install, 'dsh plugin --profile web add github:acme/a')
  } finally { restore() }
})

test('a token is sent as Authorization: Bearer', async () => {
  const { searchGitHub } = await load('github.js')
  let headers = null
  globalThis.fetch = async (_url, init) => { headers = init.headers; return json({ items: [ghItem('a', 1)] }) }
  try {
    await searchGitHub('with-token', 5, { token: 'ghp_test' })
    assert.equal(headers.authorization, 'Bearer ghp_test')
  } finally { restore() }
})

test('an empty token string counts as unset', async () => {
  const { searchGitHub } = await load('github.js')
  let headers = null
  globalThis.fetch = async (_url, init) => { headers = init.headers; return json({ items: [] }) }
  try {
    await searchGitHub('empty-token', 5, { token: '' })
    assert.equal(headers.authorization, undefined)
  } finally { restore() }
})

test('403 retries once, then throws GitHubSearchRateLimited with limit/remaining', async () => {
  const { searchGitHub, GitHubSearchRateLimited } = await load('github.js')
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return rateLimited() }
  try {
    await assert.rejects(() => searchGitHub('403', 5), (error) => {
      assert.ok(error instanceof GitHubSearchRateLimited)
      assert.equal(error.info.status, 403)
      assert.equal(error.info.limit, 10)
      assert.equal(error.info.remaining, 0)
      assert.match(error.message, /GITHUB_TOKEN/)
      return true
    })
    assert.equal(calls, 2, 'exactly one retry')
  } finally { restore() }
})

test('429 is treated as rate limiting too', async () => {
  const { searchGitHub, GitHubSearchRateLimited } = await load('github.js')
  globalThis.fetch = async () => json({ message: 'slow down' }, 429, { 'retry-after': '0' })
  try {
    await assert.rejects(() => searchGitHub('429', 5), GitHubSearchRateLimited)
  } finally { restore() }
})

test('network errors retry once, then throw a plain Error', async () => {
  const { searchGitHub, GitHubSearchRateLimited } = await load('github.js')
  let calls = 0
  globalThis.fetch = async () => { calls += 1; throw new Error('ECONNRESET') }
  try {
    let caught = null
    try { await searchGitHub('net-error', 5) } catch (error) { caught = error }
    assert.ok(caught instanceof Error)
    assert.equal(caught instanceof GitHubSearchRateLimited, false)
    assert.match(caught.message, /GitHub search failed/)
    assert.equal(calls, 2)
  } finally { restore() }
})

test('a cancelled caller request is not retried', async () => {
  const { searchGitHub } = await load('github.js')
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  globalThis.fetch = async () => { calls += 1; throw new Error('aborted') }
  try {
    await assert.rejects(() => searchGitHub('cancelled', 5, { signal: controller.signal }))
    assert.equal(calls, 1)
  } finally { restore() }
})

test('a bad token yields HTTP 401 (not the rate-limit error) and reports token=set', async () => {
  const { searchGitHub, GitHubSearchRateLimited } = await load('github.js')
  globalThis.fetch = async () => json({ message: 'Bad credentials' }, 401)
  try {
    let caught = null
    try { await searchGitHub('bad-token', 5, { token: 'bad' }) } catch (error) { caught = error }
    assert.equal(caught instanceof GitHubSearchRateLimited, false)
    assert.match(caught.message, /HTTP 401/)
    assert.match(caught.message, /token=set/)
  } finally { restore() }
})

test('successes are cached per query; failures are cached for a minute', async () => {
  const { searchGitHub } = await load('github.js')
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return json({ items: [ghItem('a', 1), ghItem('b', 2)] }) }
  try {
    assert.equal((await searchGitHub('cache-ok', 5)).length, 2)
    assert.equal((await searchGitHub('cache-ok', 1)).length, 1, 'limit applies to the cached copy')
    assert.equal(calls, 1)
  } finally { restore() }

  let failedCalls = 0
  globalThis.fetch = async () => { failedCalls += 1; return rateLimited() }
  try {
    await assert.rejects(() => searchGitHub('cache-fail', 5))
    await assert.rejects(() => searchGitHub('cache-fail', 5))
    assert.equal(failedCalls, 2, 'second attempt served from the failure cache')
  } finally { restore() }
})

test('per_page is capped at 20 and the topic qualifier is applied', async () => {
  const { searchGitHub } = await load('github.js')
  let seen = ''
  globalThis.fetch = async (url) => { seen = String(url); return json({ items: [] }) }
  try {
    await searchGitHub('perpage', 50)
    assert.match(seen, /per_page=20/)
    assert.match(seen, /topic%3Adsh-plugin/)
  } finally { restore() }
})

// ── registry.js ──────────────────────────────────────────────────────────────

test('registry: a live fetch is cached to disk along with its validators', async () => {
  await withTempHome(async (home) => {
    const { loadRegistry } = await load('registry.js')
    globalThis.fetch = async () => json(registryFixture(), 200, { etag: 'W/"abc"', 'last-modified': 'Tue, 08 Sep 2026 14:20:58 GMT' })
    try {
      const out = await loadRegistry()
      assert.equal(out.source, 'live')
      assert.equal(out.registry.plugins.length, 2)
      const cached = JSON.parse(await readFile(join(home, 'cache', 'dsh-find-plugin', 'registry.json'), 'utf8'))
      assert.equal(cached.etag, 'W/"abc"')
      assert.equal(cached.registry.plugins.length, 2)
    } finally { restore() }
  })
})

test('registry: within the TTL the in-memory copy is reused', async () => {
  await withTempHome(async () => {
    const { loadRegistry } = await load('registry.js')
    let calls = 0
    globalThis.fetch = async () => { calls += 1; return json(registryFixture(), 200, { etag: 'W/"x"' }) }
    try {
      assert.equal((await loadRegistry()).source, 'live')
      assert.equal((await loadRegistry()).source, 'memory')
      assert.equal(calls, 1)
    } finally { restore() }
  })
})

test('registry: a disk cache triggers a conditional request; 304 keeps it', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'cache', 'dsh-find-plugin')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'registry.json'), JSON.stringify({
      version: 1, fetchedAt: new Date().toISOString(), etag: 'W/"disk"', lastModified: 'Tue, 08 Sep 2026 14:20:58 GMT',
      registry: registryFixture(),
    }), 'utf8')

    const { loadRegistry } = await load('registry.js')
    let headers = null
    globalThis.fetch = async (_url, init) => { headers = init?.headers ?? {}; return new Response(null, { status: 304 }) }
    try {
      const out = await loadRegistry()
      assert.equal(out.source, 'cache')
      assert.equal(out.registry.plugins.length, 2)
      assert.equal(headers['if-none-match'], 'W/"disk"')
      assert.equal(headers['if-modified-since'], 'Tue, 08 Sep 2026 14:20:58 GMT')
    } finally { restore() }
  })
})

test('registry: offline with a disk cache uses the disk cache, not the snapshot', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'cache', 'dsh-find-plugin')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'registry.json'), JSON.stringify({
      version: 1, fetchedAt: new Date().toISOString(), registry: registryFixture(),
    }), 'utf8')

    const { loadRegistry } = await load('registry.js')
    globalThis.fetch = async () => { throw new Error('offline') }
    try {
      const out = await loadRegistry()
      assert.equal(out.source, 'disk')
      assert.equal(out.registry.plugins.length, 2)
    } finally { restore() }
  })
})

test('registry: offline with no cache falls back to the bundled snapshot', async () => {
  await withTempHome(async () => {
    const { loadRegistry } = await load('registry.js')
    globalThis.fetch = async () => { throw new Error('offline') }
    try {
      const out = await loadRegistry()
      assert.equal(out.source, 'snapshot')
      assert.ok(out.registry.plugins.length > 0)
    } finally { restore() }
  })
})

test('registry: an HTTP error or a corrupt cache degrades instead of throwing', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'cache', 'dsh-find-plugin')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'registry.json'), '{ not json', 'utf8')
    const { loadRegistry } = await load('registry.js')
    globalThis.fetch = async () => new Response('boom', { status: 500 })
    try {
      assert.equal((await loadRegistry()).source, 'snapshot')
    } finally { restore() }
  })
})

// ── why a request failed, and the proxy trap behind most of those reports ───

test('a transport failure reports its cause, not just "fetch failed"', async () => {
  const { searchGitHub } = await load('github.js')
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' }),
    })
  }
  try {
    const error = await searchGitHub(`cause-${Date.now()}`, 3).then(() => null, thrown => thrown)
    assert.ok(error !== null, 'expected the failure to surface')
    assert.match(error.message, /GitHub search failed: fetch failed ← certificate has expired \(CERT_HAS_EXPIRED\)/)
    assert.equal(calls, 2, 'one retry before giving up')
  } finally { restore() }
})

test('a proxy the host will ignore is named in the failure, and not when it opted in', async () => {
  const { searchGitHub } = await load('github.js')
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })
  }
  const saved = {
    proxy: process.env.HTTPS_PROXY,
    http: process.env.HTTP_PROXY,
    optIn: process.env.NODE_USE_ENV_PROXY,
  }
  process.env.HTTPS_PROXY = 'http://127.0.0.1:7897'
  delete process.env.HTTP_PROXY
  delete process.env.NODE_USE_ENV_PROXY
  try {
    const hinted = await searchGitHub('proxy-unused', 3).then(() => null, thrown => thrown)
    assert.match(hinted.message, /HTTPS_PROXY is set, but Node's fetch ignores proxy environment variables/)

    process.env.NODE_USE_ENV_PROXY = '1'
    const quiet = await searchGitHub('proxy-opted-in', 3).then(() => null, thrown => thrown)
    assert.doesNotMatch(quiet.message, /HTTPS_PROXY is set/)
  } finally {
    restore()
    if (saved.proxy === undefined) delete process.env.HTTPS_PROXY
    else process.env.HTTPS_PROXY = saved.proxy
    if (saved.http === undefined) delete process.env.HTTP_PROXY
    else process.env.HTTP_PROXY = saved.http
    if (saved.optIn === undefined) delete process.env.NODE_USE_ENV_PROXY
    else process.env.NODE_USE_ENV_PROXY = saved.optIn
  }
})

test('registry: a `~` in DSH_HOME expands to the OS home, as the host resolves it', async () => {
  const previous = process.env.DSH_HOME
  const name = `findp-tilde-${process.pid}-${Date.now()}`
  process.env.DSH_HOME = `~/${name}`
  try {
    const { loadRegistry } = await load('registry.js')
    globalThis.fetch = async () => json(registryFixture(), 200, { etag: 'W/"t"' })
    try {
      assert.equal((await loadRegistry()).source, 'live')
      const cached = JSON.parse(await readFile(join(homedir(), name, 'cache', 'dsh-find-plugin', 'registry.json'), 'utf8'))
      assert.equal(cached.registry.plugins.length, 2)
    } finally { restore() }
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(join(homedir(), name), { recursive: true, force: true })
  }
})



// ── adaptations for the current host (0.2.1-rc.5) ────────────────────────────

test('a caller cancellation during the retry delay stops the call immediately', async () => {
  const { searchGitHub } = await load('github.js')
  let calls = 0
  globalThis.fetch = async () => { calls += 1; throw new Error('ECONNRESET') }
  try {
    const controller = new AbortController()
    const started = Date.now()
    const pending = searchGitHub(`cancel-mid-retry-${Date.now()}`, 3, { signal: controller.signal })
    setTimeout(() => controller.abort(new Error('user cancelled')), 50)
    const error = await pending.then(() => null, (thrown) => thrown)
    assert.ok(error instanceof Error, 'the call must reject when cancelled')
    assert.equal(calls, 1, 'no further attempt after cancellation')
    assert.ok(Date.now() - started < 1000, 'the 1.5 s retry delay must not run to completion')
  } finally { restore() }
})

test('a registry fetch is cancelled with the caller signal and falls back without it completing', async () => {
  await withTempHome(async () => {
    const { loadRegistry } = await load('registry.js')
    let sawSignal = null
    globalThis.fetch = async (_url, init) => {
      sawSignal = init?.signal
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true })
      })
    }
    try {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 20)
      const out = await loadRegistry({ signal: controller.signal })
      assert.ok(sawSignal instanceof AbortSignal, 'the registry request must carry a signal')
      assert.notEqual(out.source, 'live', 'a cancelled request answers from the fallback chain')
    } finally { restore() }
  })
})

test('the host timer service owns the registry deadline', async () => {
  await withTempHome(async () => {
    const { loadRegistry } = await load('registry.js')
    let asked = null
    globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    })
    // A one-shot host timer, standing in for `ctx.timer.timeout(delay)` firing.
    const pending = []
    const timer = { timeout: (delay) => { asked = delay; return new Promise((resolve) => pending.push(resolve)) } }
    try {
      const call = loadRegistry({ timer })
      setTimeout(() => pending.splice(0).forEach((fire) => fire()), 20)
      const out = await call
      assert.equal(asked, 10_000, 'the 10 s deadline goes through ctx.timer when present')
      assert.equal(out.source, 'snapshot', 'the deadline degrades to the fallback chain')
      assert.ok(out.registry.plugins.length > 0)
    } finally { restore() }
  })
})

test('a disposed plugin timer also ends the registry request', async () => {
  await withTempHome(async () => {
    const { loadRegistry } = await load('registry.js')
    globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    })
    try {
      const out = await loadRegistry({ timer: { timeout: () => Promise.reject(new Error('disposed')) } })
      assert.equal(out.source, 'snapshot')
    } finally { restore() }
  })
})

test('registry: a 304 for a memory-only copy keeps that copy, and the next call serves it from memory', async () => {
  await withTempHome(async () => {
    const { loadRegistry } = await load('registry.js')
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      return calls === 1
        ? json(registryFixture(), 200, { etag: 'W/"mem"' })
        : new Response(null, { status: 304 })
    }
    try {
      assert.equal((await loadRegistry()).source, 'live')
      assert.equal((await loadRegistry()).source, 'memory', 'the fresh memory copy is reused within the TTL')
    } finally { restore() }
  })
})

test('registry: a conditional refresh re-sends the validators it was given', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'cache', 'dsh-find-plugin')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'registry.json'), JSON.stringify({
      version: 1, fetchedAt: new Date().toISOString(), etag: 'W/"disk2"',
      registry: registryFixture(),
    }), 'utf8')
    const { loadRegistry } = await load('registry.js')
    const sent = []
    globalThis.fetch = async (_url, init) => {
      sent.push(init?.headers?.['if-none-match'] ?? null)
      return new Response(null, { status: 304 })
    }
    try {
      assert.equal((await loadRegistry()).source, 'cache')
      assert.deepEqual(sent, ['W/"disk2"'])
    } finally { restore() }
  })
})

test('registry: a malformed live body with a disk cache and no memory falls back to disk, never throws', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'cache', 'dsh-find-plugin')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'registry.json'), JSON.stringify({
      version: 1, registry: registryFixture(),
    }), 'utf8')
    const { loadRegistry } = await load('registry.js')
    globalThis.fetch = async () => json({ plugins: [] })
    try {
      const out = await loadRegistry()
      assert.equal(out.source, 'disk')
    } finally { restore() }
  })
})

// ── opt-in live network cases ────────────────────────────────────────────────

const live = process.env.FINDP_LIVE === '1'
const liveSkip = live ? false : 'live network test — set FINDP_LIVE=1 to run'

test('live: anonymous search either succeeds or reports rate limiting deterministically', { skip: liveSkip }, async () => {
  globalThis.fetch = realFetch
  const { searchGitHub, GitHubSearchRateLimited } = await load('github.js')
  try {
    const out = await searchGitHub(`dsh-plugin probe ${Date.now()}`, 3)
    for (const item of out) assert.match(item.install, /^dsh plugin --profile web add github:/)
  } catch (error) {
    assert.ok(error instanceof GitHubSearchRateLimited, `unexpected: ${error?.message}`)
    assert.equal(error.info.limit, 10, 'anonymous search quota is 10/min')
    assert.equal(error.info.remaining, 0)
  }
})

test('live: a bogus token proves the Authorization header is really sent (401)', { skip: liveSkip }, async () => {
  globalThis.fetch = realFetch
  const { searchGitHub, GitHubSearchRateLimited } = await load('github.js')
  let caught = null
  try {
    await searchGitHub(`dsh-plugin bogus ${Date.now()}`, 3, { token: 'ghp_definitely_not_valid_000' })
  } catch (error) { caught = error }
  assert.ok(caught)
  assert.equal(caught instanceof GitHubSearchRateLimited, false)
  assert.match(caught.message, /HTTP 401/)
})
