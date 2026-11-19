# dsh-model-enhance

基于工程内置原厂资料快照的模型匹配和受控参数注入插件；models.dev 只用于开发时生成快照。

**状态：0.2.1 补充 DSH 0.2.2-rc.5 兼容性，宿主和协议 peer 同步声明，未启用版本豁免；0.2.0 将资料改为工程内置的原厂来源快照，运行时不再下载 / 更新 models.dev；推荐参数包含图片输入能力，未指定 / 空 `input` 可填充，已有明确能力需覆盖确认；注入的思考档位不包含 off；默认思考档位功能已暂停并记录在 [TODO](./TODO.md)。89 项当前离线测试和 DSH 0.2.2-rc.5 集成测试通过（rc.3 为此前验证基线）；测试不调用真实供应商端点，不能代替实机界面验收。**

## 实现范围

| 期望 | 当前实现 |
| --- | --- |
| 1. 工程内置资料、手动发布 | 已实现。运行时只读内置原厂快照，不联网、不创建用户缓存。 |
| 2. 匹配已添加模型与资料名称 | 已实现。只读取所选 provider 在 DSH 的本地可用模型目录，再按 ID、canonical ID、名称匹配；不向供应商请求完整清单，不截取原生表单草稿。 |
| 3. 展开原生模型详细设置时预填 | 未实现。当前公开 Slot 没有模型展开事件或原生草稿写入接口。 |
| 4. 一键将建议持久化到真实配置 | 已实现。独立设置页入口，先预览，再由 Host 检查版本并写入实际模型配置，包含图片输入能力。 |
| 5. 默认思考处理 | 暂停；只处理合法模型能力映射（不含 off），默认选择和修复见 TODO。 |

当前支持写入 **llm-pi-ai 的 `providers.<provider>` 配置**，包括其显式模型列表和模型覆盖配置。其他 schema / 适配器会被标为不可写，不尝试猜字段。

不修改 DSH 本体，不修改 Auto review，不伪装成原生表单预填，也不承诺每个模型都能有独立默认思考档位。

## 安装

只针对实际验证过的 **DSH 0.2.2-rc.3 / 0.2.2-rc.5** 声明兼容，范围为 `0.2.2-rc.3 || 0.2.2-rc.5`，不自动放行其他预发布版或正式版。运行期使用宿主的 `@deepseek-ai/dsh-typert-protocol` peer，范围与宿主声明一致；不要绕过 DSH 的加载器直接用普通 Node 启动 Host 入口。

从仓库根目录执行：

```sh
dsh plugin --profile desktop add ./dsh-model-enhance
```

Windows 绝对路径使用原生盘符和 `link:`：

```sh
dsh plugin --profile desktop add "link:E:/Code/dsh-plugin/dsh-model-enhance"
```

2026-11-19 本机 desktop profile 已将现有链接包重载为 **0.2.1**：管理器返回 `application: applied`、无警告，bundle 不再报 `incompatible-version`，Host 条目为 `enabled: true` / `fiberPhase: active`。本次无需移除、重装或运行依赖安装，没有设置版本豁免、请求供应商清单或写入模型参数；刷新现有 GUI 后再验收页面。以上安装命令用于尚未安装的环境；其他 profile 的安装需要另行授权。

本插件依赖模型设置页与 Host 服务，面向带 Web GUI 的运行环境，不是 ACP 端的交互工具。安装后应确认插件启用、刷新现有 GUI，再到「设置 → 模型」查看页尾的「模型资料增强」。

## 使用流程

1. 在「设置 → 模型」滚动到「添加模型提供商」下方，找到 **模型资料增强** 面板。若仍显示旧页面，刷新现有 GUI 后重新打开设置。
2. 插件使用工程内置的原厂资料快照；运行时不会联网获取或更新 models.dev。
3. 选择一个已保存且可写的目标服务商；可选资料来源服务商作为匹配筛选条件。
4. 点击 **读取已添加模型并匹配**。只显示所选 provider 当前已在 DSH 可用的模型，不请求上游 `/models` 或完整目录；没有已添加模型时保持空列表，不回退到远端发现或 models.dev 全量模型。要新增模型，请先在 DSH 原生服务商设置中添加并保存。
5. 点击 **查看推荐**，选择明确的资料候选。多个候选不会被静默当成唯一正确答案；没有候选时不会生成可注入建议。
6. 按需设置模式并点击 **重新生成预览**：
   - **允许替换已有字段（应用前需确认影响）**：默认关闭；普通字段关闭时只填空。思考映射移除 `off` 是固定规则，仍需预览并确认。
   - 注入的思考档位不包含 `off`；已有可靠映射中的 `off`（无论值为 null 还是字符串）会在预览中移除，保留其他档位及 wire 值，并要求确认后保存。
   - 默认思考档位不在本版本处理，见 [TODO](./TODO.md)。
