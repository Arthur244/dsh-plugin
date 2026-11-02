/**
 * Registry access: the curated awesome-dsh-plugin list (~3400 entries, all with
 * bilingual descriptions). Cached in memory, on disk, and revalidated with a
 * conditional request.
 *
 * The list is a first-class fallback source, not just a description enricher, so
 * it must survive both restarts and an unreachable server:
 *
 *  1. disk cache at `<DSH_HOME>/cache/dsh-find-plugin/registry.json`, so a
 *     process restart does not re-download ~800KB gzip / 2.7MB JSON;
 *  2. `If-None-Match` / `If-Modified-Since` conditional requests — the server
 *     sends `ETag`/`Last-Modified` and answers 304 with no body, making refresh
 *     nearly free;
 *  3. fallback chain memory → disk cache → bundled snapshot. The bundled
 *     snapshot only has ~176 entries and ages with the release, while the disk
 *     cache holds the full ~3400, so offline quality depends on this order.
 *
 * `DSH_HOME` resolution mirrors `@deepseek-ai/dsh-home-paths` (explicit config →
 * `$DSH_HOME`, blank treated as unset → `~/.dsh`) inlined here to keep the
 * plugin dependency-free.
 *
 * Adapted for the current host (DSH 0.2.1-rc.5): a call may hand in the tool
 * call's cancellation signal and the host's timer service, so a cancelled
 * lookup does not keep a 10 s request alive; a `304` whose validators came
 * from the memory copy is no longer cached as if it were fresh disk data; and
 * an unreachable disk cache file falls through to the bundled snapshot
 * instead of failing the lookup.
 */
export interface RegistryPlugin {
    name: string;
    owner: string;
    url: string;
    category: string;
    description: Record<string, string>;
    install: string;
    added: string;
    /** Present in the live registry; used as a ranking tie-breaker. */
    stars?: number;
}
export interface Registry {
    updated: string;
    count: number;
    categories: Record<string, Record<string, string>>;
    plugins: RegistryPlugin[];
}
export type RegistrySource = 'live' | 'cache' | 'memory' | 'disk' | 'snapshot';
/**
 * Per-call options. Both are optional: the tool layer passes the host's
 * cancellation signal and timer service when they are available, and the
 * plugin works without them (direct calls from tests on a bare Node runtime).
 */
export interface LoadRegistryOptions {
    /** Cancels the network fetch; the fallback chain still answers from cache/snapshot. */
    signal?: AbortSignal;
    /** Host timer service (`ctx.timer`); used for the request deadline so it is disposed with the plugin. */
    timer?: {
        timeout(delay: number): Promise<void>;
    };
}
/**
 * Resolve the curated list through the fallback chain memory → disk cache →
 * bundled snapshot.
 *
 * A `304` is only reusable when the validators that produced it belong to the
 * data that answers it: a fresh memory entry (no disk under it yet) refreshed
 * by a conditional request must not overwrite `cache.etag`, or the next
 * process would send a validator for disk data it has never validated.
 */
export declare function loadRegistry(options?: LoadRegistryOptions): Promise<{
    registry: Registry;
    source: RegistrySource;
}>;
