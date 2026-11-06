/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * The notify-on-complete page on the Plugins page.
 *
 * Rendered by the `plugins.row.config` slot with `view: 'summary'` for the
 * row's one-liner and `view: 'page'` for the form, together with the `form`
 * owner props the page supplies: the Host's current section (resolved value,
 * composition base, raw user layer, revision, writability) and its atomic
 * write. Staged edits live in component state — a draft is data only this
 * component knows — and nothing is written until save.
 * @module dsh-notify-on-complete/client/NotifyCard
 */

import { useState, type ReactNode } from 'react'
import {
  DEFAULTS,
  fieldOverridden,
  fieldValue,
  formatQuietHours,
  SOUND_OPTIONS,
  toStored,
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

/** The Host form share the Plugins page supplies as owner props. */
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
}

/** Props the slot renderer binds for this page. */
export interface NotifyCardProps {
  /** `summary` renders the one-liner alone; `page` renders the form. */
  view?: 'summary' | 'page'
  /** Host-owned values and write actions for this namespace. */
  form?: NotifyForm
}

/** One field row: copy, optional hint, and the control cluster. */
function FieldRow(props: {
  label: string
  hint?: string
  overridden: boolean
  disabled: boolean
  onReset: () => void
  children: ReactNode
}) {
  const { label, hint, overridden, disabled, onReset, children } = props
  return (
    <div className="noc-field">
      <div className="noc-field-copy">
        <span className="noc-field-label">{label}</span>
        {hint === undefined ? null : <span className="noc-field-hint">{hint}</span>}
      </div>
      <div className="noc-controls">
        {children}
        {overridden ? (
          <>
            <span className="noc-badge">已覆盖</span>
            <button type="button" className="noc-reset" disabled={disabled} onClick={onReset}>重置</button>
          </>
        ) : null}
      </div>
    </div>
  )
}

/** A labeled toggle switch. */
function SwitchRow(props: {
  label: string
  hint?: string
  checked: boolean
  disabled: boolean
  overridden: boolean
  onEdit: (value: boolean) => void
  onReset: () => void
}) {
  const { label, hint, checked, disabled, overridden, onEdit, onReset } = props
  return (
    <FieldRow label={label} hint={hint} overridden={overridden} disabled={disabled} onReset={onReset}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="noc-switch"
        disabled={disabled}
        onClick={() => { onEdit(!checked) }}
      >
        <span className="noc-knob" />
      </button>
    </FieldRow>
  )
}

/** A labeled sound-name selector. */
function SelectRow(props: {
  label: string
  hint?: string
  options: readonly string[]
  value: string
  disabled: boolean
  overridden: boolean
  onEdit: (value: string) => void
  onReset: () => void
}) {
  const { label, hint, options, value, disabled, overridden, onEdit, onReset } = props
  return (
    <FieldRow label={label} hint={hint} overridden={overridden} disabled={disabled} onReset={onReset}>
      <select
        className="noc-select"
        aria-label={label}
        disabled={disabled}
        value={value}
        onChange={(event) => { onEdit(event.target.value) }}
      >
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </FieldRow>
  )
}

/** A labeled text input. */
function TextRow(props: {
  label: string
  hint?: string
  value: string
  placeholder?: string
  disabled: boolean
  overridden: boolean
  onEdit: (value: string) => void
  onReset: () => void
}) {
  const { label, hint, value, placeholder, disabled, overridden, onEdit, onReset } = props
  return (
    <FieldRow label={label} hint={hint} overridden={overridden} disabled={disabled} onReset={onReset}>
      <input
        type="text"
        className="noc-input"
        aria-label={label}
        value={value}
        placeholder={placeholder ?? ''}
        disabled={disabled}
        onChange={(event) => { onEdit(event.target.value) }}
      />
    </FieldRow>
  )
}

/** The one-liner the Plugins page shows under the bundle's row. */
const SUMMARY = '运行完成、失败、提问与审批的桌面通知设置（含提示音）'

/**
 * Render this page: the row's one-liner, or the settings form.
 * @param props - the view asked for, plus the Host form share on the page view.
 * @returns the one-liner, the form, or null while no form is supplied.
 */
