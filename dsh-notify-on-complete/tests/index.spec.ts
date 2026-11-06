/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'

const mockChild = vi.hoisted(() => {
  const children: Array<{ unref: ReturnType<typeof vi.fn>; errorHandlers: Array<(e: NodeJS.ErrnoException) => void> }> = []
  return {
    children,
    makeChild: () => {
      const child = { unref: vi.fn(), errorHandlers: [] as Array<(e: NodeJS.ErrnoException) => void> }
      children.push(child)
      return {
        once: vi.fn((event: string, handler: (error: unknown) => void) => {
          if (event === 'error') child.errorHandlers.push(handler as (e: NodeJS.ErrnoException) => void)
        }),
        unref: child.unref,
      }
    },
  }
})

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockChild.makeChild()),
}))

import { apply } from '../src/index.js'
import type { NotifyConfig } from '../src/types.js'

const mockedSpawn = vi.mocked(spawn)

interface MockCtx {
  logger: { warn: ReturnType<typeof vi.fn> }
  on: ReturnType<typeof vi.fn>
  inject: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  effect: ReturnType<typeof vi.fn>
  emit: (name: string, ...args: unknown[]) => void
  fiber: { state: number }
}

function mockCtx(): MockCtx {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const ctx: MockCtx = {
    logger: { warn: vi.fn() },
    on: vi.fn((name: string, listener: (...args: unknown[]) => void) => {
      const arr = listeners.get(name) ?? []
      arr.push(listener)
      listeners.set(name, arr)
      return () => undefined
    }),
    // No settings service ever mounts in most tests: the injection callback
    // never fires, so the entry config stands — the fallback path, verbatim.
    inject: vi.fn(),
    // No webServer in unit tests: the settings API route is skipped.
    get: vi.fn(() => undefined),
    effect: vi.fn(),
    emit: (name: string, ...args: unknown[]) => {
      for (const listener of listeners.get(name) ?? []) listener(...args)
    },
    // Cordis fiber state; 0 = active (the dsh-settings wiring reads it to
    // skip work during plugin teardown).
    fiber: { state: 0 },
  }
  return ctx
}

function rootTurnEnd(kind: string): unknown[] {
  return [{ header: { id: 'root' } }, { type: 'turn/end', data: { turn: 1, reason: { kind } } }]
}

function subagentTurnEnd(kind: string): unknown[] {
  return [{ header: { id: 'child', origin: 'subagent' } }, { type: 'turn/end', data: { turn: 1, reason: { kind } } }]
}

function idleRoot(): unknown[] {
  return [{ status: 'idle', agent: { id: 'root', session: { header: { id: 'root' } } } }]
}

function idleSubagent(): unknown[] {
  return [{ status: 'idle', agent: { id: 'child', session: { header: { id: 'child', origin: 'subagent' } } } }]
}

function rootToolCall(name: string, args = '{}'): unknown[] {
  return [{ header: { id: 'root' } }, { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name, arguments: args } }]
}

