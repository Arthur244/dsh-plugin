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
import type { Context } from '@deepseek-ai/cordis';
/** The visible text of the steered message: the command line, exactly as typed. */
export declare const BARE_COMMAND_LINE = "/find-plugin";
/**
 * Register the slash command when this host has a command registry.
 * @param ctx - the plugin context.
 * @returns the unregister disposer, or undefined when no command service exists.
 */
export declare function registerCommand(ctx: Context): (() => void) | undefined;
