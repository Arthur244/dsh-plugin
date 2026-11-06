/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULTS,
  deepEqualJson,
  fieldOverridden,
  fieldValue,
  formatQuietHours,
  parseQuietHours,
  toStored,
  type NotifySection,
  type StagedMap,
} from '../src/client/notify-settings.js'

describe('parseQuietHours / formatQuietHours', () => {
  it('splits a comma-joined draft into trimmed ranges', () => {
    expect(parseQuietHours(' 22:00-08:00 , 12:00-13:00 ')).toEqual(['22:00-08:00', '12:00-13:00'])
  })

  it('treats a blank draft as a clear', () => {
    expect(parseQuietHours('   ')).toBeUndefined()
  })

  it('drops empty entries between commas', () => {
    expect(parseQuietHours('22:00-08:00,,')).toEqual(['22:00-08:00'])
  })

  it('renders an absent array as an empty draft', () => {
    expect(formatQuietHours(undefined)).toBe('')
    expect(formatQuietHours(['22:00-08:00'])).toBe('22:00-08:00')
  })
})

describe('deepEqualJson', () => {
  it('compares nested JSON data structurally', () => {
    expect(deepEqualJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(deepEqualJson({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false)
    expect(deepEqualJson([1, 2], [1, 2, 3])).toBe(false)
    expect(deepEqualJson(null, null)).toBe(true)
  })

  it('distinguishes objects from arrays of the same length', () => {
    expect(deepEqualJson({}, [])).toBe(false)
  })
})

describe('toStored', () => {
  it('parses quiet hours from their text draft', () => {
    expect(toStored('quietHours', '22:00-08:00')).toEqual(['22:00-08:00'])
    expect(toStored('quietHours', '')).toBeUndefined()
  })

  it('passes every other field through untouched', () => {
    expect(toStored('sound', false)).toBe(false)
    expect(toStored('sounds', { completed: 'Funk' })).toEqual({ completed: 'Funk' })
  })
})

describe('fieldValue', () => {
  const noStaged: StagedMap = new Map()

  it('resolves the effective value when nothing is staged', () => {
    expect(fieldValue('title', { title: 'from host' }, noStaged, value => typeof value === 'string' ? value : 'fallback'))
      .toBe('from host')
  })

  it('falls back when the section carries nothing', () => {
    expect(fieldValue('title', undefined, noStaged, value => typeof value === 'string' ? value : DEFAULTS.title))
      .toBe(DEFAULTS.title)
  })

  it('prefers a staged set over the effective value', () => {
    const staged: StagedMap = new Map([['title', { kind: 'set' as const, value: 'draft' }]])
    expect(fieldValue('title', { title: 'from host' }, staged, value => typeof value === 'string' ? value : ''))
      .toBe('draft')
  })

  it('renders the default layer for a staged clear', () => {
    const staged: StagedMap = new Map([['title', { kind: 'clear' as const }]])
    expect(fieldValue('title', { title: 'from host' }, staged, value => typeof value === 'string' ? value : DEFAULTS.title))
      .toBe(DEFAULTS.title)
  })
})

describe('fieldOverridden', () => {
  it('marks a field the user layer carries', () => {
    expect(fieldOverridden('sound', { sound: false }, new Map())).toBe(true)
    expect(fieldOverridden('sound', { title: 'x' }, new Map())).toBe(false)
  })

  it('marks a staged set as an override and a staged clear as not', () => {
    expect(fieldOverridden('sound', {}, new Map([['sound', { kind: 'set' as const, value: true }]]))).toBe(true)
    expect(fieldOverridden('sound', { sound: false }, new Map([['sound', { kind: 'clear' as const }]]))).toBe(false)
  })

  it('treats an absent or malformed user layer as no overrides', () => {
    expect(fieldOverridden('sound', undefined, new Map())).toBe(false)
    expect(fieldOverridden('sound', [], new Map())).toBe(false)
    expect(fieldOverridden('sound', 'nope', new Map())).toBe(false)
  })
})

describe('DEFAULTS', () => {
  it('mirrors the host schema defaults', () => {
    const section: NotifySection = {
      enabled: DEFAULTS.enabled,
      title: DEFAULTS.title,
      sound: DEFAULTS.sound,
      sounds: DEFAULTS.sounds,
      onBlocked: DEFAULTS.onBlocked,
      onQuestion: DEFAULTS.onQuestion,
      onApproval: DEFAULTS.onApproval,
    }
    expect(section).toEqual({
      enabled: true,
      title: 'DeepSeek Harness',
      sound: true,
      sounds: { completed: 'Glass', error: 'Sosumi', approval: 'Ping' },
      onBlocked: true,
      onQuestion: true,
      onApproval: true,
    })
  })
})
