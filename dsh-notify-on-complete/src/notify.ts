/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { spawn } from 'node:child_process'
import type { SessionEvent } from './types.js'

/** A notification command: executable + argv, spawned without a shell. */
export interface NotifyCommand {
  command: string
  args: string[]
}

/** The platforms this plugin supports; anything else is skipped with a warning. */
export const supportedPlatforms: readonly NodeJS.Platform[] = ['darwin', 'linux', 'win32']

/** Whether the platform has a notification command to run. */
export function isSupportedPlatform(platform: NodeJS.Platform): boolean {
  return supportedPlatforms.includes(platform)
}

/** Result text for a `turn/end` reason kind; unknown kinds fall through to a generic end. */
export function resultText(kind: string): string {
  switch (kind) {
    case 'completed': return '任务已完成'
    case 'error': return '任务失败'
    case 'aborted': return '任务已中止'
    case 'max-tokens': return '任务达到 token 上限'
    default: return '任务结束'
  }
}

/** The three sound tiers: completion, failure, and blocking interactions. */
export type SoundKey = 'completed' | 'error' | 'approval'

/** Default per-tier sound names (macOS system sound names). */
export const DEFAULT_SOUNDS: Record<SoundKey, string> = {
  completed: 'Glass',
  error: 'Sosumi',
  approval: 'Ping',
}

/**
 * Group an event kind into its sound tier: turn endings map completed to the
 * completion chime and everything else to the failure chime; blocking
 * interactions (question / approval) share the attention chime.
 * @param kind - the event kind (`turn/end` reason or blocked kind).
 * @returns the sound tier key.
 */
export function soundKeyFor(kind: string): SoundKey {
  switch (kind) {
    case 'completed': return 'completed'
    case 'question':
    case 'approval': return 'approval'
    default: return 'error'
  }
}

/**
 * Resolve the sound name for a tier: the configured override, or the
 * per-tier default.
 * @param sounds - per-tier overrides from config/settings.
 * @param key - the sound tier.
 * @returns the macOS sound name to use, or `'default'` for the platform default.
 */
export function resolveSoundName(sounds: Partial<Record<SoundKey, string>> | undefined, key: SoundKey): string {
  return sounds?.[key] ?? DEFAULT_SOUNDS[key]
}

/**
 * Notification body: result text, optionally the session title, plus the root
 * session id. An empty title is omitted.
 * @param result - the result text.
 * @param sessionId - the root session id.
 * @param title - the latest session title, or '' when none exists yet.
 * @returns the final notification body.
 */
export function buildBody(result: string, sessionId: string, title = ''): string {
  const body = title === '' ? result : `${result} — ${title}`
  return `${body} (session: ${sessionId})`
}

/**
 * Escape a string for a double-quoted AppleScript literal. AppleScript has no
 * multi-line string literals — a raw control character breaks the script — so
 * backslash, quote, and the control characters AppleScript itself escapes
 * (`\r`, `\n`, `\t`) are replaced with their escape sequences.
 */
function escapeAppleScript(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
}

/** Escape text for inclusion in a PowerShell single-quoted literal. */
function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''")
}

/** Escape text for inclusion in an XML text node (toast payloads are XML). */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * AppUserModelIDs a toast may be attributed to, most preferred first.
 *
 * Windows renders a toast only for an application id that is registered as
 * toast-capable. An unregistered id is not an error: `Show()` succeeds and
 * nothing appears. That is why the DeepSeek Harness id (`com.deepseek.dsh`)
 * is NOT used — it reaches the Start menu but registers no
 * `AppUserModelId` key, so a toast attributed to it is silently dropped.
 *
 * Windows PowerShell's id is the first candidate because the system ships a
 * registration for it; it renders with the PowerShell name. The application's
 * own id follows for a machine where DSH registers itself later.
 */
const WINDOWS_AUMIDS: readonly string[] = [
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe',
  'com.deepseek.dsh',
]

/** Windows toast audio sources, one per macOS sound name the plugin offers. */
const WINDOWS_TOAST_SOUNDS: Record<string, string> = {
  Glass: 'ms-winsoundevent:Notification.Default',
  Sosumi: 'ms-winsoundevent:Notification.Error',
  Ping: 'ms-winsoundevent:Notification.Reminder',
}

/**
 * Encode a PowerShell script as a `-EncodedCommand` argument.
 *
 * The script is passed as base64 UTF-16LE, so no code page is involved when
 * Windows PowerShell 5.1 parses it. Passing the same text through `-Command`
 * sends it as the process's ANSI code page, which mangles every non-ASCII
 * character (Chinese notification text arrived as mojibake).
 * @param script - the PowerShell source.
 * @returns the base64 argument value.
 */
