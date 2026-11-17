# dsh-auto-review-model-override

为官方 Auto review 单独选择审查模型，并提供**有总时间预算、失败关闭边界明确**的重试与回退。只接管审查模型请求，不修改会话权限，也不直接发起人工审批。

## 安装与生效

```sh
dsh plugin --profile desktop add "link:E:/Code/dsh-plugin/dsh-auto-review-model-override"
```

`link:` 安装从插件自己的目录解析 `@deepseek-ai/schemastery`，首次使用需在本目录运行 `npm install`。修改 Host 源码后需重新加载插件或重启 DSH；仅改变模型选择和配置值，下次审查即可生效。不要在仍运行重要任务时重载权限相关插件。

设置 → 通用 → **自动审查模型**，选择已注册的 provider 和模型。两项任一为空时沿用会话原路由，**仍过滤思考强度**，但不启用本插件的重试、备用路由和最终故障策略。

官方审查请求会移除传入的 `reasoningEffort`。在已验证的 DSH pi-ai 适配器上，还会在发送前移除最终请求体的 `reasoning.effort` / `reasoning_effort`，避免 SDK 把未指定强度自动转换成 `none`。覆盖主路由、重试、备用路由和会话回退；不修改原请求、共享 provider 配置或普通会话请求。这是**让服务端选择默认强度**，不是关闭思考，也不是改成 `low` / `medium`。非 pi-ai 适配器只过滤入口字段，其最终报文行为不在已验证范围内。

## 容灾顺序

```text
审查路由（仅暂态故障重试）→ 显式备用路由（可选）→ 会话原路由
```

- 各路由按 provider/model 对去重；主路由的重试不属于重复备用路由。
- **合法 allow/deny 都是最终审查结果，绝不因为 deny 再换模型找放行。**
- 认证／授权、配置和协议失败跳过同路由重试，可以尝试不同路由。超时、网络、限流及暂态服务错误在预算内重试；抛出的结构化 code/status 保留用于分类。
- 会话模型只是一条尽力回退路径，不保证健康，也不保证与审查模型属于不同故障域。
- 所有尝试、退避、备用路由共享一个总截止时间，默认 **120 秒**。到期返回最终故障处置；不是每条路由重新获得完整总预算。
- 超时／取消同时中断底层请求和消费者等待。若超时时生产者仍未结束，停止本次操作的后续请求，避免不断制造孤儿流。异步迭代器清理不阻塞拒绝结果，迟到的异常仍会被观察。
- 缓冲最多 8192 个 chunk、1 MiB 序列化数据。流结束后校验 `reasoning* + 一个 text + finish(stop)`、JSON 成员和 risk/decision 组合；支持官方 delta-only 与首个 block-end 权威规则。
- 调用方取消是终态：等待、退避、缓冲输出、最终合成都检查取消，不再生成放行决策。

## 最终故障策略与子代理

| `onFailure` | 审查服务最终失败后的行为 |
| :--- | :--- |
| `ask`（默认） | 合成合法 `deny`，交给官方权限系统：`approval=never` 直接拒绝；`ask` 且下游允许时才可能询问人工 |
| `deny` | 抛出审查故障，由官方返回 `AUTO_REVIEW_FAILED`，不转人工 |
| `allow` | **显式 fail-open**：合成允许，仍受官方下游守卫约束；不再具备模型审查保证 |

插件不写 `approval/policy`，也不调用审批服务。官方子代理可保持 **Auto + never**，不是关闭 Auto review。不能把 `ask` 理解为一定弹窗，也不能把 `never` 理解为禁止一切工具。

## 配置

模型选择显示在设置行；其余字段可在 bundle patch 中配置，不是全部都有专用 UI 控件。

| 字段 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `reviewProvider` / `reviewModel` | 空 | 两项齐全才启用模型覆盖和容灾；否则只在原路由过滤强度 |
| `retryAttempts` | 3 | 主审查路由总尝试次数，至少 1，运行时最多 10 |
| `timeoutMs` | 30000 | 主路由单次上限；0 使用剩余总预算 |
| `fallbackTimeoutMs` | 60000 | 备用／会话路由单次上限；0 使用剩余总预算 |
| `totalTimeoutMs` | 120000 | 整个审查的总预算；0 或无效值仍使用有限默认值 |
| `fallbackProvider` / `fallbackModel` | 空 | 可选备用路由，两项齐全才尝试 |
| `onFailure` | `ask` | 见上表，取消不使用此兜底 |

