/**
 * 为官方 Auto review 指定审查模型。
 *
 * 官方 @deepseek-ai/dsh-experimental-auto-review 的 reviewer 直接用最新
 * request/header 的 provider/model 调 ctx.llm.stream，没有配置入口。
 *
 * 关键约束（核对 vendor/cordis/src/events.ts:234-243）：
 *  - waterfall 的 `next` 签名是 `() => result`，传参会被完全丢弃，因此不能
 *    用 `next(newOptions)` 改路由。
 *  - 审查 options 在 auto-review 里被 deepFreeze（src/index.ts:675），严格
 *    模式下原地赋值会抛 TypeError，因此也不能照抄官方测试里的原地修改。
 *
 * 唯一可行做法：在 listener 内重启一次 llm.stream，把新路由交给 waterfall
 * 重新解析；用标记防止重入造成无限递归。
 */
import { Config } from './schema.js'

export { Config }

/** 官方 reviewer system prompt 的固定开头，用于识别审查请求。 */
const REVIEW_POLICY_PREFIX = 'REVIEW_POLICY\n'

/** 标记已由本插件改写过路由的请求，避免重入无限递归。 */
const OVERRIDDEN = Symbol.for('dsh-auto-review-model-override.applied')

export const name = 'auto-review-model-override'

/** 需要 ctx.llm 才能重新派发请求；缺少该声明时访问 ctx.llm 会抛 "without inject"。 */
export const inject = ['llm']

export function apply(ctx, config) {
  ctx.on('llm/stream', (options, next) => {
    if (options[OVERRIDDEN] === true) return next()
    if (typeof options.system !== 'string' || !options.system.startsWith(REVIEW_POLICY_PREFIX)) {
      return next()
    }
    // Volatile fields are live settings: read them per request so a change in
    // the General page applies without remounting the plugin.
    const provider = config.reviewProvider.get()
    const model = config.reviewModel.get()
    if (provider === '' || model === '') return next()
    // 重建请求对象：原对象可能被 deepFreeze，不能原地改写 provider/model。
    return ctx.llm.stream({ ...options, provider, model, [OVERRIDDEN]: true })
  })
}
