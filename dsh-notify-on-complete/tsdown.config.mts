/**
 * Copyright (c) 2026 Luozy
 * SPDX-License-Identifier: MIT
 */
import { defineConfig } from 'tsdown'

/**
 * Client-half bundle: built by tsdown into `lib/client.cjs` as a CJS factory,
 * then renamed and wrapped by scripts/normalize-client-banner.mjs with the
 * browser module loader preamble (`window.__ModuleLoader__.load({ id, factory })`).
 *
 * The externals below are the shell's module-table entries (`PLATFORM_MODULES`
 * in `@deepseek-ai/dsh-client-web/src/platform`): react, the jsx runtime, and
 * the ui-primitives kit. The kit resolves at runtime through the table, so the
 * bundle carries no copy of it and therefore inherits the live theme tokens
 * and the app's own control styling.
 */
export default defineConfig({
  entry: { 'client': 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
  },
})