```yaml
- id: auto-review-model-override
  name: dsh-auto-review-model-override
  config:
    reviewProvider: happy
    reviewModel: deepseek-v4.1-flash
    retryAttempts: 3
    timeoutMs: 30000
    fallbackTimeoutMs: 60000
    totalTimeoutMs: 120000
    onFailure: ask
```

## 验证

离线单元测试（本目录）：

```sh
node --test test/*.test.mjs
```

与真实已安装官方服务的组合回归（仓库根目录、DSH 桌面会话的 Git Bash）：

```sh
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" dsh-auto-review-model-override/test/official-integration.cjs
```

组合测试使用真实会话、委托策略、权限投影、Auto 审查门和 ApprovalService，但模型、工具计数与人工答复均是进程内测试桩；不连接当前会话、不联网、不发真实审批、不执行真实工具。覆盖两个插件同时启用时子代理拒绝不等人工，以及新主会话仍正确应用默认 Auto 的阳性对照。不是浏览器端到端或真实子代理进程测试。

真实 SDK 请求体回归（同一运行环境、仓库根目录）：

```sh
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" dsh-auto-review-model-override/test/wire-integration.cjs
```

使用已安装 DSH、pi-ai 和 OpenAI SDK，仅连接临时绑定 `127.0.0.1` 的假服务、使用假密钥，不读取 profile 凭证。先复现 Responses 在未指定强度时自动发送 `none`，再验证 Responses / Chat Completions 的空路由、显式强度、provider 默认强度、并发普通请求隔离，以及主路由重试 → 备用 → 会话回退的最终请求体。它验证实际序列化报文，但不证明外部模型服务已接受请求。

## 核对基线与限制

核对 DSH **0.2.2-rc.3**，参考 commit `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`，并使用同版本桌面安装模块运行组合回归：

- [官方审查协议、请求与拒绝分支](../ref/deepseek-harness/packages/experimental/auto-review/src/index.ts#L614-L776)。
- [官方 chunk 汇编规则](../ref/deepseek-harness/packages/llm/llm/src/assembler.ts#L49-L160)。
- [审查请求思考强度字段 `GenerateOptions.reasoningEffort`](../ref/deepseek-harness/packages/llm/llm/src/types.ts#L564-L569) 与 [DSH 模型默认强度解析](../ref/deepseek-harness/packages/llm/llm/src/index.ts#L934-L954)。
- [pi-ai 适配器默认强度与 SDK 调用](../ref/deepseek-harness/packages/llm/llm-pi-ai/src/adapter.ts#L395-L492) 和 [off 映射](../ref/deepseek-harness/packages/llm/llm-pi-ai/src/catalog.ts#L764-L773)。当前桌面 SDK 为 `@earendil-works/pi-ai` **1.3.0**；其 `dist/api/openai-responses.js:282-298` 在缺少 effort 且 `thinkingLevelMap.off` 非 `null` 时填入 `none`，`onPayload` 在序列化发送前运行。
- [子代理固定 never 的委托策略](../ref/deepseek-harness/packages/subagent/subagent/src/child-agent.ts#L221-L279)。

发送前过滤使用 [逐请求兼容层](./review-dispatch.js)：DSH rc.3 没有公共请求体 hook，因此局部派生 runtime / PiAiAdapter 视图，组合 SDK `onPayload`；不修改注册实例、全局 fetch 或 profile。依赖 rc.3 的内部 `registration`、`adapterStream`、`current` 与快照结构；识别为 pi-ai 但结构不兼容时拒绝发出该次审核请求，升级 DSH / SDK 必须重跑线级测试。该终端分发跳过本插件之后的 `llm/stream` 中间件；若另一个插件也依赖处理审核流，需单独做组合验证。适配器视图身份不同会使 DSH 清除 assistant 的 `replayState`；只用于官方 system + user 审核提示，不应用于普通多轮对话。

插件按 `REVIEW_POLICY\n` 匹配官方审查请求；上游协议变化需要重新核对。取消无法保证远端服务停止计费，也无法强行终止不响应取消的第三方代码；保证的是不让异步流／清理继续卡住本次决策，不再为尚未退出的超时生产者叠加后续请求。JavaScript 主线程被同步代码阻塞时，定时器也无法抢占。

这次修复不自动改写既有会话的权限。如果此前其他插件已把子会话策略改成 `ask`，本插件不会擅自修复权限记录；请结束旧任务并在正确配置下新建任务。
