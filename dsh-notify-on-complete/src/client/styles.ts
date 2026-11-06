/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
/**
 * The notify page's stylesheet.
 *
 * Every color, border, radius, and type value is a `--dsw-*` token owned by
 * ui-theme, so light and dark follow the resolved theme with no local branch
 * and no literal color here. Controls themselves come from
 * `@deepseek-ai/dsh-client-ui-primitives`; this sheet owns only the row
 * geometry around them, matching the built-in settings pages: a label column
 * on the left, the control trailing on the right, and a 0.5px hairline
 * between rows.
 */

/** The page column. */
export const NOTIFY_CSS = `
.noc-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
}

.noc-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}

.noc-row:last-of-type {
  border-bottom: none;
}

.noc-row-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.noc-row-label {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}

.noc-row-hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}

.noc-row-control {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.noc-input {
  box-sizing: border-box;
  width: 260px;
  max-width: 100%;
  padding: 6px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
}

.noc-input::placeholder {
  color: var(--dsw-alias-label-tertiary);
}

.noc-input:disabled {
  opacity: 0.5;
  cursor: default;
}

.noc-input:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

.noc-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 16px;
}

.noc-status {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}

.noc-failed {
  margin: 0;
  margin-right: auto;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-state-error-primary);
}
`
