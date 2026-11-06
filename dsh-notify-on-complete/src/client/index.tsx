/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * The notify-on-complete settings page, browser half.
 *
 * DSH 0.2.2 keeps plugin configuration on the Plugins page, but this plugin's
 * configuration belongs in the settings panel beside General and Models. It
 * registers its own `settings.section`, so the settings shell owns the
 * navigation row, the modal chrome, and the panel column; the page renders one
 * column of controls.
 *
 * A settings section receives no owner data (its only owner prop is `close`),
 * so the page binds its Host section through `ctx.configForms.get(namespace)`
 * — the same shared form service every built-in page uses. That service is the
 * one source of values, revision fencing, and the write path.
 *
 * Every control comes from `@deepseek-ai/dsh-client-ui-primitives`, the
 * shell's shared module-table entry. That is what keeps the page in step with
 * the rest of the application: the primitives read `--dsw-alias-*` semantic
 * tokens, so light and dark follow the resolved theme automatically, and the
 * control geometry, focus ring, hairline separators, and typography are the
 * same ones the built-in pages use.
 * @module dsh-notify-on-complete/client
 */

import { createElement } from 'react'
import { NotifySettingsPage, type NotifyForm, type NotifyPageFace } from './NotifyCard.js'
import { NOTIFY_CSS } from './styles.js'

export const name = 'dsh-notify-on-complete'

/** Package name the row belongs to; the first half of the row config key. */
const PACKAGE_NAME = 'dsh-notify-on-complete'

/**
 * Row id the bundle patch mounts (`- id: notify-on-complete`). The same string
 * is the settings namespace the Host describes and the second half of the
 * `plugins.row.config` key, so the three spellings must not drift.
 */
const ROW_ID = 'notify-on-complete'

/** The `plugins.row.config` key the Plugins-page entry registers under. */
const ROW_CONFIG_KEY = `${PACKAGE_NAME}#${ROW_ID}`

/** Navigation row order: after the host-plane pages, before the plugin inventory. */
const SECTION_ORDER = 40

/** Required services (cordis fiber inject): the slots registry and the settings forms. */
export const inject = ['slots', 'configForms']

/** One Host section's form, as `ctx.configForms.get()` returns it. */
interface ConfigForm<T> {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value: T | undefined
    base: unknown
    user: unknown
    revision: number | undefined
    writable: boolean
  }
  subscribe(listener: () => void): () => void
  mutate(ops: readonly { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }[], expectedRevision?: number): Promise<boolean>
}

/** The `configForms` service face this page reads. */
interface ConfigFormsService {
  get<T>(entryId: string): ConfigForm<T>
}

/** Minimal client slots face. */
interface SlotsService {
  inject(key: string, callback: () => () => void): () => void
  register(options: {
    name: string
    id?: string
    key?: string
    order?: number
    label?: string | (() => string)
    inject?: () => unknown
    children?: Record<string, { kind: 'list' | 'keyed' | 'single'; scope: 'root' }>
  }, render: (props: unknown) => unknown): () => void
}

/** Minimal client context face. */
interface ClientContext {
  get(name: string): unknown
  effect(callback: () => void | (() => void), label?: string): void
  slots: SlotsService
  configForms?: ConfigFormsService
}

let stylesInjected = false

/** Inject the page styles once per page; idempotent across re-activation. */
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
 * Adapt one shared config form onto the page's form share.
 *
 * `ctx.configForms.get()` hands back a form object (snapshot reader,
 * subscription, and the mutation queue); the page renders from a snapshot plus
 * that mutation, so this binds the two. The page subscribes through React: the
 * snapshot is read on every render, and `subscribe` is kept on the face so a
 * remount picks up changes made elsewhere.
 * @param form - the shared form for this namespace.
 * @returns the page's form share.
 */
function adaptForm(form: ConfigForm<Record<string, unknown>>): NotifyForm {
  return {
    get state() { return form.getSnapshot() },
    mutate: (ops, revision) => form.mutate(ops, revision),
    subscribe: listener => form.subscribe(listener),
  }
}

/**
 * Build the inject face one registration supplies to the page.
 * @param forms - the shared config-forms service.
 * @returns the page's form, or an empty face when the service is absent.
 */
function pageFace(forms: ConfigFormsService | undefined): NotifyPageFace {
  if (forms === undefined) return {}
  return { form: adaptForm(forms.get<Record<string, unknown>>(ROW_ID)) }
}

/**
 * Client plugin body.
 * @param ctx - the client plugin context.
 */
export function apply(ctx: ClientContext): void {
  ensureStyles()
  const slots = ctx.get('slots') as SlotsService | undefined
  if (slots === undefined) return
  const forms = (ctx.configForms ?? ctx.get('configForms')) as ConfigFormsService | undefined

  // The primary entry: a settings panel page of this plugin's own, registered
  // into the settings shell exactly like the built-in host-plane pages. A
  // section owns no data of its own, so the form arrives through `inject`.
  ctx.effect(
    () => slots.inject('settings.section', () => slots.register(
      {
        name: 'settings.section',
        id: ROW_ID,
        order: SECTION_ORDER,
        label: () => '运行完成通知',
        inject: () => pageFace(forms),
      },
      (props) => createElement(NotifySettingsPage, props as never),
    )),
    'dsh-notify-on-complete: settings section',
  )

  // The secondary entry: the same page on the Plugins page, where a bundle's
  // row configuration lives on DSH 0.2.2. That slot passes `form` as an owner
  // prop, so the page receives it either way.
  ctx.effect(
    () => slots.inject('plugins.row.config', () => slots.register(
      { name: 'plugins.row.config', key: ROW_CONFIG_KEY, order: 30 },
      (props) => createElement(NotifySettingsPage, props as never),
    )),
    'dsh-notify-on-complete: row settings page',
  )
}
