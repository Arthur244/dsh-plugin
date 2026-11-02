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

import { readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface RegistryPlugin {
  name: string
  owner: string
  url: string
  category: string
  description: Record<string, string>
  install: string
  added: string
  /** Present in the live registry; used as a ranking tie-breaker. */
  stars?: number
}

export interface Registry {
  updated: string
  count: number
  categories: Record<string, Record<string, string>>
  plugins: RegistryPlugin[]
}

export type RegistrySource = 'live' | 'cache' | 'memory' | 'disk' | 'snapshot'

const REGISTRY_URL = 'https://awesome-dsh-plugin.com/plugins.json'
/** Refresh interval; after this the cached copy is revalidated (304 is free). */
const TTL_MS = 30 * 60 * 1000
const TIMEOUT_MS = 10000
const CACHE_VERSION = 1

interface CacheEntry {
  at: number
  data: Registry
  etag?: string
  lastModified?: string
}

let cache: CacheEntry | null = null

/**
 * Per-call options. Both are optional: the tool layer passes the host's
 * cancellation signal and timer service when they are available, and the
 * plugin works without them (direct calls from tests on a bare Node runtime).
 */
export interface LoadRegistryOptions {
  /** Cancels the network fetch; the fallback chain still answers from cache/snapshot. */
  signal?: AbortSignal
  /** Host timer service (`ctx.timer`); used for the request deadline so it is disposed with the plugin. */
  timer?: { timeout(delay: number): Promise<void> }
}

/**
 * Wait for `attempt`, giving up after `timeoutMs` or when the caller cancels.
 *
 * The host timer service (`ctx.timer`) owns the deadline when supplied, so the
 * timer is disposed with the plugin instead of leaking a stray handle; Node's
 * `setTimeout` is the fallback for a bare runtime (tests, direct calls). The
 * request itself is aborted on either outcome, so no socket outlives the call.
 */
function withDeadline(attempt: (signal: AbortSignal) => Promise<Response>, options: LoadRegistryOptions, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const caller = options.signal
  let settle: () => boolean = () => false
  return new Promise<Response>((resolvePromise, reject) => {
    let settled = false
    let stopDeadline: () => void = () => {}
    settle = (): boolean => {
      if (settled) return false
      settled = true
      caller?.removeEventListener('abort', onAbort)
      stopDeadline()
      return true
    }
    const fail = (message: string): void => {
      // Settle first: `controller.abort()` synchronously rejects the pending
      // attempt, whose handler would otherwise win the race and mask this
      // more specific reason.
      if (!settle()) return
      controller.abort(new Error(message))
      reject(new Error(message))
    }
    const onAbort = (): void => fail('registry request cancelled')
    const timedOut = (): void => fail(`registry request timed out after ${timeoutMs}ms`)
    // `timer.timeout(delay)` resolves on timeout; a disposed plugin rejects it.
    // Either outcome means "deadline reached": the attempt is aborted and this
    // promise settles. The timer promise is only observed, never awaited.
    if (options.timer === undefined) {
      const handle = setTimeout(timedOut, timeoutMs)
      stopDeadline = () => clearTimeout(handle)
    } else {
      void options.timer.timeout(timeoutMs).then(timedOut, timedOut)
    }
    caller?.addEventListener('abort', onAbort, { once: true })
    if (caller?.aborted === true) onAbort()
    attempt(controller.signal).then(
      response => { if (settle()) resolvePromise(response) },
      error => { if (settle()) reject(error) },
    )
  })
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

function dshHome(): string {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return resolve(expandHome(fromEnv.trim()))
  return join(homedir(), '.dsh')
}

function cacheDir(): string {
  return join(dshHome(), 'cache', 'dsh-find-plugin')
}

function cachePath(): string {
  return join(cacheDir(), 'registry.json')
}

function snapshotPath(): string {
  return fileURLToPath(new URL('../data/registry-snapshot.json', import.meta.url))
}

function isRegistry(value: unknown): value is Registry {
  if (value === null || typeof value !== 'object') return false
  const plugins = (value as Registry).plugins
  return Array.isArray(plugins) && plugins.length > 0
}

/** The bundled snapshot, with a readable report when the file is missing or corrupt. */
function readSnapshot(): Registry {
  try {
    return JSON.parse(readFileSync(snapshotPath(), 'utf8')) as Registry
  } catch (error) {
    throw new Error(`bundled registry snapshot is unreadable (${snapshotPath()}): ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function readDiskCache(): Promise<{ registry: Registry; at: number; etag?: string; lastModified?: string } | undefined> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(), 'utf8')) as {
      version?: number
      fetchedAt?: string
      etag?: string
      lastModified?: string
      registry?: unknown
    }
    if (parsed?.version !== CACHE_VERSION || !isRegistry(parsed.registry)) return undefined
    return {
      registry: parsed.registry,
      at: Date.parse(parsed.fetchedAt ?? '') || 0,
      etag: typeof parsed.etag === 'string' ? parsed.etag : undefined,
      lastModified: typeof parsed.lastModified === 'string' ? parsed.lastModified : undefined,
    }
  } catch {
    return undefined
  }
}

async function writeDiskCache(registry: Registry, etag?: string, lastModified?: string): Promise<void> {
  try {
    await mkdir(cacheDir(), { recursive: true })
    const path = cachePath()
    const temp = `${path}.tmp-${process.pid}`
    await writeFile(temp, JSON.stringify({
      version: CACHE_VERSION,
      fetchedAt: new Date().toISOString(),
      etag,
      lastModified,
      registry,
    }), 'utf8')
    await rename(temp, path)
  } catch {
    // A cache write failure must not break the lookup; the next call refetches.
  }
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
export async function loadRegistry(options: LoadRegistryOptions = {}): Promise<{ registry: Registry; source: RegistrySource }> {
  if (cache !== null && Date.now() - cache.at < TTL_MS) return { registry: cache.data, source: 'memory' }

  const disk = await readDiskCache()
  const etag = disk?.etag ?? cache?.etag
  const lastModified = disk?.lastModified ?? cache?.lastModified
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'dsh-find-plugin' }
  if (etag !== undefined) headers['if-none-match'] = etag
  if (lastModified !== undefined) headers['if-modified-since'] = lastModified

  try {
    const res = await withDeadline(signal => fetch(REGISTRY_URL, { headers, signal }), options, TIMEOUT_MS)
    if (res.status === 304) {
      const data = disk?.registry ?? cache?.data
      if (isRegistry(data)) {
        // Only the validators that were actually sent may be remembered with
        // the answer; a memory-only copy keeps its own.
        const validators = disk === undefined
          ? { etag: cache?.etag, lastModified: cache?.lastModified }
          : { etag: disk.etag, lastModified: disk.lastModified }
        cache = { at: Date.now(), data, ...validators }
        return { registry: data, source: 'cache' }
      }
    } else if (res.ok) {
      const data = (await res.json()) as Registry
      if (!isRegistry(data)) throw new Error('empty registry')
      const nextEtag = res.headers.get('etag') ?? undefined
      const nextLastModified = res.headers.get('last-modified') ?? undefined
      cache = { at: Date.now(), data, etag: nextEtag, lastModified: nextLastModified }
      await writeDiskCache(data, nextEtag, nextLastModified)
      return { registry: data, source: 'live' }
    } else {
      throw new Error(`HTTP ${res.status}`)
    }
  } catch {
    // Network/parse/timeout/cancel failure — fall through to the fallback chain.
  }

  if (disk !== undefined) return { registry: disk.registry, source: 'disk' }
  if (cache !== null) return { registry: cache.data, source: 'memory' }
  return { registry: readSnapshot(), source: 'snapshot' }
}
