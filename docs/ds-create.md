# DSH Agent 配置与创造模式开发指南

> 面向在 DeepSeek Harness（DSH）上开发插件 / 自定义模式的 Agent 与人类开发者。
> 全部结论基于源码核对：[`ref/deepseek-harness/`](../ref/deepseek-harness/)（只读参考 submodule，不是本仓库插件，勿执行 `dsh plugin add ref/...`）。

## 0. 一句话结论

**DSH 没有 `AgentMode` 枚举。用户说的「模式」= 代码里的 agent preset（Agent 预设）。「创造模式」的唯一标识是字符串 `cordis`。**

| 界面文案 | 代码标识 | 声明载体 | order |
| :--- | :--- | :--- | :---: |
| 标准模式 | `standard` | `packages/bundle/web-app/presets/standard.patch.yml` | 1 |
| PTC 模式 | `ptc` | `.../presets/ptc.patch.yml` | 2 |
| 极简模式 | `minimal` | `.../presets/minimal.patch.yml` | 3 |
| **创造模式** | **`cordis`** | `.../presets/cordis.patch.yml` | 4 |

中文文案「创造模式」只是 locale key `presetCordisName` 的取值。**源码里从不出现「创造模式」四个字，只有 `cordis`。** 全仓 grep `创造模式` 只会命中 locale 文件、README 与测试，不会命中任何逻辑分支。

---

## 1. 架构分层

```
profile/cordis.patch.yml            ← Host 层：进程级服务、UI 插件、inspect provider
  │
  ├── agent-preset-registry         ← 注册表，config.default: standard
  │     │
  │     └── preset-<id> 行          ← @deepseek-ai/dsh-agent-preset
  │            └── config.plugins   ← 该模式的全部工具 / 提示词 / 技能
  │
  └── 每个会话创建时 mount 一棵 preset 插件树
```

关键认知：**preset 本身就是一个普通 Cordis 插件行**。它的 `config.plugins` 才是模式的实际内容。因此：

- 「新增一个模式」= 往 bundle patch 里 `insert` 一行 `@deepseek-ai/dsh-agent-preset`
- 「修改一个模式」= 按该行 id 写覆盖补丁（不是编辑原文件）

---

## 2. 注册表实现要点

核心文件 [`agent-preset-registry/src/index.ts`](../ref/deepseek-harness/packages/preset/agent-preset-registry/src/index.ts)（415 行）。四个必须理解的设计：

### 2.1 代际（Generation）模型

每个 preset 声明在启动时创建独立 `scope` + 内存 Loader 树，带 `users` 引用计数：

```
register() → activate() → mountPreset() → Generation { scope, mount, users, retired }
```

Agent 持有引用，**最后一个引用释放才销毁插件树**。所以：

> 改配置只影响**之后创建**的 Agent；已存在的会话继续跑它绑定的那一个代际。

### 2.2 激活审计（`mount.ts`）

检查三类问题：导入失败、缺失服务、**向全局泄漏的服务**。失败只禁用该定义的新绑定，不拖垮进程。

`diagnostic()` 每次读取都重新审计；若存在等待 Host 服务的行，先 `await owner.loader.await()` 等 Host Loader 树结算再判定。

### 2.3 首轮锁定

[`index.ts:365-383`](../ref/deepseek-harness/packages/preset/agent-preset-registry/src/index.ts)：`select()` 在以下条件抛 `agent-preset/locked`：

```ts
if (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)
  throw new RemoteError('agent-preset/locked', 'This session has already started', …)
```

**会话一旦开始第一轮，组合就固定了。** 空白会话期间可以切，切完记一条 `agent-preset/selected` 事件。

### 2.4 持久化与恢复

- 会话日志记 `agent-preset/selected` 事件
- 投影键 `agentPreset`（[`session.ts`](../ref/deepseek-harness/packages/preset/agent-preset-registry/src/session.ts)）从 header 初始化，由事件推进
- **重启恢复读投影，不读 header**——因为 header 只记创建时的值，而空白期可能已切换

