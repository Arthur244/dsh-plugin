/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * Pure helpers for the notify settings page: the section shape, the sound
 * options, the default layer, and the draft parsers.
 *
 * The page itself keeps its staged edits in component state (a draft is data
 * only the component knows, so it belongs to local state rather than to a
 * store). Nothing here touches the wire: writes go through the `form` owner
 * props the Plugins page supplies.
 * @module dsh-notify-on-complete/client/notify-settings
 */

/** The three sound tiers: completion, failure, and blocking interactions. */
export type SoundTier = 'completed' | 'error' | 'approval'

/** The settings section this page edits — a mirror of the host schema's shape. */
export interface NotifySection {
  enabled?: boolean
  title?: string
  /** Play a system sound alongside the notification; default `true`. */
  sound?: boolean
  /** Per-tier sound overrides; defaults in {@link DEFAULT_SOUNDS}. */
  sounds?: Partial<Record<SoundTier, string>>
  /** Quiet-hours specs "HH:MM-HH:MM" (start after end crosses midnight). */
  quietHours?: string[]
  /** Notify on blocking user-interactions (questions + approvals). */
  onBlocked?: boolean
  /** Notify when the model asks a question. */
  onQuestion?: boolean
  /** Notify when the harness waits for approval. */
  onApproval?: boolean
}

/** Default per-tier sound names (macOS system sound names), mirroring the host defaults. */
export const DEFAULT_SOUNDS: Record<SoundTier, string> = {
  completed: 'Glass',
  error: 'Sosumi',
  approval: 'Ping',
}

/**
 * macOS sound names offered by the per-tier selectors. `default` maps to each
 * platform's default chime (and on macOS means no chime — the single-tier
 * mute the README documents).
 */
export const SOUND_OPTIONS: readonly string[] = [
  'default', 'Glass', 'Sosumi', 'Ping', 'Funk',
  'Basso', 'Blow', 'Bottle', 'Frog', 'Hero',
  'Morse', 'Pop', 'Purr', 'Submarine', 'Tink',
]

/** Resolved values a field falls back to when neither the user nor the base carries it. */
export const DEFAULTS: Required<Pick<NotifySection, 'enabled' | 'title' | 'sound' | 'onBlocked' | 'onQuestion' | 'onApproval'>> & { sounds: Record<SoundTier, string> } = {
  enabled: true,
  title: 'DeepSeek Harness',
  sound: true,
  onBlocked: true,
  onQuestion: true,
  onApproval: true,
  sounds: { ...DEFAULT_SOUNDS },
}

/**
 * Parse a quiet-hours text draft ("HH:MM-HH:MM", comma separated) into the
 * stored array. An empty draft clears the field; any other draft yields the
 * trimmed, non-empty ranges in order.
 * @param text - the draft text.
 * @returns the stored array, or undefined to clear the field.
 */
export function parseQuietHours(text: string): string[] | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  return trimmed.split(',').map(part => part.trim()).filter(part => part !== '')
}

/**
 * Join a stored quiet-hours array into the text draft the control renders.
 * @param value - the stored array.
 * @returns the comma-joined draft.
 */
export function formatQuietHours(value: readonly string[] | undefined): string {
  return (value ?? []).join(', ')
}

/** Deep equality over JSON-compatible data (objects, arrays, primitives). */
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((entry, index) => deepEqualJson(entry, b[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(key => key in right && deepEqualJson(left[key], right[key]))
}

/** One staged edit for a field. */
export type StagedEdit =
  | { readonly kind: 'set'; readonly value: unknown }
  | { readonly kind: 'clear' }

/** A staged edit map, keyed by section field. */
export type StagedMap = ReadonlyMap<string, StagedEdit>

/**
 * Convert a control's draft into the value a save would store.
 * @param field - the section field.
 * @param value - the drafted value.
 * @returns the stored value, or undefined when the draft clears the field.
 */
export function toStored(field: string, value: unknown): unknown {
  if (field === 'quietHours') {
    return typeof value === 'string' ? parseQuietHours(value) : undefined
  }
  return value
}

/**
 * Resolve one field's rendered value: the staged draft when one stands,
 * otherwise the effective value from the Host, otherwise the default layer.
 * @param field - the section field.
 * @param section - the effective section the Host resolved.
 * @param staged - this page's staged edits.
 * @param resolve - narrows a raw value to the field's type, or falls back to the default.
 * @returns the value the control renders.
 */
export function fieldValue<V>(
  field: string,
  section: NotifySection | undefined,
  staged: StagedMap,
  resolve: (value: unknown) => V,
): V {
  const edit = staged.get(field)
  if (edit === undefined) return resolve(section?.[field as keyof NotifySection])
  if (edit.kind === 'clear') return resolve(undefined)
  return resolve(edit.value)
}

/**
 * Whether saving would leave a user-layer override for one field.
 * @param field - the section field.
 * @param user - the raw user layer the Host reported.
 * @param staged - this page's staged edits.
 * @returns true when the field carries — or a save would leave — an override.
 */
export function fieldOverridden(field: string, user: unknown, staged: StagedMap): boolean {
  const edit = staged.get(field)
  if (edit !== undefined) return edit.kind === 'set'
  if (typeof user !== 'object' || user === null || Array.isArray(user)) return false
  return Object.hasOwn(user, field)
}
