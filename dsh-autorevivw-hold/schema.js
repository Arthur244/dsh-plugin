/**
 * Config schema for dsh-autorevivw-hold.
 *
 * Uses the harness's own Schemastery so the entry Config is structurally
 * identical to every shipped plugin's. Both fields carry the explicit
 * `volatile()` live marker: the settings service derives a namespace only
 * from fields marked volatile, so without it the entry never appears in
 * `settings.describe` even though the Loader accepts the schema.
 *
 * @module dsh-autorevivw-hold/schema
 */
import z from '@deepseek-ai/schemastery'

/**
 * The entry Config: both fields are live (editable without a remount), so the
 * settings service publishes them under this entry's namespace.
 */
export const Config = z.object({
  /** Apply the Auto review preset to sessions created from now on. */
  defaultAutoReview: z.boolean().default(false).volatile()
    .description('新会话默认使用自动审查（实验）。'),
  /** Set once the user accepted the risk dialog with "do not show again". */
  skipAutoReviewWarning: z.boolean().default(false).volatile()
    .description('切换到自动审查时不再弹出风险提示。'),
})

export default Config
