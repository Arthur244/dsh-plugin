/* DSH rc.3 Client factory. React is supplied by the host module table. */
window.__ModuleLoader__.load({
  id: 'dsh-model-enhance',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const NS = 'settings.dsh-model-enhance'
    const PAGE = 50
    const MAX_VISIBLE = 200
    // Client Remote requires strict input codecs even when the Host also validates.
    const REQUEST_FIELDS = {
      scan: ['provider', 'sourceProvider'],
      preview: ['provider', 'modelId', 'sourceKey', 'overwrite'],
      apply: ['token', 'confirm'],
    }
    function parseRequest(method, value) {
      const allowed = REQUEST_FIELDS[method]
      if (!allowed || !value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Invalid request fields')
      for (const key of allowed) {
        if (['overwrite', 'confirm'].includes(key)) {
          if (typeof value[key] !== 'boolean') throw new Error(`Expected boolean ${key}`)
        } else if (key === 'sourceProvider' && value[key] === undefined) continue
        else if (typeof value[key] !== 'string' || value[key].length === 0 || value[key].length > 4096) throw new Error(`Invalid ${key}`)
      }
      return value
    }
    const REMOTE = {
      package: 'dsh-model-enhance',
      descriptors: ['status', 'scan', 'preview', 'apply'].map((method) => ({
        id: `dsh-model-enhance:modelEnhance/${method}`,
        service: 'modelEnhance', namespace: 'modelEnhance', method, invocation: { kind: 'direct' },
        parameters: method === 'status' ? [] : [
          { name: 'request', wire: 'request', source: 'json', codec: {
            mode: 'strict', typeSymbol: `dsh-model-enhance.${method}.Request`,
            create: () => ({ parse: (value) => parseRequest(method, value) }),
          } },
        ],
        result: { mode: 'src-json' },
      })),
    }
    const zh = {
      title: '模型资料增强', description: '使用工程内置的 models.dev 原厂来源资料匹配模型，预览后受控保存；不修改原生未保存草稿。',
      reload: '重新读取配置', loading: '处理中…', provider: '目标服务商', source: '原厂资料来源',
      chooseProvider: '请选择目标服务商', autoSource: '自动匹配原厂来源', scan: '读取已添加模型并匹配', filter: '筛选模型 ID 或名称',
      noRoutes: '没有可用路由，请先保存服务商配置。', noModels: '没有匹配筛选条件的模型。', catalogMissing: '内置原厂资料不可用，请检查插件文件；界面不会联网下载或更新。',
      catalogTime: '内置资料生成时间', catalogCounts: '内置模型／原厂来源数量', catalogError: '内置资料加载失败',
      provenance: '资料由 models.dev 原厂目录汇编并预置，不含三方平台建议，不代表厂商对当前端点的认证。',
      effortNotice: '注入的思考档位不包含 off；已有可靠映射中的 off 会在预览中移除，确认后保存。非推理能力保留 false，未知能力不虚构档位。',
      error: '操作失败', malformed: 'Host 返回了无效响应，请重新读取配置。', unavailable: '模型增强服务不可用。',
      matched: '已匹配', ambiguous: '需要确认来源', unmatched: '未匹配', candidate: '原厂资料候选', chooseCandidate: '请选择明确的原厂资料候选',
      vendorImageInput: '原厂资料的图片输入', imageSupported: '支持', imageUnsupported: '不支持', imageUnknown: '未知（不修改）',
      imageInputNotice: '这是所选原厂资料记载的能力，不承诺当前端点真实支持图片输入。',
      inputField: '图片输入能力（input）', inputUnspecified: '未指定／继承', rawJson: '原始 JSON',
      selectModel: '查看推荐', more: '再显示 50 项', limited: '已限制列表渲染；请使用筛选缩小范围。', count: '当前显示／符合条件数量',
      overwrite: '允许替换已有字段（应用前需确认影响）', preview: '重新生成预览', previewTitle: '配置变更预览',
      before: '当前值', after: '建议值', field: '字段', warnings: '注意事项', blockers: '阻止应用的原因',
      confirm: '我已检查字段覆盖影响，确认应用此预览。', apply: '一键配置推荐参数', nothing: '没有字段变更。',
      savedVerified: '配置字段已保存并核对；远端模型调用未经验证。', savedUnverified: '配置已保存，但验证未通过；请检查警告，不要重复盲目写入。',
      notSaved: '配置未保存，请检查结果与警告。', readOnly: '该路由不可写', result: '应用结果', noPreview: '选择模型及原厂资料候选以预览推荐。',
    }
    const en = {
      title: 'Model recommendations', description: 'Match added models against bundled models.dev original-vendor metadata and preview controlled writes. Unsaved native drafts are not changed.',
      reload: 'Reload configuration', loading: 'Working…', provider: 'Target provider', source: 'Original-vendor source',
      chooseProvider: 'Choose a target provider', autoSource: 'Match original vendor automatically', scan: 'Load and match added models', filter: 'Filter model ID or name',
      noRoutes: 'No routes are available. Save a provider configuration first.', noModels: 'No models match this filter.', catalogMissing: 'Bundled vendor metadata is unavailable. Check the plugin files; this page does not download or update data.',
      catalogTime: 'Bundled metadata generated at', catalogCounts: 'Bundled models / original vendors', catalogError: 'Bundled metadata failed to load',
      provenance: 'The models.dev original-vendor catalogs are compiled into this package, excluding third-party platforms. This is not vendor certification of the endpoint.',
      effortNotice: 'Injected reasoning levels exclude off. An existing off entry in a reliable mapping is removed in the preview and saved only after confirmation. Non-reasoning capability stays false; unknown levels are not invented.',
      error: 'Operation failed', malformed: 'The Host returned an invalid response. Reload configuration.', unavailable: 'The model enhancement service is unavailable.',
      matched: 'Matched', ambiguous: 'Confirm source', unmatched: 'Unmatched', candidate: 'Original-vendor candidate', chooseCandidate: 'Choose a specific vendor candidate',
      vendorImageInput: 'Image input in original-vendor metadata', imageSupported: 'Supported', imageUnsupported: 'Not supported', imageUnknown: 'Unknown (no change)',
      imageInputNotice: 'This capability is recorded in the selected original-vendor metadata; it does not guarantee actual image-input support at the current endpoint.',
      inputField: 'Image input capability (input)', inputUnspecified: 'Unspecified / inherited', rawJson: 'Raw JSON',
      selectModel: 'View recommendation', more: 'Show 50 more', limited: 'List rendering is bounded. Narrow the results with the filter.', count: 'Shown / matching models',
      overwrite: 'Allow replacing existing fields (impact confirmation required before applying)', preview: 'Regenerate preview', previewTitle: 'Configuration preview',
      before: 'Current value', after: 'Suggested value', field: 'Field', warnings: 'Warnings', blockers: 'Application blockers',
      confirm: 'I reviewed the field-overwrite impact and confirm this preview.', apply: 'Apply recommended configuration', nothing: 'No field changes.',
      savedVerified: 'Configuration fields were saved and checked. Remote model calls were not verified.', savedUnverified: 'Configuration was saved, but verification failed. Check the warnings; do not blindly repeat the write.',
      notSaved: 'Configuration was not saved. Check the result and warnings.', readOnly: 'This route is read-only', result: 'Application result', noPreview: 'Choose a model and original-vendor candidate to preview recommendations.',
    }
    // Inherit the app's resolved color-scheme, not the OS preference. Every
    // surface and native option uses the same live light/dark alias palette.
    const CSS = `
[data-dme] { color-scheme: inherit; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 1.5; border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 16px; margin-top: 16px; }
[data-dme] h3, [data-dme] h4, [data-dme] p { margin: 0 0 8px; }
[data-dme] .dme-muted { color: var(--dsw-alias-label-secondary); }
[data-dme] .dme-controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin: 12px 0; }
[data-dme] .dme-controls > label { flex: 1 1 220px; }
[data-dme] label { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
[data-dme] .dme-check { flex-direction: row; align-items: start; margin: 8px 0; }
[data-dme] input, [data-dme] select, [data-dme] button { font: inherit; color: var(--dsw-alias-label-primary); max-width: 100%; box-sizing: border-box; color-scheme: inherit; }
[data-dme] button, [data-dme] select, [data-dme] input[type='search'] { padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 6px); background: var(--dsw-alias-bg-layer-1); }
[data-dme] select, [data-dme] input[type='search'] { width: 100%; }
[data-dme] select option, [data-dme] select optgroup { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-overlay); }
[data-dme] input[type='search']::placeholder { color: var(--dsw-alias-label-secondary); opacity: 1; }
[data-dme] input[type='checkbox'] { accent-color: var(--dsw-alias-brand-primary); margin: 4px 0 0; flex: none; }
[data-dme] button { cursor: pointer; }
[data-dme] button:hover:not(:disabled), [data-dme] select:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-brand-primary); }
[data-dme] button:active:not(:disabled) { background: var(--dsw-alias-bg-base); }
[data-dme] button:disabled, [data-dme] select:disabled, [data-dme] input:disabled { cursor: not-allowed; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-base); border-color: var(--dsw-alias-border-l1); opacity: 1; }
[data-dme] :focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
[data-dme] .dme-scroll { overflow: auto; max-height: 360px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 6px); }
[data-dme] .dme-model { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; padding: 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
[data-dme] .dme-model:last-child { border-bottom: 0; }
[data-dme] .dme-model:hover { background: var(--dsw-alias-bg-layer-2); }
[data-dme] .dme-model[data-selected='true'] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, var(--dsw-alias-bg-layer-1)); box-shadow: inset 3px 0 var(--dsw-alias-brand-primary); }
[data-dme] .dme-details { margin-top: 12px; padding: 12px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 6px); }
[data-dme] .dme-values { overflow-wrap: anywhere; white-space: pre-wrap; }
[data-dme] table { width: 100%; border-collapse: collapse; }
[data-dme] thead { background: var(--dsw-alias-bg-layer-2); }
[data-dme] th, [data-dme] td { padding: 6px; text-align: start; vertical-align: top; border-bottom: 1px solid var(--dsw-alias-border-l1); }
[data-dme] .dme-notice { --dme-notice-tone: var(--dsw-alias-brand-primary); border-inline-start: 3px solid var(--dme-notice-tone); padding: 8px 10px; margin: 8px 0; overflow-wrap: anywhere; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); background: color-mix(in srgb, var(--dme-notice-tone) 8%, var(--dsw-alias-bg-layer-1)); }
[data-dme] .dme-notice-error { --dme-notice-tone: var(--dsw-alias-state-error-primary); }
[data-dme] .dme-notice-warning { --dme-notice-tone: var(--dsw-alias-state-warn-primary); }
[data-dme] .dme-notice-success { --dme-notice-tone: var(--dsw-alias-state-success-primary); }
`

    const text = (value) => {
      if (value === undefined) return '—'
      if (typeof value === 'string') return value
      try { return JSON.stringify(value) ?? '—' } catch { return String(value) }
    }
    const imageInputState = (input) => Array.isArray(input) && input.includes('image') ? 'imageSupported'
      : Array.isArray(input) && input.includes('text') ? 'imageUnsupported' : 'imageUnknown'
    const errorOf = (error) => ({ code: typeof error?.code === 'string' ? error.code : '', message: typeof error?.message === 'string' ? error.message : text(error) })
    const malformed = () => Object.assign(new Error('Invalid Host response'), { code: 'model-enhance/client-response' })

    // Independent of React: asynchronous results are scoped to their originating
    // selection and discarded after configuration reload, selection changes, or disposal.
    class Controller {
      constructor(ctx) {
        this.ctx = ctx
        this.listeners = new Set()
        this.disposed = false
        this.statusSeq = 0
        this.scanSeq = 0
        this.previewSeq = 0
        this.applying = false
        this.state = {
          status: null, loading: '', error: null, provider: '', sourceProvider: '', scan: null,
          filter: '', limit: PAGE, modelId: '', sourceKey: '', preview: null, confirmed: false,
          overwrite: false, result: null,
        }
        this.store = {
          getSnapshot: () => this.state,
          subscribe: (listener) => {
            if (this.disposed) return () => {}
            this.listeners.add(listener)
            return () => this.listeners.delete(listener)
          },
        }
      }
      publish(patch) {
        if (this.disposed) return
        this.state = { ...this.state, ...patch }
        for (const listener of this.listeners) listener()
      }
      async call(method, input) {
        const service = this.ctx.remote?.modelEnhance
        if (typeof service?.[method] !== 'function') throw Object.assign(new Error('Service unavailable'), { code: 'model-enhance/client-unavailable' })
        const response = input === undefined ? await service[method]() : await service[method](input)
        if (response?.ok === false) throw response.error ?? malformed()
        if (response?.ok !== true || !Object.hasOwn(response, 'value')) throw malformed()
        return response.value
      }
      invalidatePreview() {
        this.previewSeq++
        return { preview: null, confirmed: false, result: null, error: null }
      }
      async load() {
        if (this.disposed || this.applying) return
        const seq = ++this.statusSeq
        ++this.scanSeq
        this.publish({ ...this.invalidatePreview(), loading: 'status', scan: null, modelId: '', sourceKey: '' })
        try {
          const value = await this.call('status')
          if (this.disposed || seq !== this.statusSeq) return
          if (!value?.catalog || value.catalog.bundled !== true || value.catalog.source !== 'bundled-official'
            || !Array.isArray(value.routes) || !Array.isArray(value.sourceProviders)) throw malformed()
          const provider = value.routes.some((route) => route.provider === this.state.provider) ? this.state.provider : ''
          this.publish({ status: value, provider, loading: '' })
        } catch (error) {
          if (!this.disposed && seq === this.statusSeq) this.publish({ loading: '', error: errorOf(error) })
        }
      }
      setProvider(provider) {
        if (this.disposed || this.applying) return
        ++this.scanSeq
        this.publish({ ...this.invalidatePreview(), provider, scan: null, modelId: '', sourceKey: '', loading: '', filter: '', limit: PAGE })
      }
      setSource(sourceProvider) {
        if (this.disposed || this.applying) return
        ++this.scanSeq
        this.publish({ ...this.invalidatePreview(), sourceProvider, scan: null, modelId: '', sourceKey: '', loading: '' })
      }
      setFilter(filter) { if (!this.disposed) this.publish({ filter, limit: PAGE }) }
      showMore() { if (!this.disposed) this.publish({ limit: Math.min(this.state.limit + PAGE, MAX_VISIBLE) }) }
      async scan() {
        if (this.disposed || this.applying || !this.state.provider) return
        const provider = this.state.provider
        const seq = ++this.scanSeq
        this.publish({ ...this.invalidatePreview(), scan: null, modelId: '', sourceKey: '', loading: 'scan', limit: PAGE })
        try {
          const value = await this.call('scan', { provider, ...(this.state.sourceProvider ? { sourceProvider: this.state.sourceProvider } : {}) })
          if (this.disposed || seq !== this.scanSeq || provider !== this.state.provider) return
          if (value?.provider !== provider || !Array.isArray(value.models) || !Array.isArray(value.warnings)) throw malformed()
          this.publish({ scan: value, loading: '' })
        } catch (error) {
          if (!this.disposed && seq === this.scanSeq) this.publish({ loading: '', error: errorOf(error) })
        }
      }
      selectModel(modelId) {
        if (this.disposed || this.applying) return
        const model = this.state.scan?.models.find((entry) => entry.id === modelId)
        if (!model) return
        const candidates = model.match?.candidates ?? []
        const sourceKey = model.match?.status === 'matched' && candidates.length === 1 ? candidates[0].key : ''
        this.publish({ ...this.invalidatePreview(), modelId, sourceKey, loading: '' })
        if (sourceKey) void this.preview()
      }
      selectCandidate(sourceKey) {
        if (this.disposed || this.applying) return
        const model = this.state.scan?.models.find((entry) => entry.id === this.state.modelId)
        if (sourceKey && !model?.match?.candidates?.some((candidate) => candidate.key === sourceKey)) return
        this.publish({ ...this.invalidatePreview(), sourceKey, loading: '' })
        if (sourceKey) void this.preview()
      }
      setOption(key, value) {
        if (this.disposed || this.applying || key !== 'overwrite') return
        this.publish({ ...this.invalidatePreview(), [key]: value === true, loading: '' })
        if (this.state.modelId && this.state.sourceKey) void this.preview()
      }
      confirm(value) { if (!this.disposed && !this.applying) this.publish({ confirmed: value === true }) }
      async preview() {
        if (this.disposed || this.applying || !this.state.modelId || !this.state.sourceKey) return
        const seq = ++this.previewSeq
        const { provider, modelId, sourceKey, overwrite } = this.state
        this.publish({ preview: null, confirmed: false, result: null, error: null, loading: 'preview' })
        try {
          const value = await this.call('preview', { provider, modelId, sourceKey, overwrite })
          if (this.disposed || seq !== this.previewSeq) return
          if (typeof value?.token !== 'string' || !value.token || !Array.isArray(value.changes)
            || !Array.isArray(value.warnings) || !Array.isArray(value.blockers)
            || typeof value.canApply !== 'boolean' || typeof value.requiresConfirmation !== 'boolean') throw malformed()
          this.publish({ preview: value, loading: '' })
        } catch (error) {
          if (!this.disposed && seq === this.previewSeq) this.publish({ loading: '', error: errorOf(error) })
        }
      }
      async apply() {
        const preview = this.state.preview
        const route = this.state.status?.routes.find((entry) => entry.provider === this.state.provider)
        if (this.disposed || this.applying || this.state.loading || !route?.writable || !preview?.canApply
          || preview.blockers.length || (preview.requiresConfirmation && !this.state.confirmed)) return
        this.applying = true
        ++this.previewSeq
        this.publish({ loading: 'apply', error: null, result: null })
        try {
          // Tokens are Host-owned, single-use plans. Never send client field ops.
          const result = await this.call('apply', { token: preview.token, confirm: preview.requiresConfirmation ? this.state.confirmed : false })
          if (this.disposed) return
          if (typeof result?.saved !== 'boolean' || typeof result.verified !== 'boolean' || !Array.isArray(result.warnings)) throw malformed()
          this.publish({ result })
        } catch (error) {
          if (!this.disposed) this.publish({ error: errorOf(error) })
        } finally {
          this.applying = false
          // Even an uncertain/failed write must be re-previewed, not replayed.
          this.publish({ loading: '', preview: null, confirmed: false })
        }
      }
      dispose() {
        if (this.disposed) return
        this.disposed = true
        ++this.statusSeq; ++this.scanSeq; ++this.previewSeq
        this.listeners.clear()
      }
    }

    function Panel({ t, useEnhance, actions }) {
      const state = useEnhance((snapshot) => snapshot)
      const busy = Boolean(state.loading)
      const status = state.status
      const route = status?.routes.find((entry) => entry.provider === state.provider)
      const model = state.scan?.models.find((entry) => entry.id === state.modelId)
      const preview = state.preview
      const catalog = status?.catalog
      const generated = catalog?.generatedAt ? new Date(catalog.generatedAt) : null
      const query = state.filter.trim().toLowerCase()
      const matching = (state.scan?.models ?? []).filter((entry) => `${entry.id} ${entry.name}`.toLowerCase().includes(query))
      const visible = matching.slice(0, state.limit)
      const candidates = model?.match?.candidates ?? []
      const selectedCandidate = candidates.find((candidate) => candidate.key === state.sourceKey)
      const inputValue = (value) => h('div', null,
        h('div', null, t(imageInputState(value) === 'imageUnknown' ? 'inputUnspecified' : imageInputState(value))),
        h('div', null, t('rawJson'), ': ', h('code', null, text(value))))
      const button = (key, fn, disabled = busy) => h('button', { type: 'button', disabled, onClick: () => { void fn() } }, t(key))
      const notices = (key, values) => values?.length ? h('div', { className: `dme-notice dme-notice-${key === 'blockers' ? 'error' : 'warning'}` }, h('strong', null, t(key)), h('ul', null, values.slice(0, 100).map((value, index) => h('li', { key: index }, text(value))))) : null
      const check = (key) => h('label', { className: 'dme-check' }, h('input', { type: 'checkbox', checked: state[key], disabled: busy, onChange: (event) => actions.setOption(key, event.target.checked) }), t(key))
      return h('section', { 'data-dme': '', 'aria-label': t('title'), 'aria-busy': busy },
        h('style', null, CSS), h('h3', null, t('title')), h('p', { className: 'dme-muted' }, t('description')),
        h('p', { className: 'dme-muted' }, t('provenance')),
        h('p', { className: 'dme-notice dme-notice-warning' }, t('effortNotice')),
        h('div', { className: 'dme-controls' }, button('reload', () => actions.load())),
        busy ? h('p', { role: 'status', 'aria-live': 'polite' }, t('loading')) : null,
        state.error ? h('p', { role: 'alert', className: 'dme-notice dme-notice-error' }, t('error'), ': ',
          state.error.code === 'model-enhance/client-response' ? t('malformed') : state.error.code === 'model-enhance/client-unavailable' ? t('unavailable') : state.error.message) : null,
        catalog ? h('div', null,
          h('p', null, t('catalogTime'), ': ', generated && Number.isFinite(generated.getTime()) ? generated.toLocaleString() : text(catalog.generatedAt)),
          h('p', null, t('catalogCounts'), ': ', text(catalog.models), ' / ', text(catalog.providers)),
          !catalog.available ? h('p', { className: 'dme-notice dme-notice-warning' }, t('catalogMissing')) : null,
          catalog.lastError ? h('p', { className: 'dme-notice dme-notice-warning' }, t('catalogError'), ': ', text(catalog.lastError)) : null) : null,
        status && status.routes.length === 0 ? h('p', null, t('noRoutes')) : null,
        h('div', { className: 'dme-controls' },
          h('label', null, t('provider'), h('select', { value: state.provider, disabled: busy, onChange: (event) => actions.setProvider(event.target.value) },
            h('option', { value: '' }, t('chooseProvider')), (status?.routes ?? []).map((entry) => h('option', { key: entry.provider, value: entry.provider }, `${entry.displayName} (${entry.provider})`)))),
          h('label', null, t('source'), h('select', { value: state.sourceProvider, disabled: busy, onChange: (event) => actions.setSource(event.target.value) },
            h('option', { value: '' }, t('autoSource')), (status?.sourceProviders ?? []).map((entry) => h('option', { key: entry.id, value: entry.id }, `${entry.name} (${entry.id})`)))),
          button('scan', () => actions.scan(), busy || !state.provider || !catalog?.available)),
        route && !route.writable ? h('p', { className: 'dme-notice dme-notice-warning' }, t('readOnly'), ': ', text(route.reason)) : null,
        notices('warnings', state.scan?.warnings),
        state.scan ? h('div', null,
          h('label', null, t('filter'), h('input', { type: 'search', value: state.filter, onChange: (event) => actions.setFilter(event.target.value) })),
          h('p', { role: 'status' }, t('count'), ': ', visible.length, ' / ', matching.length),
          matching.length === 0 ? h('p', null, t('noModels')) : null,
          h('div', { className: 'dme-scroll' }, visible.map((entry) => h('div', { key: entry.id, className: 'dme-model', 'data-selected': entry.id === state.modelId },
            h('span', { className: 'dme-values' }, text(entry.name), ' — ', text(entry.id), ' · ', t(['matched', 'ambiguous', 'unmatched'].includes(entry.match?.status) ? entry.match.status : 'unmatched')),
            h('button', { type: 'button', disabled: busy, 'aria-label': `${t('selectModel')}: ${entry.name} (${entry.id})`, onClick: () => actions.selectModel(entry.id) }, t('selectModel'))))),
          matching.length > visible.length ? h('div', null, h('p', null, t('limited')), state.limit < MAX_VISIBLE ? button('more', () => actions.showMore(), false) : null) : null) : null,
        model ? h('div', { className: 'dme-details' }, h('h4', null, text(model.name), ' — ', text(model.id)),
          h('label', null, t('candidate'), h('select', { value: state.sourceKey, disabled: busy, onChange: (event) => actions.selectCandidate(event.target.value) },
            h('option', { value: '' }, t('chooseCandidate')), candidates.slice(0, MAX_VISIBLE).map((candidate) => h('option', { key: candidate.key, value: candidate.key }, `${candidate.name} — ${candidate.provider}/${candidate.id} (${candidate.confidence})`)))),
          candidates.length > MAX_VISIBLE ? h('p', null, t('limited')) : null,
          selectedCandidate ? h('div', { className: 'dme-notice', role: 'status', 'aria-live': 'polite' },
            h('p', null, h('strong', null, t('vendorImageInput')), ': ', t(imageInputState(selectedCandidate.input))),
            h('p', null, t('imageInputNotice'))) : null,
          check('overwrite'),
          button('preview', () => actions.preview(), busy || !state.sourceKey),
          !preview ? h('p', null, t('noPreview')) : h('div', null,
            h('h4', null, t('previewTitle')),
            preview.changes.length ? h('div', { className: 'dme-scroll' }, h('table', null,
              h('thead', null, h('tr', null, h('th', { scope: 'col' }, t('field')), h('th', { scope: 'col' }, t('before')), h('th', { scope: 'col' }, t('after')))),
              h('tbody', null, preview.changes.slice(0, MAX_VISIBLE).map((change, index) => h('tr', { key: index },
                h('th', { scope: 'row' }, change.field === `${state.modelId}.input` ? t('inputField') : text(change.field)),
                h('td', { className: 'dme-values' }, change.field === `${state.modelId}.input` ? inputValue(change.before) : text(change.before)),
                h('td', { className: 'dme-values' }, change.field === `${state.modelId}.input` ? inputValue(change.after) : text(change.after))))))) : h('p', null, t('nothing')),
            notices('warnings', preview.warnings), notices('blockers', preview.blockers),
            preview.requiresConfirmation ? h('label', { className: 'dme-check' }, h('input', { type: 'checkbox', checked: state.confirmed, disabled: busy, onChange: (event) => actions.confirm(event.target.checked) }), t('confirm')) : null,
            button('apply', () => actions.apply(), busy || !route?.writable || !preview.canApply || preview.blockers.length > 0 || (preview.requiresConfirmation && !state.confirmed)))) : null,
        state.result ? h('div', { role: 'status', className: `dme-notice dme-notice-${state.result.saved && state.result.verified ? 'success' : 'warning'}`, 'aria-live': 'polite' }, h('h4', null, t('result')),
          h('p', null, t(state.result.saved ? state.result.verified ? 'savedVerified' : 'savedUnverified' : 'notSaved')),
          notices('warnings', state.result.warnings)) : null)
    }

    return {
      inject: ['locale', 'remote', 'slots'],
      async apply(ctx) {
        let disposed = false
        ctx.effect(() => () => { disposed = true }, 'dsh-model-enhance.lifetime')
        const unmount = await ctx.remote.$mount(REMOTE)
        if (disposed) { await unmount(); return }
        ctx.effect(() => unmount, 'dsh-model-enhance.remote')
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-model-enhance.locale')
        // $mount provides a distinct Cordis service. Inject it only after
        // mounting, otherwise startup would wait for its own missing service.
        await ctx.inject(['remote.modelEnhance'], (scope) => {
          const controller = new Controller(scope)
          scope.effect(() => () => controller.dispose(), 'dsh-model-enhance.controller')
          scope.slots.inject('settings.models.footer', () => scope.slots.register({
            name: 'settings.models.footer', id: 'dsh-model-enhance', order: 10, locale: NS,
            inject: () => ({ hooks: { enhance: controller.store }, actions: controller }),
          }, Panel))
          void controller.load()
        })
      },
    }
  },
})
