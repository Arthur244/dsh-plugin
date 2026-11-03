# dsh-auto-review-model-override

Point the official Auto review at its own model instead of the main conversation's model.

## Install

```sh
dsh plugin --profile desktop add "link:E:/Code/dsh-plugin/dsh-auto-review-model-override"
```

## Configure

Two equivalent ways to set the same two values:

**Settings page (recommended).** Settings → General → the *Auto review model* row, below the permission row. Type a provider id and a model id, then Save. Both fields are live settings, so the next review uses them without a restart.

The row appears only while the process catalog offers `auto`, meaning the Auto integration is loaded and Auto review is selectable. Catalog changes (install, removal, reload) add or withdraw it immediately; a failed catalog read keeps the current state instead of flickering the row off.

**Profile patch.** The same values live in the plugin's config:

```yaml
- id: auto-review-model-override
  name: dsh-auto-review-model-override
  config:
    reviewProvider: happy
    reviewModel: deepseek-v4.1-flash
```

Leave both empty to keep the reviewer on the session's current route.

## How it works

`@deepseek-ai/dsh-experimental-auto-review` reviews each pending tool call through `ctx.llm.stream` using the newest `request/header` provider and model, and exposes no configuration field for that route. This plugin listens on the `llm/stream` waterfall, recognizes a review request by its fixed `REVIEW_POLICY` system prompt, and replaces only that request's `provider` and `model`. Main-conversation requests, compaction, and session titles are untouched.

Two Cordis details shape the implementation. The waterfall's `next` takes no arguments — `next(newOptions)` is silently discarded — so the rewrite cannot be delegated through it. The review request is also `deepFreeze`d, so in-place mutation throws. The plugin therefore re-enters `ctx.llm.stream` with a rebuilt request and marks it to stop the recursion.

## Known limitations

- The target provider and model must already be registered in the running process, or each review fails and the tool call is not executed. A provider outage therefore blocks every tool call while Auto review is selected.
- The plugin matches the literal `REVIEW_POLICY` prefix. If upstream changes that prompt opening, the rewrite silently stops applying.
- It rewrites the route only; the risk policy, allow/deny protocol, and Full access execution are unchanged.
