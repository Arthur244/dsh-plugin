/**
 * The manual entry point: `/find-plugin`.
 *
 * Two paths, and the plugin deliberately owns only the first:
 *
 *  - `/find-plugin <anything>` — this handler never runs. Because the
 *    definition declares no `input`, the host's command layer treats the argued
 *    line as an ordinary message: `matchEnter` returns `undefined` for a command
 *    without `input` (verified in the shipped
 *    `@deepseek-ai/dsh-client-ui-commands/lib/client.js`), the composer's
 *    adjudication falls through to the normal send, and the user's line reaches
 *    the transcript **verbatim**. The request is the user's own words, so the
 *    plugin has nothing to improve on them.
 *  - bare `/find-plugin` — no text to forward, so the handler runs and steers one
 *    ordinary user message whose visible text is exactly the command line the
 *    user typed. The guidance that turns it into an inferred search lives in the
 *    system prompt (`./prompt.ts`), never in this bubble.
 *
 * Declaring no `input` is load-bearing twice over. A `input.hint` would render as
 * ghost text after the claimed token (`InputBar.tsx` sets
 * `--dsh-composer-hint`), putting words the user never typed into their draft;
 * and declaring `input` at all turns every argued line into a claim that this
 * handler receives and would then have to rewrite.
 *
 * The steered message declares `source: { kind: 'user' }`, exactly like
 * `/plan <message>`. That source is load-bearing for presentation: the Web chat
 * classifies a waking `user/message` whose source is any *other* kind as injected
 * context and renders it as the non-human "Turn trigger" card
 * (`message.trigger.request`, "收到执行请求").
 *
 * The `commands` service is an **optional** dependency: a host without it
 * (UI-less spines, older compositions) must still load this plugin for the tool,
 * so `apply()` reads it with `ctx.get()` and registers nothing when it is absent.
 */

import type { Context } from '@deepseek-ai/cordis'

/** The visible text of the steered message: the command line, exactly as typed. */
export const BARE_COMMAND_LINE = '/find-plugin'

/** Minimal shapes the command needs; the real objects come from `dsh-commands`. */
interface CommandInvocation {
  /** The receiving agent; `steer` queues one user message for its next step. */
  agent?: { steer?: (message: unknown) => void }
  /** Everything after the command name, including separator whitespace. */
  rawInput?: string
  signal?: AbortSignal
}

interface CommandDefinition {
  name: string
  description: string
  handler: (invocation: CommandInvocation) => Promise<{ kind: 'success'; text: string } | { kind: 'error'; text: string }>
}

interface CommandRegistry {
  register?: (definition: CommandDefinition) => () => void
}

/**
 * Build the frozen user message the host's `createUserMessage` would produce.
 *
 * `@deepseek-ai/dsh-llm` is not a declared dependency of this plugin (a peer on
 * it would break installs against hosts whose copy lives elsewhere), so the
 * record is built here: the frozen `{ id, role, content, source }` message the
 * host's own session controller passes to `agent.steer`. `source` is the plain
 * user source for the presentation reason stated in the module comment.
 * @param text - the visible message text.
 * @returns the frozen user message.
 */
function userMessage(text: string): unknown {
  return Object.freeze({
    id: `find-plugin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ kind: 'user' }),
  })
}

/**
 * Register the slash command when this host has a command registry.
 * @param ctx - the plugin context.
 * @returns the unregister disposer, or undefined when no command service exists.
 */
export function registerCommand(ctx: Context): (() => void) | undefined {
  let commands: CommandRegistry | undefined
  try {
    commands = ctx.get?.('commands') as CommandRegistry | undefined
  } catch {
    // Cordis resolves unknown services strictly: a host without commands is
    // not an error for this plugin, it just has no manual entry point.
    return undefined
  }
  if (typeof commands?.register !== 'function') return undefined

  return commands.register({
    name: 'find-plugin',
    description: 'Ask the agent to find DSH plugins with find_dsh_plugin',
    handler: async ({ agent }) => {
      if (agent === undefined || typeof agent.steer !== 'function') {
        return { kind: 'error', text: 'find-plugin: no live agent is attached to this command run.' }
      }
      try {
        agent.steer(userMessage(BARE_COMMAND_LINE))
        return { kind: 'success', text: 'Reading the conversation — confirm the search before it runs.' }
      } catch (error) {
        return { kind: 'error', text: `find-plugin: could not message the agent: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  })
}
