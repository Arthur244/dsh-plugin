# Agent 配置管理插件 — 设计草案

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1（草案，待评审） |
| 日期 | 2026-10-22 |
| 插件目录 | `dsh-agent-config/`（暂定包名 `dsh-agent-config`，显示名「Agent 配置」） |
| 参考实现 | [`MichengAI/dsh-skills-manager`](https://github.com/MichengAI/dsh-skills-manager)、[`MichengAI/dsh-agency-agents`](https://github.com/MichengAI/dsh-agency-agents) |
| 调研方式 | 通过 GitHub raw 读取上述项目的 README 与截图说明，并查阅 DSH 官方仓库 `master` 分支文档；**未 clone 任何仓库** |

> 状态说明：本文是设计草案，不是最终规格。文末「待确认问题」列出需要拍板的 6 个决策点，确认后再进入实现计划。

---

## 1. 背景

DeepSeek Harness（DSH）是一个「一切皆插件」的 agent harness。它的扩展资产目前分散在几类位置：

- **技能（skill）**：`~/.dsh/skills`、`~/.agents/skills`、工作区的 `.dsh/skills` 与 `.agents/skills`，以及 `customSkillDirs` 配置的目录。
- **规则（rule）**：本质是 `AGENTS.md` / `CLAUDE.md` 风格的指令文件，按「用户全局 → 项目根 → 当前目录」的链条加载。
- **子代理（subagent）**：DSH 原生提供委派运行时（`spawn` / `fork` / `codex` / `claude-code` 等 provider），但没有「用户自定义子代理定义目录」这一层。

这带来三个实际问题：

1. **入口分散**：用户要知道每种资产该放哪个目录、哪些目录会被扫描。
2. **无法统一启停**：停用一个技能通常意味着移动/删除文件，侵入源文件，也不方便临时实验。
3. **工作区与全局割裂**：同一个技能可能同时存在全局版和工作区版，谁生效、为什么生效，界面上看不出来。

`dsh-skills-manager` 已经证明「来源分组 + 搜索 + 详情 + 开关」这套交互在 DSH 里可行且好用；本插件把同一套信息架构扩展为 **技能 / 子代理 / 规则** 三类资产，并引入「默认目录 + 用户自选多个来源」的来源模型。

## 2. 目标与非目标

### 2.1 目标

- **一个页面管理三类资产**：技能、子代理、规则，都能在同一个界面里浏览、搜索、查看详情、启用/停用。
- **全局与工作区分层**：全局配置对所有会话生效；工作区配置只对该工作区生效，并遵循「工作区优先于全局」的覆盖关系。
- **零配置可用**：插件自带默认路径，首次打开即可读取；默认目录不存在时给出可执行的引导。
- **多来源**：用户可以通过目录选择器添加一个或多个文件夹，作为额外配置来源；来源可排序、可停用、可移除（不删除磁盘文件）。
- **不改源文件即可启停**：开关只影响 DSH 的加载结果，不修改、不移动来源里的文件。
- **状态可持久**：来源、开关、界面偏好写入插件自己的状态文件，DSH 重启后保留。

### 2.2 非目标（本版不做）

- 不做 GitHub 技能市场、仓库安装、在线更新与回滚（`dsh-skills-manager` 的 Repositories 能力不纳入 MVP）。
- 不做云同步、多设备同步、团队共享服务端。
- 不执行来源目录中的任何脚本；插件只读取 Markdown / YAML frontmatter。
- 不管理未注册为 DSH 工作区的任意文件夹（工作区页签只列 `ctx.workspaceRegistry` 中的工作区）。
- 不替代 DSH 原生加载器：`~/.dsh/skills`、`AGENTS.md` 指令链仍由 DSH 自己加载；插件以「只读来源」方式呈现它们，同名冲突按 5.4 的规则处理。

## 3. 参考产品的交互借鉴

| 参考点 | `dsh-skills-manager` 的做法 | 本插件如何取舍 |
| --- | --- | --- |
| 作用域切换 | 「全局 / 项目」两个页签，项目页顶部下拉选择已登记工作区 | 保留。页签改为「全局 / 工作区」，工作区下拉同款 |
| 来源组织 | 按来源折叠分组，分类只在来源内部生效，不移动文件 | 保留。来源分组是列表的一级结构 |
| 条目操作 | 行内开关 + 「查看详情」抽屉；启停不改源文件 | 保留，并扩展为三类资产共用同一套行交互 |
| 搜索与筛选 | 顶部搜索 + 状态/来源筛选 | 保留，增加「资产类型」筛选（技能/子代理/规则） |
| 添加内容 | 「创建 / 导入」并排下拉选择目标位置 | 本期改为「添加来源」向导；新建资产放到 M5 |
| 写入边界 | 明确显示实际路径，禁用不安全路径 | 保留。所有写操作前展示绝对路径并校验 |
| 空态/错误态 | 空工作区仍可选择；失效目录禁用 | 保留，并补充「默认目录不存在」的引导态 |
| 子代理交互 | 无（只管技能） | 参考 `dsh-agency-agents` 的「专家列表 + 启停 + 详情」卡片式管理 |

**明确不照搬**：回收站、仓库订阅、更新检查、备份回滚。这些是 `dsh-skills-manager` 围绕「从 GitHub 安装」建立的复杂度，本插件 MVP 不引入。

## 4. DSH 现状调研

> 以下结论基于 DSH 仓库 `master` 分支文档（2026-10 读取）。DSH 处于 developer preview，接口可能变化；实现前需以实际安装版本为准复核。

### 4.1 技能（skill）

- 形态：目录包 `<name>/SKILL.md`，或平铺文件 `<name>.md`；**不支持**嵌套递归的 `**/SKILL.md`。
- 名称：kebab-case，`^[a-z0-9]+(?:-[a-z0-9]+)*$`。
- frontmatter：必填 `name`、`description`；可选 `whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`。
- 本地文件系统提供方的扫描优先级（rank 越小越优先）：

| Rank | 来源 | 根目录 |
| --- | --- | --- |
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | 配置了 `bundledSkillDir` 时 |

- 项目根：包含 `.git` 的最近祖先目录；找不到时用当前 cwd。
- 技能注册表 `ctx.skills` 支持注册自定义 provider：`registerProvider(create)` 返回 disposer；provider 的 `list({ cwd, signal })` 返回候选，`get(candidate, options)` 返回完整定义；候选带 `rank`、`locator`、`provider`、`source` 等字段。
- `skills/change` 是失效通知，消费方收到后自行重新拉取目录。

**对本插件的意义**：不需要自己实现文件发现逻辑也可以工作，但为了实现「按来源/按条目启停」，自建一个 provider 比复用 `skill-filesystem` 更直接。

### 4.2 规则（rule）

- 原生实现是 `@deepseek-ai/dsh-agent-instructions`：加载 `$DSH_HOME/AGENTS.md`、`<agentsHome>/AGENTS.md`，再按「项目根 → 会话 cwd」逐目录加载 `AGENTS.md` / `CLAUDE.md`（以及 `.local.md` overlay）。
- 候选文件名固定、按目录发现；没有「命名规则文件 + 单独启停」的概念。
- 注入方式是**持久 user 角色消息**（`<system-reminder>` 包裹），只在首次请求与文件变化时追加，对 KV cache 友好。
- 预算：`maxBytes` 默认 65536，超预算时先省略宽泛文件、再截断最具体文件。
- 插件若要贡献动态提示词，可用 `ctx.systemPrompt.context({ name, order, text })` 注册运行时上下文；它会被物化为持久的 user 角色快照。

**对本插件的意义**：`AGENTS.md` 这条链不动；插件管理的「规则」是**额外的一层**，以独立的命名规则文件存在，通过 `systemPrompt.context` 注入，避免与用户的 `AGENTS.md` 打架。两者同时生效时，在文档与 UI 里说明优先级（见 5.5）。

### 4.3 子代理（subagent）

- DSH 原生的 `ctx.subagents` 是**运行时**：管理 provider 注册、委派、结果回传、深度限制，不扫描「子代理定义文件」。
- 「组合」（工具集、提示词、模型）由 **agent preset** 描述：YAML 插件行、启动时加载、修改只影响之后创建的 Agent，且是 profile 级、全局的。
- 因此：**工作区级的自定义子代理，DSH 原生无法表达**，必须由插件自己定义文件格式并负责「暴露给模型 + 接受调用」。

**对本插件的意义**：子代理不是「放个文件就自动生效」，需要插件提供运行时桥接：

1. 读取子代理定义（Markdown + frontmatter）；
2. 把启用列表注入提示词上下文（名称 + 一句话描述）；
3. 注册 `run_subagent` 工具，用 `ctx.subagents.startActivation()` 按定义启动子会话。

参考 `dsh-agency-agents` 的做法（`list_experts` + `summon_expert`），这条路径是可验证的。

### 4.4 可复用的宿主能力

| 能力 | 服务 | 用途 |
| --- | --- | --- |
| 技能注册 | `ctx.skills` | 注册插件自己的技能 provider |
| 提示词上下文 | `ctx.systemPrompt.context()` | 注入规则文本、子代理目录 |
| 子代理运行时 | `ctx.subagents` | 启动委派、限制深度、结果回传 |
| 工具注册 | `ctx.tools` | 注册 `run_subagent` / `list_subagents` |
| 工作区列表 | `ctx.workspaceRegistry` | 工作区页签的数据源 |
| 目录选择 | `ctx.directoryPicker` / `ctx.remote.directoryPicker` | 「添加来源」时选文件夹 |
| 文件系统 | `ctx.fs` | 读取/写入来源目录，受沙箱策略约束 |
| 客户端 UI | `client.js` + 设置页/侧边栏扩展点 | 渲染管理页面 |

## 5. 设计决策

### 5.1 默认路径

| 作用域 | 默认根目录 | 子目录 |
| --- | --- | --- |
| 全局 | `$DSH_HOME/agent-config/`（默认 `~/.dsh/agent-config/`） | `skills/`、`subagents/`、`rules/` |
| 工作区 | `<workspace>/.dsh/agent-config/` | 同上 |

路径解析规则：优先读 `DSH_HOME` 环境变量，未设置时回退到 `~/.dsh`；与 DSH 原生 `skills` 的 home 解析保持一致。界面上显示缩写路径（`~`），复制与写入时使用绝对路径。

选择理由：

- 与 DSH 自己的 `~/.dsh/skills` 分开，避免「插件管理的技能」和「DSH 原生技能」互相覆盖、重复计数。
- `agent-config` 这个名字对三类资产都成立，不必为规则/子代理再造一个根。
- 工作区路径挂在 `.dsh/` 下，和 DSH 的项目级配置（`.dsh/skills`）放在一起，符合用户直觉，也方便随仓库提交或写进 `.gitignore`。

同时保留「DSH 原生来源」作为**只读来源**展示（可全局关闭）：

- 全局：`~/.dsh/skills`、`~/.agents/skills`
- 工作区：`<workspace>/.dsh/skills`、`<workspace>/.agents/skills`

它们由 DSH 自己加载，插件只做展示与冲突提示，不为原生条目提供开关。同名时按 5.4 的 rank 规则由插件来源胜出，原生条目显示为「被覆盖」——这是为了让界面上的开关始终有效。

### 5.2 来源模型

一个**来源（Source）**是「一个根目录 + 读取方式 + 作用域 + 优先级」：

- `layout: 'structured'`：根目录下按 `skills/`、`subagents/`、`rules/` 三个子目录读取。
- `layout: 'flat'`：根目录本身就是一个类型目录（用于 `~/.claude/skills` 这类外部目录），需显式指定 `kind`。

来源属性：`scope`、`workspaceId?`、`root`、`layout`、`kinds`、`label`、`origin`（default / manual）、`enabled`、`readOnly`、`order`。

**默认来源**：每个作用域懒创建一条 `origin: 'default'` 的记录；可以停用，但不可删除（删除按钮置灰，提示「默认目录只能停用」）。

**手工来源**：可添加多个、可排序、可停用、可移除。移除只删除记录，不动磁盘。

**优先级**：`order` 越小越优先。默认来源初始 `order` 为 100，新来源插入到默认来源之前（即新来源默认优先），用户可手动上移/下移。跨作用域时固定「工作区 > 全局」，不参与 `order` 比较。

### 5.3 启停语义

- 开关**只写插件状态**，不修改来源文件、不移动目录、不写符号链接。
- 生效条件：`source.enabled && asset.enabled && !asset.shadowed`。
- 停用来源 = 该来源下所有条目一起失效；条目开关保留原值，重新启用来源时恢复。
- 对技能的停用，通过 provider 的 `list()` 过滤实现；对规则/子代理，通过注入前过滤实现。
- 状态变化后调用 `ctx.skills` 的 provider `invalidate()` 或发出对应失效事件，让下一次目录读取立即反映。

### 5.4 同名冲突

同一作用域内出现同名资产时：

1. 先比来源 `order`；
2. 再比来源内路径（稳定排序，避免抖动）。

结果：只有胜出者被注入/加载；其余在 UI 中标记「被覆盖」，并在详情抽屉里显示「当前生效：来源 X」。用户可通过调整来源顺序改变胜出者。

跨作用域同名（工作区 vs 全局）：工作区胜出，全局条目标记「被工作区覆盖」。这与 DSH 原生「项目优先于用户」的语义一致。

冲突不自动重命名、不自动删除，只提示。

与 DSH 原生来源的关系：插件 provider 的 rank（工作区 90、全局 390）低于 DSH 原生的项目根（100）与用户根（400），因此**同作用域同名时插件来源胜出**，原生条目在 UI 中标记「被插件来源覆盖」。这样做是为了保证「在界面上关掉的东西真的会失效」；如果反过来让原生目录静默优先，用户点了开关却看不到效果。代价是原生目录的同名条目会显得「没生效」，所以冲突提示必须足够清楚。

### 5.5 三类资产的接入方式

#### 技能：自注册 provider（方案 A，推荐）

- provider 名：`agent-config`。
- `rank`：工作区来源 90，全局来源 390（工作区整体优先于全局；分别低于 DSH 原生的 100 / 400，保证插件管理的条目在同名时胜出，理由见 5.4）。
- `list()` 返回启用且未被覆盖的条目；`get()` 读取当前文件内容（每次重新读，天然支持编辑后即时生效）。
- 收益：即时启停、不依赖 profile 改配置、不需要重启。
- 备选方案 B：维护 `customSkillDirs` 配置（改 profile YAML）→ 需要重启，且无法做条目级开关，不采用。
- 备选方案 C：往 `~/.dsh/skills` 建符号链接 → 侵入原生目录、Windows 权限问题、删除风险，不采用。

#### 规则：`systemPrompt.context` 注入（方案 A，推荐）

- 注册一个全局 context，`text` 在每次组装时按 agent cwd 计算：
  - 全局规则：始终包含（若启用）；
  - 工作区规则：仅当 agent cwd 位于该工作区路径之下时包含。
- 渲染格式：`<agent-config-rules>` 包裹，每条规则带 `来源路径` 与标题，便于模型归因。
- 与 `AGENTS.md` 的关系：两者叠加；`AGENTS.md` 由 DSH 原生注入，本插件规则作为补充。UI 中说明「AGENTS.md 仍然生效」。
- 备选方案 B：仿 `agent-instructions` 在 `agent/pre-step` 注入持久消息 → KV cache 更友好，但实现复杂、需要处理去重/刷新/压缩，放到后续版本评估。

#### 子代理：目录 + 工具（方案 A，推荐）

- 定义文件：`<name>.md`（frontmatter + 正文即系统提示词）。
- 注入：`systemPrompt.context` 输出启用子代理的 `name` + `description`（上限 50 条，超出提示用 `list_subagents` 查看全部）。
- 工具：
  - `list_subagents()`：返回启用子代理的名称、描述、来源；
  - `run_subagent({ name, task, cwd? })`：按定义启动子会话，把「定义正文 + 任务」作为子会话输入，`provider` 默认用 `spawn`（不支持时回退到 `ctx.subagents.list()[0]`），`delivery: 'parent'`，并透传 `maxDepth`。
- 停用后：目录不再列出，工具调用返回「未知或已停用」。
- 备选方案 B：映射到 DSH agent preset → 只能全局、要改 profile、要重启，无法满足「工作区级子代理」，不采用。
- 备选方案 C：只浏览文件不接入运行时 → 功能价值不足，不采用。

### 5.6 状态存储

- 路径：`$DSH_HOME/agent-config-manager/state.json`（默认 `~/.dsh/agent-config-manager/state.json`，与 DSH home 解析一致）。
- 写入：临时文件 + `rename` 原子替换；写前做 schema 校验；损坏时备份为 `state.json.bak` 并回到默认状态。
- 不把状态写进各来源目录，避免污染用户的配置仓库。

## 6. 数据模型

```ts
type Scope = 'global' | 'workspace'
type AssetKind = 'skill' | 'subagent' | 'rule'

interface Source {
  id: string                 // 稳定 id（uuid）
  scope: Scope
  workspaceId?: string       // scope === 'workspace' 时必填
  root: string               // 绝对路径，规范化后存储
  layout: 'structured' | 'flat'
  kinds: AssetKind[]         // structured 时由扫描结果填充；flat 时只有一项
  label: string
  origin: 'default' | 'manual'
  enabled: boolean
  readOnly: boolean          // 原生来源 / 外部 agent 目录
  order: number
  addedAt: string            // ISO 8601
}

interface Asset {
  key: string                // `global:${kind}:${name}` 或 `ws:${workspaceId}:${kind}:${name}`
  kind: AssetKind
  name: string
  description: string
  whenToUse?: string
  sourceId: string
  scope: Scope
  workspaceId?: string
  path: string               // 文件或 SKILL.md 的绝对路径
  dir?: string               // 目录包场景
  enabled: boolean           // 条目级开关，默认 true
  effective: boolean         // 计算属性
  shadowedBy?: string        // 胜出条目的 key
  valid: boolean
  issues?: string[]          // frontmatter 解析失败、名称非法等
  meta: {
    size: number
    mtimeMs: number
    invocation?: { modelInvocable: boolean; userInvocable: boolean }
  }
}
```

`state.json` 示例：

```json
{
  "schemaVersion": 1,
  "sources": [
    {
      "id": "src_default_global",
      "scope": "global",
      "root": "C:\\Users\\me\\.dsh\\agent-config",
      "layout": "structured",
      "kinds": ["skill", "subagent", "rule"],
      "label": "默认目录",
      "origin": "default",
      "enabled": true,
      "readOnly": false,
      "order": 100,
      "addedAt": "2026-10-22T05:00:00.000Z"
    }
  ],
  "overrides": {
    "global:skill:pdf-tools": false,
    "ws:3f2a...:rule:typescript-style": true
  },
  "preferences": {
    "defaultScope": "global",
    "showNativeSources": true,
    "lastWorkspaceId": "3f2a...",
    "collapsedSourceIds": []
  }
}
```

`overrides` 的 key 带上作用域/工作区前缀，避免同名条目互相污染；`collapsedSourceIds` 保存来源折叠状态，保证刷新和重启后界面不跳动。

## 7. 文件格式

### 7.1 技能

沿用 DSH 原生格式，不做扩展：

```markdown
---
name: code-review
description: 按清单审查改动，输出分级问题与修复建议
whenToUse: 用户要求 review、检查 diff、或提交前自检时
---

# Code Review

1. 先读 diff，再读被改动文件的上下文。
2. 按「正确性 → 安全 → 可维护性」分级输出。
```

### 7.2 子代理

```markdown
---
name: code-reviewer
description: 独立审查代码改动，不修改文件
whenToUse: 需要第二双眼睛审查 PR 或本地 diff 时
---

你是一名只读的代码审查员。

- 不修改任何文件；
- 先复述改动意图，再给问题；
- 每个问题标注严重级别与最小修复建议。
```

MVP 只使用 `name`、`description`、`whenToUse` 与正文。`model`、`tools` 等字段暂不解析，避免「写了但不生效」的误解；后续版本再评估。

### 7.3 规则

```markdown
---
name: typescript-style
description: 本仓库的 TypeScript 风格约束
---

- 使用 strict 模式，禁止隐式 any。
- 公共 API 必须有 JSDoc。
- 测试文件与实现文件同目录。
```

MVP 中规则一旦启用即对该作用域内所有会话生效（全局）或对该工作区所有会话生效，不做 glob 路径匹配。`globs` 字段留到后续版本。

## 8. 交互设计

### 8.1 入口与信息架构

- 主入口：**设置 → Agent 配置**（设置导航项，图标 + 文案，参考 `dsh-skills-manager` 的 `settings-nav-icon`）。
- 可选入口：侧边栏按钮（与参考插件一致），默认关闭，设置里可开。
- 页面内结构：

```
Agent 配置
├── 作用域页签：全局 | 工作区（下拉选择已登记工作区）
├── 工具条：搜索 / 添加来源 / 刷新
├── 类型筛选：全部 · 技能 · 子代理 · 规则
├── 状态筛选：全部 · 已启用 · 已停用 · 有冲突
└── 来源分组列表
    ├── 来源头：名称、路径、条目数、启用开关、更多菜单
    └── 条目行：图标、名称、描述、类型、开关、详情入口
```

工作区下拉的数据来自 `ctx.workspaceRegistry`：显示工作区标题，失效路径置灰并标注「目录不可用」，空工作区仍可选择；选择结果写入 `preferences.lastWorkspaceId`，下次打开恢复到上次位置。

### 8.2 主界面线框

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Agent 配置                                      [搜索…]  [＋ 添加来源]  ⟳   │
│  ┌──────────────┐  ┌──────────────────────────────────┐                      │
│  │ 全局         │  │ 工作区  dsh-plugin            ▾  │                      │
│  └──────────────┘  └──────────────────────────────────┘                      │
│  全部 12 · 技能 5 · 子代理 4 · 规则 3       来源：全部 ▾   状态：全部 ▾      │
├──────────────────────────────────────────────────────────────────────────────┤
│  ▾  默认目录    ~/.dsh/agent-config                         ● 已启用   ⋯     │
│     技能 2 · 子代理 1 · 规则 1                                               │
│     ┌────────────────────────────────────────────────────────────────────┐   │
│     │ ⚡ code-review       按清单审查改动，输出分级问题   技能    ●   ›  │   │
│     │ ⚡ pdf-tools         读取、拆分与合并 PDF           技能    ●   ›  │   │
│     │ ◇ code-reviewer     独立审查代码改动，不修改文件   子代理  ●   ›  │   │
│     └────────────────────────────────────────────────────────────────────┘   │
│  ▸  团队共享库    D:\shared\agent-config    只读 · 4 项      ● 已启用   ⋯     │
│  ▸  DSH 原生技能  ~/.dsh/skills             只读 · 6 项      —          ⋯     │
└──────────────────────────────────────────────────────────────────────────────┘
```

要点：

- **来源是折叠容器**，默认展开第一个有内容的来源；折叠状态按「作用域 + 来源 id」记忆。
- 条目行不显示绝对路径（太长），路径放在详情里；行尾只保留类型徽标、开关、详情箭头。
- 只读来源显示「只读」徽标，开关替换为禁止态，悬停提示「此来源由 DSH 或外部工具加载」。
- 有冲突的条目在名称右侧显示 `⚠ 被覆盖`，点开详情看胜出者。

### 8.3 详情抽屉

```
┌ 详情 ────────────────────────────────────────────────── × ┐
│ code-review                             [技能]  [● 启用]  │
│ 按清单审查改动，输出分级问题与修复建议                     │
│ 来源：默认目录（全局）                                      │
│ 路径：~/.dsh/agent-config/skills/code-review/SKILL.md      │
│ ─────────────────────────────────────────────────────────  │
│ [概览]  [正文]  [元数据]                                    │
│                                                            │
│ # Code Review                                              │
│ 1. 先读 diff，再读被改动文件的上下文。                      │
│ 2. 按「正确性 → 安全 → 可维护性」分级输出。                │
│                                                            │
│ 调用控制：模型可调用 · 用户可调用                           │
│ 冲突：无                                                    │
│ [复制路径]  [在文件夹中显示]                                │
└────────────────────────────────────────────────────────────┘
```

- 「正文」用只读 Markdown 渲染，代码块高亮；不做富文本编辑（MVP）。
- 「元数据」显示 frontmatter 原始键值、文件大小、修改时间、生效状态。
- 抽屉宽度约 480–560px，移动端变为全屏。

### 8.4 添加来源向导

```
┌ 添加配置来源 ────────────────────────────────────────── × ┐
│  ① 选择文件夹  →  ② 识别结构  →  ③ 确认                    │
│                                                            │
│  文件夹  D:\shared\agent-config              [浏览…]        │
│                                                            │
│  检测到：                                                   │
│   ☑ skills/       2 个技能                                  │
│   ☑ subagents/    1 个子代理                                │
│   ☐ rules/        不存在                                    │
│                                                            │
│  没有子目录？也可以把该文件夹当作单一类型来源：              │
│   ○ 技能目录   ○ 子代理目录   ○ 规则目录                    │
│                                                            │
│  名称      [团队共享库            ]                         │
│  作用域    [全局 ▾]                                         │
│  优先级    [上移] [下移]   高于「默认目录」                 │
│                                    [取消]  [添加]           │
└────────────────────────────────────────────────────────────┘
```

流程细节：

1. 点「浏览」调用宿主目录选择器（`ctx.directoryPicker`），只允许选目录。
2. 选中后扫描一层子目录，识别 `skills` / `subagents` / `rules`；同时统计每类条目数。
3. 若一个都没识别到，退回「单一类型」模式，由用户指定类型；此时列表直接读根目录下的 `*.md` / `*/SKILL.md`。
4. 名称默认取文件夹名，可改；作用域默认当前页签，可改（切换作用域时工作区下拉出现）。
5. 「添加」前做校验：目录可读、路径未重复、无嵌套重叠（父目录已作为来源时提示）。
6. 添加成功后，列表滚动到新来源并短暂高亮。

### 8.5 关键流程

**首次使用（默认目录不存在）**

```
空状态
  图标 + 「还没有配置来源」
  说明：默认会在 ~/.dsh/agent-config 下读取 skills / subagents / rules
  [创建默认目录]   [添加已有文件夹]
```

点「创建默认目录」：创建 `skills/`、`subagents/`、`rules/` 三个目录和一个 `README.md`（说明三类文件的写法），完成后列表刷新。**不自动创建**，避免用户不知情地在 home 下写目录。

**启停条目**

1. 点开关 → 本地乐观更新；
2. 写 `state.json`；
3. 技能调用 provider `invalidate()`；规则/子代理在下一次提示词组装时读取新状态；
4. 失败则回滚并 toast「保存失败，已恢复原状态」。

**调整来源优先级**

来源头「⋯ → 上移 / 下移」，或在「管理来源」弹窗里拖拽排序。排序变化立即重算冲突与生效项。

**删除来源**

「⋯ → 移除来源」→ 确认弹窗写明「只移除记录，不会删除文件夹」→ 移除后条目从列表消失，磁盘不变。默认来源不可移除。

**新建资产（M5）**

「＋ 新建」→ 选类型 → 选目标来源（默认当前作用域默认目录）→ 填名称/描述/正文 → 校验名称合法与重名 → 写入文件 → 刷新。MVP 不做。

### 8.6 状态与文案

| 场景 | 表现 |
| --- | --- |
| 加载中 | 来源骨架屏（3 组），不整页转圈 |
| 来源不可读 | 来源头红色警示 + 「路径不存在或无权限」，条目不展示，提供「重新检测 / 移除」 |
| 条目解析失败 | 行内置灰 + `⚠`，详情显示具体原因（缺 name、YAML 语法错误等） |
| 空来源 | 来源头显示「0 项」，展开后一行提示「此目录下没有可识别的配置」 |
| 全部为空 | 空状态 + 创建/添加引导 |
| 冲突 | 名称后 `⚠ 被覆盖`，详情给出生效来源与调整入口 |
| 只读 | 开关禁用，悬停说明；无新建/删除入口 |

文案统一中文，英文随 `locale/` 提供；日期用本地时区，路径用等宽字体并支持复制。

### 8.7 无障碍与响应式

- 开关使用原生 `role="switch"` + `aria-checked`；来源折叠用 `aria-expanded`。
- 全键盘可达：Tab 顺序为 页签 → 搜索 → 筛选 → 来源头 → 条目；`Enter` 打开详情，`Esc` 关闭抽屉。
- 抽屉打开时焦点陷阱，关闭后焦点回到触发行。
- 窄屏（< 720px）：页签与筛选换行，来源头路径省略为 `…`，详情全屏。
- 颜色不是唯一信息载体：冲突同时用图标 + 文案，不只靠颜色。

## 9. 技术架构

### 9.1 插件包结构

```
dsh-agent-config/
├── package.json            # dsh.bundle.patch 指向 cordis.patch.yml
├── cordis.patch.yml
├── index.js                # Host 入口
├── client.js               # Web UI 入口（构建产物）
├── src/
│   ├── host/
│   │   ├── store.ts        # state.json 读写、schema 校验、原子写
│   │   ├── sources.ts      # 默认来源、增删改、排序、路径校验
│   │   ├── scanner.ts      # 目录扫描、frontmatter 解析、缓存与 watch
│   │   ├── resolve.ts      # 冲突解析、effective 计算
│   │   ├── skills.ts       # 注册 ctx.skills provider
│   │   ├── rules.ts        # 注册 systemPrompt.context
│   │   ├── subagents.ts    # 目录上下文 + run_subagent / list_subagents 工具
│   │   └── remote.ts       # 暴露给客户端的 RPC
│   └── client/
│       ├── page.tsx        # 设置页主体
│       ├── source-group.tsx
│       ├── asset-row.tsx
│       ├── detail-drawer.tsx
│       └── add-source-dialog.tsx
├── locale/
│   ├── zh.yml
│   └── en.yml
├── doc/
│   └── design.md
└── README.md
```

> 仓库现有约定是「一个插件一个目录」；当前目录放在仓库根 `dsh-agent-config/`，若后续统一收进 `plugins/`，只需移动目录并更新 README 清单。

### 9.2 Host 模块职责

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| `store` | 读取/写入 `state.json`；缺省值合并；损坏恢复 | `ctx.fs` |
| `sources` | 默认来源懒创建；添加/移除/排序；路径规范化与去重 | `store`、`ctx.fs` |
| `scanner` | 扫描目录、解析 frontmatter、统计；缓存 + 失效 | `ctx.fs`、watch |
| `resolve` | 合并来源与条目开关，计算 `effective` 与冲突 | `sources`、`scanner` |
| `skills` | 把生效技能转成 SkillProvider；失效通知 | `ctx.skills` |
| `rules` | 拼装规则文本；按 cwd 过滤工作区规则 | `ctx.systemPrompt` |
| `subagents` | 子代理目录注入；注册工具；启动委派 | `ctx.subagents`、`ctx.tools` |
| `remote` | 给 UI 的查询/变更接口 | `ctx.remote` 或等效 RPC |

### 9.3 数据流

```
            ┌──────────────┐        ┌───────────────┐
 用户操作 → │  Client UI   │ ─RPC→  │  remote.ts    │
            └──────────────┘        └───────┬───────┘
                                            │
                              ┌─────────────▼─────────────┐
                              │ sources / resolve         │
                              └───────┬───────────┬───────┘
                                      │           │
                              ┌───────▼───┐   ┌───▼────────┐
                              │  store    │   │  scanner   │
                              │ state.json│   │ 磁盘 + 缓存 │
                              └───────────┘   └───┬────────┘
                                                  │
                     ┌────────────────────────────┼───────────────────────────┐
                     │                            │                           │
              ┌──────▼──────┐              ┌──────▼──────┐            ┌───────▼───────┐
              │ ctx.skills  │              │ systemPrompt│            │ ctx.subagents │
              │ provider    │              │ context     │            │ + tools       │
              └─────────────┘              └─────────────┘            └───────────────┘
```

启动时：读 state → 确保默认来源记录 → 扫描 → 注册 provider/context/tools → 建立 watch。

### 9.4 关键集成（伪代码，签名以实际 DSH 版本为准）

```ts
// 技能 provider：只返回生效条目
ctx.skills.registerProvider(() => ({
  name: 'agent-config',
  async list({ cwd, signal }) {
    const assets = await resolve.listEffective({ kind: 'skill', cwd, signal })
    return assets.map((a) => ({
      name: a.name,
      description: a.description,
      whenToUse: a.whenToUse,
      invocation: a.meta.invocation ?? { modelInvocable: true, userInvocable: true },
      source: 'custom',
      provider: 'agent-config',
      rank: a.scope === 'workspace' ? 90 : 390,
      locator: { path: a.path },
      path: a.path,
    }))
  },
  async get(candidate, { signal }) {
    return loadSkillDefinition(candidate.locator.path, signal)
  },
}))
```

```ts
// 规则：每次组装按 agent cwd 取全局 + 当前工作区规则
ctx.systemPrompt.context({
  name: 'agent-config:rules',
  order: RULE_CONTEXT_ORDER, // 实现时与现有分配对齐，放在工作区指令之后
  text: (assembly) => {
    const cwd = assembly.agent?.cwd
    const rules = resolve.listEffectiveSync({ kind: 'rule', cwd })
    return renderRules(rules) // <agent-config-rules>…</agent-config-rules>
  },
})
```

```ts
// 子代理：目录 + 工具
ctx.tools.register({
  name: 'run_subagent',
  description: '按名称启动一个已启用的子代理，返回其最终结果',
  parameters: {
    type: 'object',
    required: ['name', 'task'],
    properties: {
      name: { type: 'string', description: '子代理名称' },
      task: { type: 'string', description: '完整任务说明' },
      cwd: { type: 'string', description: '可选工作目录' },
    },
  },
  async execute(args, exec) {
    const def = resolve.getEnabled('subagent', args.name, exec.agent.cwd)
    if (!def) return { isError: true, content: `未知或已停用的子代理：${args.name}` }
    const provider = ctx.subagents.list().includes('spawn') ? 'spawn' : ctx.subagents.list()[0]
    const activation = await ctx.subagents.startActivation({
      provider,
      label: def.name,
      request: {
        parent: exec.agent,
        signal: exec.signal,
        cwd: args.cwd,
        prompt: [{ type: 'text', text: `${def.body}\n\n---\n\n任务：${args.task}` }],
      },
      signal: exec.signal,
      delivery: 'parent',
    })
    return await activation.result
  },
})
```

### 9.5 扫描、缓存与失效

- 启动时全量扫描一次；之后优先用 `chokidar` 监听 `skills/`、`subagents/`、`rules/` 的增删改（300ms 去抖）；不可用时回退到定时轮询（30s），再不行就只保留手动刷新。
- 扫描结果缓存为 `Map<sourceId, { assets, scannedAt }>`；文件 mtime + size 未变则复用解析结果。
- 单文件上限 1 MiB；单来源条目上限 2000（超出截断并提示）；frontmatter 解析失败不阻断整目录。
- 条目正文按需读取（打开详情时），列表只读 frontmatter，降低大目录开销。
- watch 失败降级为「手动刷新」按钮，不阻塞页面。

### 9.6 安全

- **写操作只允许**：默认来源、手工添加且非只读的来源；路径必须位于来源根目录内（`path.resolve` 后做前缀校验，拒绝 `..` 与符号链接逃逸）。
- **只读来源**：原生 DSH 目录、外部 agent 目录、任何 `readOnly: true` 的来源；UI 禁用写入口，Host 侧二次校验。
- **不执行来源内容**：只解析 YAML frontmatter 与 Markdown 文本；拒绝 `!!js` 等自定义标签（用安全解析模式）。
- **不信任 frontmatter**：名称不合法、描述超长（> 500 字符）、正文含闭合标签时做转义/截断，避免破坏提示词结构。
- **子代理工具**：限制最大并发 1（同一会话内串行）、透传 `maxDepth`、禁用子代理再派生子代理（避免递归放大）；定义正文不包含工具授权。
- **路径显示**：UI 展示的绝对路径做 home 目录缩写（`~`），复制时给完整路径。

## 10. MVP 范围与里程碑

| 阶段 | 范围 | 完成标志 |
| --- | --- | --- |
| M0 骨架 | 插件包、manifest/patch、设置页入口、空页面 | 安装后能在设置里看到「Agent 配置」 |
| M1 全局只读 | 默认目录扫描、来源分组、列表、搜索、详情 | 默认目录里的技能/规则/子代理能被列出 |
| M2 技能生效 | 技能 provider、条目/来源开关、冲突解析 | 关闭技能后新会话目录中消失 |
| M3 工作区 | 工作区页签、工作区默认来源、多来源与排序 | 工作区技能只在该工作区会话生效 |
| M4 规则与子代理 | 规则注入、子代理目录与工具 | 工作区规则只注入该工作区；子代理可被调用 |
| M5 打磨 | 错误态、空态、i18n、无障碍、新建/删除 | 通过第 11 节验收 |

写操作（新建/编辑/删除/回收站）放在 M5，MVP 先做「读取 + 启停 + 添加/移除来源」。

## 11. 验收标准

1. 默认目录不存在时，页面显示引导；点击「创建默认目录」后生成三个子目录，刷新出现三个来源组。
2. 默认目录放入一个技能，列表可见；关闭开关后，该技能在下一次模型步骤的技能目录中消失；重新打开后恢复。
3. 添加第二个来源后，其条目出现在统一列表，可单独启停；移除来源后条目消失，磁盘文件仍在。
4. 同名技能同时存在于全局与工作区：工作区条目标记生效，全局条目标记「被工作区覆盖」。
5. 调整来源顺序后，同名条目的生效者随之改变，无需重启。
6. 全局规则出现在所有会话；工作区规则只出现在 cwd 位于该工作区的会话。
7. 启用子代理后，模型可调用 `run_subagent` 并拿到结果；停用后调用返回「未知或已停用」。
8. 只读来源无新建/删除入口，开关为禁用态；Host 侧拒绝写入尝试。
9. 重启 DSH 后，来源、开关、折叠状态、上次工作区均保持。
10. 来源目录不可读时，页面显示错误态且不影响其他来源。
11. 详情抽屉可用键盘打开/关闭，焦点正确返回。
12. 大目录（500 个条目）首次加载 < 2s，开关操作反馈 < 200ms（乐观更新）。

## 12. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| DSH 插件 API 变动（preview） | provider/context/tools 签名变化 | 按 `engines.dsh` 锁定验证过的版本；集成层集中隔离，便于适配 |
| `systemPrompt.context` 变更导致 KV cache 失效 | 开关规则后首轮变慢 | 规则变更低频；UI 提示「下一条消息生效」；后续可改持久消息注入 |
| 与 DSH 原生技能重名 | 用户困惑「为什么没生效」 | 冲突检测 + 明确 badge + 详情说明；rank 设计保证工作区优先 |
| 子代理递归/滥用 | token 与并发放大 | 禁用嵌套派生子代理；`maxDepth` 透传；同会话串行 |
| Windows 符号链接/权限 | 写入失败、路径解析异常 | 写操作拒绝符号链接；错误就地提示；不做跨盘链接 |
| 大目录/watch 抖动 | 页面卡顿、CPU 占用 | 缓存 + 去抖 + 条目上限；watch 失败降级手动刷新 |
| 用户误删默认目录内容 | 配置丢失 | 移除来源不删文件；删除资产进回收站（M5） |

## 13. 待确认问题

以下 6 项会实质影响实现，需要确认后再进入实现计划。

| # | 问题 | 选项 | 建议 |
| --- | --- | --- | --- |
| Q1 | 「子代理」的定义方式 | A. Markdown 定义 + 插件提供 `run_subagent` 运行时；B. 映射 DSH agent preset（全局、需重启）；C. 只浏览文件不接入 | **A**：唯一能支持工作区级子代理的方案 |
| Q2 | 「规则」的生效方式 | A. 常驻注入（全局/工作区各一层）；B. 支持 glob 路径匹配；C. 只管理文件不注入 | **A**：MVP 简单可控，B 放后续 |
| Q3 | 默认根目录 | A. `~/.dsh/agent-config/{skills,subagents,rules}`；B. 复用 `~/.dsh/{skills,agents,rules}`；C. `~/.agents/...` | **A**：与 DSH 原生目录解耦，避免重复加载 |
| Q4 | 是否把 DSH 原生目录（`~/.dsh/skills` 等）作为只读来源展示 | A. 展示（可全局关闭）；B. 完全不展示 | **A**：用户能看到「为什么某个技能已经存在」 |
| Q5 | MVP 是否包含写操作 | A. 只做读取 + 启停 + 来源管理；B. 同时做新建/编辑/删除/回收站 | **A**：先验证加载链路，写操作放 M5 |
| Q6 | 是否需要兼容 Claude Code / Codex 的目录格式 | A. MVP 支持把 `~/.claude/skills` 作为 flat 来源；B. 暂不支持 | **A**：成本低，能直接复用现有技能库 |

## 14. 参考资料

- DSH Skills Manager 仓库：<https://github.com/MichengAI/dsh-skills-manager>
- DSH Agency Agents 仓库：<https://github.com/MichengAI/dsh-agency-agents>
- DSH Skills 子系统文档：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.zh.md>
- DSH 子代理子系统文档：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/subagent.zh.md>
- DSH 系统提示词文档：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/system-prompt.zh.md>
- DSH 工作区文档：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/workspace.zh.md>
- DSH 插件开发入门：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.zh.md>
- `dsh-agent-instructions` 说明：<https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.zh.md>
- `dsh-skill-filesystem` 说明：<https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.zh.md>

---

### 附：调研边界说明

本文的 DSH 行为结论来自官方仓库 `master` 分支的 Markdown 文档与包 README，**没有 clone 任何仓库**，也没有读取 DSH 的构建产物。涉及具体 API 签名、客户端扩展点、`engines.dsh` 版本范围的部分，需要在实现前用本地安装的 DSH 与官方示例再核对一次；如需要，我可以先征得同意再 clone 参考项目做源码级比对。
