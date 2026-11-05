# dsh-auto-review-model-override

Pin the model that reviews tool calls, and keep Auto review usable when that model's provider is unreachable.

## Install

```sh
dsh plugin --profile desktop add "link:E:/Code/dsh-plugin/dsh-auto-review-model-override"
```

`index.js` imports `./schema.js`, which imports `@deepseek-ai/schemastery`. A `link:` install resolves modules from the plugin's own directory, not from the profile's `node_modules`, so that package must exist here:

```sh
cd dsh-auto-review-model-override && npm install
```

Skipping this makes the Host half fail to load (`ERR_MODULE_NOT_FOUND: @deepseek-ai/schemastery`). The failure is easy to miss: the Web bundle is published from the package manifest and client entry alone (`packages/client/modules/src/index.ts:891-918`, which never imports the Host module), so the settings row can appear while the half that actually rewrites review routes is dead. Re-run `npm install` after pulling whenever `package.json` changes.

## Configure

Settings → General shows one **Auto review model** row below the permission row: pick the provider and model used for review. Both levels of the menu come from the provider/model catalog the running process actually advertises, so no ids need typing.

Resilience (timeout, retry, fallback, last resort) is **built in** and not exposed as a setting; its parameters use built-in defaults:

| Parameter | Built-in | Meaning |
| :--- | :--- | :--- |
| Attempts | 3 | Total attempts on the review route, including the first |
| Timeout | 30 s | Per-attempt timeout |
| Fallback timeout | 60 s | Timeout for the fallback and session routes, more generous than the review route |
| Fallback model | session model | Automatic fall-back after retries run out |
| When review fails | Ask me | Prompts for your approval |

The route order is **review route (N attempts) → configured fallback → session's own model**. The last step needs no configuration: a review request's original route already *is* the session model, which is necessarily registered and in use, so a single provider outage recovers by itself.

A saved model change applies to the next review without a restart. The same values also work in the profile patch:

```yaml
- id: auto-review-model-override
  name: dsh-auto-review-model-override
  config:
    reviewProvider: happy
    reviewModel: deepseek-v4.1-flash
    retryAttempts: 3
    timeoutMs: 30000
    fallbackTimeoutMs: 60000
    onFailure: ask
```

The plugin stays out of the way when the review fields are empty. It still intervenes when the review route equals the session route — in that case the fall-back target *is* the failure itself, so timeout, retry, and the last resort matter even more; the fall-back stage skips the duplicate via `alreadyTried`.

## Why resilience is needed

Upstream auto-review treats its two failure modes asymmetrically (`packages/experimental/auto-review/src/index.ts`, submodule `dsh-v0.2.2-rc.1`):

| Situation | Path | Outcome |
| :--- | :--- | :--- |
| Model judged the call unsafe | `askUser()`, :712 | `ask` — a dialog lets you override |
| Reviewer itself failed | `failed()`, :722 | `deny` — `info.code = AUTO_REVIEW_FAILED`, no override |

Auto's approval policy is `ask` (`packages/interaction/permission-presets/src/index.ts:83-86`, whose comment states "`ask` routes reviewer denials to the user"), so a model denial becomes a prompt. `failed()` returns before ever reaching `askUser`, so a reviewer outage is a hard denial.

A single provider outage therefore blocks every tool call with no way to proceed — stricter than an actual model denial. This plugin restores the missing half.

## How it works

**Route rewrite** (`llm/stream` waterfall): review requests are recognized by their `REVIEW_POLICY` system-prompt prefix. Two Cordis details force the shape of the implementation. The waterfall's `next` takes no arguments — `next(newOptions)` is silently discarded (`vendor/cordis/src/events.ts:246-261`) — so the rewrite cannot be delegated through it. The review request is also `deepFreeze`d (:682), so in-place mutation throws. The plugin therefore re-enters `ctx.llm.stream` with a rebuilt request, marked to stop the recursion.

**Timeout / retry / fallback** (same `llm/stream`): failures arrive as a terminal `finish` chunk rather than a throw (`packages/llm/llm/src/index.ts:1187-1196`), so the stream must be drained to detect them. Each attempt buffers the whole stream before yielding anything — a review's output is just one JSON decision object assembled completely by `readDecision` (`src/index.ts:643-667`), never displayed as a stream, so buffering makes "already emitted" a reversible state: a mid-stream failure retries cleanly instead of leaving half an answer overwritten.

The timeout aborts the underlying request through a local `AbortController` (rather than only discarding the result via `Promise.race`), so it leaves no orphan stream still executing server-side. An abort caused by the timeout is reclassified locally as `TIMEOUT`, kept strictly distinct from an upstream cancellation — the former is retryable, the latter must stop immediately.

**Ask-on-failure** (same `llm/stream`): when every route fails, the plugin synthesizes a valid review decision stream instead of throwing. Throwing cannot work: the `failed()` branch returns `deny` outright (`:722-729`) and never reaches `askUser`; that dialog only opens for `decision.decision === 'deny'` under a non-`never` approval policy (`:770-776`), and Auto's approval is exactly `ask` (`packages/interaction/permission-presets/src/index.ts:83-86`). So `onFailure: ask` synthesizes a `deny`, `allow` synthesizes a pass, and `deny` still throws to keep the upstream hard refusal. The payload follows `parseDecision` (`:614-640`) and the block order satisfies `readDecision`'s "reasoning* then exactly one text" rule (`:661-665`). Synthesizing inside `llm/stream` depends on no listener registration order.

The bundled `@deepseek-ai/dsh-llm-retry` cannot help here: it listens on `agent/request-error` (`packages/llm/llm-retry/src/index.ts:240`), which covers the main conversation's failed step. A review is a bare `ctx.llm.stream` call that produces no agent step.

## Known limitations

- Both the review route and any configured fallback must already be registered in the process, or that attempt fails as well. The session-model fall-back is exempt: that route necessarily exists.
- When the session model lives on the same failing provider, the fall-back target is the failure itself, leaving `onFailure` as the last resort. That path is tested: three dead routes end in the approval prompt.
- Matching is on the literal `REVIEW_POLICY` prefix. If upstream changes that prompt opening, both the route rewrite and the resilience path silently stop applying.
- The failure detail affects only the prompt's wording, never the security decision.
- `onFailure: allow` trusts tool calls unconditionally whenever review is unavailable — weigh that yourself. The default `ask` keeps you in the loop.
- Only routing and failure handling change; the risk policy, allow/deny protocol, and Full access execution are untouched.