一个细节：若空白会话已记录所请求的 preset 且正运行其当前版本，`select` 不做任何改动，也不追加切换记录、不触发 `tools/change`。

---

## 3. 「创造模式」到底多了什么

这是最容易被搞错的一节。精确 diff `standard.patch.yml` 与 `cordis.patch.yml`，差异有 **4 处**：

| # | 差异 | 说明 |
| :--- | :--- | :--- |
| 1 | 新增 `tool-cordis` 行 | 两个只读运行时检查工具 |
| 2 | `skill-filesystem` 多了 `customSkillDirs` | 挂载随包的 `skills/` 目录 |
| 3 | `tool-plugin-market` 的 `disabled` 变了 | `true` → `!!js "!ctx.get('profileContext')"` |
| 4 | `id` / `order` / persona 的 `>-` 折行（语义等价） | 无实际影响 |

**注意第 3 条**：插件市场工具在 standard 里是硬禁用（`disabled: true`），在 cordis 里改为「有 profile 上下文就启用」。所以「创造模式能逛插件市场」是真的，但机制是解禁，不是新增插件行。

### 3.1 两个只读检查工具

`tool-cordis` 提供：

- `cordis_inspect_list` — 发现可用 provider
- `cordis_inspect_query` — 查询具体 Service 方法、Event 模式、运行中 entry 的 Config JSON Schema、Client Slots、Theme token

**Host provider 必须由 Host 层注册**。`cordis-inspect-providers` 行挂在 `packages/bundle/web-app/cordis.patch.yml` 的 Host 层，因为检查注册表拒绝重复 id：

```yaml
- id: cordis-inspect-providers
  name: '@deepseek-ai/dsh-tool-cordis/host'
```

> **preset 行只挂工具，不提供 provider。** 只写 preset 行、不写 Host 行 → 工具调用拿不到任何 provider。

### 3.2 随包的四个技能

位于 [`packages/preset/agent-preset/skills/`](../ref/deepseek-harness/packages/preset/agent-preset/skills/)：

| 技能 | 职责 |
| :--- | :--- |
| `cordis-plugin-development` | 主流程：写 bundle → `install_bundle` → `cordis_inspect_query` 验证 |
| `editing-cordis-compositions` | 专门讲如何创建/修改 agent preset 本身 |
| `cordis-composition-reference` | patch 方言 + 可挂载插件清单（`references/packages.md` 由脚本生成，有新鲜度门禁） |
| `agent-experience` | 工具描述与上下文加载的写作规范 |

挂载方式是一段 `!!js` 表达式，动态解析包目录：

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - !!js process.getBuiltinModule('node:path').join(…resolve('@deepseek-ai/dsh-agent-preset/package.json')…, 'skills')
```

> 为什么用 `!!js` 而不是相对路径：Desktop 下包在 `app.asar` 内，只有 Host 进程自己的文件读取能打开；shell、glob、node 都读不到。

### 3.3 能力矩阵

| 能力 | `standard` | `cordis` | `ptc` | `minimal` |
| :--- | :---: | :---: | :---: | :---: |
| Shell / FS / 搜索 / 计划 / 子代理 / 工作流 | ✅ | ✅ | ✅ | 仅持久 Shell + `read_image` |
| `tool-cordis` 运行时检查 | ❌ | **✅** | ❌ | ❌ |
| 随包插件开发技能 | ❌ | **✅** | ❌ | ❌ |
| `tool-plugin-market` | ❌ 硬禁用 | **✅ 解禁** | ❌ 硬禁用 | ❌ 无此行 |
| `tool-plugin-manager` | ✅（有 profile） | ✅（有 profile） | ❌ 硬禁用 | ❌ 无此行 |

> `tool-plugin-manager` / `tool-plugin-market` 的启用条件是 `!!js "!ctx.get('profileContext')"`——**没有 profile 上下文的部署里两行都是禁用的**。

---

## 4. 写一个自定义模式

### 4.1 最小可用的包结构

```
my-preset/
├── package.json
└── presets/
    └── my.patch.yml