function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * Build the WinRT toast script for Windows.
 *
 * `WScript.Shell.Popup` — what this plugin used before — opens a modal dialog
 * box owned by the script host: it blocks, it ignores Focus Assist, and it is
 * not the notification the platform shows. A toast through
 * `Windows.UI.Notifications` is the native action-center notification.
 * @param title - the notification title, escaped here.
 * @param body - the notification body, escaped here.
 * @param soundName - resolved macOS sound name, or `'default'`.
 * @param withSound - whether the toast plays a chime.
 * @returns the PowerShell script.
 */
function windowsToastScript(title: string, body: string, soundName: string, withSound: boolean): string {
  const audio = withSound
    ? `<audio src="${WINDOWS_TOAST_SOUNDS[soundName] ?? WINDOWS_TOAST_SOUNDS['Glass']!}"/>`
    : '<audio silent="true"/>'
  const toast = `<toast><visual><binding template="ToastGeneric"><text>${escapeXml(title)}</text><text>${escapeXml(body)}</text></binding></visual>${audio}</toast>`
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$xml.LoadXml('${toast.replace(/'/g, "''")}')`,
    '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
    // Try each candidate id until one is registered as toast-capable. A
    // registration under `AppUserModelId` is what makes `Show()` actually
    // render; without one it still returns without an error.
    `$aumids = @(${WINDOWS_AUMIDS.map(id => `'${id.replace(/'/g, "''")}'`).join(', ')})`,
    '$shown = $false',
    'foreach ($candidate in $aumids) {',
    '  try {',
    '    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($candidate).Show($toast)',
    '    $shown = $true',
    '    break',
    '  } catch { }',
    '}',
    // Nothing registered: attribute to the first candidate anyway. `Show()`
    // accepts it, and a caller that checks for a rendered toast has no better
    // option from a plugin process.
    'if (-not $shown) {',
    `  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${WINDOWS_AUMIDS[0]!.replace(/'/g, "''")}').Show($toast)`,
    '}',
  ].join('\n')
}

/**
 * Build the candidate notification commands for a platform, most preferred
 * first. macOS uses osascript; Linux prefers notify-send and falls back to
 * kdialog; Windows shows a native WinRT toast. macOS embeds the sound name in
 * the script; Windows maps it to a toast audio event. `withSound: false`
 * silences both: macOS omits the `sound name` part and Windows emits a silent
 * toast.
 * @param platform - `process.platform` value.
 * @param title - the notification title, already final.
 * @param body - the notification body, already final.
 * @param soundName - macOS sound name, or `'default'` for the platform default.
 * @param withSound - whether the command plays a chime; `false` mutes the
 * embedded sound on macOS and Windows.
 * @returns the ordered candidate commands.
 * @throws on unsupported platforms (callers should gate with
 * {@link isSupportedPlatform} first).
 */
export function buildCommands(platform: NodeJS.Platform, title: string, body: string, soundName = 'Glass', withSound = true): NotifyCommand[] {
  switch (platform) {
    case 'darwin':
      return [{
        command: 'osascript',
        args: ['-e', `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"${withSound && soundName !== 'default' ? ` sound name "${escapeAppleScript(soundName)}"` : ''}`],
      }]
    case 'linux':
      return [
        { command: 'notify-send', args: [title, body] },
        { command: 'kdialog', args: ['--passivepopup', body, title, '5'] },
      ]
    case 'win32': {
      return [{
        command: 'powershell',
        args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodePowerShell(windowsToastScript(title, body, soundName, withSound))],
      }]
    }
    default:
      throw new Error(`dsh-notify-on-complete: unsupported platform "${platform}"`)
  }
}

/** Linux mapping: macOS sound name → canberra event id + freedesktop theme file. */
const LINUX_SOUNDS: Record<string, { event: string; file: string }> = {
  Glass: { event: 'complete', file: 'complete.oga' },
  Sosumi: { event: 'error', file: 'error.oga' },
  Ping: { event: 'info', file: 'info.oga' },
  default: { event: 'complete', file: 'complete.oga' },
}

/**
 * Candidate sound commands for a platform, most preferred first. macOS and
 * Windows already embed the sound in the notification command itself, so only
 * Linux needs a standalone chain: canberra-gtk-play (plays the themed event)
 * falls back to paplay with the freedesktop sound theme's audio file.
 * @param platform - `process.platform` value.
 * @param soundName - the resolved macOS sound name, or `'default'`.
 * @returns the ordered candidate sound commands; empty on platforms whose
 * notification command already plays the sound.
 */
