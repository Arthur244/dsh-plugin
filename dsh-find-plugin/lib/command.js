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
/** What the command hands to the agent when the user typed a request. */
const REQUEST_TEMPLATE = (request) => `[manual /find-plugin] The user explicitly asked to find DSH plugins. Their request, verbatim:\n\n` +
    `${request}\n\n` +
    'Use the `find_dsh_plugin` tool for this: read the request together with the conversation so far, ' +
    "then choose the tool parameters yourself — a short English or Chinese keyword `query` that best " +
    'matches what they need, a sensible `limit`, and `lang` matching the language they write in. ' +
    'Do not ask for confirmation first unless the request is too vague to search. ' +
    'Summarize what you found, including each ready-to-run install command, and remind them that ' +
    'plugins are third-party code worth reviewing before installing.';
/** What the command hands to the agent for a bare `/find-plugin`. */
const CONTEXT_ONLY_TEMPLATE = '[manual /find-plugin] The user invoked `/find-plugin` without naming what to look for. ' +
    'Infer from the conversation so far which DSH plugin capability would help next — a need they ' +
    'expressed, a limitation they hit, or a step they asked for that DSH cannot do today. ' +
    'Summarize your reading in one or two sentences as a concrete plugin need, and ask the user to ' +
    'confirm before searching. Once they confirm, call `find_dsh_plugin` with parameters you choose. ' +
    'Do not call the tool yet, and do not ask any question beyond that confirmation.';
/** The user message rendered for one invocation; exported for tests. */
export function commandPrompt(rawInput) {
    const request = rawInput.trim();
    return request.length > 0 ? REQUEST_TEMPLATE(request) : CONTEXT_ONLY_TEMPLATE;
}
/**
 * Build the message object the host's `createUserMessage` would produce.
 *
 * `@deepseek-ai/dsh-llm` is not a declared dependency of this plugin (a peer on
 * it would break installs against hosts whose copy lives elsewhere), so the
 * shape is built here: the frozen `{ id, role, content, source }` record that
 * the host's own session controller passes to `agent.steer`. The source says
 * the text came from this command, which is what keeps the model's reading of
 * it honest and the log greppable.
 */
function userMessage(text, rawInput) {
    return Object.freeze({
        id: `find-plugin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'command', name: 'find-plugin', rawInput },
    });
}
/**
 * Register the slash command when this host has a command registry.
 * @param ctx - the plugin context.
 * @returns the unregister disposer, or undefined when no command service exists.
 */
export function registerCommand(ctx) {
    let commands;
    try {
        commands = ctx.get?.('commands');
    }
    catch {
        // Cordis resolves unknown services strictly: a host without commands is
        // not an error for this plugin, it just has no manual entry point.
        return undefined;
    }
    if (typeof commands?.register !== 'function')
        return undefined;
    return commands.register({
        name: 'find-plugin',
        description: 'Ask the agent to find DSH plugins (it calls find_dsh_plugin with parameters it chooses)',
        input: { hint: '<what you need, in your own words>' },
        handler: async ({ agent, rawInput }) => {
            const raw = rawInput ?? '';
            const prompt = commandPrompt(raw);
            if (agent === undefined || typeof agent.steer !== 'function') {
                return { kind: 'error', text: 'find-plugin: no live agent is attached to this command run.' };
            }
            try {
                agent.steer(userMessage(prompt, raw));
                return {
                    kind: 'success',
                    text: raw.trim().length > 0
                        ? 'Sent to the agent — it will choose the search parameters and call find_dsh_plugin.'
                        : 'Sent to the agent — it will infer the plugin need from this conversation and ask you to confirm.',
                };
            }
            catch (error) {
                return { kind: 'error', text: `find-plugin: could not message the agent: ${error instanceof Error ? error.message : String(error)}` };
            }
        },
    });
}
