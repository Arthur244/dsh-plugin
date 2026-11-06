/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * Unit-test stand-in for `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * At runtime the settings page imports that kit from the shell's module table.
 * Unit specs run without a shell, so this module supplies the same surface the
 * page uses, rendered as plain elements. It reproduces each control's
 * accessible role and name, which is what the specs assert on — never the real
 * kit's classes, geometry, or theme tokens.
 */

import { createElement, type ReactNode } from 'react'

/** Toggle switch: a button with `role="switch"` and the accessible name. */
export function Switch(props: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  title?: string | undefined
  className?: string | undefined
}) {
  return createElement('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': props.checked,
    'aria-label': props.label,
    'title': props.title,
    'disabled': props.disabled ?? false,
    'className': props.className,
    'onClick': () => { props.onChange(!props.checked) },
  })
}

/** Push button. */
export function Button(props: {
  children?: ReactNode
  variant?: 'primary' | 'outline' | 'ghost'
  size?: 'sm' | 'md'
  disabled?: boolean
  'aria-label'?: string
  onClick?: (event: { currentTarget: HTMLButtonElement }) => void
}) {
  return createElement('button', {
    type: 'button',
    'data-variant': props.variant ?? 'primary',
    'disabled': props.disabled ?? false,
    'aria-label': props['aria-label'],
    'onClick': props.onClick,
  }, props.children)
}

/** A menu: renders its trigger and, while open, one row per item. */
export function Menu(props: {
  open: boolean
  anchor: ReactNode
  items?: readonly { id: string; label: ReactNode; disabled?: boolean }[]
  selectedId?: string | undefined
  onSelect?: (id: string) => void
  onClose: () => void
}) {
  return createElement('span', {},
    props.anchor,
    props.open
      ? createElement('div', { role: 'menu' }, (props.items ?? []).map(item => createElement('button', {
        key: item.id,
        type: 'button',
        role: 'menuitem',
        'aria-current': item.id === props.selectedId ? 'true' : undefined,
        'disabled': item.disabled ?? false,
        'onClick': () => { props.onSelect?.(item.id) },
      }, item.label)))
      : null,
  )
}
