/**
 * Config schema for dsh-auto-review-model-override.
 *
 * Fields are `volatile()`: the settings service derives a namespace only from
 * volatile fields, so without the marker the entry never appears in
 * `settings.describe` even though the Loader accepts the schema
 * (mirrors dsh-autorevivw-hold/schema.js).
 *
 * @module dsh-auto-review-model-override/schema
 */
import z from '@deepseek-ai/schemastery'

/**
 * The entry Config: every field is live (editable without a remount).
 */
export const Config = z.object({
  /** Provider route used for Auto review requests. */
  reviewProvider: z.string().default('').volatile()
    .description('自动审查使用的 provider（留空则不接管）。'),
  /** Model id passed to that provider for Auto review requests. */
  reviewModel: z.string().default('').volatile()
    .description('自动审查使用的模型（留空则不接管）。'),

  /** Total attempts for one review request, including the first (1 disables retry). */
  retryAttempts: z.natural().default(3).volatile()
    .description('审查请求的总尝试次数（含首次），1 表示不重试。'),
  /** Whole-operation deadline, including retries, backoff and fallback. Always finite. */
  totalTimeoutMs: z.natural().default(120000).volatile()
    .description('审查操作的总时间预算，含重试与回落；默认 120 秒，0 仍使用默认值。'),
  /** Per-attempt cap; 0 uses the remaining whole-operation budget. */
  timeoutMs: z.natural().default(30000).volatile()
    .description('单次审查尝试的超时毫秒数；0 使用剩余总预算，不允许无限等待。'),
  /**
   * Timeout for the fall-back routes (the configured fallback and the session
   * model), in milliseconds. These are the last-resort routes, so the default
   * is more generous than `timeoutMs`; 0 uses the remaining total budget.
   * Neither setting can disable the whole-operation deadline.
   */
  fallbackTimeoutMs: z.natural().default(60000).volatile()
    .description('回落路由超时（降级与会话模型）；0 使用剩余总预算。'),
  /**
   * Optional route tried after every retry fails, before the automatic
   * fall-back to the session's own model. An empty provider or model simply
   * skips this step — the session route is still tried.
   */
  fallbackProvider: z.string().default('').volatile()
    .description('重试耗尽后使用的备用 provider（留空则直接回落到会话模型）。'),
  /** Model id for {@link fallbackProvider}. */
  fallbackModel: z.string().default('').volatile()
    .description('重试耗尽后使用的备用模型（留空则直接回落到会话模型）。'),
  /**
   * What a tool call becomes when review cannot produce any decision.
   * `ask` keeps the user in the loop; `deny` preserves the upstream behavior;
   * `allow` is available but trusts the call without a review.
   */
  onFailure: z.union(['ask', 'deny', 'allow']).default('ask').volatile()
    .description('审查故障最终处置：ask 合成拒绝并由官方审批策略决定（子代理 never 直接拒绝）；deny 硬拒；allow 显式故障放行。'),
})

export default Config