export function NotifyCard(props: NotifyCardProps) {
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

  const { state } = form
  if (state.status !== 'ready') {
    return <p className="noc-readonly" role="status">设置命名空间不可用，无法编辑。</p>
  }
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
      const value = toStored(field, edit.value)
      if (value === undefined) ops.push({ op: 'unset', path: [field] })
      else ops.push({ op: 'set', path: [field], value })
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
  const currentSounds = (): Record<SoundTier, string> => ({
    completed: fieldValue('sounds', section, stagedMap, (value) => soundOf(value, 'completed')),
    error: fieldValue('sounds', section, stagedMap, (value) => soundOf(value, 'error')),
    approval: fieldValue('sounds', section, stagedMap, (value) => soundOf(value, 'approval')),
  })

  return (
    <div className="noc-form">
      {!state.writable ? <p className="noc-readonly" role="status">设置文档为只读，无法保存修改。</p> : null}
      <SwitchRow
        label="启用通知"
        hint="关闭后不再发送任何通知"
        checked={fieldValue('enabled', section, stagedMap, (value) => booleanOf(value, DEFAULTS.enabled))}
        disabled={disabled}
        overridden={fieldOverridden('enabled', state.user, stagedMap)}
        onEdit={(value) => { stage('enabled', { kind: 'set', value }) }}
        onReset={() => { reset('enabled') }}
      />
      <TextRow
        label="通知标题"
        hint="通知中心显示的应用标题"
        value={fieldValue('title', section, stagedMap, (value) => stringOf(value, DEFAULTS.title))}
        disabled={disabled}
        overridden={fieldOverridden('title', state.user, stagedMap)}
        onEdit={(value) => { stage('title', { kind: 'set', value }) }}
        onReset={() => { reset('title') }}
      />
      <SwitchRow
        label="播放提示音"
        hint="通知时同时播放系统提示音；关闭则只弹通知不出声"
        checked={fieldValue('sound', section, stagedMap, (value) => booleanOf(value, DEFAULTS.sound))}
        disabled={disabled}
        overridden={fieldOverridden('sound', state.user, stagedMap)}
        onEdit={(value) => { stage('sound', { kind: 'set', value }) }}
        onReset={() => { reset('sound') }}
      />
      <SelectRow
        label="完成音色"
        hint="运行完成时的提示音；default 为平台默认（macOS 上不响铃）"
        options={SOUND_OPTIONS}
        value={sounds.completed ?? DEFAULTS.sounds.completed}
        disabled={disabled}
        overridden={fieldOverridden('sounds', state.user, stagedMap)}
        onEdit={(value) => { stage('sounds', { kind: 'set', value: { ...currentSounds(), completed: value } }) }}
        onReset={() => { reset('sounds') }}
      />
      <SelectRow
        label="失败音色"
        hint="运行失败或中止时的提示音"
        options={SOUND_OPTIONS}
        value={sounds.error ?? DEFAULTS.sounds.error}
        disabled={disabled}
        overridden={fieldOverridden('sounds', state.user, stagedMap)}
        onEdit={(value) => { stage('sounds', { kind: 'set', value: { ...currentSounds(), error: value } }) }}
        onReset={() => { reset('sounds') }}
      />
      <SelectRow
        label="提问/审批音色"
        hint="模型提问或等待审批时的提示音"
        options={SOUND_OPTIONS}
        value={sounds.approval ?? DEFAULTS.sounds.approval}
        disabled={disabled}
        overridden={fieldOverridden('sounds', state.user, stagedMap)}
        onEdit={(value) => { stage('sounds', { kind: 'set', value: { ...currentSounds(), approval: value } }) }}
        onReset={() => { reset('sounds') }}
      />
      <TextRow
        label="静音时段"
        hint="HH:MM-HH:MM，多个用逗号分隔，如 22:00-08:00（跨午夜）"
        value={fieldValue('quietHours', section, stagedMap, (value) => formatQuietHours(Array.isArray(value) ? value as string[] : undefined))}
        placeholder="例如 22:00-08:00"
        disabled={disabled}
        overridden={fieldOverridden('quietHours', state.user, stagedMap)}
        onEdit={(value) => { stage('quietHours', { kind: 'set', value }) }}
        onReset={() => { reset('quietHours') }}
      />
      <SwitchRow
        label="阻塞交互通知"
        hint="需要回答提问或批准操作时立即通知"
        checked={fieldValue('onBlocked', section, stagedMap, (value) => booleanOf(value, DEFAULTS.onBlocked))}
        disabled={disabled}
        overridden={fieldOverridden('onBlocked', state.user, stagedMap)}
        onEdit={(value) => { stage('onBlocked', { kind: 'set', value }) }}
        onReset={() => { reset('onBlocked') }}
      />
      <SwitchRow
        label="提问通知"
        hint="模型调用提问工具时通知"
        checked={fieldValue('onQuestion', section, stagedMap, (value) => booleanOf(value, DEFAULTS.onQuestion))}
        disabled={disabled}
        overridden={fieldOverridden('onQuestion', state.user, stagedMap)}
        onEdit={(value) => { stage('onQuestion', { kind: 'set', value }) }}
        onReset={() => { reset('onQuestion') }}
      />
      <SwitchRow
        label="审批通知"
        hint="等待操作批准时通知"
        checked={fieldValue('onApproval', section, stagedMap, (value) => booleanOf(value, DEFAULTS.onApproval))}
        disabled={disabled}
        overridden={fieldOverridden('onApproval', state.user, stagedMap)}
        onEdit={(value) => { stage('onApproval', { kind: 'set', value }) }}
        onReset={() => { reset('onApproval') }}
      />
      <div className="noc-footer">
        {failed ? <p className="noc-failed" role="status">保存失败，请重试。</p> : null}
        <button type="button" className="noc-button noc-discard" disabled={!dirty || saving} onClick={discard}>
          放弃修改
        </button>
        <button type="button" className="noc-button noc-save" disabled={!dirty || saving} onClick={save}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}

/** Read one tier out of a staged or stored `sounds` object. */
function soundOf(value: unknown, tier: SoundTier): string {
  if (typeof value !== 'object' || value === null) return DEFAULTS.sounds[tier]
  const tierValue = (value as Record<string, unknown>)[tier]
  return typeof tierValue === 'string' ? tierValue : DEFAULTS.sounds[tier]
}

/** Narrow a raw value to a boolean. */
function booleanOf(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Narrow a raw value to a string. */
function stringOf(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}
