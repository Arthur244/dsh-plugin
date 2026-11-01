/**
 * The manual entry point: `/find-plugin [--limit N] [--lang zh|en] <keywords>`.
 *
 * The slash command lives in its own module because it belongs to the *manual*
 * surface, not to the tool contract:
 *
 *  - `dsh-commands` runs a handler directly against the receiving agent and
 *    renders its text outside model history, so calling the command creates no
 *    model message and costs no tokens (see the package README, "Token effect");
 *  - the `commands` service is an **optional** dependency. A host without it
 *    (UI-less spines, older compositions) must still load this plugin for the
 *    tool, so `apply()` reads it with `ctx.get()` instead of declaring it in
 *    `inject`, and simply registers nothing when it is absent;
 *  - the command and the tool share one search implementation
 *    ({@link findPlugins}) so both callers cannot drift apart.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FindDeps, FindResult } from './index.ts'
import { renderText } from './index.ts'

/** Default result count for the command; the tool has its own default of 8. */
const COMMAND_DEFAULT_LIMIT = 5
const COMMAND_MAX_LIMIT = 20

/** Parsed `/find-plugin` input. */
export interface CommandArgs {
  /** Keywords; empty when the user typed only flags. */
  query: string
  limit: number
  lang: string
}

/**
 * Parse the command's own grammar. The registry hands the handler everything
 * after the command name verbatim, so flags and keywords are split here:
 * `--limit N` / `-n N` and `--lang L` / `-l L` are stripped wherever they
 * appear; everything else (including CJK text) is the query.
 * @param raw - the raw input after `/find-plugin`.
 * @returns the parsed arguments; never throws.
 */
export function parseCommandArgs(raw: string): CommandArgs {
  const tokens = raw.trim().split(/\s+/u).filter(token => token.length > 0)
  const keywords: string[] = []
  let limit = COMMAND_DEFAULT_LIMIT
  let lang = 'en'

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    const flag = /^(--limit|-n)(?:=(.*))?$/u.exec(token)
    const langFlag = /^(--lang|-l)(?:=(.*))?$/u.exec(token)
    if (flag !== null) {
      const value = flag[2] ?? tokens[index + 1]
      if (flag[2] === undefined) index += 1
      const asked = Number(value)
      if (Number.isFinite(asked)) limit = Math.max(1, Math.min(Math.trunc(asked), COMMAND_MAX_LIMIT))
      continue
    }
    if (langFlag !== null) {
      const value = langFlag[2] ?? tokens[index + 1]
      if (langFlag[2] === undefined) index += 1
      if (typeof value === 'string' && value.length > 0) lang = value
      continue
    }
    keywords.push(token)
  }

  return { query: keywords.join(' '), limit, lang }
}

/** Command text: the shared result rendering, prefixed with what was searched. */
export function renderCommandText(args: CommandArgs, result: FindResult): string {
  return `/find-plugin ${args.query}\n\n${renderText(result)}`
}

/**
 * Register the slash command when this host has a command registry.
 * @param ctx - the plugin context.
 * @param find - the shared search implementation (same one the tool calls).
 * @returns the unregister disposer, or undefined when no command service exists.
 */
export function registerCommand(ctx: Context, find: (deps: FindDeps) => Promise<FindResult>): (() => void) | undefined {
  let commands: {
    register?: (definition: {
      name: string
      description: string
      input?: { hint: string }
      handler: (invocation: { rawInput: string; signal: AbortSignal }) => Promise<{ kind: 'success'; text: string } | { kind: 'error'; text: string }>
    }) => () => void
  } | undefined
  try {
    commands = ctx.get?.('commands') as typeof commands
  } catch {
    // Cordis resolves unknown services strictly: a host without commands is
    // not an error for this plugin, it just has no manual entry point.
    return undefined
  }
  if (typeof commands?.register !== 'function') return undefined

  return commands.register({
    name: 'find-plugin',
    description: 'Search GitHub `dsh-plugin` topics for DSH plugins (live, ranked by stars)',
    input: { hint: '[--limit N] [--lang zh|en] <keywords>' },
    handler: async ({ rawInput, signal }) => {
      const args = parseCommandArgs(rawInput)
      if (args.query.length === 0) {
        return {
          kind: 'error',
          text: 'Usage: /find-plugin [--limit N] [--lang zh|en] <keywords>\n' +
            'e.g. /find-plugin --lang zh 跨会话记忆',
        }
      }
      try {
        const result = await find({ query: args.query, limit: args.limit, lang: args.lang, signal })
        return { kind: 'success', text: renderCommandText(args, result) }
      } catch (error) {
        return { kind: 'error', text: `find-plugin failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  })
}