export function buildSoundCommands(platform: NodeJS.Platform, soundName = 'Glass'): NotifyCommand[] {
  switch (platform) {
    case 'linux': {
      const sound = LINUX_SOUNDS[soundName] ?? LINUX_SOUNDS['default']!
      return [
        { command: 'canberra-gtk-play', args: ['-i', sound.event] },
        { command: 'paplay', args: [`/usr/share/sounds/freedesktop/stereo/${sound.file}`] },
      ]
    }
    default:
      return []
  }
}

/**
 * Fire-and-forget a notification: spawn the first candidate without a console
 * window and unref'd; on ENOENT retry the next candidate (notify-send →
 * kdialog). Any other failure is swallowed — a missing notifier must never
 * break the run it reports on.
 * @param commands - ordered candidate commands from {@link buildCommands}.
 * @returns the spawned child, or undefined when no candidate remains.
 */
export function spawnNotify(commands: NotifyCommand[]): ReturnType<typeof spawn> | undefined {
  const [first, ...rest] = commands
  if (!first) return undefined
  // `detached: true` is deliberately not used. On Windows a detached PowerShell
  // never runs the script it was handed: the spawn succeeds, a pid is returned,
  // and nothing appears — which silently swallowed every Windows notification.
  // `windowsHide` suppresses the console window instead, and `unref()` still
  // lets the harness exit without waiting for the notifier.
  const child = spawn(first.command, first.args, { stdio: 'ignore', windowsHide: true })
  child.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' && rest.length > 0) spawnNotify(rest)
  })
  child.unref()
  return child
}

/** Maximum length of a text fragment (question or title) carried into a notification body. */
const BODY_TEXT_MAX = 80

/** Truncate text to `max` code points, appending an ellipsis when it overflows. */
function truncateText(text: string, max: number): string {
  const chars = [...text]
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text
}

/**
 * Extract the first question's text from an `ask_user_question` tool call's
 * raw `arguments` JSON string, trimmed and truncated for a notification body.
 * Returns an empty string when the JSON is malformed or the text is absent.
 * @param argumentsString - the raw `arguments` string from a `tool/call` event.
 * @returns the first question's trimmed text, truncated to {@link BODY_TEXT_MAX} chars.
 */
export function blockedQuestionText(argumentsString: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsString)
  } catch {
    return ''
  }
  const questions = (parsed as { questions?: unknown } | undefined)?.questions
  if (!Array.isArray(questions) || questions.length === 0) return ''
  const question = (questions[0] as { question?: unknown } | undefined)?.question
  if (typeof question !== 'string' || question.trim() === '') return ''
  return truncateText(question.trim(), BODY_TEXT_MAX)
}

/**
 * Build a blocking-action notification body: a kind label plus the extracted
 * detail, with the session id appended. An empty detail or an unknown kind
 * falls back to the generic "needs attention" text; an empty title is omitted.
 * @param kind - `'question'` or `'approval'`.
 * @param detail - the extracted question text, or `toolName — reason`.
 * @param sessionId - the root session id to append.
 * @param title - the latest session title, or '' when none exists yet.
 * @returns the final notification body.
 */
export function blockedBody(kind: string, detail: string, sessionId: string, title = ''): string {
  const label = kind === 'question' ? '需要回答' : kind === 'approval' ? '需要批准' : '需要处理'
  const base = detail === '' || label === '需要处理' ? '需要处理' : `${label}：${detail}`
  const body = title === '' ? base : `${base} — ${title}`
  return `${body} (session: ${sessionId})`
}

/**
 * Compose the approval detail from an `approval/asked` event's tool name and
 * optional reason: the tool name alone, `toolName — reason`, or `''` when the
 * tool name is absent — the empty string lets {@link blockedBody} fall back to
 * its generic text.
 * @param toolName - the asked tool's name (already narrowed to string or '').
 * @param reason - the optional human-readable reason (string or '').
 * @returns the composed detail.
 */
export function approvalDetail(toolName: string, reason: string): string {
  if (toolName === '') return ''
  return reason === '' ? toolName : `${toolName} — ${reason}`
}

/**
 * Read the latest session title from a session's event log: scan backwards for
 * the last `session/title` event and return its normalized, truncated `title`.
 * Returns an empty string before the first title lands — titles are an async
 * projection, so early notifications may not have one yet.
 * @param events - the session's event log, in order.
 * @returns the latest title truncated to {@link BODY_TEXT_MAX} chars, or ''.
 */
export function sessionTitle(events: readonly SessionEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type !== 'session/title') continue
    const title = (event.data as { title?: unknown } | undefined)?.title
    if (typeof title !== 'string' || title.trim() === '') return ''
    return truncateText(title.trim(), BODY_TEXT_MAX)
  }
  return ''
}
