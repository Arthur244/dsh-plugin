/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * The notify-on-complete settings page.
 *
 * The page is a single column of rows, matching the built-in settings pages:
 * every control is a `@deepseek-ai/dsh-client-ui-primitives` component, so the
 * light and dark themes, the type scale, the focus ring, and the 0.5px hairline
 * separators all come from the theme owner rather than from this package.
 *
 * Staged edits live in component state — a draft is data only this page knows
 * — and nothing is written until save, which submits one revision-fenced
 * mutation through the Host form share.
 * @module dsh-notify-on-complete/client/NotifyCard
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Button, Menu, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  DEFAULTS,
  fieldOverridden,
  fieldValue,
  formatQuietHours,
  parseQuietHours,
  SOUND_OPTIONS,
  type NotifySection,
  type SoundTier,
  type StagedEdit,
  type StagedMap,
} from './notify-settings.js'

/** One path edit the shared configuration form accepts. */
export interface NotifyPathOp {
  op: 'set' | 'unset'
  path: readonly string[]
  value?: unknown
}

/** The Host form share a settings surface supplies. */
export interface NotifyForm {
  /** The Host's current section for this namespace. */
  readonly state: {
    status: 'loading' | 'ready' | 'unavailable'
    value: Record<string, unknown> | undefined
    base?: unknown
    user?: unknown
    revision?: number | undefined
    writable: boolean
  }
  /** Apply ordered field edits in one revision-fenced write. */
  mutate: (ops: readonly NotifyPathOp[], expectedRevision?: number) => Promise<boolean>
  /**
   * Observe Host section changes.
   *
   * The settings section owns no props of its own, so the page must follow the
   * shared form: without this the page would render once and never reflect a
   * write made in another surface (or the initial load that lands after mount).
   * The Plugins page re-renders its row page with a fresh `state`, so that
   * surface may omit it.
   */
  subscribe?: ((listener: () => void) => () => void) | undefined
}

/** The inject face a settings section supplies (a section owns no owner data). */
export interface NotifyPageFace {
  /** The Host section's values and write actions. */
  form?: NotifyForm | undefined
}

/**
 * Props the slot renderer binds for this page.
 *
 * Two surfaces host it and they deliver data differently: `settings.section`
 * passes nothing and the page reads `form` from its inject face, while
 * `plugins.row.config` passes `form` and `view` as owner props.
 */
export interface NotifySettingsPageProps extends NotifyPageFace {
  /** `plugins.row.config` only: `summary` renders the one-liner, `page` the form. */
  view?: 'summary' | 'page'
}

/** The one-liner the Plugins page shows for this bundle's row. */
const SUMMARY = '运行完成、失败、提问与审批的桌面通知设置（含提示音）'

/** One labeled row: copy on the left, control on the right. */
function Row(props: {
  label: string
  hint?: string
  /** Rendered at the trailing edge. */
  children: ReactNode
  /** Marks a row that a save would leave overridden, and offers the reset. */
  overridden?: boolean
  onReset?: () => void
  disabled?: boolean
}) {
  return (
    <div className="noc-row">
      <div className="noc-row-copy">
        <span className="noc-row-label">{props.label}</span>
        {props.hint === undefined ? null : <span className="noc-row-hint">{props.hint}</span>}
      </div>
      <div className="noc-row-control">
        {props.children}
        {props.overridden === true
          ? (
            <Button variant="ghost" size="sm" disabled={props.disabled} onClick={props.onReset}>
              重置
            </Button>
          )
          : null}
      </div>
    </div>
  )
}

/**
 * Render this page.
 * @param props - the view asked for, plus the Host form share on the page view.
 * @returns the one-liner, the form, or null while no form is supplied.
 */
export function NotifySettingsPage(props: NotifySettingsPageProps) {
  if (props.view === 'summary') return <>{SUMMARY}</>
  const form = props.form
  if (form === undefined) return null
  return <NotifyForm form={form} />
}