7. 检查字段差异、警告、阻止原因。覆盖已有配置需要显式确认。
8. 点击 **一键配置推荐参数**，持久化的是实际模型配置，不是剪贴板文本。保存后查看字段核对结果。

改动供应商配置或适配器能力变化后，需要重新读取已添加模型 / 预览；不要复用旧方案。写入失败不会自动重试，避免一次操作被重复执行。

## 主题与可访问状态

设置面板跟随 DSH 当前主题，不单独监听系统深浅色偏好，也不需要额外开关：

- 输入框、下拉框及原生选项使用主题前景 / 背景；继承宿主的 `color-scheme`。
- 按钮悬停、按下、禁用和键盘焦点使用主题变量；禁用状态保留可读文字，不通过整体半透明压暗。
- 选中模型、预览表格、错误、警告和保存结果使用对应主题表面与语义边线；提示内容仍以主文本色显示。
- 所有样式限制在 `[data-dme]` 面板内，不修改其他设置页面或宿主主题。

0.1.3 新增样式契约与语义渲染回归；它们不等同于真实浏览器截图对比。更新后刷新现有 GUI，可在深色 / 浅色主题中分别检查下拉选项、禁用按钮、焦点和提示区域。

## 图片输入能力

推荐参数包含模型的图片输入能力，写入模型级 `input`，不修改服务商的 `defaultInput`：

| 原厂资料中的输入类型 | 推荐写入 |
| --- | --- |
| 包含图片 | `input: ["text", "image"]`（若资料只列图片，则仅写 `"image"`） |
| 仅有文本 | `input: ["text"]`，明确不接收图片 |
| 缺失、空数组或只有 DSH 不支持的类型 | 不生成 `input` 建议，不猜测支持与否，也不清除现有配置 |

详情中的「原厂资料的图片输入」显示资料标注的支持 / 不支持 / 未知状态；预览中的图片输入行同时展示原始数组，区分未指定 / 继承与明确不支持图片。资料能力不代表自定义代理端点实测可用，本插件不发送图片测试请求。

默认只填空：未填写 `input` 或 `input: []` 都视为未指定，可填入资料建议；已有非空数组原样保留，若与资料不同会提示。要替换已有能力，启用「允许替换已有字段」并确认预览；支持图片与不支持图片的替换方向都需要确认。该规则同时适用于显式 `models` 和 `modelOverrides`，重复应用相同建议不再产生改动。**`[]` 不表示禁止图片**，它在 DSH pi-ai 中表示继承能力，核对来源见下方源码基线。

## 默认思考档位：已暂停

本版本不选择、写入或修复 provider / model 的默认思考档位；原因和恢复条件见 [TODO](./TODO.md)。

可靠非推理映射仍可保留 `reasoningEfforts: false`；可靠推理映射只注入非 `off` 档位。未知能力不虚构档位；若已有配置只有 `off`、没有可靠的其他档位，则保留原配置并提示警告，避免生成无效空映射。本次代码修改不批量清理已保存配置，需要重新预览并确认应用到目标模型。

## 写入与并发保护

- Client 只能提交选择条件和一次性方案 token，不能提交任意设置 path / ops。
- Host 重新验证模型来自本次读取的已添加清单、资料来自当前工程快照，按现有 schema 生成最小修改，不重建整个供应商配置。
- 保留端点、凭据、真实模型 ID、数组顺序和未修改字段；更新显式模型数组时保留其他条目及其未知扩展字段。
- 本地清单快照绑定 namespace、revision、路由配置指纹和资料快照；预览前后、应用前重新检查，防止旧端点的列表被写进新端点配置。
- token 默认 10 分钟有效，最多保留 100 个方案；本地清单快照最多保留 50 个。token 在首次异步写入前消费，失败也不能重放。
- 应用时重算建议。适配器目录或配置变化后旧方案失效；默认思考档位不参与本次应用。
- 同一 namespace 使用带 `expectedRevision` 的设置变更；冲突不自动覆盖。没有跨 namespace 事务或自动回滚承诺。
- 不调用推理、不执行资料中的文字、不写入任意来源提供的配置路径；卸载清理 Remote、UI、待处理目录读取和内存方案。

