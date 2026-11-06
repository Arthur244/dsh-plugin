/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
// Client entry apply: the settings page registers into the keyed
// `plugins.row.config` slot under `<package name>#<row id>`. The slot registry
// rejects a keyless keyed registration at load, and the Plugins page dispatches
// a row's page by exactly that key, so the key this spec locks is the
// plugin-load contract — not just a rendering detail.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.tsx'

type ClientContext = Parameters<typeof apply>[0]

interface RegisterOptions {
  name: string
  key?: string
  id?: string
  order?: number
  inject?: () => unknown
}

/** A minimal slots/context fake capturing one register call. */
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

  it('registers the settings page keyed by package name and row id', () => {
    const { ctx, registered } = harness()
    apply(ctx)
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      name: 'plugins.row.config',
      // The Plugins page keys a row's page by `<package name>#<row id>`, and
      // the row id must match the entry id the bundle patch mounts, because
      // that same string is the settings namespace.
      key: 'dsh-notify-on-complete#notify-on-complete',
      order: 30,
    })
    // `id` names list-slot entries; keyed slots dispatch by `key` instead.
    expect(registered[0].id).toBeUndefined()
  })
})