/** The settings form over one Host section. */
function NotifyForm({ form }: { form: NotifyForm }) {
  const [staged, setStaged] = useState<Map<string, StagedEdit>>(() => new Map())
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [openMenu, setOpenMenu] = useState<SoundTier | null>(null)
  // Follow the shared form when it can notify: a settings section receives no
  // owner props, so nothing else would re-render this page after the Host
  // answers a read or another surface writes.
  const [, setVersion] = useState(0)
  useEffect(() => {
    const subscribe = form.subscribe
    if (subscribe === undefined) return undefined
    return subscribe(() => { setVersion(value => value + 1) })
  }, [form])

  const { state } = form
  const section = state.value as NotifySection | undefined
  const disabled = !state.writable || saving
  const stagedMap: StagedMap = staged
  const dirty = staged.size > 0

  const stage = (field: string, edit: StagedEdit): void => {
    setStaged((previous) => {
      const next = new Map(previous)
      next.set(field, edit)
      return next
    })
    setFailed(false)
  }

  const reset = (field: string): void => { stage(field, { kind: 'clear' }) }

  const discard = (): void => {
    setStaged(new Map())
    setFailed(false)
  }

  /** Write every staged edit in one revision-fenced mutation. */
  const save = (): void => {
    const ops: NotifyPathOp[] = []
    for (const [field, edit] of staged) {
      if (edit.kind === 'clear') {
        ops.push({ op: 'unset', path: [field] })
        continue
      }
      if (field === 'quietHours') {
        const value = typeof edit.value === 'string' ? parseQuietHours(edit.value) : undefined
        ops.push(value === undefined ? { op: 'unset', path: [field] } : { op: 'set', path: [field], value })
        continue
      }
      ops.push({ op: 'set', path: [field], value: edit.value })
    }
    if (ops.length === 0) {
      discard()
      return
    }
    setSaving(true)
    setFailed(false)
    void form.mutate(ops, state.revision).then((landed) => {
      if (landed) setStaged(new Map())
      setSaving(false)
      setFailed(!landed)
    }, () => {
      // A transport failure keeps the drafts so the user can retry.
      setSaving(false)
      setFailed(true)
    })
  }

  const sounds = (section?.sounds ?? {}) as Partial<Record<SoundTier, string>>
  const soundValue = (tier: SoundTier): string => {
    const edit = stagedMap.get('sounds')
    if (edit?.kind === 'set' && typeof edit.value === 'object' && edit.value !== null) {
      const tierValue = (edit.value as Record<string, unknown>)[tier]
      if (typeof tierValue === 'string') return tierValue
    }
    const current = sounds[tier]
    return typeof current === 'string' ? current : DEFAULTS.sounds[tier]
  }
  const writeSound = (tier: SoundTier, value: string): void => {
    stage('sounds', {
      kind: 'set',
      value: { completed: soundValue('completed'), error: soundValue('error'), approval: soundValue('approval'), [tier]: value },
    })
    setOpenMenu(null)
  }

  if (state.status !== 'ready') {
    return <p className="noc-status" role="status">设置命名空间不可用，无法编辑。</p>
  }

  return (
    <div className="noc-page">
      {!state.writable ? <p className="noc-status" role="status">设置文档为只读，无法保存修改。</p> : null}

      <Row
        label="启用通知"
        hint="关闭后不再发送任何通知"
        disabled={disabled}
        overridden={fieldOverridden('enabled', state.user, stagedMap)}
        onReset={() => { reset('enabled') }}
      >
        <Switch
          label="启用通知"
          checked={fieldValue('enabled', section, stagedMap, (value) => typeof value === 'boolean' ? value : DEFAULTS.enabled)}
          disabled={disabled}
          onChange={(value) => { stage('enabled', { kind: 'set', value }) }}
        />
      </Row>

      <Row
        label="通知标题"
        hint="通知中心显示的应用标题"
        disabled={disabled}
        overridden={fieldOverridden('title', state.user, stagedMap)}
        onReset={() => { reset('title') }}
      >
        <input
          className="noc-input"
          aria-label="通知标题"
          value={fieldValue('title', section, stagedMap, (value) => typeof value === 'string' ? value : DEFAULTS.title)}
          disabled={disabled}
          onChange={(event) => { stage('title', { kind: 'set', value: event.target.value }) }}
        />
      </Row>

      <Row
        label="播放提示音"
        hint="通知时同时播放系统提示音；关闭则只弹通知不出声"
        disabled={disabled}
        overridden={fieldOverridden('sound', state.user, stagedMap)}
        onReset={() => { reset('sound') }}
      >
        <Switch
          label="播放提示音"
          checked={fieldValue('sound', section, stagedMap, (value) => typeof value === 'boolean' ? value : DEFAULTS.sound)}
          disabled={disabled}
          onChange={(value) => { stage('sound', { kind: 'set', value }) }}
        />
      </Row>

      {(['completed', 'error', 'approval'] as const).map((tier) => (
        <Row
          key={tier}
          label={TIER_LABELS[tier].label}
          hint={TIER_LABELS[tier].hint}
          disabled={disabled}
          overridden={fieldOverridden('sounds', state.user, stagedMap)}
          onReset={() => { reset('sounds') }}
        >
          <SoundPicker
            label={TIER_LABELS[tier].label}
            value={soundValue(tier)}
            disabled={disabled}
            open={openMenu === tier}
            onOpen={() => { setOpenMenu(tier) }}
            onClose={() => { setOpenMenu(null) }}
            onSelect={(value) => { writeSound(tier, value) }}
          />
        </Row>
      ))}

      <Row
        label="静音时段"
        hint="HH:MM-HH:MM，多个用逗号分隔，如 22:00-08:00（跨午夜）"
        disabled={disabled}
        overridden={fieldOverridden('quietHours', state.user, stagedMap)}
        onReset={() => { reset('quietHours') }}
      >
        <input
          className="noc-input"
          aria-label="静音时段"
          value={fieldValue('quietHours', section, stagedMap, (value) => formatQuietHours(Array.isArray(value) ? value as string[] : undefined))}
          placeholder="例如 22:00-08:00"
          disabled={disabled}
          onChange={(event) => { stage('quietHours', { kind: 'set', value: event.target.value }) }}
        />
      </Row>

      <Row
        label="阻塞交互通知"
        hint="需要回答提问或批准操作时立即通知"
        disabled={disabled}
        overridden={fieldOverridden('onBlocked', state.user, stagedMap)}
        onReset={() => { reset('onBlocked') }}
      >
        <Switch
          label="阻塞交互通知"
          checked={fieldValue('onBlocked', section, stagedMap, (value) => typeof value === 'boolean' ? value : DEFAULTS.onBlocked)}
          disabled={disabled}
          onChange={(value) => { stage('onBlocked', { kind: 'set', value }) }}
        />
      </Row>

      <Row
        label="提问通知"
        hint="模型调用提问工具时通知"
        disabled={disabled}
        overridden={fieldOverridden('onQuestion', state.user, stagedMap)}
        onReset={() => { reset('onQuestion') }}
      >
        <Switch
          label="提问通知"
          checked={fieldValue('onQuestion', section, stagedMap, (value) => typeof value === 'boolean' ? value : DEFAULTS.onQuestion)}
          disabled={disabled}
          onChange={(value) => { stage('onQuestion', { kind: 'set', value }) }}
        />
      </Row>

      <Row
        label="审批通知"
        hint="等待操作批准时通知"
        disabled={disabled}
        overridden={fieldOverridden('onApproval', state.user, stagedMap)}
        onReset={() => { reset('onApproval') }}
      >
        <Switch
          label="审批通知"
          checked={fieldValue('onApproval', section, stagedMap, (value) => typeof value === 'boolean' ? value : DEFAULTS.onApproval)}
          disabled={disabled}
          onChange={(value) => { stage('onApproval', { kind: 'set', value }) }}
        />
      </Row>

      <div className="noc-footer">
        {failed ? <p className="noc-failed" role="status">保存失败，请重试。</p> : null}
        <Button variant="ghost" size="sm" disabled={!dirty || saving} onClick={discard}>放弃修改</Button>
        <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={save}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>
    </div>
  )
}

/** Copy for the three sound tiers. */
const TIER_LABELS: Record<SoundTier, { label: string; hint: string }> = {
  completed: { label: '完成音色', hint: '运行完成时的提示音；default 为平台默认（macOS 上不响铃）' },
  error: { label: '失败音色', hint: '运行失败或中止时的提示音' },
  approval: { label: '提问/审批音色', hint: '模型提问或等待审批时的提示音' },
}

/** A sound-name selector rendered as the app's own menu control. */
function SoundPicker(props: {
  label: string
  value: string
  disabled: boolean
  open: boolean
  onOpen: () => void
  onClose: () => void
  onSelect: (value: string) => void
}) {
  // `anchor` wraps the trigger: the menu positions against it and returns
  // keyboard focus there on dismissal.
  return (
    <Menu
      open={props.open}
      anchor={(
        <Button
          variant="outline"
          size="sm"
          disabled={props.disabled}
          aria-label={props.label}
          onClick={props.onOpen}
        >
          {props.value}
        </Button>
      )}
      items={SOUND_OPTIONS.map(option => ({ id: option, label: option }))}
      selectedId={props.value}
      onSelect={(id) => { props.onSelect(id) }}
      onClose={props.onClose}
    />
  )
}
