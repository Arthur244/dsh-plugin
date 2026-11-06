/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * JSON API for the notify settings card.
 *
 * DSH 0.2.2 serves every registered settings namespace through the
 * `settings` Remote namespace, so the browser card reads and writes through
 * that path and this plugin needs no route of its own. The handler below is
 * kept for the narrow case the Remote cannot cover: a deployment that mounts
 * `ctx.settings` without the Remote gateway (a CLI-only profile) still answers
 * GET for diagnostics, and the prefix route never registers where no
 * `webServer` service exists.
 * @module dsh-notify-on-complete/api
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { NOTIFY_SETTINGS_NAMESPACE } from './settings.js'

/** The settings namespace the API serves. */
export const NOTIFY_NS = NOTIFY_SETTINGS_NAMESPACE

/** The config section the API serves. */
export interface NotifyApiConfig {
  /** Schema-resolved value (defaults + base + user). */
  value?: Record<string, unknown>
  /** Composition layer the value resolves over (what a reset returns to). */
  base?: Record<string, unknown>
  /** Raw user layer as stored. */
  user?: Record<string, unknown>
  /** Whether the settings document accepts writes. */
  writable: boolean
}

/** The settings descriptor fields this route reads. */
interface SettingsDescriptorLike {
  ns: unknown
  value: unknown
  base?: unknown
  user?: unknown
}

/** The settings service face this route reads. */
interface SettingsServiceLike {
  writable: boolean
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptorLike[]
}

/** Send one JSON response with the given status. */
function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Resolve the settings service at call time (the web profile mounts it; CLI runs skip the route). */
function settingsOf(ctx: Context): SettingsServiceLike | undefined {
  return ctx.get('settings') as SettingsServiceLike | undefined
}

/**
 * Build the prefix-route handler for the JSON API. The handler resolves the
 * settings service on every request, so it works whenever the settings
 * provider is mounted — even if it appeared after the plugin started.
 * @param ctx - the plugin context.
 * @returns the route handler.
 */
export function createNotifyApiHandler(ctx: Context): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const action = url.pathname.replace(/^\/notify-on-complete\/api/, '').replace(/^\/+|\/+$/g, '')
      const settings = settingsOf(ctx)
      if (settings === undefined) {
        respond(res, 503, { error: 'settings service is absent' })
        return
      }
      if (req.method === 'GET' && action === 'config') {
        const descriptor = settings.describe({ redactSecrets: true })
          .find((entry) => String(entry.ns) === NOTIFY_NS)
        if (descriptor === undefined) {
          respond(res, 404, { error: `settings namespace "${NOTIFY_NS}" is not registered` })
          return
        }
        const config: NotifyApiConfig = {
          value: descriptor.value as Record<string, unknown>,
          writable: settings.writable,
        }
        if (descriptor.base !== undefined) config.base = descriptor.base as Record<string, unknown>
        if (descriptor.user !== undefined) config.user = descriptor.user as Record<string, unknown>
        respond(res, 200, config)
        return
      }
      // Writes go through the `settings` Remote namespace, which every
      // configuration surface uses; a second write path here would bypass the
      // revision fence the card relies on.
      if (req.method === 'POST' && action === 'config') {
        respond(res, 405, { error: 'writes go through the settings Remote namespace' })
        return
      }
      respond(res, 404, { error: 'not found' })
    } catch (error) {
      respond(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}
