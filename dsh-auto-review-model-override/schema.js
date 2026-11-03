/**
 * Config schema for dsh-auto-review-model-override.
 *
 * Both fields are `volatile()`: the settings service derives a namespace only
 * from volatile fields, so without the marker the entry never appears in
 * `settings.describe` even though the Loader accepts the schema
 * (mirrors dsh-autorevivw-hold/schema.js).
 *
 * @module dsh-auto-review-model-override/schema
 */
import z from '@deepseek-ai/schemastery'

/**
 * The entry Config: both fields are live (editable without a remount).
 */
export const Config = z.object({
  /** Provider route used for Auto review requests. */
  reviewProvider: z.string().default('').volatile()
    .description('自动审查使用的 provider（留空则不接管）。'),
  /** Model id passed to that provider for Auto review requests. */
  reviewModel: z.string().default('').volatile()
    .description('自动审查使用的模型（留空则不接管）。'),
})

export default Config
