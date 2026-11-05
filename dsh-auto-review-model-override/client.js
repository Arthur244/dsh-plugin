window.__ModuleLoader__.load({
  id: 'dsh-auto-review-model-override',
  factory: (require) => {
    const React = require('react')
    const {
      IconCheckOutlineRegular, IconChevronDownOutlineRegular, Menu,
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement

    /** Plugin config namespace (equals the Loader entry id). */
    const PLUGIN_SETTINGS_NS = 'auto-review-model-override'
    /** Locale namespace for this row. */
    const NS = 'settings.dsh-auto-review-model-override'
    /** Fields this row owns inside the plugin namespace. */
    const PROVIDER_FIELD = 'reviewProvider'
    const MODEL_FIELD = 'reviewModel'

    const zh = {
      'title': '自动审查模型',
      'description': '指定自动审查使用的模型，留空则沿用当前会话模型。',
      'provider': '服务商',
      'model': '模型',
      'unset': '沿用会话模型',
      'save': '保存',
      'saving': '保存中…',
      'unavailable': '自动审查未启用，此设置不可用',
      'loading': '加载中…',
      'noProviders': '没有可用的服务商',
      'noModels': '该服务商没有已配置的模型',
    }
    const en = {
      'title': 'Auto review model',
      'description': 'Pin the model that reviews tool calls; leave empty to reuse the session model.',
      'provider': 'Provider',
      'model': 'Model',
      'unset': 'Use session model',
      'save': 'Save',
      'saving': 'Saving…',
      'unavailable': 'Auto review is not enabled, so this setting is unavailable',
      'loading': 'Loading…',
      'noProviders': 'No providers are available',
      'noModels': 'This provider has no configured models',
    }

    /**
     * The selected-row marker: the Menu's own trailing check.
     *
     * The marker is deliberately *trailing*. A submenu row's `icon` slot is
     * the leading one (`Menu.tsx:502`), so putting the check there would indent
     * the selected row's text and break the left edge every other row shares.
     * Drawing it after the label keeps all labels flush left, which is also how
     * the Menu places its own check on top-level rows (`Menu.tsx:488`,
     * figma .Menu_cell); it takes the same `--dsw-alias-label-primary` color
     * (`Menu.module.css:217-219`).
     * @returns the icon element.
     */
    function Check() {
      return h('span', { 'data-arvo': 'check' }, h(IconCheckOutlineRegular, { size: 14 }))
    }

    /**
     * A menu label that carries the check at its trailing edge when selected.
     *
     * Mirrors the Menu's own selected cell (`Menu.module.css:217-219`): one
     * trailing check, no other emphasis. The label grows to the row's full
     * width so the check lands on the right edge, and the text keeps its own
     * ellipsis instead of being clipped by the row.
     * @param text - the visible name.
     * @param selected - whether this row is the current selection.
     * @returns the label node.
     */
    function SelectedLabel(text, selected) {
      if (!selected) return text
      return h('span', { 'data-arvo': 'mark' },
        h('span', { 'data-arvo': 'mark-text' }, text),
        Check())
    }

    /**
     * Row stylesheet.
     *
     * Copy of the shipped `PermissionRow` / `LanguageRow` chrome
     * (`ui-permission-presets/src/client/PermissionRow.module.css`,
     * `locale/src/client/LanguageRow.module.css`): the same 16px vertical
     * rhythm, the same `0.5px` `--dsw-alias-border-l2` hairline that every
     * General-section row draws, and the same 36px selector pill with a
     * trailing chevron. Real CSS rather than inline styles because the pill
     * needs `:hover`, which an inline `style` object cannot express.
     * Selectors are scoped by the `data-arvo` attribute only, so nothing here
     * can leak into the shipped rows.
     */
    const ROW_CSS = `
[data-arvo='row'] {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
[data-arvo='text'] {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 48px;
}
@media (max-width: 767px) {
  html:not([data-windows-titlebar]):not([data-platform='darwin']) [data-arvo='text'] {
    padding-right: 16px;
  }
}
[data-arvo='title'] {
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
[data-arvo='desc'] {
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
[data-arvo='value'] {
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
[data-arvo='selector'] {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  flex: 0 1 auto;
  min-width: 0;
  height: 36px;
  max-width: 320px;
  padding: 0 14px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-module-platform);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
@media (hover: hover) {
  [data-arvo='selector']:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
[data-arvo='selector']:disabled {
  cursor: default;
}
[data-arvo='selector-label'] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-arvo='chevron'] {
  flex: none;
}
[data-arvo='mark'] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
[data-arvo='mark-text'] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-arvo='check'] {
  display: inline-flex;
  flex: none;
  color: var(--dsw-alias-label-primary);
}
`

    /**
     * Mount the row stylesheet once per document.
     *
     * Tagged with `data-plugin` the way the shipped theme sheets are
     * (`ui-theme/src/client/styles.ts:57-58`), so it is identifiable in devtools
     * and removed with the plugin.
     * @returns the teardown.
     */
    function mountStyles() {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-auto-review-model-override'
      tag.dataset.pluginCss = 'dsh-auto-review-model-override/row.css'
      tag.textContent = ROW_CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    /**
     * Settings controller for one plugin-config namespace.
     *
     * Reads through the shared describe mirror (the same face the shipped
     * settings pages use) and writes through `remote.settings.mutate` with the
     * revision it last accepted.
     */
    class Controller {
      constructor(ctx) {
        this.ctx = ctx
        this.describeFace = ctx.configForms.describe()
        this.listeners = new Set()
        this.snapshot = {
          status: 'idle',
          error: null,
          writable: false,
          provider: '',
          model: '',
          revision: 0,
          /** Provider groups advertised by the Host, for the two-level menu. */
          groups: [],
          /** Provider-local catalog failures; usable groups stay usable. */
          failures: [],
          catalogStatus: 'idle',
        }
        this.store = {
          getSnapshot: () => this.snapshot,
          subscribe: (listener) => {
            this.listeners.add(listener)
            return () => this.listeners.delete(listener)
          },
        }
        this.following = null
        this.saving = false
        this.disposed = false
        this.namespace = null
      }

      update(patch) {
        this.snapshot = { ...this.snapshot, ...patch }
        for (const listener of this.listeners) listener()
      }

      async load() {
        if (this.disposed) return
        this.following ??= this.describeFace.subscribe(() => { this.derive() })
        this.update({ status: 'loading', error: null })
        await this.describeFace.ensure()
        this.derive()
      }

      /**
       * Read the Host's own provider/model catalog so the row offers real
       * choices instead of free-text ids. Failures stay local to this read:
       * the settings face above still works, and a provider that fails to
       * list its models simply contributes no group.
       * @returns the advertised groups, or an empty list on failure.
       */
      async loadCatalog() {
        if (this.disposed || this.snapshot.catalogStatus === 'loading') return
        this.update({ catalogStatus: 'loading' })
        try {
          const response = await this.ctx.remote.session.modelCatalog()
          if (this.disposed) return
          if (!response.ok) {
            this.update({
              catalogStatus: 'error',
              groups: [],
              failures: [],
              error: `${response.error.code}: ${response.error.message}`,
            })
            return
          }
          const value = response.value ?? {}
          this.update({
            catalogStatus: 'ready',
            groups: Array.isArray(value.groups) ? value.groups : [],
            failures: Array.isArray(value.failures) ? value.failures : [],
          })
        } catch (error) {
          if (this.disposed) return
          this.update({
            catalogStatus: 'error',
            groups: [],
            failures: [],
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      /**
       * Persist both fields in one mutate call.
       * @param provider - provider route, or '' to stop overriding.
       * @param model - model id, or '' to stop overriding.
       * @returns success.
       */
      async save(provider, model) {
        const state = this.snapshot
        if (!state.writable || this.saving || this.namespace === null) return false
        this.saving = true
        this.update({ status: 'saving', error: null })
        try {
          const response = await this.ctx.remote.settings.mutate(this.namespace, [
            { op: 'set', path: [PROVIDER_FIELD], value: provider },
            { op: 'set', path: [MODEL_FIELD], value: model },
          ], state.revision)
          if (!response.ok) { this.fail(response.error); return false }
          this.describeFace.acceptView(response.value)
          this.derive()
          return true
        } catch (error) {
          this.fail(error)
          return false
        } finally {
          this.saving = false
        }
      }

      /** Fold the describe mirror into one row snapshot. */
      derive() {
        if (this.disposed) return
        const mirrored = this.describeFace.getSnapshot()
        if (mirrored.view === undefined) {
          if (mirrored.error !== null) this.fail(new Error(mirrored.error))
          return
        }
        // Locate the namespace by the field it owns rather than by a hard-coded
        // id, so a renamed or prefixed Loader entry keeps working.
        const view = mirrored.view.namespaces.find((entry) => entry.ns === PLUGIN_SETTINGS_NS)
          ?? mirrored.view.namespaces.find((entry) => entry.value !== undefined && entry.value !== null
            && typeof entry.value === 'object' && PROVIDER_FIELD in entry.value)
        if (view === undefined) {
          const published = mirrored.view.namespaces.map((entry) => entry.ns)
          this.update({
            status: 'unavailable',
            writable: false,
            error: `missing namespace "${PLUGIN_SETTINGS_NS}" (Host published: ${published.join(', ') || 'none'})`,
          })
          return
        }
        this.namespace = view.ns
        const value = view.value ?? {}
        this.update({
          status: 'ready',
          error: null,
          writable: mirrored.view.writable,
          provider: typeof value[PROVIDER_FIELD] === 'string' ? value[PROVIDER_FIELD] : '',
          model: typeof value[MODEL_FIELD] === 'string' ? value[MODEL_FIELD] : '',
          revision: view.revision,
        })
      }

      fail(error) {
        this.update({ status: 'error', error: error?.message ?? String(error) })
      }

      dispose() {
        this.disposed = true
        this.following?.()
        this.following = null
        this.listeners.clear()
      }
    }

    /**
     * Render the Auto review model row.
     *
     * The hook arrives as `useOverrides` because the registration declares
     * `hooks: { overrides: store }`: the framework names each injected hook
     * `use<PascalCase(key)>`, so a plain `store:` field reaches no prop at all.
     * @param props - composed slot props.
     * @returns the row element tree.
     */
    function Row({ t, save, loadCatalog, useOverrides }) {
      const snapshot = useOverrides((state) => state)
      const [open, setOpen] = React.useState(false)

      // The provider/model catalog is a Host read, so fetch it when the row
      // mounts and again each time the menu opens (a provider may have been
      // added since).
      React.useEffect(() => { void loadCatalog() }, [loadCatalog])
      const openMenu = () => {
        void loadCatalog()
        setOpen(true)
      }

      const title = h('div', { 'data-arvo': 'text' },
        h('div', { 'data-arvo': 'title' }, t('title')),
        h('div', { 'data-arvo': 'desc' }, t('description')))

      if (snapshot.status === 'idle' || snapshot.status === 'loading') {
        return h('div', { 'data-arvo': 'row' }, title,
          h('div', { 'data-arvo': 'value' }, t('loading')))
      }
      if (snapshot.status === 'unavailable') {
        return h('div', { 'data-arvo': 'row' }, title,
          h('div', { 'data-arvo': 'value' }, t('unavailable')))
      }

      const saving = snapshot.status === 'saving'
      const groups = snapshot.groups
      const selectedProvider = groups.find((group) => group.id === snapshot.provider)
      const selectedModel = selectedProvider?.models?.find((entry) => entry.id === snapshot.model)
      // A half-filled pair overrides nothing: the Host requires both fields
      // (`index.js:241`), so it must not read as a finished selection here.
      const pinned = snapshot.provider !== '' && snapshot.model !== ''
      const label = !pinned
        ? t('unset')
        : `${selectedProvider?.name ?? snapshot.provider} / ${selectedModel?.name ?? snapshot.model}`

      // Level 1 marks the current route: `__unset` while nothing is pinned,
      // otherwise the provider owning the configured model. The Menu draws
      // that check itself, last in the row, from `selectedId` — the same
      // trailing position and color as any shipped menu (`Menu.tsx:488`,
      // `Menu.module.css:217-219`). Level 2 marks the model with the same
      // shape; a submenu row cannot use `selectedId` (the Menu only consults
      // it for top-level entries), so SelectedLabel draws it.
      const items = groups.length === 0
        ? [{ id: '__empty', label: t('noProviders'), disabled: true }]
        : [
            { id: '__unset', label: t('unset') },
            ...groups.map((group) => ({
              id: `provider:${group.id}`,
              label: group.name,
              submenu: (group.models ?? []).length === 0
                ? [{ id: '__nomodels', label: t('noModels'), disabled: true }]
                : (group.models ?? []).map((entry) => ({
                    id: `model:${group.id}:${entry.id}`,
                    label: SelectedLabel(
                      entry.name,
                      group.id === snapshot.provider && entry.id === snapshot.model,
                    ),
                  })),
            })),
          ]

      const selectedId = pinned ? `provider:${snapshot.provider}` : '__unset'

      const onSelect = (id) => {
        if (id === '__empty' || id === '__nomodels') return
        if (id === '__unset') {
          setOpen(false)
          void save('', '')
          return
        }
        if (id.startsWith('provider:')) return
        if (id.startsWith('model:')) {
          const [, providerId, ...rest] = id.split(':')
          setOpen(false)
          void save(providerId, rest.join(':'))
        }
      }

      return h('div', { 'data-arvo': 'row' }, title,
        h(Menu, {
          open,
          onClose: () => { setOpen(false) },
          align: 'end',
          portal: true,
          minWidthFromAnchor: true,
          items,
          selectedId,
          onSelect,
          anchor: h('button', {
            type: 'button',
            'data-arvo': 'selector',
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            disabled: saving || !snapshot.writable,
            onClick: () => { open ? setOpen(false) : openMenu() },
          },
          h('span', { 'data-arvo': 'selector-label' }, saving ? t('saving') : label),
          h('span', { 'data-arvo': 'chevron' }, h(IconChevronDownOutlineRegular, { size: 14 }))),
        }))
    }


    const inject = ['configForms', 'connection', 'locale', 'remote', 'remote.permissionPresets', 'remote.session', 'remote.settings', 'slots']

    return {
      inject,
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-auto-review-model-override.locale')
        ctx.effect(() => mountStyles(), 'dsh-auto-review-model-override.styles')

        const controller = new Controller(ctx)
        controller.t = ctx.locale.bind(NS)
        ctx.effect(() => () => controller.dispose(), 'dsh-auto-review-model-override.settings')

        void controller.load()

        // Temporary: the catalog gate is off so the row is always visible.
        // Flip to true to restore "render only while the catalog offers auto".
        const GATE_ON_AUTO_AVAILABLE = false

        /**
         * Whether the current process catalog offers Auto review. The Host
         * publishes `auto` only while the Auto integration's `registerAuto`
         * effect is live, so this is the exact "Auto review is available"
         * signal — unlike the default-preset list, which never carries it.
         */
        const offersAuto = (catalog) => catalog !== null
          && Array.isArray(catalog.options)
          && catalog.options.some((option) => option.value === 'auto')

        let registered = false
        let disposing = null
        let disposed = false

        const mount = () => {
          const disposeModel = ctx.slots.register({
            name: 'settings.general.item',
            // Sits directly under the permission row (order -20) and above
            // the shipped Language row (order 0).
            id: 'auto-review-model-override',
            order: -10,
            locale: NS,
            // Hooks are injected by key: `overrides` reaches the component as
            // the `useOverrides` prop.
            inject: () => ({
              hooks: { overrides: controller.store },
              save: (provider, model) => controller.save(provider, model),
              loadCatalog: () => controller.loadCatalog(),
            }),
          }, Row)
          disposing = () => { disposeModel() }
          registered = true
        }

        /** Read the catalog now, then register or withdraw the row to match. */
        const sync = async () => {
          if (disposed) return
          if (!GATE_ON_AUTO_AVAILABLE) {
            if (!registered) mount()
            return
          }
          let catalog
          try {
            catalog = await ctx.remote.permissionPresets.catalog()
          } catch {
            // A failed read leaves the row in its current state rather than
            // flickering it off on a transient Host hiccup.
            return
          }
          if (disposed) return
          const wanted = offersAuto(catalog)
          if (wanted === registered) return
          if (wanted) {
            mount()
          } else {
            disposing?.()
            disposing = null
            registered = false
          }
        }

        // Re-read on every catalog invalidation and connection generation: the
        // Auto integration can be installed, removed, or remounted at runtime.
        ctx.effect(() => ctx.remote.$on('permission-presets/catalog-changed', () => { void sync() }),
          'dsh-auto-review-model-override.catalog')
        ctx.effect(() => {
          const connection = ctx.get('connection')
          const subscription = connection?.generation?.subscribe(() => { void sync() })
          return () => subscription?.()
        }, 'dsh-auto-review-model-override.connection')
        ctx.effect(() => {
          void sync()
          return () => {
            disposed = true
            disposing?.()
            disposing = null
          }
        }, 'dsh-auto-review-model-override.row')
      },
    }
  },
})