## 文件与验证

- [Host 入口](./index.js)、[Remote 契约](./protocol.js)、[客户端入口](./client.js)。
- [目录匹配](./core/catalog.js)、[工程资料加载](./core/bundled-catalog.js)、[注入规划](./core/planner.js)、[Host 控制器](./core/service.js)。
- [插件 manifest](./package.json)、[启用 patch](./cordis.patch.yml)、[测试目录](./test/)。

从仓库根目录运行离线测试：

```sh
node --test dsh-model-enhance/test/*.test.mjs
```

真实运行库隔离测试使用已安装桌面端的 ASAR-aware Electron Node 模式，例如本机 Git Bash：

```sh
APP_EXE='D:/Users/Arthur/AppData/Local/Programs/DeepSeek Harness/DeepSeek Harness.exe'
APP_ROOT='D:/Users/Arthur/AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh'
ELECTRON_RUN_AS_NODE=1 "$APP_EXE" dsh-model-enhance/test/runtime-integration.mjs "$APP_ROOT"
```

该测试先使用已安装宿主的兼容性检查函数分别验证 `engines.dsh` 与协议 peer，复现旧声明对 rc.5 的拒绝，并确认未验证版本仍被阻止，不使用版本豁免。随后使用实际 Cordis、Typert Registry、Host Gateway、Client Remote、已安装 pi-ai 的 `Config` 和真实 `SettingsForms`；通过 `client.plugin(ui)` 启动真实客户端 fiber，而非用根上下文 / 普通对象直接调用 `apply`。设置描述、原生 schema 投影、revision 校验、volatile 路径校验、路径修改和写后读取均执行 DSH 真实代码；只有 `configEditor` 持久化边界保留在内存，LLM 为隔离 fixture，工程快照由包内文件读取。覆盖四个 Remote 端点、真实客户端作用域内取数 / 选择 / 匹配 / 预览、Host 保存与实际 SettingsForms 回读、JSON 边界、严格输入校验、单次 token 和卸载 / 重载，不安装插件、不修改真实 profile、不访问网络、不调用付费模型。

已完成的验证包括内置快照 fail-closed、未知能力、图片能力三态展示、空 `input` 填充及双向覆盖确认、显式列表 / 模型覆盖写入、图片能力实际 SettingsForms 保存回读与幂等、名称歧义、只填空 / 覆盖、思考映射排除 off、已有 off 移除及幂等、版本冲突、能力变更重规划、读取与预览竞争、本地目录读取超时和禁止远端回退、卸载、Client 挂载生命周期及真实 Client → Gateway 调用链。0.1.1 虽在当前 GUI 注册入口成功，但用户验收发现取数报错；0.1.2 增加了真实 fiber 中的命名空间注入和交互回归。**真实 GUI 中的布局和所选 provider 已添加模型清单仍需用户验收；本插件不会测试上游推理调用。**

