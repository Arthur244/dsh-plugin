# dsh-auto-review-model-override

为官方 Auto review 单独选择审查模型，并提供**有总时间预算、失败关闭边界明确**的重试与回退。只接管审查模型请求，不修改会话权限，也不直接发起人工审批。

## 安装与生效

```sh
dsh plugin --profile desktop add "link:E:/Code/dsh-plugin/dsh-auto-review-model-override"
```

`link:` 安装从插件自己的目录解析 `@deepseek-ai/schemastery`，首次使用需在本目录运行 `npm install`。修改 Host 源码后需重新加载插件或重启 DSH；仅改变模型选择和配置值，下次审查即可生效。不要在仍运行重要任务时重载权限相关插件。

设置 → 通用 → **自动审查模型**，选择已注册的 provider 和模型。两项任一为空时插件完全不接管。

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
| `reviewProvider` / `reviewModel` | 空 | 两项齐全才接管 |
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
node --test test/resilience.test.mjs
```

与真实已安装官方服务的组合回归（仓库根目录、DSH 桌面会话的 Git Bash）：

```sh
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" dsh-auto-review-model-override/test/official-integration.cjs
```

组合测试使用真实会话、委托策略、权限投影、Auto 审查门和 ApprovalService，但模型、工具计数与人工答复均是进程内测试桩；不连接当前会话、不联网、不发真实审批、不执行真实工具。覆盖两个插件同时启用时子代理拒绝不等人工，以及新主会话仍正确应用默认 Auto 的阳性对照。不是浏览器端到端或真实子代理进程测试。

## 核对基线与限制

核对 DSH **0.2.2-rc.3**，参考 commit `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`，并使用同版本桌面安装模块运行组合回归：

- [官方审查协议、请求与拒绝分支](../ref/deepseek-harness/packages/experimental/auto-review/src/index.ts#L614-L776)。
- [官方 chunk 汇编规则](../ref/deepseek-harness/packages/llm/llm/src/assembler.ts#L49-L160)。
- [子代理固定 never 的委托策略](../ref/deepseek-harness/packages/subagent/subagent/src/child-agent.ts#L221-L279)。

插件按 `REVIEW_POLICY\n` 匹配官方审查请求；上游协议变化需要重新核对。取消无法保证远端服务停止计费，也无法强行终止不响应取消的第三方代码；保证的是不让异步流／清理继续卡住本次决策，不再为尚未退出的超时生产者叠加后续请求。JavaScript 主线程被同步代码阻塞时，定时器也无法抢占。

这次修复不自动改写既有会话的权限。如果此前其他插件已把子会话策略改成 `ask`，本插件不会擅自修复权限记录；请结束旧任务并在正确配置下新建任务。
