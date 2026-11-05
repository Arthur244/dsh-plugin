/**
 * 为官方 Auto review 指定审查模型，并在审查服务故障时提供容灾。
 *
 * ## 为什么需要改写路由
 *
 * 官方 @deepseek-ai/dsh-experimental-auto-review 的 reviewer 直接用最新
 * request/header 的 provider/model 调 ctx.llm.stream，没有配置入口。
 *
 * 关键约束（核对 vendor/cordis/src/events.ts:246-261）：
 *  - waterfall 的 `next` 签名是 `() => result`，传参会被完全丢弃，因此不能
 *    用 `next(newOptions)` 改路由。
 *  - 审查 options 在 auto-review 里被 deepFreeze（src/index.ts:682），严格
 *    模式下原地赋值会抛 TypeError，因此也不能照抄官方测试里的原地修改。
 *
 * 唯一可行做法：在 listener 内重启一次 llm.stream，把新路由交给 waterfall
 * 重新解析；用标记防止重入造成无限递归。
 *
 * ## 为什么需要容灾
 *
 * 审查器故障走 auto-review 的 `failed()` 分支（src/index.ts:722-729），产出
 * `deny` + `info.code === 'AUTO_REVIEW_FAILED'`，**不经过** `askUser`。而模型
 * 主动拒绝会经过 `askUser` 变弹窗（src/index.ts:776）。于是单点 provider 故障
 * 会让所有工具调用直接失败且无法放行——比模型拒绝还严厉。
 *
 * 本插件补上这个不对称：
 *  1. 超时保护：单次审查尝试最多等 `timeoutMs`。
 *  2. 重试：失败后按指数退避重试，最多 `retryAttempts` 次。
 *  3. 降级：重试耗尽后换到 `fallbackProvider/fallbackModel`，再回落到会话模型。
 *  4. 兜底：仍失败时按 `onFailure` 合成 allow / deny 决策流。
 *
 * 第 1-4 步都在 `llm/stream` 瀑布内完成（重新发起请求，审查插件无感知）。
 * 兜底靠「合成决策」而非「让审查器报错」：`failed()` 分支直接 `return deny`，
 * 永远到不了 `askUser`；只有 `decision.decision === 'deny'` 且 approval 策略
 * 非 `never` 时才弹人工确认（src/index.ts:770-776），而 Auto 预设的 approval
 * 恰为 `ask`（packages/interaction/permission-presets/src/index.ts:83-86）。
 * 因此 onFailure=ask 合成 deny 触发 askUser，allow 合成放行，deny 抛错硬拒。
 */
import { Config } from './schema.js'

export { Config }

/** 官方 reviewer system prompt 的固定开头，用于识别审查请求。 */
const REVIEW_POLICY_PREFIX = 'REVIEW_POLICY\n'

/** 标记请求已由本插件接管过路由，避免重入无限递归。 */
const OVERRIDDEN = Symbol.for('dsh-auto-review-model-override.applied')

export const name = 'auto-review-model-override'

/** 需要 ctx.llm 才能重新派发请求；缺少该声明时访问 ctx.llm 会抛 "without inject"。 */
export const inject = ['llm']

/** 判断一个 GenerateOptions 是否是 Auto review 发出的请求。 */
function isReviewRequest(options) {
  return typeof options.system === 'string' && options.system.startsWith(REVIEW_POLICY_PREFIX)
}

/** 指数退避：base 逐步翻倍，带少量抖动，避免并发重试撞在同一时刻。 */
function backoffDelay(attempt) {
  const base = 300 * 2 ** (attempt - 1)
  const jitter = base * 0.1 * (Math.random() * 2 - 1)
  return Math.max(0, Math.round(base + jitter))
}

/** 可被 signal 提前打断的等待。 */
function sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms)
    function finish() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })
  })
}

/**
 * 把一次失败归一化成给用户看的短句。
 *
 * 弹窗里出现的不该是原始报文：provider 的 404 正文往往是一整段 HTML，
 * 全塞进去既读不懂也淹没重点。这里按错误码归类成一句人话，原始细节只在
 * 确实没有可用归类时才保留。
 */
function describeFailure(failure) {
  if (failure === undefined || failure === null) return 'review service unavailable'
  const code = typeof failure.code === 'string' ? failure.code : ''
  const message = typeof failure.message === 'string' ? failure.message : ''
  const status = Number.isInteger(failure.status) ? failure.status : undefined

  switch (code) {
    case 'TIMEOUT':
    case 'ABORTED':
      return 'review model did not respond in time'
    case 'NO_ADAPTER':
      return 'review model is not configured'
    case 'TRANSPORT':
      return 'cannot reach the review service'
    case 'RATE_LIMIT':
      return 'review service is rate limiting'
    case 'PI_AI_ERROR':
    case 'SERVER':
      return status === 404
        ? 'review model endpoint not found'
        : 'review service returned an error'
    default:
      break
  }
  // 未归类的失败（例如模型拒绝按协议作答）保留一句截断的原因，
  // 但绝不回传整段 HTML。
  const brief = message.split('<')[0].replace(/\s+/g, ' ').trim().slice(0, 120)
  if (brief === '') return 'review service unavailable'
  return brief
}

