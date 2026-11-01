/**
 * The model-facing half of the manual entry point.
 *
 * `/find-plugin` reaches the agent in one of two shapes, and the plugin must not
 * rewrite either of them:
 *
 *  - bare `/find-plugin` — the command handler runs (the host executes a
 *    no-`input` command only when it has no arguments; verified in the shipped
 *    `@deepseek-ai/dsh-client-ui-commands` `matchEnter`). There is no text to
 *    forward, so the handler steers an ordinary user message whose visible text
 *    is exactly the command line the user typed. The guidance that turns it into
 *    an inferred search therefore arrives from the system prompt, which is what
 *    this module registers.
 *  - `/find-plugin <request>` — the host sends the user's line verbatim as an
 *    ordinary message; the handler never runs. The same guidance tells the agent
 *    what that prefix means.
 *
 * The section is static rather than armed per turn: it is a fixed capability
 * statement, so it costs a constant number of prompt tokens and needs no
 * per-session state to arm, expire, or leak.
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * Register the `/find-plugin` guidance as a system prompt section.
 *
 * The registration lives in a child fiber that waits for `systemPrompt`, so it is
 * unaffected by whether that service exists, or exists yet, when this plugin
 * loads; the fiber is disposed with the plugin. The service is read with
 * `ctx.get()` because it is optional for this plugin as a whole — the tool must
 * load on a host that has no prompt registry at all.
 * @param ctx - the plugin context.
 */
export declare function registerPromptSection(ctx: Context): void;
