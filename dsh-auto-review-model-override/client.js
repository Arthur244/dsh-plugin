window.__ModuleLoader__.load({
  id: 'dsh-auto-review-model-override',
  factory: (require) => {
    const React = require('react')
    const { Menu, IconCheckOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')
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
     * The selected-row marker: a brand-colored check.
     *
     * Submenu rows cannot use the Menu's own `selectedId` — it only marks
     * top-level entries (`Menu.tsx:488`), and the model being selected lives
     * one level down. So the marker is drawn as the row's leading icon, which
     * the Menu renders for any entry, including submenu rows (`Menu.tsx:486`
     * and `:504`). `IconProps` accepts only `size` and `className` (icons/props.ts),
     * so the brand color wraps the icon rather than being passed to it.
     * @returns the icon element.
     */
    function Check() {
      return h('span', { style: { display: 'inline-flex', color: styles.markColor.color } },
        h(IconCheckOutlineRegular, { size: 14 }))
    }

    /**
     * A menu label that carries the check when its row is the current choice.
     *
     * Uses font weight and color in addition to the icon, so the selection
     * survives colorblindness and low-contrast themes.
     * @param text - the visible name.
     * @param selected - whether this row is the current selection.
     * @returns the label node.
     */
    function SelectedLabel(text, selected) {
      return selected
        ? h('span', { style: { fontWeight: 600, color: styles.markColor.color } }, text)
        : text
    }

    /** Minimal inline styles so the row needs no CSS module pipeline. */
    const styles = {
      markColor: { color: 'var(--dsw-alias-brand-primary, #4d6bfe)' },
      row: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        padding: '12px 0',
      },
      text: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
      title: { fontSize: '14px' },
      description: { fontSize: '12px', opacity: 0.65 },
      value: { fontSize: '13px', opacity: 0.7 },
      selector: {
        font: 'inherit',
        fontSize: '13px',
        padding: '6px 14px',
        borderRadius: '10px',
        border: '1px solid var(--dsh-border, rgba(128,128,128,.35))',
        background: 'var(--dsh-surface, transparent)',
        color: 'inherit',
        cursor: 'pointer',
        maxWidth: '260px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
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

      const title = h('div', { style: styles.text },
        h('div', { style: styles.title }, t('title')),
        h('div', { style: styles.description }, t('description')))

      if (snapshot.status === 'idle' || snapshot.status === 'loading') {
        return h('div', { style: styles.row }, title,
          h('div', { style: styles.value }, t('loading')))
      }
      if (snapshot.status === 'unavailable') {
        return h('div', { style: styles.row }, title,
          h('div', { style: styles.value }, t('unavailable')))
      }

      const saving = snapshot.status === 'saving'
      const groups = snapshot.groups
      const selectedProvider = groups.find((group) => group.id === snapshot.provider)
      const selectedModel = selectedProvider?.models?.find((entry) => entry.id === snapshot.model)
      const label = snapshot.provider === ''
        ? t('unset')
        : snapshot.model === ''
          ? snapshot.provider
          : `${selectedProvider?.name ?? snapshot.provider} / ${selectedModel?.name ?? snapshot.model}`

      // Level 1: one row per provider, each opening a model submenu.
      const items = groups.length === 0
        ? [{ id: '__empty', label: t('noProviders'), disabled: true }]
        : [
            { id: '__unset', label: t('unset'), icon: snapshot.provider === '' ? Check() : undefined },
            ...groups.map((group) => ({
              id: `provider:${group.id}`,
              // A provider is "current" only when it is both the configured
              // route and has a model picked; otherwise the trailing check
              // would claim a complete selection that does not exist yet.
              label: SelectedLabel(group.name, group.id === snapshot.provider && snapshot.model !== ''),
              submenu: (group.models ?? []).length === 0
                ? [{ id: '__nomodels', label: t('noModels'), disabled: true }]
                : (group.models ?? []).map((entry) => ({
                    id: `model:${group.id}:${entry.id}`,
                    label: SelectedLabel(
                      entry.name,
                      group.id === snapshot.provider && entry.id === snapshot.model,
                    ),
                    icon: group.id === snapshot.provider && entry.id === snapshot.model
                      ? Check()
                      : undefined,
                  })),
            })),
          ]

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

      return h('div', { style: styles.row }, title,
        h(Menu, {
          open,
          onClose: () => { setOpen(false) },
          align: 'end',
          portal: true,
          minWidthFromAnchor: true,
          items,
          selectedId: snapshot.provider === '' ? '__unset' : undefined,
          onSelect,
          anchor: h('button', {
            type: 'button',
            style: styles.selector,
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            disabled: saving || !snapshot.writable,
            onClick: () => { open ? setOpen(false) : openMenu() },
          }, saving ? t('saving') : label),
        }))
    }


    const inject = ['configForms', 'connection', 'locale', 'remote', 'remote.permissionPresets', 'remote.session', 'remote.settings', 'slots']

    return {
      inject,
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-auto-review-model-override.locale')

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