/**
 * 把一次流调用收进缓冲区，并用独立超时兜住。
 *
 * 超时通过本地 `AbortController` 真正 abort 底层请求，而不是只靠
 * `Promise.race` 丢弃结果——后者会留下一个仍在服务端执行的「孤儿流」，
 * 每次超时重试都会让 provider 多收到一次完整请求。
 *
 * 超时 abort 会让下游 `adapterFailureChunk`（packages/llm/llm/src/index.ts:1191-1194）
 * 把终止标成 `kind: 'aborted'`，但本函数用 `timedOut` 标志在本地把它
 * 重新归类为 TIMEOUT，与「调用方取消」（上游 signal abort）严格区分：
 * 前者可重试，后者必须立即收手。
 *
 * @param ctx - 用于派发请求的上下文。
 * @param options - 本次尝试的请求。
 * @param signal - 上游取消信号。
 * @param timeoutMs - 本次超时；0 表示不设超时。
 * @returns `{ chunks, failure, cancelled }`。
 */
async function collectOnce(ctx, options, signal, timeoutMs) {
  const chunks = []
  let failure = null

  // 本地超时控制器：超时时真正打断底层请求。
  const controller = new AbortController()
  let timedOut = false

  const collect = async () => {
    try {
      // 合并上游取消与本地超时：任一触发都能真正打断底层 HTTP，不留孤儿流。
      const merged = signal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, signal])
      const stream = ctx.llm.stream({ ...options, signal: merged })
      for await (const chunk of stream) {
        if (chunk.type === 'finish'
          && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
          failure = chunk.reason.failure
          return
        }
        chunks.push(chunk)
      }
    } catch (error) {
      failure = {
        code: 'THROWN',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (timeoutMs <= 0) {
    await collect()
    return { chunks, failure, cancelled: signal?.aborted === true && failure !== null }
  }

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    await collect()
  } finally {
    clearTimeout(timer)
  }

  // 本地超时优先：底层看到的 abort 其实是「我们主动超时」，归为 TIMEOUT。
  if (timedOut) {
    failure = { code: 'TIMEOUT', message: `review attempt exceeded ${timeoutMs}ms` }
    chunks.length = 0
  }

  // 上游取消（非本地超时）才是「调用方取消」。
  const cancelled = !timedOut && signal?.aborted === true && failure !== null
  return { chunks, failure, cancelled }
}

/**
 * 合成一条合法的审查决策流，用于审查服务不可用时把决定交回给用户。
 *
 * `kind === 'allow'` 合成放行决策（审查器直接放行）；否则合成 `deny` 决策，
 * 审查器会因 `decision.decision === 'deny'` 且 approval 策略为 ask 而调用
 * `askUser`（src/index.ts:770-776），弹出人工确认——这正是 `failed()` 分支
 * 永远到不了的地方。
 *
 * 格式取自 auto-review 的 `parseDecision`（src/index.ts:614-640）：deny 需
 * 恰好三个成员（risk / decision / reason），reason 为字符串。
 *
 * 合成的只是「模型判定」，命令仍要用户点确认才执行；把关没有消失，只是
 * 从模型换成了人。
 *
 * @param kind - 'allow' 或 'deny'。
 * @param detail - 失败原因，写进 reasoning 与 deny 的 reason 便于排障。
 * @returns 与真实审查器同形的 chunk 序列。
 */
