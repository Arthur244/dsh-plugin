/**
 * The manual entry point: `/find-plugin`.
 *
 * Two paths with different owners:
 *
 *  - bare `/find-plugin` — the command steers one user message whose text is
 *    exactly what the user typed; the guidance lives in the system prompt.
 *  - `/find-plugin <request>` — the command does not run at all; the host sends
 *    the user's line verbatim. This suite can only pin the definition shape that
 *    earns that host behavior (no `input`, so the line is never claimed), plus
 *    the prompt section that explains both shapes to the model.
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
const { BARE_COMMAND_LINE } = await import(new URL('../lib/command.js', import.meta.url).href)

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

/** A fake `systemPrompt` service that records sections by name. */
function fakePrompt() {
  const sections = new Map()
  return {
    sections,
    service: {
      section: (section) => {
        assert.ok(!sections.has(section.name), `duplicate section: ${section.name}`)
        sections.set(section.name, section)
        return () => sections.delete(section.name)
      },
      getSectionOrder: (name) => {
        assert.equal(name, 'TOOLS_SDK')
        return 5000
      },
    },
  }
}

/** A fake agent that records every steered message. */
function fakeAgent() {
  const steered = []
  return { steered, agent: { steer: (message) => { steered.push(message) } } }
}

function pluginContext({ commands, prompt } = {}) {
  const tools = []
  const ctx = {
    tools: { register: (definition) => { tools.push(definition); return () => {} } },
    get: (service) => {
      if (service === 'commands') return commands
      if (service === 'systemPrompt') return prompt
      return undefined
    },
    effect: (callback) => callback,
    // Mirrors cordis: the callback runs only once the named services exist, and
    // the fiber is disposed with the plugin. This fake runs it synchronously
    // against the same context, which is what the payload contract needs.
    inject: (_deps, callback) => { callback(ctx) },
  }
  return { tools, ctx }
}

const textOf = (message) => message.content.map((block) => block.text).join('\n')

// ── definition shape ────────────────────────────────────────────────────────

test('definition: the command declares no input, so the composer shows no ghost hint and argued lines are never claimed', () => {
  const commands = fakeCommands()
  const { ctx, tools } = pluginContext({ commands: commands.service, prompt: fakePrompt().service })
  apply(ctx)
  assert.equal(tools.length, 1, 'the tool is still registered')
  const definition = commands.registered.get('find-plugin')
  assert.ok(definition, 'expected /find-plugin to be registered')
  // `InputBar.tsx` renders `input.hint` as ghost text inside the draft, and
  // `matchEnter` returns a claim for any command that declares `input`; both
  // would put words into the user's own message.
  assert.equal('input' in definition, false, 'no input descriptor at all')
  assert.match(definition.description, /find_dsh_plugin/)
})

test('registration: a host without a commands service still registers the tool', () => {
  const { ctx, tools } = pluginContext()
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(tools.length, 1)
})

test('registration: a throwing ctx.get (strict Cordis) is tolerated', () => {
  const tools = []
  const ctx = {
    tools: { register: (definition) => { tools.push(definition); return () => {} } },
    get: (service) => { throw new Error(`unknown service: ${service}`) },
    effect: (callback) => callback,
    inject: (_deps, callback) => { callback(ctx) },
  }
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(tools.length, 1)
})

// ── the bare command ────────────────────────────────────────────────────────

test('handler: bare /find-plugin steers exactly the command line the user typed', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext({ commands: commands.service, prompt: fakePrompt().service })
  apply(ctx)
  const { agent, steered } = fakeAgent()
  let fetched = false
  const previous = globalThis.fetch
  globalThis.fetch = async () => { fetched = true; return new Response('{}') }
  try {
    const result = await commands.registered.get('find-plugin').handler({
      agent,
      rawInput: '',
      signal: new AbortController().signal,
    })
    assert.equal(result.kind, 'success')
    assert.equal(steered.length, 1, 'exactly one user message is steered')
    const message = steered[0]
    assert.equal(message.role, 'user')
    assert.ok(Object.isFrozen(message), 'the message is frozen like a host-created user message')
    assert.equal(textOf(message), BARE_COMMAND_LINE, 'the bubble holds only /find-plugin')
    assert.equal(textOf(message), '/find-plugin')
    assert.equal(fetched, false, 'the command itself performs no search')
  } finally { globalThis.fetch = previous }
})

test('handler: the steered message declares the plain user source, so chat renders it as a user row', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext({ commands: commands.service, prompt: fakePrompt().service })
  apply(ctx)
  const { agent, steered } = fakeAgent()
  await commands.registered.get('find-plugin').handler({ agent, rawInput: '' })
  // The Web chat folds a waking message from any other source kind into the
  // non-human turn-trigger card (`message.trigger.request`); `user` keeps the
  // row identical to a typed message, which is why `/plan` uses it too.
  assert.deepEqual(steered[0].source, { kind: 'user' })
})

test('handler: a command run without an agent fails with a reason and steers nothing', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext({ commands: commands.service, prompt: fakePrompt().service })
  apply(ctx)
  const result = await commands.registered.get('find-plugin').handler({ rawInput: '' })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /no live agent/)
})

test('handler: an agent whose steer throws is reported, not propagated', async () => {
  const commands = fakeCommands()
  const { ctx } = pluginContext({ commands: commands.service, prompt: fakePrompt().service })
  apply(ctx)
  const result = await commands.registered.get('find-plugin').handler({
    agent: { steer: () => { throw new Error('inbox closed') } },
    rawInput: '',
  })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /inbox closed/)
})

// ── model-facing guidance ───────────────────────────────────────────────────

test('prompt: one section explains both shapes, and the bare shape demands a confirmation', () => {
  const prompt = fakePrompt()
  const { ctx } = pluginContext({ commands: fakeCommands().service, prompt: prompt.service })
  apply(ctx)
  assert.equal(prompt.sections.size, 1, 'one section, registered once')
  const section = [...prompt.sections.values()][0]
  assert.equal(section.name, 'find-plugin:manual-entry')
  assert.equal(section.order, 4999, 'placed just before the SDK block')
  assert.match(section.text, /`\/find-plugin`/, 'the command is named')
  assert.match(section.text, /exactly `\/find-plugin` states no need/, 'the bare shape is distinguished')
  assert.match(section.text, /ask the user to confirm that reading before calling/, 'the bare shape confirms first')
  assert.match(section.text, /continues after `\/find-plugin` is the request itself/, 'the argued shape is distinguished')
  assert.match(section.text, /search without asking first/, 'the argued shape searches directly')
})

test('prompt: a host without a system-prompt service still registers the tool', () => {
  const { ctx, tools } = pluginContext({ commands: fakeCommands().service })
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(tools.length, 1)
})

test.after(async () => {
  delete process.env.DSH_HOME
  await rm(home, { recursive: true, force: true })
})
