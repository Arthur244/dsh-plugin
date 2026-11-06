/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Source imports use `.js` extensions (NodeNext output); tests resolve them to `.ts`.
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
  test: {
    // The browser half imports `@deepseek-ai/dsh-client-ui-primitives`, which at
    // runtime is a shell module-table entry. Its published build still carries
    // its own transitive bare imports (clsx), and the unit environment has no
    // shell to satisfy them, so every unit spec that touches the settings page
    // stubs the kit instead of resolving the real package.
    alias: {
      '@deepseek-ai/dsh-client-ui-primitives': new URL('./tests/stubs/ui-primitives.tsx', import.meta.url).pathname,
    },
  },
})
