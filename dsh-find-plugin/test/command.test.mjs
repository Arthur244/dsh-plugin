/**
 * The manual entry point: `/find-plugin <natural-language request>`.
 *
 * The command must NOT search: it hands one user message to the agent through
 * `agent.steer`, and the agent decides the tool parameters. These cases pin
 * that contract: what the command does to the agent, what it says, and the
 * bare-command (context-inference + confirm) path.
 *
 * Kept in its own file like the tool suite so no other suite's `fetch` swap can
 * interfere with it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { apply } = await import(new URL('../lib/index.js', import.meta.url).href)
const { commandPrompt } = await import(new URL('../lib/command.js', import.meta.url).href)

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

/** A fake agent that records every steered message. */
function fakeAgent() {
  const steered = []
  return { steered, agent: { steer: (message) => { steered.push(message) } } }
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

const textOf = (message) => message.content.map((block) => block.text).join('\n')

// ── prompt text ─────────────────────────────────────────────────────────────

test('prompt: a request is carried verbatim and the agent is told to choose parameters', () => {
  const prompt = commandPrompt('  任务完成时想收到微信通知，有插件吗  ')
  assert.match(prompt, /任务完成时想收到微信通知，有插件吗/, 'the request is kept verbatim')
  assert.match(prompt, /`find_dsh_plugin`/)
  assert.match(prompt, /choose the tool parameters yourself/)
  assert.doesNotMatch(prompt, /^\s*任务完成时/, 'the request is embedded, not used as a raw query')
})

test('prompt: a bare command asks for context inference and confirmation, not a search', () => {
  const prompt = commandPrompt('   ')
  assert.match(prompt, /without naming what to look for/)
  assert.match(prompt, /Infer from the conversation so far/)
  assert.match(prompt, /ask the user to confirm/)
  assert.match(prompt, /Do not call the tool yet/)
})

// ── registration ────────────────────────────────────────────────────────────

test('registration: the command is registered with its description and input hint', () => {
  const commands = fakeCommands()
  const { ctx, tools } = pluginContext(commands.service)
  apply(ctx)
  assert.equal(tools.length, 1, 'the tool is still registered')
  const definition = commands.registered.get('find-plugin')
  assert.ok(definition, 'expected /find-plugin to be registered')
  assert.match(definition.description, /find_dsh_plugin/)
  assert.match(definition.input.hint, /your own words/)
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

test('handler: a request is steered to the agent as one user message, and nothing is searched', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext(commands.service)
  apply(ctx)
  const { agent, steered } = fakeAgent()
  let fetched = false
  const previous = globalThis.fetch
  globalThis.fetch = async () => { fetched = true; return new Response('{}') }
  try {
    const result = await commands.registered.get('find-plugin').handler({
      agent,
      rawInput: ' 任务完成时想收到微信通知，有插件吗',
      signal: new AbortController().signal,
    })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /Sent to the agent/)
    assert.equal(steered.length, 1, 'exactly one user message is steered')
    const message = steered[0]
    assert.equal(message.role, 'user')
    assert.ok(Object.isFrozen(message), 'the message is frozen like a host-created user message')
    assert.equal(message.source.kind, 'command')
    assert.equal(message.source.name, 'find-plugin')
    assert.match(textOf(message), /微信通知/, 'the user wording reaches the agent')
    assert.match(textOf(message), /`find_dsh_plugin`/)
    assert.equal(fetched, false, 'the command itself performs no search')
  } finally { globalThis.fetch = previous }
})

test('handler: a bare command steers the context-inference prompt', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext(commands.service)
  apply(ctx)
  const { agent, steered } = fakeAgent()
  const result = await commands.registered.get('find-plugin').handler({ agent, rawInput: '' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /ask you to confirm/)
  assert.equal(steered.length, 1)
  assert.match(textOf(steered[0]), /ask the user to confirm/)
  assert.doesNotMatch(textOf(steered[0]), /Their request, verbatim/)
})

test('handler: a command run without an agent fails with a reason and steers nothing', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext(commands.service)
  apply(ctx)
  const result = await commands.registered.get('find-plugin').handler({ rawInput: 'memory' })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /no live agent/)
})

test('handler: an agent whose steer throws is reported, not propagated', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext(commands.service)
  apply(ctx)
  const result = await commands.registered.get('find-plugin').handler({
    agent: { steer: () => { throw new Error('inbox closed') } },
    rawInput: 'memory',
  })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /inbox closed/)
})

test.after(async () => {
  delete process.env.DSH_HOME
  await rm(home, { recursive: true, force: true })
})
