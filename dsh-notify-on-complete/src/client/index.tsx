/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * The notify-on-complete settings page, browser half.
 *
 * DSH 0.2.2 retired the `settings.plugin.item` slot this card used to register
 * into, together with the per-namespace settings scope it read through. The
 * configuration of a bundle's row now lives on the Plugins page, in the
 * `plugins.row.config` slot keyed by `<package name>#<row id>`; the values and
 * write actions arrive as owner props (`form`), backed by the shared
 * `ctx.configForms` service. The card therefore owns its controls and copy
 * only — it opens no route of its own and needs no settings scope.
 * @module dsh-notify-on-complete/client
 */

import { createElement } from 'react'
import { NotifyCard, type NotifyCardProps } from './NotifyCard.js'
import { NOTIFY_CSS } from './styles.js'

export const name = 'dsh-notify-on-complete'

/** Package name the row belongs to; the first half of the slot key. */
const PACKAGE_NAME = 'dsh-notify-on-complete'

/**
 * Row id the bundle patch mounts (`- id: notify-on-complete`). The slot key is
 * `<package name>#<row id>`; the same string is the settings namespace the
 * Host describes, so the three spellings must not drift.
 */
const ROW_ID = 'notify-on-complete'

/** The `plugins.row.config` key this card registers under. */
const ROW_CONFIG_KEY = `${PACKAGE_NAME}#${ROW_ID}`

/** Required services (cordis fiber inject): the slots registry only. */
export const inject = ['slots']

/** Minimal client slots face. */
interface SlotsService {
  inject(key: string, callback: () => () => void): () => void
  register(options: {
    name: string
    /** Keyed slots dispatch by key: `<package name>#<row id>`. */
    key: string
    order?: number
    label?: string | (() => string)
    inject?: () => unknown
  }, render: (props: unknown) => unknown): () => void
}

/** Minimal client context face. */
interface ClientContext {
  get(name: string): unknown
  effect(callback: () => void | (() => void), label?: string): void
  slots: SlotsService
}

let stylesInjected = false

/** Inject the card styles once per page; idempotent across re-activation. */
function ensureStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return
  stylesInjected = true
  if (document.getElementById('dsh-notify-on-complete-css') !== null) return
  const element = document.createElement('style')
  element.id = 'dsh-notify-on-complete-css'
  element.textContent = NOTIFY_CSS
  document.head.appendChild(element)
}

/**
 * Client plugin body.
 * @param ctx - the client plugin context.
 */
export function apply(ctx: ClientContext): void {
  ensureStyles()
  const slots = ctx.get('slots') as SlotsService | undefined
  if (slots === undefined) return
  // The page supplies `form` (values plus write actions) as owner props on
  // every render, so the card renders straight from that share and keeps its
  // staged drafts in component state.
  ctx.effect(
    () => slots.inject('plugins.row.config', () => slots.register(
      { name: 'plugins.row.config', key: ROW_CONFIG_KEY, order: 30 },
      (props) => createElement(NotifyCard, props as NotifyCardProps),
    )),
    'dsh-notify-on-complete: row settings page',
  )
}
