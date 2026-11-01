/**
 * The manual entry point: `/find-plugin [--limit N] [--lang zh|en] <keywords>`.
 *
 * Two layers are covered here: the pure grammar ({@link parseCommandArgs}) and
 * the registration path against a fake command service, including a host that
 * has no command service at all (the plugin must still register the tool).
 *
 * Kept in its own file like the tool suite: a fake `fetch` router is installed
 * per process so the github/registry suites cannot tear it down.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { apply } = await import(new URL('../lib/index.js', import.meta.url).href)
const { parseCommandArgs } = await import(new URL('../lib/command.js', import.meta.url).href)

const REGISTRY = {
  updated: '2026-09-08',
  count: 2,
  categories: { memory: { en: 'Memory', zh: '记忆' } },
  plugins: [
    { name: 'memory-a', owner: 'acme', url: 'https://github.com/acme/memory-a', category: 'memory', description: { en: 'A memory plugin', zh: '记忆插件 A' }, install: 'dsh plugin --profile web add github:acme/memory-a', added: '2026-09-01', stars: 10 },
    { name: 'memory-b', owner: 'acme', url: 'https://github.com/acme/memory-b', category: 'memory', description: { en: 'Another memory plugin', zh: '记忆插件 B' }, install: 'dsh plugin --profile web add github:acme/memory-b', added: '2026-09-02', stars: 5 },
  ],
}

const ghItem = (name, stars) => ({
  name, full_name: `acme/${name}`, html_url: `https://github.com/acme/${name}`, description: `${name} from github`,
  stargazers_count: stars, pushed_at: '2026-09-01T00:00:00Z', owner: { login: 'acme' },
})

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const seenQueries = []
globalThis.fetch = async (url) => {
  const target = String(url)
  if (target.includes('api.github.com')) {
    seenQueries.push(new URL(target).searchParams.get('q') ?? '')
    return json({ items: [ghItem('memory-a', 10), ghItem('from-github', 30)] })
  }
  if (target.includes('awesome-dsh-plugin.com')) return json(REGISTRY)
  throw new Error(`unexpected fetch: ${target}`)
}

const home = await mkdtemp(join(tmpdir(), 'findp-command-'))
process.env.DSH_HOME = home

/** A fake `commands` service that records the registration. */
function fakeCommands() {
  const registered = new Map()
  return {
    registered,
    service: {
      register: (definition) => {
        assert.ok(!registered.has(definition.name), `duplicate registration: ${definition.name}`)
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
    },
  }
}

function pluginContext(commands) {
  const tools = []
  return {
    tools,
    ctx: {
      tools: { register: (definition) => { tools.push(definition); return () => {} } },
      get: (service) => (service === 'commands' ? commands : undefined),
      effect: (callback) => callback,
    },
  }
}

// ── grammar ─────────────────────────────────────────────────────────────────

test('grammar: keywords only, defaults 5 results and en', () => {
  assert.deepEqual(parseCommandArgs('跨会话记忆'), { query: '跨会话记忆', limit: 5, lang: 'en' })
})

test('grammar: --limit and --lang accept both spaced and = forms', () => {
  assert.deepEqual(parseCommandArgs('--limit 3 --lang zh memory'), { query: 'memory', limit: 3, lang: 'zh' })
  assert.deepEqual(parseCommandArgs('memory --limit=7 --lang=zh'), { query: 'memory', limit: 7, lang: 'zh' })
  assert.deepEqual(parseCommandArgs('-n 2 -l en wechat notifications'), { query: 'wechat notifications', limit: 2, lang: 'en' })
})

test('grammar: limit is clamped to 1..20 and garbage falls back to the default', () => {
  assert.equal(parseCommandArgs('--limit 99 memory').limit, 20)
  assert.equal(parseCommandArgs('--limit 0 memory').limit, 1)
  assert.equal(parseCommandArgs('--limit abc memory').limit, 5)
  assert.equal(parseCommandArgs('memory --limit').limit, 5)
})

test('grammar: an empty or flags-only line yields an empty query', () => {
  assert.equal(parseCommandArgs('').query, '')
  assert.equal(parseCommandArgs('   ').query, '')
  assert.equal(parseCommandArgs('--limit 3').query, '')
})

// ── registration ────────────────────────────────────────────────────────────

test('registration: the command is registered with its description and input hint', () => {
  const commands = fakeCommands()
  const { ctx, tools } = pluginContext(commands.service)
  apply(ctx)
  assert.equal(tools.length, 1, 'the tool is still registered')
  const definition = commands.registered.get('find-plugin')
  assert.ok(definition, 'expected /find-plugin to be registered')
  assert.match(definition.description, /GitHub/)
  assert.match(definition.input.hint, /--limit/)
})

test('registration: a host without a commands service still registers the tool', () => {
  const { ctx, tools } = pluginContext(undefined)
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(tools.length, 1)
})

test('registration: a throwing ctx.get (strict Cordis) is tolerated', () => {
  const tools = []
  apply({
    tools: { register: (definition) => { tools.push(definition); return () => {} } },
    get: (service) => { throw new Error(`unknown service: ${service}`) },
    effect: (callback) => callback,
  })
  assert.equal(tools.length, 1)
})

// ── handler ─────────────────────────────────────────────────────────────────

test('handler: runs the shared search and renders results with the query', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext(commands.service)
  apply(ctx)
  const result = await commands.registered.get('find-plugin').handler({ rawInput: '--limit 2 memory', signal: new AbortController().signal })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /^\/find-plugin memory/)
  assert.match(result.text, /memory-a/)
  assert.match(result.text, /from-github/)
  assert.match(result.text, /install: dsh plugin --profile web add github:/)
  assert.match(result.text, /Live GitHub/)
  assert.ok(!result.text.includes('memory-b'), 'limit 2 means two GitHub results')
})

test('handler: --lang picks the curated description language', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext(commands.service)
  apply(ctx)
  const result = await commands.registered.get('find-plugin').handler({ rawInput: '--lang zh memory', signal: new AbortController().signal })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /记忆插件 A/)
})

test('handler: an empty query reports usage instead of searching', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext(commands.service)
  apply(ctx)
  const before = seenQueries.length
  const result = await commands.registered.get('find-plugin').handler({ rawInput: '--lang zh', signal: new AbortController().signal })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /Usage: \/find-plugin/)
  assert.equal(seenQueries.length, before, 'no search is attempted')
})

test('handler: the command signal reaches the GitHub request', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext(commands.service)
  apply(ctx)
  const controller = new AbortController()
  let seen = null
  const previous = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.github.com')) seen = init?.signal
    return previous(url, init)
  }
  try {
    await commands.registered.get('find-plugin').handler({ rawInput: 'memory signal', signal: controller.signal })
    assert.ok(seen instanceof AbortSignal)
  } finally { globalThis.fetch = previous }
})

test.after(async () => {
  delete process.env.DSH_HOME
  await rm(home, { recursive: true, force: true })
})
