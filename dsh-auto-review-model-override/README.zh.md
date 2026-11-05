# dsh-auto-review-model-override

为官方 Auto review 指定审查模型，并在审查服务故障时提供容灾。

## 安装

```sh
dsh plugin --profile desktop add "link:E:/Code/dsh-plugin/dsh-auto-review-model-override"
```

## 配置

设置 → 通用，权限行下方出现**「自动审查模型」**一行：选择审查使用的 provider 与模型。二级菜单从当前进程真实注册的 provider/模型列表里选，不用手填 id。

容灾（超时、重试、降级、兜底）是**内置行为**，不暴露配置项，参数用内置默认值：

| 参数 | 内置值 | 说明 |
| :--- | :--- | :--- |
| 尝试次数 | 3 | 审查路由的总尝试次数（含首次） |
| 超时 | 30 秒 | 单次审查尝试的超时 |
| 回落超时 | 60 秒 | 降级与会话回落路由的超时，比审查路由更宽松 |
| 降级模型 | 会话当前模型 | 重试耗尽后自动回落 |
| 彻底失败时 | 询问我 | 弹窗请你确认 |

路由顺序是：**审查路由（重试 N 次）→ 降级路由（若有）→ 会话当前模型**。最后一步无需配置——审查请求原本的路由就是会话模型，它一定已注册且你正在用，所以单点 provider 故障会自动恢复。

审查模型保存后下一次审查立即生效，无需重启。也可以写进 profile patch：

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

审查模型两项留空时插件不介入。即使审查路由与会话路由相同，插件仍会接管——此时回落目标就是故障本身，超时、重试与兜底反而更必要；回落阶段会用 `alreadyTried` 跳过重复尝试。

## 为什么需要容灾

官方 auto-review 对两种失败的待遇是不对称的（核对 `packages/experimental/auto-review/src/index.ts`，submodule `dsh-v0.2.2-alpha.2`）：

| 情况 | 代码路径 | 结果 |
| :--- | :--- | :--- |
| 模型判定不安全 | `askUser()`，:703 | `ask`，弹窗让你决定，可放行 |
| 审查器故障 | `failed()`，:712 | `deny`，`info.code = AUTO_REVIEW_FAILED`，无放行机会 |

因为 Auto 预设的 approval 是 `ask`（`packages/interaction/permission-presets/src/index.ts:83-86`，注释明写 "`ask` routes reviewer denials to the user"），模型拒绝会转成弹窗；但 `failed()` 在到达 `askUser` 之前就 `return` 了，所以审查器故障**直接硬拒**。

结果是单点 provider 故障会让所有工具调用失败且无法放行——比模型拒绝还严厉。本插件补齐这一半。

## 实现

**路由改写**（`llm/stream` 瀑布）：按 `REVIEW_POLICY` system prompt 开头识别审查请求。有两个 Cordis 细节决定实现方式——瀑布的 `next` 不接受参数（`next(newOptions)` 会被静默丢弃，`vendor/cordis/src/events.ts:234-243`），所以不能借它改路由；审查请求又被 `deepFreeze`（:675），原地赋值会抛错。因此插件用重建后的请求重新进入 `ctx.llm.stream`，并打标记阻止递归。

**超时 / 重试 / 降级**（同在 `llm/stream`）：失败不是异常而是终止性的 `finish` chunk（`packages/llm/llm/src/index.ts:1186-1196`），所以必须遍历流才能发现。每次尝试把整条流收进缓冲区后才交给调用方——审查的输出只是一个 JSON 决策对象，由 auto-review 的 `readDecision` 完整收集后再解析（`src/index.ts:644-663`），不做流式展示；先收再发意味着「已输出」不是不可逆状态，中途失败也能安全重试而不会出现半截内容被覆盖。

超时通过本地 `AbortController` 真正 abort 底层请求（而非只靠 `Promise.race` 丢弃结果），避免留下仍在服务端执行的「孤儿流」；超时触发的 abort 会在本地被重新归类为 TIMEOUT，与「上游取消」严格区分——前者可重试，后者必须立即收手。

**兜底转人工**（同在 `llm/stream`）：所有路由都失败时不再抛错，而是**合成一条合法的审查决策流**交给审查器。不能靠抛错：`failed()` 分支直接 `return deny`（`:712-719`），永远到不了 `askUser`；只有 `decision.decision === 'deny'` 且 approval 策略非 `never` 时才弹出人工确认（`:767-768`），而 Auto 预设的 approval 恰为 `ask`（`packages/interaction/permission-presets/src/index.ts:83-86`）。因此 `onFailure: ask` 合成 `deny`，审查器便会调用 `askUser`；`allow` 合成放行；`deny` 仍抛错保持官方硬拒。合成格式取自 `parseDecision`（`:607-636`），块顺序满足 `readDecision` 的「reasoning* + 紧跟一个 text」要求（`:659-661`）。在 `llm/stream` 层合成不依赖任何监听注册顺序。

注意底层的 `@deepseek-ai/dsh-llm-retry` 帮不上忙：它挂在 `agent/request-error`（`packages/llm/llm-retry/src/index.ts:240`），处理主对话的失败步，而审查是一次独立的 `ctx.llm.stream` 裸调用，不产生 agent 步。

## 已知问题

- 审查路由与配置的降级路由都必须在当前进程已注册，否则那次尝试会再失败一次；回落到会话模型时该路由必然已存在，不受此限。
- 会话模型本身是同一个故障 provider 时，回落目标就是故障本身；此时靠 `onFailure` 兜底（该场景已实测：三个路由全挂 → 弹窗）。
- 插件按 `REVIEW_POLICY` 字面前缀匹配。上游若改动该提示词开头，路由改写会静默失效（容灾也随之失效）。
- 失败原因只影响弹窗文案，不参与安全决策。
- `onFailure: allow` 等于审查不可用时无条件信任工具调用，请自行权衡；默认 `ask` 保持你在回路中。
- 只改路由与失败处理，风险策略、allow/deny 协议与 Full access 执行都不变。
