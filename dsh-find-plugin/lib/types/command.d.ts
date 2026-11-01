/**
 * The manual entry point: `/find-plugin <natural-language request>`.
 *
 * Manual trigger in the sense the user asked for: the command does **not**
 * search. It turns what the user typed into one ordinary user message that
 * tells the agent to use this plugin's capability, and hands the wheel over —
 * the agent reads that message together with the conversation context, decides
 * what to search for, and calls `find_dsh_plugin` with its own parameters
 * (query / limit / lang). A bare `/find-plugin` behaves the same way: it tells
 * the agent to take the need from the conversation and search immediately,
 * without a confirmation round.
 *
 * Delivery uses the host's established command→agent channel,
 * `agent.steer(message)` (the same call `/plan <message>` uses; it queues the
 * message as the next step of the receiving agent and wakes it), so the
 * command works whether the agent is idle or mid-turn, and the text lands in
 * the session log as an ordinary user message.
 *
 * The steered message declares `source: { kind: 'user' }`, exactly like
 * `/plan`. That source is load-bearing for presentation: the Web chat classifies
 * a waking `user/message` whose source is any *other* kind as injected context
 * and renders it as the non-human "Turn trigger" card
 * (`message.trigger.request`, "收到执行请求"). A `user` source renders the row
 * as the user's own message, so the text is written to read that way: the
 * user's own words come first, and the tool instruction follows them.
 *
 * The `commands` service is an **optional** dependency: a host without it
 * (UI-less spines, older compositions) must still load this plugin for the
 * tool, so `apply()` reads it with `ctx.get()` and registers nothing when it is
 * absent.
 */
import type { Context } from '@deepseek-ai/cordis';
/** The user message rendered for one invocation; exported for tests. */
export declare function commandPrompt(rawInput: string, chineseConversation?: boolean): string;
/**
 * Register the slash command when this host has a command registry.
 * @param ctx - the plugin context.
 * @returns the unregister disposer, or undefined when no command service exists.
 */
export declare function registerCommand(ctx: Context): (() => void) | undefined;
