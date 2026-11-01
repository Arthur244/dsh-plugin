/**
 * The manual entry point: `/find-plugin <natural-language request>`.
 *
 * Manual trigger in the sense the user asked for: the command does **not**
 * search. It turns what the user typed into one ordinary user message that
 * tells the agent to use this plugin's capability, and hands the wheel over —
 * the agent reads that message together with the conversation context, decides
 * what to search for, and calls `find_dsh_plugin` with its own parameters
 * (query / limit / lang). Bare `/find-plugin` never searches either: it asks
 * the agent to work out, from the context, which plugin need the user means,
 * and to confirm with the user before searching.
 *
 * Delivery uses the host's established command→agent channel,
 * `agent.steer(message)` (the same call `/plan <message>` uses; it queues the
 * message as the next step of the receiving agent and wakes it), so the
 * command works whether the agent is idle or mid-turn, and the text lands in
 * the session log as an ordinary user message.
 *
 * The `commands` service is an **optional** dependency: a host without it
 * (UI-less spines, older compositions) must still load this plugin for the
 * tool, so `apply()` reads it with `ctx.get()` and registers nothing when it is
 * absent.
 */
import type { Context } from '@deepseek-ai/cordis';
/** The user message rendered for one invocation; exported for tests. */
export declare function commandPrompt(rawInput: string): string;
/**
 * Register the slash command when this host has a command registry.
 * @param ctx - the plugin context.
 * @returns the unregister disposer, or undefined when no command service exists.
 */
export declare function registerCommand(ctx: Context): (() => void) | undefined;
