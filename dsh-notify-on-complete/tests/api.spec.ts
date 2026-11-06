/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from 'vitest'
import { createNotifyApiHandler } from '../src/api.js'

/** One descriptor the fake settings service serves. */
interface Descriptor {
  ns: string
  value?: unknown
  base?: unknown
  user?: unknown
}

/** Fake settings service capturing describe calls. */
function fakeSettings(descriptors: Descriptor[]) {
  return {
    writable: true,
    describe: vi.fn(() => descriptors),
  }
}

/** Minimal ctx face the handler reads. */
function fakeCtx(settings: ReturnType<typeof fakeSettings> | undefined) {
  return { get: (name: string) => (name === 'settings' ? settings : undefined) } as never
}

/** Capture writeHead/end calls. */
function fakeRes() {
  const calls: Array<{ status?: number; body?: string }> = []
  return {
    calls,
    writeHead(status: number) { calls.push({ status }) },
    end(body: string) { calls.push({ body }) },
  } as never
}

/** Build a fake IncomingMessage. */
function fakeReq(method: string, url: string) {
  return { method, url } as never
}

function lastBody(res: { calls: Array<{ status?: number; body?: string }> }): { status: number; body: unknown } {
  const status = res.calls.find(call => call.status !== undefined)?.status ?? 0
  const body = res.calls.filter(call => call.body !== undefined).map(call => call.body).join('')
  return { status, body: JSON.parse(body || '{}') }
}

describe('createNotifyApiHandler', () => {
  it('serves the notify-on-complete config on GET', async () => {
    const settings = fakeSettings([
      { ns: 'notify-on-complete', value: { sound: false }, base: { sound: true }, user: { sound: false } },
      { ns: 'shell' },
    ])
    const handler = createNotifyApiHandler(fakeCtx(settings))
    const res = fakeRes()
    await handler(fakeReq('GET', '/notify-on-complete/api/config'), res)
    const { status, body } = lastBody(res)
    expect(status).toBe(200)
    expect(body).toEqual({
      value: { sound: false },
      base: { sound: true },
      user: { sound: false },
      writable: true,
    })
    expect(settings.describe).toHaveBeenCalledWith({ redactSecrets: true })
  })

  it('404s when the namespace is not registered', async () => {
    const settings = fakeSettings([{ ns: 'shell' }])
    const handler = createNotifyApiHandler(fakeCtx(settings))
    const res = fakeRes()
    await handler(fakeReq('GET', '/notify-on-complete/api/config'), res)
    expect(lastBody(res).status).toBe(404)
  })

  it('refuses writes: they go through the settings Remote namespace', async () => {
    // The card writes through `ctx.remote.settings`, which fences every write
    // with the revision the editor read. A second write path here would bypass
    // that fence, so the route answers 405 instead of mutating.
    const settings = fakeSettings([{ ns: 'notify-on-complete' }])
    const handler = createNotifyApiHandler(fakeCtx(settings))
    const res = fakeRes()
    await handler(fakeReq('POST', '/notify-on-complete/api/config'), res)
    expect(lastBody(res).status).toBe(405)
  })

  it('503s without a settings service', async () => {
    const handler = createNotifyApiHandler(fakeCtx(undefined))
    const res = fakeRes()
    await handler(fakeReq('GET', '/notify-on-complete/api/config'), res)
    expect(lastBody(res).status).toBe(503)
  })

  it('404s on unknown actions', async () => {
    const settings = fakeSettings([{ ns: 'notify-on-complete' }])
    const handler = createNotifyApiHandler(fakeCtx(settings))
    const res = fakeRes()
    await handler(fakeReq('GET', '/notify-on-complete/api/other'), res)
    expect(lastBody(res).status).toBe(404)
  })
})
