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
    // Adapt the existing Host string contract without requiring a Host/Client upgrade in lockstep.
    const WARNING_KEYS = new Map([
      ['Only models already available in DSH for this provider are listed. No provider model-discovery or inference request was made.', 'warnLocalModels'],
      ['No valid model record was supplied.', 'warnInvalidRecord'],
      ['maxTokens is the catalog output limit, not a recommended routine request budget.', 'warnOutputLimit'],
      ['Maximum output is a catalog limit, not a recommended routine request budget.', 'warnOutputLimit'],
      ['Source input modalities are unknown; existing image capability is preserved and no input setting is imported.', 'warnUnknownInput'],
      ['Some source efforts have no verified protocol mapping; none is never converted to off.', 'warnUnmappedEfforts'],
      ['This API has no verified direct reasoning-effort mapping; configure its wire values manually.', 'warnUnverifiedEffortApi'],
      ['Reasoning is advertised, but no safe effort mapping could be recommended.', 'warnNoSafeEffort'],
      ['Toggle, token-budget, or unknown reasoning options are informational; they are not converted into effort levels.', 'warnInformationalEffort'],
      ['Source reasoning capability is unknown; no reasoning configuration is imported.', 'warnUnknownReasoning'],
      ['Existing input modalities are preserved. To apply the catalog image capability, enable overwrite and confirm the preview.', 'warnPreservedInput'],
      ['Non-reasoning capability is preserved as false.', 'warnNoReasoning'],
      ['The existing off level is removed from the reasoning mapping; review the change before applying.', 'warnOffRemoved'],
      ['No reliable non-off effort mapping is available; original reasoning capability is preserved and no level is invented.', 'warnPreservedReasoning'],
      ['Default reasoning selection and repair are deferred (see TODO.md); provider and explicit session defaults are not changed or certified.', 'warnDefaultReasoning'],
      ['Settings write completed, but read-back did not verify the expected fields. Do not blindly repeat it.', 'warnReadBack'],
    ])
    const zh = {
      title: '模型资料增强', description: '匹配已添加模型，预览原厂推荐参数，确认后安全写入配置。',
      bundled: '工程内置', rules: '资料来源与注入规则', stepProvider: '选择服务商', stepMatch: '匹配模型', stepApply: '预览并应用',
      setupTitle: '选择匹配范围', localOnly: '只读取已添加模型，不请求远端模型清单。', changeProvider: '更换服务商', backModels: '返回模型列表',
      resultsTitle: '已添加模型', resultsHint: '选择模型，查看原厂资料与配置建议。', noAddedModels: '该服务商没有已添加模型，请先在原生设置中添加并保存。',
      noCandidates: '未找到原厂资料候选。可返回并更换资料来源后重新匹配；没有明确候选时不会生成建议。',
      overwriteHint: '关闭时只填空；移除可靠思考映射中的 off 仍需确认。', changes: '项字段变更', noWrite: '无需写入配置',
      safeWrite: '仅保存本次预览字段，不修改端点、凭据与模型 ID。', offRemoved: '本次预览移除 off 档位，请核对完整映射后确认。',
      savedTitle: '配置已保存并核对', unverifiedTitle: '保存结果需要检查', rescan: '读取最新模型', previewHint: '选择候选后自动预览；预览失效时请重新生成。',
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
      before: '当前值', after: '建议值', field: '字段', blockers: '阻止应用的原因',
      scanWarnings: '模型匹配注意事项', previewWarnings: '配置预览注意事项', resultWarnings: '保存结果注意事项',
      warnLocalModels: '仅列出此服务商在 DSH 中已添加的模型，未请求上游模型清单或调用模型。',
      warnInvalidRecord: '没有可用的模型资料记录。',
      warnOutputLimit: 'maxTokens 是资料标注的输出上限，并非常规请求的推荐预算。',
      warnUnknownInput: '资料未说明输入类型，不导入输入设置，并保留现有图片输入能力。',
      warnUnmappedEfforts: '部分思考档位没有经过验证的协议映射；不会将 none 转换为 off。',
      warnUnverifiedEffortApi: '此 API 没有经过验证的思考档位直通映射，请手动配置协议值。',
      warnNoSafeEffort: '资料标注支持推理，但无法安全推荐思考档位映射。',
      warnInformationalEffort: '推理开关、token 预算或未知选项仅供参考，不会转换为思考档位。',
      warnUnknownReasoning: '资料未说明推理能力，不会导入推理配置。',
      warnPreservedInput: '已保留现有输入类型。若要应用资料中的图片输入能力，请启用覆盖并确认预览。',
      warnNoReasoning: '不支持推理的能力标记保留为 false。',
      warnOffRemoved: '此变更会移除思考映射中的 off 档位，请核对后再应用。',
      warnPreservedReasoning: '未找到可靠的非 off 档位映射；保留原有推理能力，不虚构档位。',
      warnDefaultReasoning: '暂不处理默认思考档位的选择与修复（见 TODO.md）；不修改或核验服务商及显式会话默认值。',
      warnReadBack: '设置已写入，但回读未能核对预期字段。请先检查，不要盲目重复写入。',
      warnUnknown: '未识别的注意事项（原始详情）',
      confirm: '我已检查字段覆盖影响，确认应用此预览。', apply: '一键配置推荐参数', nothing: '没有字段变更。',
      savedVerified: '配置字段已保存并核对；远端模型调用未经验证。', savedUnverified: '配置已保存，但验证未通过；请检查警告，不要重复盲目写入。',
      notSaved: '配置未保存，请检查结果与警告。', readOnly: '该路由不可写', result: '应用结果', noPreview: '选择模型及原厂资料候选以预览推荐。',
    }
    const en = {
      title: 'Model recommendations', description: 'Match added models, preview vendor recommendations, and safely save confirmed changes.',
      bundled: 'Bundled metadata', rules: 'Metadata sources and injection rules', stepProvider: 'Choose provider', stepMatch: 'Match models', stepApply: 'Preview and apply',
      setupTitle: 'Choose matching scope', localOnly: 'Only reads added models; no remote model-list requests.', changeProvider: 'Change provider', backModels: 'Back to models',
      resultsTitle: 'Added models', resultsHint: 'Choose a model to review vendor metadata and recommendations.', noAddedModels: 'This provider has no added models. Add and save models in the native settings first.',
      noCandidates: 'No vendor candidates found. Go back and try another metadata source; no recommendations are generated without a specific candidate.',
      overwriteHint: 'When off, only empty fields are filled. Removing off from reliable reasoning mappings still requires confirmation.', changes: 'field changes', noWrite: 'No configuration write needed',
      safeWrite: 'Saves only previewed fields; endpoint, credentials, and model ID stay unchanged.', offRemoved: 'This preview removes the off level. Review the complete mapping before confirming.',
      savedTitle: 'Configuration saved and checked', unverifiedTitle: 'Check the save result', rescan: 'Read latest models', previewHint: 'Selecting a candidate generates a preview. Regenerate it if the preview expires.',
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
      before: 'Current value', after: 'Suggested value', field: 'Field', blockers: 'Application blockers',
      scanWarnings: 'Model matching warnings', previewWarnings: 'Configuration preview warnings', resultWarnings: 'Save result warnings',
      warnLocalModels: 'Only models already added in DSH are listed. No upstream model list or inference was requested.',
      warnInvalidRecord: 'No usable model metadata record was supplied.',
      warnOutputLimit: 'maxTokens is the catalog output limit, not a recommended routine request budget.',
      warnUnknownInput: 'The source does not specify input types. No input setting is imported, and existing image input is preserved.',
      warnUnmappedEfforts: 'Some reasoning levels have no verified protocol mapping. none is never converted to off.',
      warnUnverifiedEffortApi: 'This API has no verified direct reasoning-effort mapping. Configure its wire values manually.',
      warnNoSafeEffort: 'The source advertises reasoning, but no safe reasoning-effort mapping could be recommended.',
      warnInformationalEffort: 'Reasoning toggles, token budgets and unknown options are informational and are not converted into effort levels.',
      warnUnknownReasoning: 'The source does not specify reasoning capability. No reasoning setting is imported.',
      warnPreservedInput: 'Existing input types are preserved. To use the catalog image capability, enable overwrite and confirm the preview.',
      warnNoReasoning: 'The non-reasoning flag remains false.',
      warnOffRemoved: 'This change removes the off level from the reasoning mapping. Review it before applying.',
      warnPreservedReasoning: 'No reliable non-off mapping is available. Existing reasoning capability is preserved and no level is invented.',
      warnDefaultReasoning: 'Default reasoning selection and repair are deferred (see TODO.md). Provider and explicit session defaults are not changed or verified.',
      warnReadBack: 'Settings were written, but read-back could not verify the expected fields. Inspect the result before writing again.',
      warnUnknown: 'Unrecognized warning (original detail)',
      confirm: 'I reviewed the field-overwrite impact and confirm this preview.', apply: 'Apply recommended configuration', nothing: 'No field changes.',
      savedVerified: 'Configuration fields were saved and checked. Remote model calls were not verified.', savedUnverified: 'Configuration was saved, but verification failed. Check the warnings; do not blindly repeat the write.',
      notSaved: 'Configuration was not saved. Check the result and warnings.', readOnly: 'This route is read-only', result: 'Application result', noPreview: 'Choose a model and original-vendor candidate to preview recommendations.',
    }
    // Inherit the app's resolved color-scheme, not the OS preference. Every
    // surface and native option uses the same live light/dark alias palette.
    const CSS = `
[data-dme] { container-type: inline-size; color-scheme: inherit; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 24px; margin-top: 24px; display: flex; flex-direction: column; gap: 18px; min-width: 0; }
[data-dme] * { box-sizing: border-box; }
[data-dme] h3, [data-dme] h4, [data-dme] p { margin: 0; overflow-wrap: anywhere; }
[data-dme] h3 { font-size: 17px; font-weight: 600; }
[data-dme] h4 { font-size: 14px; font-weight: 600; }
[data-dme] .dme-muted { color: var(--dsw-alias-label-secondary); font-size: 12px; }
[data-dme] .dme-stack { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
[data-dme] .dme-header, [data-dme] .dme-toolbar, [data-dme] .dme-actions, [data-dme] .dme-title-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; }
[data-dme] .dme-header { align-items: flex-start; }
[data-dme] .dme-heading { flex: 1 1 200px; min-width: 0; }
[data-dme] .dme-heading p { margin-top: 5px; }
[data-dme] .dme-symbol { display: grid; place-items: center; width: 38px; height: 38px; flex: none; border: 1px solid var(--dsw-alias-border-l2); border-radius: 11px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
[data-dme] .dme-icon { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
[data-dme] .dme-meta { display: flex; flex-wrap: wrap; gap: 6px 18px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); font-size: 11px; color: var(--dsw-alias-label-secondary); }
[data-dme] .dme-meta strong { font-weight: 500; color: var(--dsw-alias-label-primary); }
[data-dme] details { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); }
[data-dme] summary { padding: 10px 12px; cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 12px; }
[data-dme] .dme-rules-body { display: flex; flex-direction: column; gap: 8px; padding: 0 12px 12px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
[data-dme] .dme-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); list-style: none; gap: 10px; margin: 0; padding: 0; }
[data-dme] .dme-step { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 11px; min-width: 0; }
[data-dme] .dme-step-number { display: grid; place-items: center; flex: none; width: 24px; height: 24px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 50%; }
[data-dme] .dme-step[aria-current='step'] { color: var(--dsw-alias-label-primary); font-weight: 600; }
[data-dme] .dme-step[aria-current='step'] .dme-step-number { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); }
[data-dme] .dme-step[data-complete='true'] .dme-step-number { color: var(--dsw-alias-state-success-primary); border-color: currentColor; }
[data-dme] .dme-card { padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); }
[data-dme] .dme-controls, [data-dme] .dme-diff-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); gap: 12px; }
[data-dme] label { display: flex; flex-direction: column; gap: 6px; min-width: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
[data-dme] .dme-check { flex-direction: row; align-items: start; gap: 9px; }
[data-dme] .dme-check small { display: block; margin-top: 3px; }
[data-dme] input, [data-dme] select, [data-dme] button { font: inherit; color: var(--dsw-alias-label-primary); max-width: 100%; color-scheme: inherit; }
[data-dme] button, [data-dme] select, [data-dme] input[type='search'] { min-height: 36px; padding: 7px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
[data-dme] select, [data-dme] input[type='search'] { width: 100%; min-width: 0; }
[data-dme] select option, [data-dme] select optgroup { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-overlay); }
[data-dme] input[type='search']::placeholder { color: var(--dsw-alias-label-secondary); opacity: 1; }
[data-dme] input[type='checkbox'] { accent-color: var(--dsw-alias-brand-primary); margin: 3px 0 0; flex: none; }
[data-dme] button { cursor: pointer; font-size: 12px; }
[data-dme] button:hover:not(:disabled), [data-dme] select:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-label-secondary); }
[data-dme] button:active:not(:disabled) { background: var(--dsw-alias-bg-base); }
[data-dme] button.dme-primary:not(:disabled) { color: var(--dsw-alias-bg-base); background: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-primary); font-weight: 600; }
[data-dme] button.dme-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-label-primary) 85%, var(--dsw-alias-bg-base)); }
[data-dme] button:disabled, [data-dme] select:disabled, [data-dme] input:disabled { cursor: not-allowed; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-base); border-color: var(--dsw-alias-border-l1); opacity: 1; }
[data-dme] :focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
[data-dme] .dme-actions { justify-content: space-between; }
[data-dme] .dme-actions > .dme-muted { flex: 1 1 200px; }
[data-dme] .dme-toolbar { justify-content: space-between; }
[data-dme] .dme-summary { padding: 11px 13px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); }
[data-dme] .dme-list { display: grid; gap: 8px; max-height: 420px; overflow: auto; padding: 3px; }
[data-dme] .dme-model { width: 100%; min-height: 66px; display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; padding: 11px 12px; text-align: start; border-radius: 12px; }
[data-dme] .dme-identity { flex: 1 1 160px; min-width: 0; }
[data-dme] .dme-identity strong, [data-dme] .dme-identity code { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-dme] .dme-identity code { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
[data-dme] .dme-row-action { color: var(--dsw-alias-label-secondary); display: inline-flex; align-items: center; gap: 4px; font-size: 11px; }
[data-dme] .dme-badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
[data-dme] .dme-badge[data-tone='matched'] { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, currentColor 30%, var(--dsw-alias-border-l1)); }
[data-dme] .dme-badge[data-tone='ambiguous'] { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, currentColor 30%, var(--dsw-alias-border-l1)); }
[data-dme] .dme-empty { padding: 28px 16px; text-align: center; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 12px; color: var(--dsw-alias-label-secondary); }
[data-dme] .dme-values { overflow-wrap: anywhere; white-space: pre-wrap; min-width: 0; }
[data-dme] .dme-preview { border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
[data-dme] .dme-preview-header { padding: 13px 15px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
[data-dme] .dme-diff { padding: 15px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
[data-dme] .dme-diff:last-child { border-bottom: 0; }
[data-dme] .dme-diff-field { margin-bottom: 10px; font-size: 12px; overflow-wrap: anywhere; }
[data-dme] .dme-diff-column { min-width: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); }
[data-dme] .dme-diff-column[data-after='true'] { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 25%, var(--dsw-alias-border-l1)); }
[data-dme] .dme-diff-label { padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 11px; color: var(--dsw-alias-label-secondary); }
[data-dme] .dme-diff-value { padding: 10px; font-size: 12px; }
[data-dme] .dme-off-removed { margin-top: 8px; color: var(--dsw-alias-state-warn-primary); font-size: 11px; }
[data-dme] .dme-confirm { padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); }
[data-dme] .dme-notice { --dme-notice-tone: var(--dsw-alias-brand-primary); border: 1px solid color-mix(in srgb, var(--dme-notice-tone) 25%, var(--dsw-alias-border-l1)); border-radius: 8px; padding: 11px 12px; overflow-wrap: anywhere; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); background: color-mix(in srgb, var(--dme-notice-tone) 8%, var(--dsw-alias-bg-layer-1)); }
[data-dme] .dme-notice ul { margin: 8px 0 0; padding-inline-start: 20px; }
[data-dme] .dme-notice-error { --dme-notice-tone: var(--dsw-alias-state-error-primary); }
[data-dme] .dme-notice-warning { --dme-notice-tone: var(--dsw-alias-state-warn-primary); }
[data-dme] .dme-notice-success { --dme-notice-tone: var(--dsw-alias-state-success-primary); }
[data-dme] .dme-warning { display: inline-grid; flex: none; --dme-warning-bg: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, var(--dsw-alias-bg-layer-1)); }
[data-dme] button.dme-warning-trigger, [data-dme] button.dme-warning-trigger:hover:not(:disabled), [data-dme] button.dme-warning-trigger:active:not(:disabled) { display: grid; place-items: center; inline-size: 28px; min-block-size: 28px; block-size: 28px; padding: 0; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, var(--dsw-alias-border-l1)); border-radius: 50%; color: var(--dsw-alias-state-warn-primary); background: var(--dme-warning-bg); }
[data-dme] .dme-warning-popover { position: fixed; inset: auto; margin: 4px 8px; position-area: block-end span-inline-end; position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline, block-end span-all, block-start span-all; position-visibility: anchors-visible; justify-self: safe start; align-self: start; inline-size: min(380px, calc(100vw - 24px)); max-block-size: min(320px, 40dvh); overflow: auto; overscroll-behavior: contain; overflow-wrap: anywhere; background: var(--dme-warning-bg); box-shadow: var(--dsw-elevation-panel); }
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
      editSelection() {
        if (this.disposed || this.applying) return
        ++this.scanSeq
        this.publish({ ...this.invalidatePreview(), scan: null, modelId: '', sourceKey: '', loading: '' })
      }
      backToModels() {
        if (this.disposed || this.applying) return
        if (this.state.result) { void this.scan(); return }
        this.publish({ ...this.invalidatePreview(), modelId: '', sourceKey: '', loading: '' })
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

    const icon = (name) => h('svg', { className: 'dme-icon', viewBox: '0 0 24 24', 'aria-hidden': true, focusable: 'false' },
      h('path', { d: {
        spark: 'm12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z',
        check: 'm5 12 4 4L19 6', arrow: 'm9 5 7 7-7 7', back: 'm15 5-7 7 7 7',
        shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6',
      }[name] }))

    function WarningNotice({ t, label, values }) {
      const id = React.useId()
      const panel = React.useRef(null)
      const trigger = React.useRef(null)
      const closeTimer = React.useRef(null)
      const pinned = React.useRef(false)
      const cancelClose = () => clearTimeout(closeTimer.current)
      React.useEffect(() => () => clearTimeout(closeTimer.current), [])
      const warnings = [...new Set(values.slice(0, 100).map((value) => {
        const key = WARNING_KEYS.get(value)
        return key ? t(key) : `${t('warnUnknown')}: ${text(value)}`
      }))]
      const isOpen = () => panel.current?.matches(':popover-open')
      const show = () => {
        cancelClose()
        if (isOpen()) return
        pinned.current = false
        panel.current?.showPopover?.({ source: trigger.current })
      }
      const close = () => {
        cancelClose()
        pinned.current = false
        if (isOpen()) panel.current.hidePopover()
      }
      const anchorName = `--dme-warning-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`
      return h('div', {
        className: 'dme-warning',
        onPointerEnter: (event) => { if (event.pointerType !== 'touch') show() },
        onPointerLeave: (event) => {
          if (event.pointerType === 'touch') return
          cancelClose()
          // Allow the pointer to cross the gap to the top-layer popover.
          closeTimer.current = setTimeout(() => {
            if (!pinned.current && !trigger.current?.matches(':focus-visible') && !panel.current?.matches(':focus-within')) close()
          }, 180)
        },
        onBlur: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) close() },
      }, h('button', {
        ref: trigger, type: 'button', className: 'dme-warning-trigger', popovertarget: id,
        'aria-label': `${t(label)} (${warnings.length})`, style: { anchorName },
        onFocus: (event) => {
          if (event.currentTarget.matches(':focus-visible') && !panel.current?.contains(event.relatedTarget)) show()
        },
        onClick: (event) => {
          event.preventDefault()
          if (isOpen() && pinned.current) close()
          else { show(); pinned.current = true }
        },
      }, h('span', { 'aria-hidden': true }, '!')),
      h('div', { ref: panel, id, popover: 'auto', role: 'region', 'aria-label': t(label), tabIndex: 0,
        className: 'dme-notice dme-notice-warning dme-warning-popover', style: { positionAnchor: anchorName } },
      h('strong', null, t(label)), h('ul', null, warnings.map((message) => h('li', { key: message }, message)))))
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
      const view = !state.scan ? 'setup' : !model ? 'results' : state.result ? 'saved' : 'detail'
      const step = view === 'setup' ? 0 : view === 'results' ? 1 : 2
      const heading = React.useRef(null)
      const previousView = React.useRef(view)
      // Move focus only when navigation removes the invoking control.
      React.useEffect(() => {
        if (previousView.current !== view) heading.current?.focus()
        previousView.current = view
      }, [view])
      const previewButton = React.useRef(null)
      const wasApplying = React.useRef(false)
      React.useEffect(() => {
        if (wasApplying.current && state.loading !== 'apply' && state.error) previewButton.current?.focus()
        wasApplying.current = state.loading === 'apply'
      }, [state.loading, state.error])
      const query = state.filter.trim().toLowerCase()
      const matching = (state.scan?.models ?? []).filter((entry) => `${entry.id} ${entry.name}`.toLowerCase().includes(query))
      const visible = matching.slice(0, state.limit)
      const candidates = model?.match?.candidates ?? []
      const selectedCandidate = candidates.find((candidate) => candidate.key === state.sourceKey)
      const matchStatus = (entry) => ['matched', 'ambiguous', 'unmatched'].includes(entry.match?.status) ? entry.match.status : 'unmatched'
      const badge = (entry) => h('span', { className: 'dme-badge', 'data-tone': matchStatus(entry) }, matchStatus(entry) === 'matched' ? icon('check') : null, t(matchStatus(entry)))
      const inputValue = (value) => h('div', null,
        h('div', null, t(imageInputState(value) === 'imageUnknown' ? 'inputUnspecified' : imageInputState(value))),
        h('div', { className: 'dme-muted' }, t('rawJson'), ': ', h('code', null, text(value))))
      const button = (key, fn, disabled = busy, primary = false) => h('button', { type: 'button', ref: key === 'preview' ? previewButton : undefined, className: primary ? 'dme-primary' : undefined, disabled, onClick: () => { void fn() } }, t(key))
      const warningNotice = (label, values, key = label) => values?.length ? h(WarningNotice, { t, label, key, values }) : null
      const scopeSummary = h('div', { className: 'dme-summary dme-values dme-toolbar' },
        h('div', null, h('strong', null, text(route?.displayName ?? state.provider)), ' · ', h('code', null, text(state.provider)),
          h('p', { className: 'dme-muted' }, t('source'), ': ', state.sourceProvider || t('autoSource'))),
        warningNotice('scanWarnings', state.scan?.warnings, `scan-${view}-${state.modelId}`))
      const diff = (change) => {
        const isInput = change.field === `${state.modelId}.input`
        const offRemoved = change.field === `${state.modelId}.reasoningEfforts` && change.before && typeof change.before === 'object'
          && Object.hasOwn(change.before, 'off') && (change.after === false
            || (change.after && typeof change.after === 'object' && !Object.hasOwn(change.after, 'off')))
        return h('section', { key: change.field, className: 'dme-diff', 'aria-label': isInput ? t('inputField') : text(change.field) },
          h('h4', { className: 'dme-diff-field' }, isInput ? t('inputField') : text(change.field)),
          h('div', { className: 'dme-diff-grid' }, ['before', 'after'].map((side) => h('div', { key: side, className: 'dme-diff-column', 'data-after': side === 'after' },
            h('div', { className: 'dme-diff-label' }, t(side)),
            h('div', { className: 'dme-diff-value dme-values' }, isInput ? inputValue(change[side]) : h('code', null, text(change[side])))))),
          offRemoved ? h('p', { className: 'dme-off-removed' }, t('offRemoved')) : null)
      }
      return h('section', { 'data-dme': '', 'aria-label': t('title'), 'aria-busy': busy },
        h('style', null, CSS),
        h('header', { className: 'dme-header' }, h('span', { className: 'dme-symbol' }, icon('spark')),
          h('div', { className: 'dme-heading' }, h('div', { className: 'dme-title-line' }, h('h3', null, t('title')), h('span', { className: 'dme-badge' }, t('bundled'))),
            h('p', { className: 'dme-muted' }, t('description'))), button('reload', () => actions.load())),
        catalog ? h('div', { className: 'dme-stack' },
          h('div', { className: 'dme-meta' }, h('span', null, t('catalogTime'), ': ', h('strong', null, generated && Number.isFinite(generated.getTime()) ? generated.toLocaleString() : text(catalog.generatedAt))),
            h('span', null, t('catalogCounts'), ': ', h('strong', null, text(catalog.models), ' / ', text(catalog.providers)))),
          !catalog.available ? h('p', { className: 'dme-notice dme-notice-warning' }, t('catalogMissing')) : null,
          catalog.lastError ? h('p', { className: 'dme-notice dme-notice-warning' }, t('catalogError'), ': ', text(catalog.lastError)) : null) : null,
        h('details', null, h('summary', null, t('rules')), h('div', { className: 'dme-rules-body' }, h('p', null, t('provenance')), h('p', null, t('effortNotice')))),
        h('ol', { className: 'dme-steps' }, ['stepProvider', 'stepMatch', 'stepApply'].map((key, index) => h('li', { key, className: 'dme-step', 'aria-current': step === index ? 'step' : undefined, 'data-complete': index < step },
          h('span', { className: 'dme-step-number', 'aria-hidden': true }, index < step ? icon('check') : index + 1), h('span', null, t(key))))),
        busy ? h('p', { role: 'status', 'aria-live': 'polite', className: 'dme-muted' }, t('loading')) : null,
        state.error ? h('p', { role: 'alert', className: 'dme-notice dme-notice-error' }, t('error'), ': ',
          state.error.code === 'model-enhance/client-response' ? t('malformed') : state.error.code === 'model-enhance/client-unavailable' ? t('unavailable') : state.error.message) : null,
        route && !route.writable ? h('p', { className: 'dme-notice dme-notice-warning' }, t('readOnly'), ': ', text(route.reason)) : null,
        view === 'setup' ? h('div', { className: 'dme-card dme-stack' },
          h('h4', { ref: heading, tabIndex: -1 }, t('setupTitle')),
          status && status.routes.length === 0 ? h('p', { className: 'dme-empty' }, t('noRoutes')) : null,
          h('div', { className: 'dme-controls' },
            h('label', null, t('provider'), h('select', { value: state.provider, disabled: busy, onChange: (event) => actions.setProvider(event.target.value) },
              h('option', { value: '' }, t('chooseProvider')), (status?.routes ?? []).map((entry) => h('option', { key: entry.provider, value: entry.provider }, `${entry.displayName} (${entry.provider})`)))),
            h('label', null, t('source'), h('select', { value: state.sourceProvider, disabled: busy, onChange: (event) => actions.setSource(event.target.value) },
              h('option', { value: '' }, t('autoSource')), (status?.sourceProviders ?? []).map((entry) => h('option', { key: entry.id, value: entry.id }, `${entry.name} (${entry.id})`))))),
          h('div', { className: 'dme-actions' }, h('p', { className: 'dme-muted' }, t('localOnly')), button('scan', () => actions.scan(), busy || !state.provider || !catalog?.available, true))) : null,
        view === 'results' ? h('div', { className: 'dme-stack' },
          h('div', { className: 'dme-toolbar' }, h('h4', { ref: heading, tabIndex: -1 }, t('resultsTitle')), button('changeProvider', () => actions.editSelection())),
          scopeSummary, h('p', { className: 'dme-muted' }, t('resultsHint')),
          h('label', null, t('filter'), h('input', { type: 'search', value: state.filter, onChange: (event) => actions.setFilter(event.target.value) })),
          h('p', { role: 'status', className: 'dme-muted' }, t('count'), ': ', visible.length, ' / ', matching.length),
          matching.length === 0 ? h('p', { className: 'dme-empty' }, t(state.scan.models.length === 0 ? 'noAddedModels' : 'noModels')) : null,
          h('div', { className: 'dme-list' }, visible.map((entry) => h('button', { key: entry.id, type: 'button', className: 'dme-model', disabled: busy, 'aria-label': `${t('selectModel')}: ${entry.name} (${entry.id}) · ${t(matchStatus(entry))}`, onClick: () => actions.selectModel(entry.id) },
            h('span', { className: 'dme-identity' }, h('strong', null, text(entry.name)), h('code', null, text(entry.id))), badge(entry), h('span', { className: 'dme-row-action' }, t('selectModel'), icon('arrow'))))),
          matching.length > visible.length ? h('div', { className: 'dme-actions' }, h('p', { className: 'dme-muted' }, t('limited')), state.limit < MAX_VISIBLE ? button('more', () => actions.showMore(), false) : null) : null) : null,
        model ? h('div', { className: 'dme-stack' },
          h('div', { className: 'dme-toolbar' }, h('h4', { ref: heading, tabIndex: -1, className: 'dme-values' }, text(model.name), ' — ', text(model.id)),
            button('backModels', () => actions.backToModels())), scopeSummary,
          view === 'detail' ? h('div', { className: 'dme-stack' },
            h('div', { className: 'dme-card dme-stack' },
              h('div', { className: 'dme-title-line' }, badge(model), h('p', { className: 'dme-muted' }, t('previewHint'))),
              h('label', null, t('candidate'), h('select', { value: state.sourceKey, disabled: busy || !candidates.length, onChange: (event) => actions.selectCandidate(event.target.value) },
                h('option', { value: '' }, t('chooseCandidate')), candidates.slice(0, MAX_VISIBLE).map((candidate) => h('option', { key: candidate.key, value: candidate.key }, `${candidate.name} — ${candidate.provider}/${candidate.id} (${candidate.confidence})`)))),
              candidates.length > MAX_VISIBLE ? h('p', { className: 'dme-muted' }, t('limited')) : null,
              candidates.length === 0 ? h('p', { className: 'dme-empty' }, t('noCandidates')) : null,
              selectedCandidate ? h('div', { className: 'dme-notice', role: 'status', 'aria-live': 'polite' },
                h('p', { className: 'dme-values' }, h('strong', null, text(selectedCandidate.name)), ' · ', text(selectedCandidate.provider), '/', text(selectedCandidate.id)),
                h('p', null, h('strong', null, t('vendorImageInput')), ': ', t(imageInputState(selectedCandidate.input))), h('p', { className: 'dme-muted' }, t('imageInputNotice'))) : null,
              h('label', { className: 'dme-check' }, h('input', { type: 'checkbox', checked: state.overwrite, disabled: busy, onChange: (event) => actions.setOption('overwrite', event.target.checked) }),
                h('span', null, t('overwrite'), h('small', { className: 'dme-muted' }, t('overwriteHint')))),
              h('div', { className: 'dme-actions' }, h('p', { className: 'dme-muted' }, t('localOnly')), button('preview', () => actions.preview(), busy || !state.sourceKey))),
            !preview ? h('p', { className: 'dme-muted' }, t('noPreview')) : h('div', { className: 'dme-stack' },
              h('div', { className: 'dme-preview' }, h('div', { className: 'dme-preview-header dme-toolbar' }, h('h4', null, t('previewTitle')),
                h('div', { className: 'dme-title-line' }, h('span', { className: 'dme-badge' }, preview.changes.length, ' ', t('changes')),
                  warningNotice('previewWarnings', preview.warnings, preview.token))),
                preview.changes.length ? preview.changes.slice(0, MAX_VISIBLE).map(diff) : h('p', { className: 'dme-empty' }, t('nothing'))),
              preview.changes.length > MAX_VISIBLE ? h('p', { className: 'dme-muted' }, t('limited')) : null,
              preview.blockers.length ? h('div', { className: 'dme-notice dme-notice-error', role: 'alert' }, h('strong', null, t('blockers')),
                h('ul', null, preview.blockers.slice(0, 100).map((value, index) => h('li', { key: index }, text(value))))) : null,
              h('div', { className: 'dme-confirm dme-stack' },
                preview.requiresConfirmation ? h('label', { className: 'dme-check' }, h('input', { type: 'checkbox', checked: state.confirmed, disabled: busy, onChange: (event) => actions.confirm(event.target.checked) }), t('confirm')) : null,
                h('div', { className: 'dme-actions' }, h('p', { className: 'dme-muted' }, icon('shield'), ' ', t('safeWrite')),
                  button('apply', () => actions.apply(), busy || !route?.writable || !preview.canApply || preview.blockers.length > 0 || (preview.requiresConfirmation && !state.confirmed), true))))) : null,
          state.result ? h('div', { className: 'dme-stack' },
            h('div', { className: `dme-notice dme-toolbar dme-notice-${state.result.saved && state.result.verified ? 'success' : 'warning'}` },
              h('div', { role: 'status', 'aria-live': 'polite' },
                h('h4', null, t(state.result.saved && state.result.verified ? 'savedTitle' : 'unverifiedTitle')),
                h('p', null, t(state.result.saved ? state.result.verified ? 'savedVerified' : 'savedUnverified' : 'notSaved'))),
              warningNotice('resultWarnings', state.result.warnings)),
            h('div', { className: 'dme-actions' }, h('p', { className: 'dme-muted' }, t('safeWrite')), button('rescan', () => actions.scan(), busy, true))) : null) : null)
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