```

`package.json`：

```json
{
  "name": "@local/dsh-my-preset",
  "version": "1.0.0",
  "dsh": {
    "bundle": {
      "patch": ["./presets/my.patch.yml"]
    }
  }
}
```

`presets/my.patch.yml`：

```yaml
- insert:
    - id: preset-my
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: my-mode                 # 必填，小写字母 / 数字 / 连字符
        name: "代码审查模式"          # 可选；一旦填了就不再被当作内置预设
        description: "优先挑错，改动前先问"
        order: 10                   # 可选，roster 排序
        plugins:                    # 必填，Cordis entry list
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: You are a code reviewer powered by the {{model}} model.
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
          - id: tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
            disabled: !!js process.platform === 'win32'
          - id: tool-pwsh
            name: '@deepseek-ai/dsh-tool-pwsh'
            disabled: !!js process.platform !== 'win32'
```

行 id 约定为 `preset-<id>`（`preset-my`）。子插件行可省略 `id`，由 Loader 分配。

### 4.2 安装

```bash
# profile 换成目标 profile（desktop / web / acp）
dsh plugin --profile desktop add /绝对路径/my-preset
```

包名形如需走 registry，用 `dsh plugin --profile desktop add <包名>@<版本>`。

或在创造模式里让 Agent 用 `plugin_manager` 的 `action: install_bundle` 安装（`target` 传绝对包目录）。后者无需退出会话，HMR 生效；替换已安装的包仍需重启。

> **hard 约束**：注册表**不提供任何写回接口**。`readDocument` 只读，把 `config.plugins` dump 成 YAML 供查看。新建 / 覆盖 preset 只能走「bundle patch + install」。不要在会话里试图直接改 profile 的 `package.json` 或 `cordis.patch.yml`——`install_bundle` 负责那两步，手写每次都要单独审批。

### 4.3 `!!js` 语法要点

只在两个位置允许：子插件行的 `disabled` 与 `config` 内。**其他位置保持字面量。**

```yaml
disabled: !!js process.platform === 'win32'          # ✅
name: !!js someExpr                                  # ❌ 不解析
```

---

## 5. UI 侧如何识别「创造模式」

三层解析，**没有一处硬编码中文名**：

1. `isBuiltInPreset()` — 判据是「**没发布 `name`** 且在 `BUILT_IN_PRESET_KEYS` 里」。所以用户自己声明一个 id 为 `cordis` 且填了 `name` 的 preset，会被当成自定义模式，不显示官方文案。
2. `presetDisplayText()` — 内置 id 走 locale 字典；自定义 id 原样显示，**永不翻译**。
3. 唯一硬编码 `'cordis'` 的地方是 `startCreatorDraft()`（[`ui-agent-preset/src/client/index.ts:220`](../ref/deepseek-harness/packages/client/ui-agent-preset/src/client/index.ts)）——「让 Agent 创建插件」入口直接以 `agentPreset: 'cordis'` 起新会话。

派生行为：`CreatePluginMenuItem` 先查 roster 里有没有 `cordis`，没有就显示「当前配置未提供创造模式」并**禁用入口**。这就是删掉 preset 行后按钮变灰的原因。

---

## 6. 开发须知（易踩的点）

### 6.1 命名

- 模式 id：小写字母、数字、连字符；**重复 id 会让声明加载失败**
- 显示名与描述是**声明元数据**，不走 i18n；要中文就直接写字面量
- 想让自己的模式被当作内置（带官方中英文案），需要 id 命中 `standard`/`ptc`/`minimal`/`cordis` **且不填 `name`**——通常不要这么做

### 6.2 隔离（realm）

- preset 的服务提供方与其消费者**必须共享同一个 `cordis:group` 隔离 realm**
- 条目局部 `isolate` **不会**沿 Agent 注册 scope 传播；组外的普通 Context 查找（包括 `agent.ctx`）仍选 Host realm
- 想读某个 preset 内部的服务，用 `agentPresets.serviceFor(agent, name)`，不要走普通查找
- 向 Host realm 泄漏服务的 preset 会被**拒绝挂载**

### 6.3 子代理继承

子 Agent 默认继承父 Agent 已绑定的**那个精确代际**（`composeFrom`），不是最新版。`tool-subagent` 想独立指定预设时用 `PresetSelectionConfig`：

```ts
{ agentPreset?: string, allowedAgentPresets?: string[] }  // 后者非空才向模型暴露选择
```

### 6.4 默认模式

默认值有两条来源，优先级不同：

| 来源 | 字段 | 优先级 |
| :--- | :--- | :--- |
| 部署默认 | `agent-preset-registry.config.default`（patch 里是 `standard`） | 低 |
| 用户默认 | `config.selectedDefault`（volatile） | **高** |

用户默认写入 settings 命名空间 `agent-preset-registry`，字段 `selectedDefault`。

### 6.5 工具可见性 ≠ 权限

preset 决定**模型看到哪些工具**，不决定**能做什么**。权限由权限预设与沙箱决定。例如 `plugin_manager` 在 `danger-full-access` 之外每次调用都要审批（连 `list_plugins` 也要）。

### 6.6 调试顺序

1. `agentPresets.list()` / `remoteExportList()` 看 roster，注意每行的 `broken` 字段
2. `compositionInventory()` 看每个 preset 的行与激活状态
3. `readDocument(id)` 看某 preset 实际声明的 YAML
4. `cordis_inspect_list` → `cordis_inspect_query` 查运行中 entry 的 Config Schema 与 `packageDir`

`broken` 有值就说明该 preset **无法 compose 新会话**，但老会话仍能跑。

---

## 7. 与本仓库的关系

- 本仓库是个人插件收纳箱，`ref/` 下是**只读参考**，不参与构建
- [`docs/cc-create.md`](./cc-create.md) 是同主题的另一份笔记，可作为对照
- `dsh-agent-config/` 的设计草案（[`doc/design.md`](../dsh-agent-config/doc/design.md)）只覆盖技能 / 子代理 / 规则三类资产，**未覆盖 agent preset 这一层**。若要把「模式管理」纳入，注意第 4.2 节的写回硬约束：`list` 与 `readDocument` 是只读的，新建/覆盖必须走 bundle patch。
- 本机（`desktop` profile）的完整可用模式清单以 profile 的实际组合为准，不要以本文的 4 个内置模式为全部——见 §8。

## 8. 速查

```bash
# 查看某 profile 组合后的完整配置
dsh --profile desktop --dump-config

# 本机 profile 的 preset 覆盖情况（常规应无输出，说明全用 bundle 默认）
grep -n "agent-preset\|preset-" ~/.dsh/profiles/desktop/cordis.patch.yml
```

| 想知道 | 看哪里 |
| :--- | :--- |
| 有哪些模式 | `packages/bundle/web-app/presets/*.patch.yml` |
| 某模式由什么组成 | 该文件的 `config.plugins`，或 `readDocument(id)` |
| 注册/锁定/持久化逻辑 | `packages/preset/agent-preset-registry/src/index.ts` |
| 隔离与审计 | 同目录 `mount.ts` |
| 会话记录格式 | 同目录 `session.ts` |
| 创造模式技能原文 | `packages/preset/agent-preset/skills/` |
| 运行时检查工具 | `packages/extensions/tool-cordis/` |
| 界面文案 | `packages/client/ui-agent-preset/src/client/locales.ts` |
