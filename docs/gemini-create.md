# DeepSeek Harness (DSH) Agent 配置与创造模式开发指南

> **文档定位**：本指南用于指导 Agent（以及开发者）理解 DeepSeek Harness (DSH) 的内核架构、Agent 预设体系，以及如何在“创造模式”（Creator Mode）下进行插件扩展、预设定制与功能开发。

---

## 1. 架构总览与 Agent 运行机制

DeepSeek Harness 基于 **Cordis 微内核体系** 构建。在 DSH 中，Agent 不是一个写死的单一执行体，其可用工具、人设提示词、技能库及执行逻辑均由**声明式的插件组合（Agent Preset）**动态驱动。

### 1.1 核心分层架构

```
┌────────────────────────────────────────────────────────────────────────┐
│                      Host 平面 (Cordis 微内核)                          │
│ 共享基础服务：Agent Loop、Session 日志、持久化存储、模型路由、全局工具等 │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
┌───────────────────────────┐             ┌───────────────────────────┐
│   AgentPresetRegistry     │             │     Profile / Bundles     │
│   (预设注册表与代际管理)     │             │    (用户与内置 Patch 层)    │
└─────────────┬─────────────┘             └─────────────┬─────────────┘
              │                                         │
              ├─────────────────────────────────────────┤
              ▼                                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Agent 预设 (Session Scope)                       │
│  ├─ 标准模式 (standard)  : 通用编程、文件读写、检索、命令终端            │
│  ├─ PTC 模式 (ptc)       : Programmatic Tool Calling 代码调度工具      │
│  ├─ 极简模式 (minimal)   : 持久终端与图片输入，评测对照基线             │
│  └─ 创造模式 (cordis)    : 运行时 API 探查、插件开发、预设自定制        │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.2 关键概念与生命周期

* **Agent Preset（预设）**：在 Cordis patch 中通过 `@deepseek-ai/dsh-agent-preset` 行声明，定义了该模式下的子插件列表（`plugins`）、展示名称、描述及排序。
* **Scope（作用域隔离）**：
  * Host 级插件提供进程全局服务（如 Agent Loop、Tools 注册表）。
  * Preset 级插件仅注册至当前 Session 的专属 Scope，互不干扰。提供私有服务的插件需配置 `cordis:group` 及 `isolate` realm。
* **代际保留（Generation Retention）**：
  * 预设更新或重新安装时，**已运行中的 Session/Agent 不会被破坏**，它们继续持有创建时的代际引用；
  * 直到会话结束、所有引用释放后，旧代际才会被垃圾回收；
  * 新建 Session 则会自动挂载最新的预设定义。
* **空白会话（Blank Session）规则**：
  * 仅在尚未发送任何首轮对话的空白会话中允许切换预设；
  * 一旦首轮对话开始，预设即刻锁定并落账到 Session 日志（`agentPreset` 投影）。

---

## 2. 系统内置预设对照表

| 预设名称 | 预设 ID | Loader 行 ID | 典型适用场景 | 核心工具与能力组合 |
| :--- | :--- | :--- | :--- | :--- |
| **标准模式**<br>*(Standard mode)* | `standard` | `preset-standard` | 日常代码编写、文件处理、资料检索、故障排查 | `tool-bash`/`pwsh`, `tool-fs`, `tool-fs-search`, `tool-jobs`, `planning` (计划模式), `compaction`, `subagent`, `workflow`, `tool-todo`, `tool-web` |
| **PTC 模式**<br>*(PTC mode)* | `ptc` | `preset-ptc` | 大规模批量处理文件、数据筛选/去重/汇总 | 在标准能力基础上，引入 `tool-executor-ptc`，支持 `run_code` 编写 TypeScript 聚合调度工具；禁用 workflow 与插件管理工具以维持稳定 |
| **极简模式**<br>*(Minimal mode)* | `minimal` | `preset-minimal` | 基础模型能力评测、纯终端命令行对照实验 | `persona` (固定简易系统提示词), `read_image`, `persistent-shell` (持久 PTY 终端), 基础上下文压缩；不加载 Skills 和高级规划 |
| **创造模式**<br>*(Creator mode)* | `cordis` | `preset-cordis` | **定制 DSH 自身、开发插件、增加新功能或 UI 页面、自制新预设** | **包含标准模式全套能力**，并额外挂载 `tool-cordis`、`skill-filesystem`（专有开发技能）、`tool-plugin-manager` 与 `tool-plugin-market` |

---

## 3. “创造模式”（Creator Mode）全景解构

在源码及多语言配置中，创造模式的内部 ID 为 **`cordis`**。

### 3.1 预设补丁配置
声明文件路径：`packages/bundle/web-app/presets/cordis.patch.yml`

```yaml
- insert:
    - id: preset-cordis
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: cordis
        order: 4
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: >-
                You are a coding agent powered by the {{model}} model.
          # ... [标准工具链: fs, bash/pwsh, planning, delegation 等] ...
          # 创造模式专有工具:
          - id: tool-cordis
            name: '@deepseek-ai/dsh-tool-cordis'
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
            config:
              customSkillDirs:
                - !!js process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('@deepseek-ai/dsh-agent-preset/package.json')), 'skills')
          - id: tool-skill
            name: '@deepseek-ai/dsh-tool-skill'
          - id: tool-plugin-manager
            name: '@deepseek-ai/dsh-plugin-manager/tools'
            disabled: !!js "!ctx.get('profileContext')"
          - id: tool-plugin-market
            name: '@deepseek-ai/dsh-plugin-market/tools'
            disabled: !!js "!ctx.get('profileContext')"