function* synthesizeDecision(kind, detail) {
  const text = kind === 'allow'
    ? JSON.stringify({ risk: 'medium', decision: 'allow' })
    : JSON.stringify({ risk: 'medium', decision: 'deny', reason: `review model unavailable (${detail})` })
  yield { type: 'block-start', index: 0, blockType: 'reasoning' }
  yield { type: 'reasoning-delta', index: 0, text: `review unavailable: ${detail}` }
  yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: `review unavailable: ${detail}` } }
  yield { type: 'block-start', index: 1, blockType: 'text' }
  yield { type: 'text-delta', index: 1, text }
  yield { type: 'block-end', index: 1, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/**
 * 带重试与降级的审查流。
 *
 * 路由顺序：审查路由（重试 N 次）→ 显式降级路由（若有）→ 会话原路由。
 *
 * 超时只作用于**审查路由**。回落到会话模型是最后一道保障，它用的路由本来
 * 就正常工作，再套一层超时只会在最后一步自己把自己掐死。
 *
 * @param ctx - 用于重新派发请求的上下文。
 * @param options - 原始审查请求；其 provider/model 仍是会话原路由。
 * @param config - 实时配置。
 * @param signal - 上游取消信号。
 * @param onExhausted - 所有尝试失败后的兜底回调，返回 Error 或决策 chunk 序列。
 */
async function* resilientStream(ctx, options, config, signal, onExhausted) {
  const reviewProvider = config.reviewProvider.get()
  const reviewModel = config.reviewModel.get()
  const overridden = reviewProvider !== '' && reviewModel !== ''

  const attempts = Math.max(1, config.retryAttempts.get())
  const timeoutMs = Math.max(0, config.timeoutMs.get())
  // 老配置可能没有 fallbackTimeoutMs 字段，缺失时退回 60 秒兜底。
  const fallbackTimeoutMs = Math.max(0, config.fallbackTimeoutMs?.get?.() ?? 60000)
  const fallbackProvider = config.fallbackProvider.get()
  const fallbackModel = config.fallbackModel.get()

  let lastFailure = null

  /** 跑一次尝试；成功返回块数组，失败返回 null；上游取消直接抛出。 */
  async function runOnce(provider, model, timeout) {
    const route = provider === undefined ? {} : { provider, model }
    const result = await collectOnce(ctx, { ...options, ...route }, signal, timeout)
    if (result.failure === null) return result.chunks
    lastFailure = result.failure
    if (result.cancelled) {
      const cancelled = new Error('auto-review cancelled by the caller')
      cancelled.cancelled = true
      throw cancelled
    }
    return null
  }

  const targetProvider = overridden ? reviewProvider : undefined
  const targetModel = overridden ? reviewModel : undefined

  // 阶段 1：审查路由，带超时与重试。
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) return
    const chunks = await runOnce(targetProvider, targetModel, timeoutMs)
    if (chunks !== null) { yield* chunks; return }
    if (attempt < attempts) await sleep(backoffDelay(attempt), signal)
  }

  // 阶段 2：显式配置的降级路由（可选）。用更宽松的回落超时：它是保障路径，
  // 但挂起时仍需有逃生通道，不能永久等待。
  if (fallbackProvider !== '' && fallbackModel !== '' && !signal?.aborted) {
    const chunks = await runOnce(fallbackProvider, fallbackModel, fallbackTimeoutMs)
    if (chunks !== null) { yield* chunks; return }
  }

  // 阶段 3：回落到会话原路由。同样用更宽松的回落超时。
  const sessionProvider = options.provider
  const sessionModel = options.model
  const alreadyTried = (targetProvider === sessionProvider && targetModel === sessionModel)
    || (fallbackProvider === sessionProvider && fallbackModel === sessionModel)
  if (!alreadyTried && !signal?.aborted) {
    const chunks = await runOnce(sessionProvider, sessionModel, fallbackTimeoutMs)
    if (chunks !== null) { yield* chunks; return }
  }

  // 兜底：onFailure=deny 时抛出（官方硬拒）；ask/allow 时产出合成的决策流。
  const outcome = onExhausted(lastFailure)
  if (outcome instanceof Error) throw outcome
  yield* outcome
}

export function apply(ctx, config) {
  /**
   * 最近一次审查失败的描述。审查请求与工具调用之间没有稳定的公共键
   * （前者只有 sessionId 字符串，后者是 Session 对象），因此按闭包共享，
   * 只用于把原因展示给用户，不做正确的会话隔离——最坏情况是展示上一次的
   * 失败原因，不影响安全决策。
   */
  let lastFailureDetail = ''

  ctx.on('llm/stream', (options, next) => {
    // 已接管过的请求（重试时重新进入）直接放行到下游，避免无限递归。
    if (options[OVERRIDDEN] === true) return next()
    if (!isReviewRequest(options)) return next()

    const reviewProvider = config.reviewProvider.get()
    const reviewModel = config.reviewModel.get()
    // 只要配置了审查路由就接管。不要因为「审查路由 == 会话路由」而短路：
    // 两者相同时回落目标就是故障本身，恰恰更需要超时、重试与兜底。
    // 回落阶段自身会用 alreadyTried 跳过与已试路由相同的目标。
    if (reviewProvider === '' || reviewModel === '') return next()

    const signal = options.signal
    const policy = config.onFailure.get()

    /**
     * 兜底回调：按 `onFailure` 决定审查彻底失败后的产物。
     *  - `deny`：抛错，沿用官方 `failed()` 分支的硬拒。
     *  - `ask` / `allow`：合成决策流（ask 合成 deny 触发弹窗，allow 合成放行）。
     */
    const onExhausted = (failure) => {
      lastFailureDetail = describeFailure(failure)
      if (policy === 'deny') {
        return new Error(`auto-review failed after retries: ${lastFailureDetail}`)
      }
      return synthesizeDecision(policy === 'allow' ? 'allow' : 'deny', lastFailureDetail)
    }

    return resilientStream(
      ctx,
      { ...options, [OVERRIDDEN]: true },
      config,
      signal,
      onExhausted,
    )
  })
}
