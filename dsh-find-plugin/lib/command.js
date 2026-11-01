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
/** Whether the text is mostly Chinese, so the steered instruction can match it. */
const CJK = /[\u3400-\u9fff]/u;
/**
 * Compose the visible message for a request.
 * @param request - the user's request, already trimmed and non-empty.
 * @returns the user's words followed by the tool instruction in the same language.
 */
function requestPrompt(request) {
    if (CJK.test(request)) {
        return `${request}\n\n（用 \`find_dsh_plugin\` 帮我找插件：结合上面的对话自己决定 query、limit 和 lang，`
            + '不必先问我确认；给出可直接运行的安装命令，并提醒我插件是第三方代码、装之前先看源码。）';
    }
    return `${request}\n\n(Use \`find_dsh_plugin\` for this: read it with the conversation so far, choose `
        + '`query`, `limit` and `lang` yourself, and do not ask me to confirm first. Give the ready-to-run '
        + 'install commands, and remind me that plugins are third-party code worth reviewing.)';
}
/** What the command hands to the agent for a bare `/find-plugin` in a Chinese conversation. */
const CONTEXT_ONLY_ZH = '[find-plugin] 现在用 `find_dsh_plugin` 工具：从上面的对话推断我接下来需要哪类插件能力（我说过的需求、'
    + '遇到的限制，或我要求做到但 DSH 目前做不到的事），自己决定 query、limit 和 lang，用一句话说明你读出'
    + '的需求，然后给出结果和可直接运行的安装命令。不必先问我确认。';
/** What the command hands to the agent for a bare `/find-plugin` otherwise. */
const CONTEXT_ONLY_EN = '[find-plugin] Use the `find_dsh_plugin` tool now: infer from this conversation which plugin '
    + 'capability would help next — a need I expressed, a limitation I hit, or a step I asked for '
    + 'that DSH cannot do today. Choose `query`, `limit` and `lang` yourself, state in one sentence '
    + 'which need you read out of the context, and report what you found with its install commands. '
    + 'Do not ask me to confirm first.';
/**
 * Whether the conversation so far has been written mostly in Chinese.
 * @param agent - the receiving agent, when the host supplied one.
 * @returns true when the newest user message contains CJK text.
 */
function conversationIsChinese(agent) {
    let messages;
    try {
        messages = agent?.session?.deriveMessages?.() ?? [];
    }
    catch {
        // A session that cannot be read yet (or at all) must not fail the command;
        // the instruction then uses the default language.
        return false;
    }
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message?.role !== 'user' || !Array.isArray(message.content))
            continue;
        const text = message.content
            .map(block => (typeof block === 'object' && block !== null && 'text' in block && typeof block.text === 'string' ? block.text : ''))
            .join('');
        if (text.trim().length > 0)
            return CJK.test(text);
    }
    return false;
}
/** The user message rendered for one invocation; exported for tests. */
export function commandPrompt(rawInput, chineseConversation = false) {
    const request = rawInput.trim();
    if (request.length > 0)
        return requestPrompt(request);
    return chineseConversation ? CONTEXT_ONLY_ZH : CONTEXT_ONLY_EN;
}
/**
 * Build the frozen user message the host's `createUserMessage` would produce.
 *
 * `@deepseek-ai/dsh-llm` is not a declared dependency of this plugin (a peer on
 * it would break installs against hosts whose copy lives elsewhere), so the
 * record is built here: the frozen `{ id, role, content, source }` message the
 * host's own session controller passes to `agent.steer`. `source.kind` is
 * `'user'` for the presentation reason stated in this module's doc comment.
 */
function userMessage(text) {
    return Object.freeze({
        id: `find-plugin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        role: 'user',
        content: Object.freeze([Object.freeze({ type: 'text', text })]),
        source: Object.freeze({ kind: 'user' }),
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
            const prompt = commandPrompt(raw, conversationIsChinese(agent));
            if (agent === undefined || typeof agent.steer !== 'function') {
                return { kind: 'error', text: 'find-plugin: no live agent is attached to this command run.' };
            }
            try {
                agent.steer(userMessage(prompt));
                return {
                    kind: 'success',
                    text: raw.trim().length > 0
                        ? 'Sent — the agent will pick the search parameters.'
                        : 'Sent — the agent will take the need from this conversation and search.',
                };
            }
            catch (error) {
                return { kind: 'error', text: `find-plugin: could not message the agent: ${error instanceof Error ? error.message : String(error)}` };
            }
        },
    });
}
