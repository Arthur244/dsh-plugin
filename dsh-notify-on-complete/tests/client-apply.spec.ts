/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
// Client entry apply: the page registers twice, and both keys are
// plugin-load contracts rather than rendering details.
//
//  - `settings.section` puts the page in the settings panel beside General and
//    Models, which is where this plugin's configuration belongs. Its `id`
//    names the navigation row and must equal the settings namespace, because
//    the shell resolves the Host form by that id.
//  - `plugins.row.config` keeps the same page on the Plugins page, keyed by
//    `<package name>#<row id>`. A keyed slot rejects a keyless registration at
//    load, and the row id is the same settings namespace.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.tsx'

type ClientContext = Parameters<typeof apply>[0]

interface RegisterOptions {
  name: string
  key?: string
  id?: string
  order?: number
  label?: string | (() => string)
  inject?: () => unknown
  children?: Record<string, unknown>
}

/** A minimal slots/context fake capturing every register call. */
function harness(): { ctx: ClientContext; registered: RegisterOptions[] } {
  const registered: RegisterOptions[] = []
  const slots = {
    inject: (_key: string, register: () => () => void) => register(),
    register: (options: RegisterOptions) => {
      registered.push(options)
      return () => {}
    },
  }
  return {
    ctx: {
      get: () => slots,
      effect: (callback: () => void | (() => void)) => { callback() },
    },
    registered,
  }
}

describe('client entry apply', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('registers the page as a settings section and as the bundle row configuration', () => {
    const { ctx, registered } = harness()
    apply(ctx)
    expect(registered).toHaveLength(2)

    const section = registered.find(entry => entry.name === 'settings.section')
    expect(section).toBeDefined()
    expect(section).toMatchObject({
      // The navigation row id is the settings namespace the Host describes.
      id: 'notify-on-complete',
      order: 40,
    })
    // A settings section is a list slot: `key` belongs to keyed slots only.
    expect(section?.key).toBeUndefined()
    expect(typeof section?.label === 'function' ? section.label() : section?.label).toBe('运行完成通知')

    const row = registered.find(entry => entry.name === 'plugins.row.config')
    expect(row).toBeDefined()
    expect(row).toMatchObject({
      // The Plugins page dispatches a row's page by `<package name>#<row id>`.
      key: 'dsh-notify-on-complete#notify-on-complete',
      order: 30,
    })
    // `id` names list-slot entries; keyed slots dispatch by `key` instead.
    expect(row?.id).toBeUndefined()
  })
})
