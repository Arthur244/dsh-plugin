/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * Settings schema and live-config reads for the notify plugin.
 *
 * DSH 0.2.2 removed the standalone `settingsNamespace()` /
 * `installSettingsSection()` helpers this plugin was built against. The
 * replacement has no separate registration step: a settings namespace IS a
 * profile plugin entry id, and `ctx.settings` (`SettingsForms`) describes an
 * entry exactly when its `Config` schema carries at least one volatile field.
 * Volatile values are references the Loader swaps in place on every committed
 * write, so a plugin reads its current config through them instead of
 * re-reading a settings scope.
 *
 * @module dsh-notify-on-complete/settings
 */
import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { NotifyConfig } from './types.js'

/**
 * Settings namespace of this plugin: the profile entry id the bundle patch
 * mounts (`- id: notify-on-complete` in `cordis.patch.yml`). The Plugins page
 * keys a row's configuration slot by `<package name>#<row id>`, and the Host
 * resolves the settings namespace by that same row id, so the two spellings
 * must not drift.
 */
export const NOTIFY_SETTINGS_NAMESPACE = 'notify-on-complete'

/** The three sound tiers, resolved. */
export interface ResolvedSounds {
  completed: string
  error: string
  approval: string
}

/**
 * Declarative settings schema. Every field is volatile: `SettingsForms.describe()`
 * skips an entry with no volatile field, so a non-volatile one would leave the
 * card with no namespace to read and no write it could make.
 */
export const NotifySettingsSchema = Schema.object({
  enabled: Schema.boolean().default(true).volatile(),
  title: Schema.string().default('DeepSeek Harness').volatile(),
  sound: Schema.boolean().default(true).volatile(),
  sounds: Schema.object({
    completed: Schema.string().default('Glass'),
    error: Schema.string().default('Sosumi'),
    approval: Schema.string().default('Ping'),
  }).default({ completed: 'Glass', error: 'Sosumi', approval: 'Ping' }).volatile(),
  quietHours: Schema.array(Schema.string()).default([]).volatile(),
  onBlocked: Schema.boolean().default(true).volatile(),
  onQuestion: Schema.boolean().default(true).volatile(),
  onApproval: Schema.boolean().default(true).volatile(),
})

/**
 * The config the plugin's `apply` receives: each field is a volatile reference
 * whose identity outlives every settings write.
 */
export interface VolatileNotifyConfig {
  readonly enabled: { get(): boolean | undefined }
  readonly title: { get(): string | undefined }
  readonly sound: { get(): boolean | undefined }
  readonly sounds: { get(): Partial<ResolvedSounds> | undefined }
  readonly quietHours: { get(): string[] | undefined }
  readonly onBlocked: { get(): boolean | undefined }
  readonly onQuestion: { get(): boolean | undefined }
  readonly onApproval: { get(): boolean | undefined }
}

/**
 * Read the effective config for one event.
 *
 * The volatile references hold what the settings document resolved (schema
 * defaults over the composition entry), so a panel edit is visible on the very
 * next notification without a restart. A field the document never supplied
 * falls back to the entry config from the bundle patch.
 * @param live - the volatile config, when the plugin received a schema-validated one.
 * @param fallback - the plain entry config the bundle patch declares.
 * @returns the config the notification paths read.
 */
export function readLiveConfig(live: VolatileNotifyConfig | undefined, fallback: NotifyConfig): NotifyConfig {
  if (live === undefined) return fallback
  const quietHours = live.quietHours.get()
  return {
    enabled: live.enabled.get() ?? fallback.enabled,
    title: live.title.get() ?? fallback.title,
    sound: live.sound.get() ?? fallback.sound,
    sounds: { ...fallback.sounds, ...live.sounds.get() },
    quietHours: quietHours ?? fallback.quietHours,
    onBlocked: live.onBlocked.get() ?? fallback.onBlocked,
    onQuestion: live.onQuestion.get() ?? fallback.onQuestion,
    onApproval: live.onApproval.get() ?? fallback.onApproval,
  }
}

/**
 * Mark the plugin's settings page as plugin-owned, so the Plugins page does
 * not also generate a generic form over the same namespace beside the card
 * this package registers.
 * @param ctx - the plugin context.
 */
export function configureSettingsPresentation(ctx: Context): void {
  ctx.inject(['settings'], (scope) => {
    const settings = scope.get('settings') as {
      configure?: (presentation: { auto?: boolean }, owner?: unknown) => () => void
    } | undefined
    if (settings?.configure === undefined) return
    scope.effect(
      () => settings.configure?.({ auto: false }, ctx.fiber) ?? (() => undefined),
      'dsh-notify-on-complete: settings presentation',
    )
  })
}
