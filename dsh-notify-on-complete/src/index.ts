/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { createNotifyApiHandler } from './api.js'
import { blockedBody, buildBody, buildCommands, buildSoundCommands, isSupportedPlatform, resolveSoundName, resultText, soundKeyFor, spawnNotify } from './notify.js'
import { isInQuietHours } from './quiet-hours.js'
import { BlockedNotifier, RunEndNotifier } from './notifier.js'
import { configureSettingsPresentation, NotifySettingsSchema, readLiveConfig } from './settings.js'
import type { VolatileNotifyConfig } from './settings.js'
import type { AgentStatusPayload, NotifyConfig, Session, SessionEvent } from './types.js'

export const name = 'dsh-notify-on-complete'

/**
 * The settings schema the Plugins page renders and the Loader validates every
 * entry config against. Exporting it as `Config` is what registers this
 * plugin's settings namespace: on DSH 0.2.2 a namespace IS the profile entry
 * id, and `ctx.settings` describes the entry only when its schema carries a
 * volatile field (see `settings.ts`).
 */
export const Config = NotifySettingsSchema

/**
 * Notify the OS when a root-session run ends. Watches `agent/status` for the
 * root agent returning to `'idle'` (the harness's run-ended signal) and
 * reports the latest `turn/end` reason recorded on `session/event`, so a run
 * spanning many turns (goal rounds, follow-ups) produces exactly one
 * notification with its true final result. Subagent sessions are excluded via
 * `header.origin === 'subagent'`.
 *
 * The effective config is read per event from the volatile references the
 * schema resolves, so a settings-panel edit applies without a restart;
 * `enabled: false` silences every path, and unsupported platforms are skipped
 * with a warning instead of throwing inside event listeners. Blocking
 * interactions (questions and approvals) during a session also fire an
 * immediate notification.
 * @param ctx - the plugin context.
 * @param config - the schema-resolved entry config; its fields are volatile
 * references to the live values, defaulted over the composition entry.
 */
