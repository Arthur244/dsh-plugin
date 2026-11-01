/**
 * dsh-find-plugin — find DSH plugins inside the agent.
 *
 * Registers the `find_dsh_plugin` tool: a live GitHub search over the
 * public `dsh-plugin` topic, ranked by stars. When a result is also on
 * the awesome-dsh-plugin curated list, its bilingual description is used —
 * ranking and presentation are otherwise untouched.
 *
 * Rate limits are handled instead of surfacing them raw. GitHub's anonymous
 * search quota (10 req/min per public IP) is shared with every host behind the
 * same egress IP, so a search can fail for reasons the user cannot control:
 *
 *  - an optional `GITHUB_TOKEN` credential is resolved per call through
 *    `ctx.credentials` (30 req/min, account-scoped). The credentials service is
 *    an **optional** dependency and is therefore read with `ctx.get()` rather
 *    than declared in `inject` — a missing required service would stop this
 *    plugin from loading at all;
 *  - when GitHub is rate limited or unreachable, the tool degrades to keyword
 *    matches from the curated list (which already ships in `data/` and is
 *    cached on disk) instead of returning an error.
 *
 * Adapted for DSH 0.2.1-rc.5 (see `lib/`); each change below is a verified
 * difference from the 0.1.x host this file was written against:
 *
 *  - `ctx.get(name)` throws when the service is absent on this host (verified in
 *    `@deepseek-ai/cordis@4.0.5`), so the optional read is wrapped — a host
 *    without the credentials service must degrade to anonymous, not fail the
 *    whole tool call;
 *  - the run context's `signal` is the call's cancellation signal; the
 *    transport signals are merged with it instead of replacing it, so a
 *    cancelled call stops retrying and sleeping at once;
 *  - the per-attempt timeout has a fallback when `AbortSignal.timeout` is
 *    missing from the host runtime.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-find-plugin";
export declare const inject: string[];
export type FindItem = {
    name: string;
    url: string;
    description: string;
    stars: number;
    install: string;
};
export type FindResult = {
    results: FindItem[];
    note: string;
};
export declare function renderText(result: FindResult): string;
/** One search request, shared by the tool and the `/find-plugin` command. */
export interface FindDeps {
    query: string;
    limit: number;
    lang: string;
    /** Caller cancellation: the tool call's signal or the command's signal. */
    signal?: AbortSignal;
}
/** Clamp a requested count into the supported 1..20 window; anything unusable uses the default. */
export declare function clampLimit(value: unknown, fallback?: number): number;
/**
 * The one search implementation behind both callers.
 *
 * GitHub first (live, star-ranked, curated descriptions when a result is also
 * on the list); when GitHub is rate limited or unreachable it degrades to
 * keyword matches over the curated list and says so in the note. It throws only
 * when nothing is left to answer from.
 */
export declare function findPlugins(ctx: Context, deps: FindDeps): Promise<FindResult>;
export declare function apply(ctx: Context): void;
