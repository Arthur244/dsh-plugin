# dsh-autorevivw-hold

在 DeepSeek Harness Web **设置 → 通用 → 权限**的默认权限模式选择器中加入“自动审查”选项；切换到自动审查（或完全权限）时弹出风险确认，自动审查的确认框可勾选**“以后不再显示此风险提示”**并持久记忆。

## 安装

```sh
dsh plugin --profile desktop add ./dsh-autorevivw-hold
```

插件会同时启用官方 `@deepseek-ai/dsh-experimental-auto-review` 集成（对话框下方的会话权限选择器也会恢复“自动审查”选项）。

## 工作方式

- 插件以同 id 阴影（`priority: -1`）替换官方权限设置行的渲染，把“自动审查（EXP）”追加进选项列表；仅当 Host 的 Auto 集成处于活动状态时显示。
- 选择“自动审查”会写入两条配置：官方 `permission.defaultPreset` 回落到安全预设（`workspace-write`），插件配置 `defaultAutoReview=true` 由 Host 侧在**新会话创建时**应用 Auto。
- 风险确认勾选“不再提示”后写入 `skipAutoReviewWarning=true`，之后直接切换、不再弹窗；取消勾选路径（选回普通预设）会重置该标记。
- 官方边界保持不变：`auto` 不是合法的 `defaultPreset` 值，因此本插件用自有命名空间存默认值。

## 配置

- `defaultAutoReview`: 是否让新会话默认选择 Auto review。
- `skipAutoReviewWarning`: 是否跳过启用时的风险确认（由确认框的“不再提示”勾选写入）。

## 已知问题

- Auto review 是实验功能，需要当前模型可用；它可能误放行或误拒绝操作，并会额外消耗模型请求。
- 关闭插件后，已创建的 Auto 会话由官方集成迁移到 Full access；设置行恢复为官方版本（不含自动审查选项）。
- “不再提示”只作用于设置行的风险确认；会话内权限选择器的确认逻辑由官方代码控制，本插件不修改。
