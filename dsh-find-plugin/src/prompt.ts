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

import type { Context } from '@deepseek-ai/cordis'

/** Unique prompt-section name; the subject of the cordis effect this registration owns. */
const SECTION_NAME = 'find-plugin:manual-entry'

/**
 * The guidance, written from the model's perspective.
 *
 * Both shapes are stated because the same section serves both, and they differ
 * in exactly one thing this plugin cannot enforce itself: whether the search runs
 * immediately or waits for the user's agreement. The bare form asks for that
 * agreement because the user supplied no words for the plugin to act on — the
 * need is the agent's reading of the conversation, so the user gets to correct
 * that reading before a request leaves the machine.
 */
const GUIDANCE =
  'The user can ask for a DeepSeek Harness plugin through `/find-plugin`.\n'
  + '\n'
  + '- A message whose text is exactly `/find-plugin` states no need. Infer from the conversation '
  + 'which capability would help next, then reply with the search you intend — the `query`, `limit`, '
  + 'and `lang` you would pass — and ask the user to confirm that reading before calling '
  + '`find_dsh_plugin`. Search only after they agree.\n'
  + '- A message that continues after `/find-plugin` is the request itself. Choose the parameters '
  + 'from that text and the conversation and search without asking first.\n'
  + '\n'
  + 'Present each result with its ready-to-run install command, and note that plugins are '
  + 'third-party code worth reviewing before installing.'

/** The parts of the system-prompt service this module uses. */
interface PromptRegistry {
  section: (section: { name: string; order: number; text: string }) => () => void
  getSectionOrder: (name: PromptSectionOrderName) => number
}

/** The subset of centrally allocated section positions this module needs. */
type PromptSectionOrderName = 'TOOLS_SDK'

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
export function registerPromptSection(ctx: Context): void {
  ctx.inject(['systemPrompt'], (scope) => {
    let prompt: PromptRegistry | undefined
    try {
      prompt = scope.get?.('systemPrompt') as PromptRegistry | undefined
    } catch {
      // The fiber waits for `systemPrompt`, so a strict host cannot reach this;
      // a host whose registry is not the documented service simply contributes
      // no guidance rather than failing the tool.
      return
    }
    if (typeof prompt?.section !== 'function' || typeof prompt.getSectionOrder !== 'function') return
    prompt.section({
      name: SECTION_NAME,
      // One step before the SDK block: after every built-in tool's guidance and
      // before the trailing deployment sections.
      order: prompt.getSectionOrder('TOOLS_SDK') - 1,
      text: GUIDANCE,
    })
  })
}