```

### 3.2 专有核心工具（Tools）

创造模式引入了 `@deepseek-ai/dsh-tool-cordis`，向 Agent 暴露运行时只读探查接口：

1. **`cordis_inspect_list`**：
   * 列出宿主进程与客户端支持探查的 Provider（如 `Service`、`Event`、`Tool`、`Config`、`Slots`、`Theme` 等）。
2. **`cordis_inspect_query`**：
   * 精确查询特定运行时声明与规范：
     * **服务接口**：查询 Host/Client 服务的公开方法与入参类型。
     * **UI 槽位**：查询客户端槽位树（`Slots.listSubTree`），探查侧边栏、标题栏、菜单等注入点及其 Props。
     * **配置 Schema**：通过 `Config.listConfigs` 检索已装载插件条目，获取其 Config 的 JSON Schema 及所在绝对物理路径 `packageDir`。

### 3.3 专有内置技能（Skills）

位于 `packages/preset/agent-preset/skills/`，通过 `skill-filesystem` 仅在创造模式挂载：

* **`cordis-plugin-development`**：
  * 指导 Agent 完成 DSH 插件、UI 扩展与 MCP 配置的完整闭环。
  * 规定了三级知识检索顺序：**① 运行时探查 (`cordis_inspect_query`) → ② 查阅 `<packageDir>/README.md` → ③ 查阅编译产物 `lib/` 或源码**。
* **`editing-cordis-compositions`**：
  * 指导 Agent 如何编写声明式 Bundle 来新增或重写 Agent 预设，并进行合法性校验。
* **`cordis-composition-reference`**：
  * Cordis YAML 补丁方言（`insert`、`override by id`、`disabled: !!js`、`isolate`）与全部内置插件包目录索引。
* **`agent-experience`**：
  * 约束 Agent 设计工具 Schema 与 Prompt 时的紧凑性原则（删除冗余约束、就近披露、结果有界输出）。

---

## 4. Agent 核心开发实战指引

在创造模式下，Agent 面向两类典型开发任务：**开发新插件（功能/UI/MCP）** 与 **定制 Agent 预设模式**。

### 4.1 任务一：开发与安装 DSH 插件 (Bundle)

不要试图直接修改 `$DSH_HOME` 或系统的核心代码。Agent 应当在**工作区**内创建标准 Bundle，再调用 `plugin_manager` 自动安装。

#### 步骤 1：探查目标 API 与 UI 槽位
```typescript
// 伪代码示例：Agent 在会话中调度工具
// 1. 查找可用的客户端插槽
await cordis_inspect_query({ provider: 'Slots', target: 'listSubTree' });
// 2. 查找相关服务的 API 接口
await cordis_inspect_query({ provider: 'Service', target: 'workspace' });
```

#### 步骤 2：在工作区构建 Bundle 目录
标准插件 Bundle 结构如下：
```text
my-cool-plugin/
├── package.json          # 清单声明 (指定 dsh.bundle.patch)
├── cordis.patch.yml      # Cordis 补丁文件
├── index.js              # Host 端插件入口 (可选)
├── client.js             # Client 端 UI 插件入口 (可选)
├── icon.svg              # 插件图标 (SVG 格式)
└── locale/               # 多语言翻译目录
    ├── zh.json
    └── en.json