export function apply(ctx: Context, config: NotifyConfig & Partial<VolatileNotifyConfig> = {}): void {
  // The bundle patch may spell the entry config plainly (a hand-written
  // cordis.yml mounts the plugin without going through the schema). Keep the
  // fail-loud validation for that path; a schema-validated config has already
  // been checked by the Loader, so its values are volatile references instead.
  const live = isVolatileConfig(config) ? config : undefined
  const entry: NotifyConfig = live === undefined ? plainEntryConfig(ctx, config) : config

  configureSettingsPresentation(ctx)

  // The browser settings card reads and writes through the `settings` Remote
  // namespace, which every configuration surface uses. This route stays for
  // diagnostics in a profile that mounts `ctx.settings` without the Remote
  // gateway; the webServer service mounts after this bundle in web profiles,
  // so wait on the service rather than reading it at apply time. CLI one-shot
  // runs never satisfy the injection and the route simply never registers.
  ctx.inject(['webServer'], (sctx) => {
    const webServer = sctx.get('webServer') as { register(route: {
      kind: 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
    }): () => void }
    sctx.effect(
      () => webServer.register({
        kind: 'prefix',
        path: '/notify-on-complete/api',
        handler: createNotifyApiHandler(ctx),
      }),
      'dsh-notify-on-complete: settings api route',
    )
  })

  /** The effective config for this event: live settings over the entry layer. */
  const current = (): NotifyConfig => readLiveConfig(live, entry)

  if (!(current().enabled ?? true)) return

  if (!isSupportedPlatform(process.platform)) {
    ctx.logger?.warn?.(`dsh-notify-on-complete: unsupported platform "${process.platform}" — notifications disabled`)
    return
  }

  /** Suppressed during quiet hours and when disabled. */
  const active = (config: NotifyConfig): boolean => (config.enabled ?? true) && !isInQuietHours(new Date(), config.quietHours ?? [])

  const notifier = new RunEndNotifier({
    notify: (kind: string, sessionId: string, sessionTitle: string): void => {
      const config = current()
      if (!active(config)) return
      const soundName = resolveSoundName(config.sounds, soundKeyFor(kind))
      spawnNotify(buildCommands(process.platform, config.title ?? 'DeepSeek Harness', buildBody(resultText(kind), sessionId, sessionTitle), soundName, config.sound ?? true))
      if (config.sound ?? true) spawnNotify(buildSoundCommands(process.platform, soundName))
    },
  })

  const blockedNotifier = new BlockedNotifier({
    notify: (kind: string, detail: string, sessionId: string, sessionTitle: string): void => {
      const config = current()
      if (!(config.onBlocked ?? true)) return
      if (kind === 'question' && !(config.onQuestion ?? true)) return
      if (kind === 'approval' && !(config.onApproval ?? true)) return
      if (!active(config)) return
      const soundName = resolveSoundName(config.sounds, soundKeyFor(kind))
      spawnNotify(buildCommands(process.platform, config.title ?? 'DeepSeek Harness', blockedBody(kind, detail, sessionId, sessionTitle), soundName, config.sound ?? true))
      if (config.sound ?? true) spawnNotify(buildSoundCommands(process.platform, soundName))
    },
    onQuestion: true,
    onApproval: true,
  })
  // The actual switches are judged dynamically inside the callback from the
  // live config, so the constructor flags stay all-on.

  // The harness's typed `session/event` and `agent/status` declarations live in
  // the unpublished @deepseek-ai/dsh-session / @deepseek-ai/dsh-agent packages,
  // so register with a narrowed cast; the payload shapes are pinned
  // structurally in types.ts.
  const register = ctx.on as unknown as (
    name: string,
    listener: (...args: unknown[]) => void,
  ) => () => void
  register('session/event', (...args: unknown[]): void => {
    const session = args[0] as Session
    const event = args[1] as SessionEvent
    notifier.onSessionEvent(session, event)
    blockedNotifier.onSessionEvent(session, event)
  })
  register('agent/status', (...args: unknown[]): void => {
    notifier.onAgentStatus(args[0] as AgentStatusPayload)
  })
}

/** Whether a validated config carries volatile references rather than plain values. */
function isVolatileConfig(config: NotifyConfig & Partial<VolatileNotifyConfig>): config is NotifyConfig & VolatileNotifyConfig {
  const candidate = config as Partial<VolatileNotifyConfig>
  return typeof candidate.enabled?.get === 'function' && typeof candidate.title?.get === 'function'
}

/**
 * Validate a plainly-spelled entry config and narrow it to the fields this
 * plugin reads. A profile that mounts the plugin through a hand-written
 * `cordis.yml` bypasses the schema, so it gets the fail-loud checks the schema
 * would otherwise apply.
 * @param ctx - the plugin context, for the load-time diagnostic.
 * @param config - the entry config as composed.
 * @returns the entry config this plugin reads.
 */
function plainEntryConfig(ctx: Context, config: NotifyConfig): NotifyConfig {
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.enabled must be a boolean, got ${typeof config.enabled}`)
  }
  if (config.title !== undefined && typeof config.title !== 'string') {
    throw new Error(`dsh-notify-on-complete: config.title must be a string, got ${typeof config.title}`)
  }
  if (config.sound !== undefined && typeof config.sound !== 'boolean') {
    throw new Error(`dsh-notify-on-complete: config.sound must be a boolean, got ${typeof config.sound}`)
  }
  for (const key of ['onBlocked', 'onQuestion', 'onApproval'] as const) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') {
      throw new Error(`dsh-notify-on-complete: config.${key} must be a boolean, got ${typeof config[key]}`)
    }
  }
  if (config.quietHours !== undefined && (!Array.isArray(config.quietHours) || !config.quietHours.every((range) => typeof range === 'string'))) {
    throw new Error(`dsh-notify-on-complete: config.quietHours must be an array of strings, got ${typeof config.quietHours}`)
  }
  void ctx
  return config
}
