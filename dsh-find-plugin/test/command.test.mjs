/**
 * The manual entry point: `/find-plugin <natural-language request>`.
 *
 * The command must NOT search: it hands one user message to the agent through
 * `agent.steer`, and the agent decides the tool parameters. These cases pin
 * that contract: what the command does to the agent, what it says, the
 * bare-command (context inference + search) path, and the message source the
 * Web chat needs in order to render the row as the user's own message.
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
  assert.ok(prompt.startsWith('任务完成时想收到微信通知，有插件吗'), 'the request leads the row, so it reads like a user message')
  assert.match(prompt, /`find_dsh_plugin`/)
  assert.match(prompt, /自己决定 query、limit 和 lang/, 'the agent, not the command, picks the parameters')
  assert.match(prompt, /不必先问我确认/)
})

test('prompt: the instruction follows the language of the request', () => {
  const english = commandPrompt('wechat notifications')
  assert.match(english, /choose `query`, `limit` and `lang` yourself/)
  assert.match(english, /third-party code worth reviewing/)
  const chinese = commandPrompt('微信通知')
  assert.match(chinese, /第三方代码/)
  assert.doesNotMatch(chinese, /choose `query`/, 'no English instruction is appended to a Chinese request')
})

test('prompt: a bare command asks for context inference and the search, not a confirmation round', () => {
  const english = commandPrompt('   ')
  assert.match(english, /infer from this conversation/)
  assert.match(english, /Use the `find_dsh_plugin` tool now/)
  assert.match(english, /Do not ask me to confirm first/)
  assert.doesNotMatch(english, /My request:/, 'the bare path carries no request text')
  const chinese = commandPrompt('', true)
  assert.match(chinese, /从上面的对话推断/)
  assert.match(chinese, /不必先问我确认/)
  assert.doesNotMatch(chinese, /infer from this conversation/)
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
    assert.match(result.text, /Sent — the agent/)
    assert.equal(steered.length, 1, 'exactly one user message is steered')
    const message = steered[0]
    assert.equal(message.role, 'user')
    assert.ok(Object.isFrozen(message), 'the message is frozen like a host-created user message')
    assert.ok(textOf(message).startsWith('任务完成时想收到微信通知，有插件吗'), 'the user wording opens the message')
    assert.match(textOf(message), /`find_dsh_plugin`/)
    assert.equal(fetched, false, 'the command itself performs no search')
  } finally { globalThis.fetch = previous }
})

test('handler: the steered message declares the plain user source, so chat renders it as a user row', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext(commands.service)
  apply(ctx)
  const { agent, steered } = fakeAgent()
  await commands.registered.get('find-plugin').handler({ agent, rawInput: 'memory' })
  const message = steered[0]
  // The Web chat folds a waking message from any other source kind into the
  // non-human turn-trigger card (`message.trigger.request`); `user` keeps the
  // row identical to a typed message, which is why `/plan` uses it too.
  assert.deepEqual(message.source, { kind: 'user' })
})

test('handler: a bare command steers the context-inference prompt that searches straight away', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext(commands.service)
  apply(ctx)
  const { agent, steered } = fakeAgent()
  const result = await commands.registered.get('find-plugin').handler({ agent, rawInput: '' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /take the need from this conversation/)
  assert.equal(steered.length, 1)
  assert.match(textOf(steered[0]), /infer from this conversation/)
  assert.match(textOf(steered[0]), /Use the `find_dsh_plugin` tool now/)
  assert.doesNotMatch(textOf(steered[0]), /My request/)
})

test('handler: a bare command in a Chinese conversation steers the Chinese instruction', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext(commands.service)
  apply(ctx)
  const steered = []
  const agent = {
    steer: (message) => { steered.push(message) },
    session: {
      deriveMessages: () => [
        { role: 'user', content: [{ type: 'text', text: '帮我看下这个插件' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Sure.' }] },
        { role: 'user', content: [{ type: 'text', text: '我还想要跨会话记忆' }] },
      ],
    },
  }
  await commands.registered.get('find-plugin').handler({ agent, rawInput: '' })
  assert.match(textOf(steered[0]), /从上面的对话推断/)
})

test('handler: an unreadable session falls back to the default instruction instead of failing', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext(commands.service)
  apply(ctx)
  const steered = []
  const agent = {
    steer: (message) => { steered.push(message) },
    session: { deriveMessages: () => { throw new Error('log not loaded') } },
  }
  const result = await commands.registered.get('find-plugin').handler({ agent, rawInput: '' })
  assert.equal(result.kind, 'success')
  assert.match(textOf(steered[0]), /infer from this conversation/)
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