```

**`package.json` 规范**：
```json
{
  "name": "@local/dsh-my-cool-plugin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "这是插件的一句话说明",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

**`cordis.patch.yml` 示例（注册 Host 服务与 Client UI）**：
```yaml
- insert:
    - id: my-host-service
      name: ./index.js
      config:
        foo: 'bar'
    - id: my-ui-view
      name: ./client.js
```

#### 步骤 3：调用 `plugin_manager` 安装
Agent 调用内置管理工具完成 profile 写入与依赖链接：
```json
{
  "tool": "plugin_manager",
  "action": "install_bundle",
  "target": "E:/Code/dsh-plugin/my-cool-plugin"  // 必须是绝对路径
}
```
* `install_bundle` 会自动执行包的本地软链、profile 配置写入及 `pnpm` 关联。
* 安装完成后，调用 `cordis_inspect_query` 检验插槽挂载状态。

---

### 4.2 任务二：创建或修改 Agent 预设 (Preset)

#### 场景 A：新建一个自定义预设模式
在工作区创建预设 Bundle（例如 `review-preset/`）：

1. **`package.json`**：
```json
{
  "name": "@local/dsh-review-preset",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

2. **`cordis.patch.yml`**：
```yaml
- insert:
    - id: preset-review
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: review
        name: 代码审查模式
        description: 专注于代码走查，仅启用检索和只读分析工具。
        order: 10
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: 你是一个严格的高级代码审查员，优先检查架构漏洞、异常流与测试覆盖。
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
            config:
              read: true
              write: false
              edit: false
          - id: tool-fs-search
            name: '@deepseek-ai/dsh-tool-fs-search'
```

3. **执行安装**：
调用 `plugin_manager` 安装该目录后，新任务的预设名册中即会出现“代码审查模式”。

#### 场景 B：覆盖系统内置预设（如修改标准模式）
不要使用 `insert`，而是通过覆盖 Loader 行 ID（例如 `preset-standard`）。
> **注意**：覆盖会**完全替换**该条目的 `config`（批发替换，非深合并），因此必须重述所需保留的全部 `plugins` 列表：

```yaml
- id: preset-standard
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: standard
    order: 1
    plugins:
      # 重述官方标准插件列表，并在其中增加或调整你的自定义配置
```

---

## 5. UI 交互与触发工作流

DSH 在 Web 前端（`packages/client/ui-agent-preset`）为创造模式提供了无缝接入的 UI 触发机制：

1. **设置页自定义预设卡片**：
   * 路径：`设置 -> Agent 预设 -> 自定义分组`
   * 操作：点击 **“让 Agent 帮我创建预设模式”**（`creatorDraft`）。系统会暂存并创建一个指定 `agentPreset: 'cordis'` 的新会话，引导 Agent 协助用户组装模式。
2. **插件侧边栏管理菜单**：
   * 路径：`插件页 -> 添加插件下拉菜单`
   * 操作：点击 **“让 Agent 创建插件”**（`createPlugin`）。系统会进入创造模式任务，保留当前工作区草稿，开始交互式插件编写。
3. **新任务启动器**：
   * 会话未发送第一条消息前，可直接在预设下拉胶囊中选择 **“创造模式”**。

---

## 6. Agent 开发者关键注意事项与避坑指南

1. **严禁越过工具手写 Profile 目录**：
   * 切勿通过 Shell 脚本或文件写入工具直接修改 `$DSH_HOME/profiles/<profile>/package.json` 或 `cordis.patch.yml`。
   * 必须统一使用 `plugin_manager` 的 `install_bundle` 操作，由系统托管锁与 HMR 热更新。
2. **桌面端 `app.asar` 路径陷阱**：
   * 在 Desktop 打包环境中，官方模板和内置代码位于只读的 `app.asar` 归档包内。常规的 Shell 命令（如 `cat`、`cp`、`grep`）无法读取该路径。
   * 必须使用宿主提供的只读文件读取工具（`file_read`）或者 `cordis_inspect_query` 进行探查。
3. **配置替换为全量生效（No Deep Merge）**：
   * 覆盖已有插件行或预设行的 `config` 时，Cordis 采用覆盖式赋值。任何省略的字段都会丢失，覆盖时务必重述其原有依赖行。
4. **服务隔离与 Scope 放置**：
   * 仅为单个 Agent 服务的插件，挂载在 Preset 内部即可；
   * 若插件提供的服务需要被宿主进程（Host）或其他插件引用，则该条目必须注册为 Host 级插件，并在必要时使用 `cordis:group` + `isolate` 避免服务全局污染。
5. **审批与安全权限**：
   * `plugin_manager` 涉及宿主进程代码加载与本地命令执行，在沙箱受限环境需要用户授权确认。Agent 应提前向用户说明操作意图与影响范围。

