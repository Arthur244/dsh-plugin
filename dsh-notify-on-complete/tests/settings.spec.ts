/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from 'vitest'
import { NotifySettingsSchema } from '../src/settings.js'
import { readLiveConfig } from '../src/settings.js'
import type { NotifyConfig } from '../src/types.js'

/** A volatile reference over a fixed value, as the Loader hands one to `apply`. */
function ref<T>(value: T): { get(): T } {
  return { get: () => value }
}

describe('NotifySettingsSchema', () => {
  it('resolves defaults for an empty document, unwrapping volatile references', () => {
    const resolved = NotifySettingsSchema({}) as Record<string, { get(): unknown }>
    expect({
      enabled: resolved['enabled']?.get(),
      title: resolved['title']?.get(),
      sound: resolved['sound']?.get(),
      sounds: resolved['sounds']?.get(),
      quietHours: resolved['quietHours']?.get(),
      onBlocked: resolved['onBlocked']?.get(),
      onQuestion: resolved['onQuestion']?.get(),
      onApproval: resolved['onApproval']?.get(),
    }).toEqual({
      enabled: true,
      title: 'DeepSeek Harness',
      sound: true,
      sounds: { completed: 'Glass', error: 'Sosumi', approval: 'Ping' },
      quietHours: [],
      onBlocked: true,
      onQuestion: true,
      onApproval: true,
    })
  })

  it('overlays user fields over the defaults', () => {
    const resolved = NotifySettingsSchema({ sound: false, quietHours: ['23:00-08:00'] }) as Record<string, { get(): unknown }>
    expect(resolved['sound']?.get()).toBe(false)
    expect(resolved['quietHours']?.get()).toEqual(['23:00-08:00'])
    expect(resolved['title']?.get()).toBe('DeepSeek Harness')
  })

  it('rejects a non-boolean sound', () => {
    expect(() => NotifySettingsSchema({ sound: 1 as never })).toThrow()
  })

  it('marks every field volatile so the settings panel can list the entry', () => {
    // `SettingsForms.describe()` skips an entry whose schema carries no
    // volatile field; a non-volatile one would leave the card with no
    // namespace to read and no write it could make.
    const schema = NotifySettingsSchema as unknown as { dict: Record<string, { meta: { volatile?: boolean } }> }
    for (const [field, node] of Object.entries(schema.dict)) {
      expect(node.meta.volatile, `${field} must be volatile`).toBe(true)
    }
  })
})

describe('readLiveConfig', () => {
  const entry: NotifyConfig = { enabled: true, title: 'Entry Title', sound: false, quietHours: ['01:00-02:00'] }

  it('returns the entry config when the plugin received no volatile references', () => {
    expect(readLiveConfig(undefined, entry)).toEqual(entry)
  })

  it('reads every field through its volatile reference', () => {
    const config = readLiveConfig({
      enabled: ref(false),
      title: ref('Live Title'),
      sound: ref(true),
      sounds: ref({ completed: 'Funk' }),
      quietHours: ref(['22:00-08:00']),
      onBlocked: ref(false),
      onQuestion: ref(false),
      onApproval: ref(false),
    }, entry)
    expect(config).toMatchObject({
      enabled: false,
      title: 'Live Title',
      sound: true,
      quietHours: ['22:00-08:00'],
      onBlocked: false,
      onQuestion: false,
      onApproval: false,
    })
    // Unset tiers keep the entry's sounds instead of disappearing.
    expect(config.sounds).toMatchObject({ completed: 'Funk' })
  })

  it('falls back per field when a volatile reference reads undefined', () => {
    const config = readLiveConfig({
      enabled: ref(undefined),
      title: ref(undefined),
      sound: ref(undefined),
      sounds: ref(undefined),
      quietHours: ref(undefined),
      onBlocked: ref(undefined),
      onQuestion: ref(undefined),
      onApproval: ref(undefined),
    }, entry)
    expect(config.enabled).toBe(entry.enabled)
    expect(config.title).toBe('Entry Title')
    expect(config.sound).toBe(false)
    expect(config.quietHours).toEqual(['01:00-02:00'])
  })
})
