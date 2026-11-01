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
import type { Context } from '@deepseek-ai/cordis';
import type { FindDeps, FindResult } from './index.ts';
/** Parsed `/find-plugin` input. */
export interface CommandArgs {
    /** Keywords; empty when the user typed only flags. */
    query: string;
    limit: number;
    lang: string;
}
/**
 * Parse the command's own grammar. The registry hands the handler everything
 * after the command name verbatim, so flags and keywords are split here:
 * `--limit N` / `-n N` and `--lang L` / `-l L` are stripped wherever they
 * appear; everything else (including CJK text) is the query.
 * @param raw - the raw input after `/find-plugin`.
 * @returns the parsed arguments; never throws.
 */
export declare function parseCommandArgs(raw: string): CommandArgs;
/** Command text: the shared result rendering, prefixed with what was searched. */
export declare function renderCommandText(args: CommandArgs, result: FindResult): string;
/**
 * Register the slash command when this host has a command registry.
 * @param ctx - the plugin context.
 * @param find - the shared search implementation (same one the tool calls).
 * @returns the unregister disposer, or undefined when no command service exists.
 */
export declare function registerCommand(ctx: Context, find: (deps: FindDeps) => Promise<FindResult>): (() => void) | undefined;