0.1.0 的入口缺失原因：Client Remote 的请求参数错误地使用 `src-json` codec，`remote.$mount()` 在注册 footer 前拒绝挂载。0.1.1 为三个请求端点加入严格 codec，并将真实 Client Remote 纳入隔离测试；Host 独立执行请求校验，不能用 Client codec 代替服务端安全边界。参见 [Client 严格输入要求](../ref/deepseek-harness/packages/api/gateway/src/client/index.ts#L803-L817)。

0.1.1 的按钮 / 取数失败原因：只声明 `remote` 不能访问独立服务 `remote.modelEnhance`，实际插件作用域会抛出 `cannot get property "remote.modelEnhance" without inject`。0.1.2 在 `$mount()` 完成后通过 `ctx.inject(['remote.modelEnhance'], ...)` 创建子作用域，再创建控制器与注册入口，避免把该依赖放到挂载前形成自等待。旧隔离测试使用根上下文，未触发 Cordis 检查；现在使用真实插件 fiber 重现并覆盖此回归。参见 [Cordis 依赖检查](../ref/deepseek-harness/vendor/cordis/src/reflect.ts#L147-L178)和 [子作用域注入](../ref/deepseek-harness/vendor/cordis/src/registry.ts#L300-L302)。

0.1.3 的「Only generic pi-ai provider settings are supported」误判原因：将 `settings.describe().schema` 当作标准 JSON Schema 的 `properties`，而真实返回是 Schemastery 的 `{ uid, refs }`，节点使用 `type` / `dict` / `inner`。0.1.4 沿根 `providers` 字典解析 profile 字段，拒绝悬空 / 循环引用、错误类型及无关嵌套字段；不放宽其他适配器的写入保护。参见 [设置描述生成](../ref/deepseek-harness/packages/settings/settings/src/index.ts#L302-L340)和 [原生 schema 序列化](../ref/deepseek-harness/vendor/schemastery/src/index.ts#L311-L321)。真实 SettingsForms 还会按 schema 重排对象字段，因此写后核验改为 JSON 结构值比较，对象键顺序不影响结果，但字段值和数组顺序仍须一致。

## 源码核对基线

当前核对日期：2026-11-19；本机 DSH **0.2.2-rc.5**。参考源码 tag `dsh-v0.2.2-rc.5`，commit `9c2670d3bce5275e0d1610272958121af87787bb`，只读未修改。此前基线为 2026-11-17 的 rc.3（commit `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`）；本次核对下列接口实现未变，并重新通过已安装 rc.5 的隔离测试。

- [宿主兼容性检查](../ref/deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts#L51-L80)：自有 `engines.dsh` 优先于 DSH peers；旧精确 rc.3 声明会阻止 rc.5。0.2.1 同步更新宿主和协议 peer 为已验证版本的精确并集，不依赖版本豁免。

- [公开模型设置 Slot](../ref/deepseek-harness/packages/client/ui-settings-models/src/client/slot-contract.ts#L23-L57)：footer / provider-card，不提供原生草稿回调。
- [pi-ai 模型与路由配置](../ref/deepseek-harness/packages/llm/llm-pi-ai/src/config.ts#L331-L385)：能力映射属于模型，默认 `reasoning` 属于路由。
- [pi-ai 本地可用模型目录](../ref/deepseek-harness/packages/llm/llm-pi-ai/src/adapter.ts#L346-L362)：读取配置快照中的模型；与供应商端点模型发现是不同接口。
- [核心 effort 解析](../ref/deepseek-harness/packages/llm/llm/src/index.ts#L934-L954)和 [pi-ai 请求 effort 选择](../ref/deepseek-harness/packages/llm/llm-pi-ai/src/adapter.ts#L419-L434)：显式选择优先，不能只修改元数据来掩盖请求默认值。
- [设置路径操作](../ref/deepseek-harness/packages/settings/settings/src/types.ts#L52-L54)：`op: 'set'` / `op: 'unset'`，不是 `type`。
- [运行期 linked peer 解析](../ref/deepseek-harness/packages/boot/app-boot/src/profile-resolution/resolver.ts#L85-L92)：链接插件的 peer 由当前运行期解析层处理；隔离测试使用进程内解析 hook，不写宿主安装目录。
- 2026-11-18 补充图片能力核对：[模型输入 schema](../ref/deepseek-harness/packages/llm/llm-pi-ai/src/config.ts#L331-L339)将未填写的 `input` 初始化为 `[]`；[模型输入语义](../ref/deepseek-harness/packages/llm/llm-pi-ai/src/catalog.ts#L618-L629)说明空值继承目录能力 / 路由默认值，非空数组明确声明模型接受的类型；已安装 rc.3 的真实 `Config` 与 `SettingsForms` 隔离测试验证空数组填充、保存和回读。
- 2026-11-18 补充主题核对：[主题应用](../ref/deepseek-harness/packages/client/ui-layout/src/client/theme-presenter.ts#L69-L76)在根元素设置 `color-scheme`；面板使用 Client Inspect `Theme.listTokens` 已声明的深浅色 alias token，不另行维护颜色常量。