function rootApprovalAsked(toolName: string, reason?: string): unknown[] {
  return [{ header: { id: 'root' } }, { type: 'approval/asked', data: { id: 'a1', toolName, ...(reason === undefined ? {} : { reason }) } }]
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

afterEach(() => {
  mockedSpawn.mockClear()
  mockChild.children.length = 0
  Object.defineProperty(process, 'platform', originalPlatform!)
})

describe('apply', () => {
  it('registers both listeners and notifies once per run on a supported platform', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { title: 'T' })

    expect(ctx.on).toHaveBeenCalledWith('session/event', expect.any(Function))
    expect(ctx.on).toHaveBeenCalledWith('agent/status', expect.any(Function))

    // A multi-turn run: two rounds end, then the agent returns to idle.
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('agent/status', ...idleRoot())

    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn).toHaveBeenCalledWith('osascript', [
      '-e',
      'display notification "任务已完成 (session: root)" with title "T" sound name "Glass"',
    ], { stdio: 'ignore', windowsHide: true })
  })

  it('reports the failing kind of the last turn end-to-end', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('session/event', ...rootTurnEnd('error'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('任务失败 (session: root)')
  })

  it('maps unknown kinds to the generic end text end-to-end', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...rootTurnEnd('blocked'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('任务结束 (session: root)')
  })

  it('never notifies subagent sessions end-to-end', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...subagentTurnEnd('completed'))
    ctx.emit('agent/status', ...idleSubagent())
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it('does not notify without a turn ending even when the agent idles', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it('registers nothing when disabled', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { enabled: false })
    expect(ctx.on).not.toHaveBeenCalled()
  })

  it('fails loud on a non-boolean enabled', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    expect(() => apply(ctx, { enabled: 1 as unknown as boolean })).toThrow(/config\.enabled must be a boolean/)
  })

  it('fails loud on a non-string title', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    expect(() => apply(ctx, { title: 1 as unknown as NotifyConfig['title'] })).toThrow(/config\.title must be a string/)
  })

  it('skips unsupported platforms with a warning instead of registering', () => {
    setPlatform('freebsd')
    const ctx = mockCtx()
    expect(() => apply(ctx)).not.toThrow()
    expect(ctx.on).not.toHaveBeenCalled()
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('unsupported platform'))
  })

  it('spawns the Linux sound command in addition to the notification', () => {
    setPlatform('linux')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn).toHaveBeenCalledTimes(2)
    expect(mockedSpawn.mock.calls[1]![0]).toBe('canberra-gtk-play')
  })

  it('skips the sound when config.sound is false', () => {
    setPlatform('linux')
    const ctx = mockCtx()
    apply(ctx, { sound: false })
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn.mock.calls[0]![0]).toBe('notify-send')
  })

  it('fails loud on a non-boolean sound', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    expect(() => apply(ctx, { sound: 1 as unknown as NotifyConfig['sound'] })).toThrow(/config\.sound must be a boolean/)
  })

  it('notifies immediately on an ask_user_question tool call', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...rootToolCall('ask_user_question', '{"questions":[{"question":"要如何？"}]}'))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('需要回答：要如何？ (session: root)')
  })

  it('notifies immediately on an approval/asked event', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...rootApprovalAsked('bash', 'escalate sandbox'))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('需要批准：bash — escalate sandbox (session: root)')
  })

  it('does not notify blocked events for subagent sessions', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', { header: { id: 'child', origin: 'subagent' } }, { type: 'tool/call', data: { name: 'ask_user_question', arguments: '{}' } })
    expect(mockedSpawn).not.toHaveBeenCalled()
  })

  it('disables blocked notifications when onBlocked is false', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { onBlocked: false })
    ctx.emit('session/event', ...rootToolCall('ask_user_question', '{"questions":[{"question":"x"}]}'))
    ctx.emit('session/event', ...rootApprovalAsked('bash'))
    expect(mockedSpawn).not.toHaveBeenCalled()
    // The master switch scopes only to blocked notifications: run-ended still fires.
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('任务已完成 (session: root)')
  })

  it('fires a blocked notification and a run-ended notification without interfering', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    ctx.emit('session/event', ...rootToolCall('ask_user_question', '{"questions":[{"question":"要如何？"}]}'))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn).toHaveBeenCalledTimes(2)
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('需要回答：要如何？')
    expect(mockedSpawn.mock.calls[1]![1]!.join(' ')).toContain('任务已完成')
  })

  it('includes the session title in both run-ended and blocked bodies', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx)
    // DSH 0.2.2 removed the `events` array; the log is read through `snapshotEvents()`.
    const session = { header: { id: 'root' }, snapshotEvents: () => [{ type: 'session/title', data: { title: '修复登录bug' } }] }
    ctx.emit('session/event', session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    ctx.emit('agent/status', { status: 'idle', agent: { id: 'root', session } })
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('任务已完成 — 修复登录bug (session: root)')
    ctx.emit('session/event', session, { type: 'tool/call', data: { name: 'ask_user_question', arguments: '{"questions":[{"question":"要如何？"}]}' } })
    expect(mockedSpawn.mock.calls[1]![1]!.join(' ')).toContain('需要回答：要如何？ — 修复登录bug (session: root)')
  })

  it('disables only questions when onQuestion is false', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { onQuestion: false })
    ctx.emit('session/event', ...rootToolCall('ask_user_question', '{"questions":[{"question":"x"}]}'))
    expect(mockedSpawn).not.toHaveBeenCalled()
    ctx.emit('session/event', ...rootApprovalAsked('bash'))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
  })

  it('disables only approvals when onApproval is false', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { onApproval: false })
    ctx.emit('session/event', ...rootApprovalAsked('bash'))
    expect(mockedSpawn).not.toHaveBeenCalled()
    ctx.emit('session/event', ...rootToolCall('ask_user_question', '{"questions":[{"question":"x"}]}'))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
  })

  it('fails loud on non-boolean onBlocked/onQuestion/onApproval', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    expect(() => apply(ctx, { onBlocked: 1 as unknown as NotifyConfig['onBlocked'] })).toThrow(/config\.onBlocked must be a boolean/)
    expect(() => apply(ctx, { onQuestion: 1 as unknown as NotifyConfig['onQuestion'] })).toThrow(/config\.onQuestion must be a boolean/)
    expect(() => apply(ctx, { onApproval: 1 as unknown as NotifyConfig['onApproval'] })).toThrow(/config\.onApproval must be a boolean/)
  })

  it('does not notify during quiet hours', () => {
    // Fake the wall clock so the quiet-hours judgment never depends on when the suite runs.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 10, 0))
    try {
      setPlatform('darwin')
      const ctx = mockCtx()
      apply(ctx, { quietHours: ['00:00-23:59'] })
      ctx.emit('session/event', ...rootTurnEnd('completed'))
      ctx.emit('agent/status', ...idleRoot())
      expect(mockedSpawn).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('notifies outside quiet hours', () => {
    // Fixed 10:00 — outside 23:00-08:00 (which covers midnight) — so the
    // expectation holds at any real wall-clock hour.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 10, 0))
    try {
      setPlatform('darwin')
      const ctx = mockCtx()
      apply(ctx, { quietHours: ['23:00-08:00'] })
      ctx.emit('session/event', ...rootTurnEnd('completed'))
      ctx.emit('agent/status', ...idleRoot())
      expect(mockedSpawn).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the per-kind sound name for failures', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    // Funk is not the default failure chime (Sosumi), so this only passes if
    // the per-kind override is actually wired through.
    apply(ctx, { sounds: { error: 'Funk' } })
    ctx.emit('session/event', ...rootTurnEnd('error'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('sound name "Funk"')
  })

  it('fails loud on a non-string quietHours element', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    expect(() => apply(ctx, { quietHours: [123 as unknown as string] })).toThrow(/config\.quietHours must be an array of strings/)
  })

  it('omits the chime from the macOS command when config.sound is false', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { sound: false })
    ctx.emit('session/event', ...rootTurnEnd('completed'))
    ctx.emit('agent/status', ...idleRoot())
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).not.toContain('sound name')
  })

  it('omits the chime from blocked notifications when config.sound is false', () => {
    setPlatform('darwin')
    const ctx = mockCtx()
    apply(ctx, { sound: false })
    ctx.emit('session/event', ...rootToolCall('ask_user_question', '{"questions":[{"question":"要如何？"}]}'))
    expect(mockedSpawn).toHaveBeenCalledTimes(1)
    expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).not.toContain('sound name')
  })

  describe('with a schema-resolved (volatile) config', () => {
    /** A volatile reference the test can swap, as the Loader does on a committed write. */
    function mutableRef<T>(initial: T) {
      let value = initial
      return {
        get: () => value,
        set: (next: T) => { value = next },
      }
    }

    /** The full volatile config the Loader hands `apply` for the plugin's schema. */
    function volatileConfig(title: string) {
      const titleRef = mutableRef(title)
      const ref = mutableRef(true)
      return {
        config: {
          enabled: ref,
          title: titleRef,
          sound: ref,
          sounds: mutableRef({ completed: 'Glass', error: 'Sosumi', approval: 'Ping' }),
          quietHours: mutableRef<string[]>([]),
          onBlocked: ref,
          onQuestion: ref,
          onApproval: ref,
        },
        title: titleRef,
      }
    }

    it('reads the live config instead of the entry config', () => {
      setPlatform('darwin')
      const ctx = mockCtx()
      const { config } = volatileConfig('Panel Title')
      apply(ctx, { ...config, title: config.title } as never)
      ctx.emit('session/event', ...rootTurnEnd('completed'))
      ctx.emit('agent/status', ...idleRoot())
      expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('with title "Panel Title"')
    })

    it('applies a settings write live without a restart', () => {
      setPlatform('darwin')
      const ctx = mockCtx()
      const { config, title } = volatileConfig('Panel Title')
      apply(ctx, config as never)
      ctx.emit('session/event', ...rootTurnEnd('completed'))
      ctx.emit('agent/status', ...idleRoot())
      expect(mockedSpawn.mock.calls[0]![1]!.join(' ')).toContain('with title "Panel Title"')
      // A committed settings write swaps the reference's value in place; the
      // plugin's next event reads the new one without reloading.
      title.set('Changed Title')
      ctx.emit('session/event', ...rootTurnEnd('completed'))
      ctx.emit('agent/status', ...idleRoot())
      expect(mockedSpawn.mock.calls[1]![1]!.join(' ')).toContain('with title "Changed Title"')
    })

    it('stops notifying once a write disables the plugin', () => {
      setPlatform('darwin')
      const ctx = mockCtx()
      const { config } = volatileConfig('Panel Title')
      apply(ctx, config as never)
      config.enabled.set(false)
      ctx.emit('session/event', ...rootTurnEnd('completed'))
      ctx.emit('agent/status', ...idleRoot())
      expect(mockedSpawn).not.toHaveBeenCalled()
    })
  })
})
