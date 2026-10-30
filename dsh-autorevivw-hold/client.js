window.__ModuleLoader__.load({
  id: 'dsh-autorevivw-hold',
  factory: (require) => {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    /** Host wire namespace of the official permission settings row. */
    const PERMISSION_SETTINGS_NS = 'permission'
    /** Plugin config namespace (equals the Loader entry id). */
    const PLUGIN_SETTINGS_NS = 'auto-review-default'
    /** Locale namespace for the shadowed settings row. */
    const NS = 'settings.dsh-autorevivw-hold'
    const FULL_ACCESS_PRESET = 'danger-full-access'
    const AUTO_PRESET = 'auto'
    /**
     * The shipped default-permission row's id and order. Reusing the id puts
     * this row in THAT cell (replacing the official control) rather than
     * adding a second one; `priority: -1` wins the cell against the shipped
     * registration, which keeps the default priority 0.
     */
    const SHIPPED_ROW_ID = 'permission'
    const SHIPPED_ROW_ORDER = -20

    // ---- helpers --------------------------------------------------------------

    /**
     * Preset to leave behind in the official namespace while Auto is default:
     * the current default when it is a regular preset, else workspace-write.
     */
    function safeFallback(options, current) {
      const regular = options.filter((option) => option.id !== AUTO_PRESET).map((option) => option.id)
      return current !== undefined && current !== AUTO_PRESET && regular.includes(current)
        ? current
        : (regular.includes('workspace-write') ? 'workspace-write' : regular[0])
    }

    // ---- settings controller ------------------------------------------------

    /**
     * Row controller mirroring the official PermissionPresetSettingsController:
     * one describe face for revisions, one snapshot store for the component.
     * The catalog is read once per load and re-read when the host re-announces it.
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
          currentValue: '',
          options: [],
          autoDefault: false,
          revision: 0,
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
        /** Namespace key resolved from the describe mirror (entry id may differ). */
        this.pluginNamespace = null
      }

      update(patch) {
        this.snapshot = { ...this.snapshot, ...patch }
        for (const listener of this.listeners) listener()
      }

      namespaceView(ns) {
        return this.describeFace.getSnapshot().view?.namespaces.find((entry) => entry.ns === ns)
      }

      async load() {
        if (this.disposed) return
        this.following ??= this.describeFace.subscribe(() => { this.derive() })
        this.update({ status: 'loading', error: null })
        await this.describeFace.ensure()
        this.derive()
      }

      /**
       * Persist one choice. Official presets write `permission.defaultPreset`;
       * the Auto choice additionally writes the plugin namespace so the Host
       * half applies it to new sessions and remembers the warning flag.
       * @param value - preset key or 'auto'.
       * @param skipWarning - persist "do not show the risk dialog again".
       * @returns success.
       */
      async select(value, skipWarning) {
        const state = this.store.getSnapshot()
        const view = this.namespaceView(PERMISSION_SETTINGS_NS)
        if (view === undefined || !state.writable || this.saving) return false
        this.saving = true
        this.update({ status: 'saving', error: null })
        try {
          // While Auto is the default, the official defaultPreset is the safe
          // preset a session falls back to when the Auto integration is gone;
          // the official boundary (auto is not a defaultPreset value) holds.
          const preset = value === AUTO_PRESET ? safeFallback(state.options, view.value.defaultPreset) : value
          const response = await this.ctx.remote.settings.mutate(PERMISSION_SETTINGS_NS, [{
            op: 'set', path: ['defaultPreset'], value: preset,
          }], view.revision)
          if (!response.ok) { this.fail(response.error); return false }
          this.describeFace.acceptView(response.value)
          if (value === AUTO_PRESET || state.autoDefault) {
            const ns = this.pluginNamespace ?? PLUGIN_SETTINGS_NS
            const pluginView = this.namespaceView(ns)
            if (pluginView !== undefined) {
              // Only the Auto dialog can change the skip flag; other choices
              // preserve it.
              const skip = value === AUTO_PRESET ? skipWarning === true : state.skipWarning === true
              const pluginResponse = await this.ctx.remote.settings.mutate(ns, [
                { op: 'set', path: ['defaultAutoReview'], value: value === AUTO_PRESET },
                { op: 'set', path: ['skipAutoReviewWarning'], value: skip },
              ], pluginView.revision)
              if (!pluginResponse.ok) { this.fail(pluginResponse.error); return false }
              this.describeFace.acceptView(pluginResponse.value)
            }
          }
          this.derive()
          return true
        } catch (error) {
          this.fail(error)
          return false
        } finally {
          this.saving = false
        }
      }

      /** Fold the describe mirror + plugin config into one row snapshot. */
      derive() {
        if (this.disposed || this.saving) return
        const mirrored = this.describeFace.getSnapshot()
        if (mirrored.view === undefined) {
          if (mirrored.error !== null) this.fail(new Error(mirrored.error))
          return
        }
        const view = mirrored.view.namespaces.find((entry) => entry.ns === PERMISSION_SETTINGS_NS)
        // The plugin's own namespace is keyed by its Loader entry id. Locate it
        // by the field it owns rather than by a hard-coded id, so a renamed or
        // prefixed entry does not make the row unusable.
        const pluginView = mirrored.view.namespaces.find((entry) => entry.ns === PLUGIN_SETTINGS_NS)
          ?? mirrored.view.namespaces.find((entry) => entry.value !== undefined && entry.value !== null
            && typeof entry.value === 'object' && 'defaultAutoReview' in entry.value)
        if (view === undefined || pluginView === undefined) {
          // Both namespaces must be describable: the official one carries the
          // fallback preset and its revision, the plugin one carries the Auto
          // flag and the saved "do not warn" choice. Report what the Host did
          // publish, so a missing namespace is diagnosable instead of opaque.
          const published = mirrored.view.namespaces.map((entry) => entry.ns)
          const missing = [
            view === undefined ? PERMISSION_SETTINGS_NS : null,
            pluginView === undefined ? PLUGIN_SETTINGS_NS : null,
          ].filter((name) => name !== null).join(', ')
          this.update({
            status: 'unavailable',
            writable: false,
            options: [],
            error: `missing namespace "${missing}" (Host published: ${published.join(', ') || 'none'})`,
          })
          return
        }
        const autoDefault = pluginView.value.defaultAutoReview === true
        const skipWarning = pluginView.value.skipAutoReviewWarning === true
        // Remember the resolved key so writes address the same namespace.
        this.pluginNamespace = pluginView.ns
        const options = [
          { id: 'read-only', label: this.t('preset.readOnly') },
          { id: 'workspace-write', label: this.t('preset.workspaceWrite') },
          { id: FULL_ACCESS_PRESET, label: this.t('preset.fullAccess') },
        ]
        // Auto review is always offered: it is the option this plugin exists
        // to add. Never gate it on `catalog()` — that lists the presets the
        // CURRENT session may pick, so it omits Auto until a session is on Auto
        // and cannot tell whether the integration is installed.
        options.push({
          id: AUTO_PRESET,
          label: this.t('preset.auto'),
          badge: this.t('auto.badge'),
          detail: this.t('auto.description'),
        })
        // When Auto is the default, remember which preset to fall back to.
        const currentValue = autoDefault ? AUTO_PRESET : (view.value.defaultPreset ?? 'workspace-write')
        this.update({
          status: 'ready',
          error: null,
          writable: mirrored.view.writable,
          currentValue,
          options,
          autoDefault,
          skipWarning,
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

    // ---- components ---------------------------------------------------------

    function Row({ load, select, usePermission, t }) {
      const state = usePermission((snapshot) => snapshot)
      const [open, setOpen] = React.useState(false)
      const [confirming, setConfirming] = React.useState(false)
      const [confirmValue, setConfirmValue] = React.useState('')
      const [acknowledged, setAcknowledged] = React.useState(false)
      const [dontAskAgain, setDontAskAgain] = React.useState(false)
      const buttonRef = React.useRef(null)
      const [menuBox, setMenuBox] = React.useState(null)
      React.useEffect(() => { load() }, [load])
      React.useEffect(() => {
        if (state.writable && state.status !== 'unavailable') return
        setOpen(false); setAcknowledged(false); setConfirming(false)
      }, [state.status, state.writable])
      React.useEffect(() => {
        if (!confirming) setDontAskAgain(state.skipWarning === true)
      }, [confirming, state.skipWarning])
      // Anchor the portal menu to the selector button; follow scroll and resize.
      React.useEffect(() => {
        if (!open) { setMenuBox(null); return }
        const place = () => {
          const rect = buttonRef.current?.getBoundingClientRect()
          if (rect === undefined) return
          setMenuBox({ top: rect.bottom + 4, right: window.innerWidth - rect.right, minWidth: Math.max(rect.width, 280) })
        }
        place()
        window.addEventListener('scroll', place, true)
        window.addEventListener('resize', place)
        return () => {
          window.removeEventListener('scroll', place, true)
          window.removeEventListener('resize', place)
        }
      }, [open])
      // Close on outside pointer-down and Escape, like the shared Menu.
      React.useEffect(() => {
        if (!open) return
        const onPointerDown = (event) => {
          const target = event.target
          if (target instanceof Node && buttonRef.current?.contains(target) !== true
            && !event.target.closest?.('.arh-menu')) setOpen(false)
        }
        const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('mousedown', onPointerDown)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      if (state.status === 'unavailable') {
        // Keep the row visible instead of vanishing: a hidden row is
        // indistinguishable from a plugin that never loaded.
        return h('div', { className: 'arh-row' },
          h('div', { className: 'arh-rowText' },
            h('div', { className: 'arh-title' }, t('title')),
            h('div', { className: 'arh-desc', role: 'alert' }, state.error ?? t('unavailable')),
          ),
        )
      }
      const selected = state.options.find((option) => option.id === state.currentValue)
      const busy = state.status === 'loading' || state.status === 'saving' || confirming
      const label = selected !== undefined
        ? selected.label
        : busy ? t('loading') : t('unavailable')

      const choose = (id) => {
        setOpen(false)
        if (id === state.currentValue) return
        if (id !== AUTO_PRESET && id !== FULL_ACCESS_PRESET) { select(id); return }
        // Full access and Auto review both require an explicit risk gate.
        if (id === AUTO_PRESET && state.skipWarning) { select(id, true); return }
        setConfirmValue(id)
        setAcknowledged(false)
        setDontAskAgain(false)
        setConfirming(true)
      }

      return h(React.Fragment, null,
        h('div', { className: 'arh-row' },
          h('div', { className: 'arh-rowText' },
            h('div', { className: 'arh-title' }, t('title')),
            h('div', { className: 'arh-desc', role: state.error ? 'alert' : undefined },
              state.error ?? t('description')),
          ),
          h('button', {
            type: 'button',
            ref: buttonRef,
            className: 'arh-selector',
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            disabled: busy || !state.writable || state.options.length === 0,
            onClick: () => setOpen((value) => !value),
          }, label,
            h('span', { className: 'arh-chevron', 'aria-hidden': true }, '▾'),
          ),
        ),
        open && menuBox !== null && ReactDOM.createPortal(
          h('div', {
            className: 'arh-menu',
            role: 'menu',
            'aria-label': t('title'),
            style: { top: `${menuBox.top}px`, right: `${menuBox.right}px`, minWidth: `${menuBox.minWidth}px` },
          },
            state.options.map((option) => h('button', {
              key: option.id,
              type: 'button',
              role: 'menuitemradio',
              'aria-checked': option.id === state.currentValue,
              className: 'arh-option' + (option.id === state.currentValue ? ' arh-active' : ''),
              onClick: () => choose(option.id),
            },
              h('span', { className: 'arh-optionMain' },
                h('span', { className: 'arh-optionLabel' }, option.label,
                  option.badge && h('span', { className: 'arh-badge' }, option.badge)),
                option.detail && h('span', { className: 'arh-optionDetail' }, option.detail),
              ),
            )),
          ),
          document.body,
        ),
        confirming && h(RiskDialog, {
          t,
          value: confirmValue,
          acknowledged,
          dontAskAgain,
          setAcknowledged,
          setDontAskAgain,
          onCancel: () => setConfirming(false),
          onConfirm: () => {
            const skip = dontAskAgain
            const value = confirmValue
            setConfirming(false)
            select(value, skip)
          },
          disabled: !state.writable || state.status === 'saving',
        }),
      )
    }

    function RiskDialog({ t, value, acknowledged, dontAskAgain, setAcknowledged, setDontAskAgain, onCancel, onConfirm, disabled }) {
      const auto = value === AUTO_PRESET
      return h('div', {
        className: 'arh-overlay',
        role: 'dialog',
        'aria-modal': true,
        'aria-label': auto ? t('auto.confirmTitle') : t('confirmTitle'),
      }, h('div', { className: 'arh-dialog' },
        h('h2', { className: 'arh-dialogTitle' }, auto ? t('auto.confirmTitle') : t('confirmTitle')),
        h('p', { className: 'arh-dialogDesc' }, auto ? t('auto.confirmDescription') : t('confirmDescription')),
        h('label', { className: 'arh-check' },
          h('input', { type: 'checkbox', checked: acknowledged, disabled, onChange: (event) => setAcknowledged(event.target.checked) }),
          h('span', null, auto ? t('auto.acknowledge') : t('acknowledge')),
        ),
        auto && h('label', { className: 'arh-check' },
          h('input', { type: 'checkbox', checked: dontAskAgain, disabled, onChange: (event) => setDontAskAgain(event.target.checked) }),
          h('span', null, t('dontAskAgain')),
        ),
        h('div', { className: 'arh-dialogActions' },
          h('button', { type: 'button', className: 'arh-btn', onClick: onCancel, disabled }, t('cancel')),
          h('button', {
            type: 'button',
            className: 'arh-btn arh-btnPrimary',
            onClick: onConfirm,
            disabled: disabled || !acknowledged,
          }, auto ? t('auto.confirmEnable') : t('confirmEnable')),
        ),
      ))
    }

    // ---- styles -------------------------------------------------------------

    const CSS = `
.arh-row{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex;position:relative}
.arh-rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}
.arh-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.arh-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}
.arh-selector{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}
.arh-selector:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.arh-selector:disabled{cursor:default}
.arh-chevron{flex:none;font-size:10px;color:var(--dsw-alias-label-secondary)}
.arh-menu{position:fixed;z-index:1000;max-width:360px;max-height:320px;overflow-y:auto;padding:4px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-primary));border:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lg,0 12px 40px rgba(0,0,0,.24));display:flex;flex-direction:column}
.arh-option{display:flex;align-items:flex-start;gap:8px;width:100%;text-align:left;border:0;background:transparent;cursor:pointer;padding:8px 10px;border-radius:var(--dsw-radius-sm,6px);font:inherit;color:var(--dsw-alias-label-primary)}
.arh-option:hover{background:var(--dsw-alias-interactive-bg-hover)}
.arh-active{background:var(--dsw-alias-interactive-bg-selected,transparent)}
.arh-optionMain{display:flex;flex-direction:column;gap:2px;min-width:0}
.arh-optionLabel{font-size:14px;line-height:20px;display:flex;align-items:center;gap:6px}
.arh-optionDetail{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.arh-badge{font-size:10px;line-height:14px;padding:0 5px;border-radius:var(--dsw-radius-sm,6px);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);flex:none}
.arh-overlay{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:24px;background:var(--dsw-alias-mask,rgba(0,0,0,.45))}
.arh-dialog{width:min(480px,100%);padding:24px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-primary);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lg,0 12px 40px rgba(0,0,0,.24));display:flex;flex-direction:column;gap:0}
.arh-dialogTitle{margin:0 0 10px;font-size:18px;line-height:24px;font-weight:600}
.arh-dialogDesc{margin:0 0 18px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.arh-check{display:flex;gap:8px;align-items:flex-start;margin-bottom:10px;font-size:13px;line-height:20px;cursor:pointer}
.arh-dialogActions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.arh-btn{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);padding:8px 14px;cursor:pointer;color:var(--dsw-alias-label-primary);background:transparent;font:inherit}
.arh-btnPrimary{border:0;color:var(--dsw-alias-label-on-primary);background:var(--dsw-alias-state-business-primary)}
.arh-btn:disabled{cursor:default;opacity:.55}
`

    function installStyles() {
      if (typeof document === 'undefined') return
      const tagId = 'dsh-autorevivw-hold/settings.css'
      if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-autorevivw-hold'
      tag.dataset.pluginCss = tagId
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ---- plugin body ----------------------------------------------------------

    const zh = {
      'title': '权限',
      'description': '选择新会话的默认权限模式',
      'loading': '加载中',
      'unavailable': '不可用',
      'preset.readOnly': '仅可查看',
      'preset.workspaceWrite': '工作区内修改',
      'preset.fullAccess': '完全权限',
      'preset.auto': '自动审查',
      'auto.badge': 'EXP',
      'auto.description': '无沙箱运行；每次原生工具调用前由同一模型进行实验性审查。',
      'confirmTitle': '确认启用完全权限？',
      'confirmDescription': '启用完全权限后，新会话将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任后续任务时使用。',
      'acknowledge': '我已了解风险，并愿意继续',
      'confirmEnable': '启用完全权限',
      'auto.confirmTitle': '确认启用自动审查（实验）？',
      'auto.confirmDescription': '自动审查不使用沙箱。每次原生工具调用前，都会由与当前会话相同的模型进行审查；审查拒绝的调用由你批准或拒绝。此功能仍属实验性，可能误放行或误拒绝，并会消耗额外 token。',
      'auto.acknowledge': '我已了解这些风险，并愿意继续',
      'auto.confirmEnable': '启用自动审查',
      'dontAskAgain': '以后不再显示此风险提示',
      'cancel': '取消',
    }
    const en = {
      'title': 'Permission',
      'description': 'Choose the default permission mode for new sessions',
      'loading': 'Loading',
      'unavailable': 'Unavailable',
      'preset.readOnly': 'Read Only',
      'preset.workspaceWrite': 'Workspace Write',
      'preset.fullAccess': 'Full access',
      'preset.auto': 'Auto review',
      'auto.badge': 'EXP',
      'auto.description': 'Run without a sandbox after an experimental same-model review of every native tool call.',
      'confirmTitle': 'Enable Full access?',
      'confirmDescription': 'Full access lets new sessions reduce confirmation steps and perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust subsequent tasks.',
      'acknowledge': 'I understand the risks and want to continue',
      'confirmEnable': 'Enable Full access',
      'auto.confirmTitle': 'Enable Auto review (experimental)?',
      'auto.confirmDescription': 'Auto review runs without a sandbox. Before every native tool call, the same model as the current session reviews whether to allow it; you approve or reject each call it denies. This feature is experimental, can falsely allow or reject actions, and uses additional tokens.',
      'auto.acknowledge': 'I understand these risks and want to continue',
      'auto.confirmEnable': 'Enable Auto review',
      'dontAskAgain': 'Do not show this warning again',
      'cancel': 'Cancel',
    }

    const inject = ['configForms', 'connection', 'locale', 'remote', 'remote.permissionPresets', 'remote.settings', 'slots']

    return {
      inject,
      apply(ctx) {
        installStyles()
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-autorevivw-hold.locale')

        const controller = new Controller(ctx)
        controller.t = ctx.locale.bind(NS)
        ctx.effect(() => () => controller.dispose(), 'dsh-autorevivw-hold.settings')

        // Keep the row fresh across Host catalog and connection changes. The
        // catalog is NOT consulted to decide whether Auto exists: it lists what
        // the current session may pick, so Auto is absent until a session is
        // already on Auto. The Host's own write path settles the rest.
        const refresh = () => { controller.derive() }
        void refresh()
        ctx.effect(() => ctx.remote.$on('permission-presets/catalog-changed', refresh), 'dsh-autorevivw-hold.catalog')
        ctx.effect(() => ctx.get('connection').generation.subscribe(refresh), 'dsh-autorevivw-hold.connection')

        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          // Reuse the shipped id so this row REPLACES the official default
          // permission control instead of stacking a duplicate beside it, and
          // shadow it with a lower priority (same id + same priority throws).
          id: SHIPPED_ROW_ID,
          order: SHIPPED_ROW_ORDER,
          priority: -1,
          locale: NS,
          inject: () => ({
            hooks: { permission: controller.store },
            load: () => controller.load(),
            select: (value, skipWarning) => controller.select(value, skipWarning),
          }),
        }, Row))
      },
    }
  },
})
