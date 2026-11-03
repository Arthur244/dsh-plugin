# dsh-auto-review-model-override

为官方 Auto review 注入指定审查模型的插件。

## 安装

```sh
dsh plugin --profile desktop add "link:E:/Code/dsh-plugin/dsh-auto-review-model-override"
```

## 配置

两种等价方式，改的都是同一对值：

**设置页（推荐）**：设置 → 通用 → 权限行下方的「自动审查模型」。填入 provider 与模型 id 后点保存。两个字段都是 volatile 实时设置，保存后下一次审查立即生效，无需重启。

只有当前进程的权限目录里存在 `auto` 选项时，这一行才出现——也就是 Auto 集成已加载、可选自动审查时。目录变化（安装、移除、重载）会即时增减该行。目录读取失败时保持原状态，不因一次抖动闪掉。

**profile patch**：同样的值也可以写在插件配置里：

```yaml
- id: auto-review-model-override
  name: dsh-auto-review-model-override
  config:
    reviewProvider: happy
    reviewModel: deepseek-v4.1-flash
```

两项都留空则不接管，审查沿用会话当前模型。

## 实现

`@deepseek-ai/dsh-experimental-auto-review` 每次工具调用前用最新 `request/header` 的 provider/model 调 `ctx.llm.stream` 审查，且没有提供该路由的配置入口。本插件监听 `llm/stream` 瀑布，用固定的 `REVIEW_POLICY` system prompt 开头识别审查请求，只替换该请求的 `provider` 与 `model`。主对话、compaction、会话标题都不受影响。

有两个 Cordis 细节决定了实现方式：瀑布的 `next` 不接受参数（`next(newOptions)` 会被静默丢弃），所以不能借它改路由；审查请求又被 `deepFreeze`，原地赋值在严格模式下会抛错。因此插件用重建后的请求重新进入 `ctx.llm.stream`，并打标记阻止递归。

## 已知问题

- 目标 provider 与模型必须在当前进程已注册，否则每次审查都失败，工具调用不会执行。provider 故障时，选中 Auto 审查会连带阻断所有工具调用。
- 插件按 `REVIEW_POLICY` 字面前缀匹配。上游若改动该提示词开头，改写会静默失效。
- 只改路由，风险策略、allow/deny 协议与 Full access 执行都不变。
