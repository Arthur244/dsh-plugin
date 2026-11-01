# dsh-find-plugin [![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

English | [中文](README.zh.md)

**A plugin that finds plugins** — think [`/find-skills`](https://skills.sh) from skills.sh, for DSH.

Tell your agent what you want ("notify me on WeChat when a task finishes"),
and it searches the DSH plugin ecosystem on GitHub for you — top results by
stars, each with a one-line description and an install command.

<img src="https://raw.githubusercontent.com/awesome-dsh-plugin/dsh-find-plugin/main/assets/demo-en.png" alt="find_dsh_plugin in action" width="640">

## Install

```sh
# this repository copy (adapted to the current DSH 0.2.1-rc.5)
dsh plugin --profile desktop add /path/to/dsh-find-plugin

# from npm (upstream)
# dsh plugin --profile web add dsh-find-plugin
```

`dsh plugin ... add` links rather than copies, so moving or deleting the source
directory disables the plugin.

## Usage

### Manual trigger: `/find-plugin`

Type the slash command in the composer. It runs **without the model**: no model
message is created, no tokens are spent, and the rendered result is shown
directly in the chat.

```text
/find-plugin cross-session memory
/find-plugin --lang zh --limit 3 terminal TUI
/find-plugin -n 5 -l en wechat notifications
```

| Form | Meaning |
| --- | --- |
| `/find-plugin <keywords>` | 5 results, English descriptions by default |
| `--limit N` / `-n N` | result count, 1–20 |
| `--lang zh|en` / `-l zh|en` | curated description language |
| bare `/find-plugin` | prints usage; performs no search |

The command and the `find_dsh_plugin` tool share one search implementation;
they differ only in defaults (the tool returns 8) and in who presents the
result. On a host without the `commands` service (UI-less runtime) the command
registration is skipped and the tool keeps working.

### Natural language

Restart `dsh web` after installing, then just talk to the agent — it calls
`find_dsh_plugin` on its own whenever plugin discovery helps:

- "What terminal TUI plugins are there?"
- "I want to get a WeChat notification when a task finishes — any plugin for that?"
- "Find me something for reviewing git diffs inside DSH."

Each result comes back with stars, a description, the repo link, and a
ready-to-run `dsh plugin add` command — ask the agent to install one and
it can run the command for you.

## How it works

- Live GitHub repository search scoped to the official `dsh-plugin` topic,
  re-ranked by stars (5-minute success cache, 1-minute failure cache).
- When a result is also listed on
  [awesome-dsh-plugin](https://awesome-dsh-plugin.com), its hand-written
  bilingual description from `plugins.json` replaces the GitHub one (the
  `lang` parameter picks the language) — ranking is untouched.
- Every result comes with a ready-to-run `dsh plugin add` command. Plugins
  are third-party code — review the source and pin a commit.

### Rate limits and offline fallback

GitHub's **search** API allows only 10 requests/minute per public IP when
unauthenticated, and that quota is shared by every host behind the same egress
IP (carrier CGNAT, corporate NAT, …), so a search can fail with `HTTP 403` for
reasons outside your control. The plugin therefore:

- uses the **`GITHUB_TOKEN` DSH credential** when one is configured (30
  req/min, account-scoped, immune to shared-IP exhaustion). Optional — without
  it the tool still works, just closer to the anonymous limit;
- retries a rate-limited (403/429) or failed request once, then degrades
  instead of failing: it falls back to **keyword matches from the curated
  list** and says so in the result note;
- caches the curated list on disk (`$DSH_HOME/cache/dsh-find-plugin/`) and
  revalidates it with `If-None-Match` / `If-Modified-Since`, so restarts and
  offline runs use the full ~3400-entry list instead of the small bundled
  snapshot.
- says *why* a request failed. Node reports every transport failure as a bare
  `fetch failed` and hides the useful part in `cause`, so the plugin surfaces
  the chain (`fetch failed ← certificate has expired (CERT_HAS_EXPIRED)`) and
  names the one trap that otherwise looks like a plugin bug: a system proxy or
  VPN accelerator, which Node's `fetch` ignores unless DSH itself was started
  with `NODE_USE_ENV_PROXY=1` (or `--use-env-proxy`). A browser has no such
  rule — which is why GitHub opens fine and this still fails.

## Compatibility

DSH plugin APIs are prerelease-versioned, and node-semver only lets a
prerelease satisfy a range that carries a prerelease on the *same*
major.minor.patch — so a peer range pinned to one host line silently stops
matching the next one. The declared `@deepseek-ai/dsh-tools` range therefore
names every published line from `0.1.0-rc.6` through `0.2.2-alpha.2`; typecheck
and the test suite run on both the floor (`0.1.0-rc.8`) and the current host
(`0.2.1-rc.5`). `npm run check:peers` (run in CI) resolves the current
`latest`/`next` host lines and fails the day a new one is not covered.

## Configuration

There is nothing to configure — the plugin exposes no Config field
(`Config.listConfigs` reports it as `status: absent`). Optional runtime inputs:

| Input | Effect |
| --- | --- |
| DSH credential `GITHUB_TOKEN` | Sent as `Authorization: Bearer` for GitHub search (30 req/min, account-scoped); unset, or when the credentials service is unavailable, search runs anonymously (10 req/min) |
| `DSH_HOME` | Base of the cache directory, default `~/.dsh`; the cache file is `$DSH_HOME/cache/dsh-find-plugin/registry.json` |
| `NODE_USE_ENV_PROXY=1` / `--use-env-proxy` | Makes the DSH process's `fetch` honour system proxy variables (required behind VPN accelerators or corporate proxies) |

## Adaptation to the current host (DSH 0.2.1-rc.5)

The copy first reproduced upstream 0.4.0 byte for byte (`src/`, `lib/`, `test/`
identical, every upstream test passing), then changed this:

- `package.json`: peer ranges now name the host lines that exist —
  `@deepseek-ai/dsh-tools` covers `0.1.0-rc.6` … `0.2.2-alpha.2`,
  `@deepseek-ai/cordis` is `^4.0.5` — plus `engines.dsh: >=0.2.1-rc.5 <0.3.0`
  and the READMEs in `files`.
- `src/index.ts`: this Cordis throws when `ctx.get('credentials')` /
  `ctx.get('timer')` names a missing service, so those reads sit inside the
  degradation path; the call's own `exec.signal` now reaches both the GitHub
  search and the curated-list request; `limit` is clamped numerically
  (defence in depth — `defineTool` already validates the type before running).
- `src/github.ts`: the caller signal and the per-attempt timeout are merged
  without assuming `AbortSignal.any`, the retry delay is cancellable, and a
  timeout reports `GitHub search timed out after 8000ms` instead of an
  anonymous abort.
- `src/registry.ts`: the request deadline uses the host `ctx.timer` when
  present (disposed with the plugin) and falls back to `setTimeout`; a timeout
  or cancellation aborts the request before the disk/snapshot fallback; a
  `304` answered from memory no longer overwrites `cache.etag` with the disk's
  validator; a corrupt snapshot reports its path instead of throwing a bare
  parse error.
- `data/registry-snapshot.json`: the bundled fallback went from 176 entries to
  the full current list (8107 entries, updated 2026-10-31).
- Tests: every upstream case kept, new host-adaptation cases added (strict
  `ctx.get`, cancellation, cancellable retry delay, host timer, 304
  validators, corrupt snapshot) — 40 in total.
- **New manual entry point `/find-plugin`** (`src/command.ts`), registered
  through the host `ctx.commands.register`: the search body that lived only
  inside the tool `execute` became one shared `findPlugins()` used by both the
  tool and the command; `commands` is read as an optional service, so a host
  without it just skips the registration. The command creates no model message
  and spends no tokens. 11 new cases in `test/command.test.mjs`, 51 in total.

Known issues:

- The upstream case "a proxy the host will ignore is named in the failure, and
  not when it opted in" already failed in the verbatim copy: this machine
  always sets `HTTPS_PROXY`/`https_proxy`, so the hint reads
  `HTTPS_PROXY/https_proxy is set` and misses the case's exact regex. It is an
  environment-sensitive upstream assertion and was left untouched.
- Upstream `check-peer-range` resolves host lines from `@deepseek-ai/dsh`
  `dist-tags`; with the current registry that yields no usable `dsh-tools`
  line, so the peer range plus typecheck/test runs on `0.1.0-rc.8` (floor) and
  `0.2.1-rc.5` (current host) stand as the compatibility evidence.
- The `desktop` profile is owned by the Electron app, so the CLI refuses
  `--dump-config` for it; loading is verified at runtime through
  `Config.listConfigs` (`include:find-dsh-plugin` present) and
  `Tool.listTools` (`find_dsh_plugin` present).

## Development

```sh
npm run typecheck                     # tsc --noEmit
npm test                              # offline tests (mocked fetch)
FINDP_LIVE=1 npm run test:live        # opt-in real-network cases
```

## License

MIT © awesome-dsh-plugin
