# AGENTS.md

本仓库是个人自用的 DeepSeek Harness（DSH）插件合集。给在本目录工作的 agent 的约定：先读本文件，再读 [`README.md`](./README.md) 和目标插件自己的 `README.md`。

## 源码就在本地：`ref/deepseek-harness/`

> **这是本仓库最重要的一条约定。** [`ref/deepseek-harness/`](./ref/deepseek-harness/) 是 **DSH 本体的完整开源源码**（git submodule，当前 `dsh-v0.2.2-rc.1`，与桌面端已安装的 0.2.2-rc.1 同源，用 `git -C ref/deepseek-harness describe --tags` 查实际版本）。

**凡是涉及 DSH 自身行为的问题——插件 API、`ctx` 上有哪些服务和方法、事件名与载荷、`SessionEventMap`、配置 schema、profile / bundle / patch 的合并规则、客户端 UI 槽位、CLI 子命令、权限与沙箱策略——都不要凭记忆、猜测或网上二手资料回答，直接在这个源码树里查证后再写代码或写文档。**

怎么查：

| 想找的东西 | 去哪看 |
| :--- | :--- |
| 架构总览、能力 seam、生命周期 | `ref/deepseek-harness/docs/`（大量 `.md` 有 `.zh.md` 中文版，如 `architecture.zh.md`、`capability-seams.zh.md`） |
| 某个功能的实现 | `ref/deepseek-harness/packages/<分组>/<包>/src/`（分组列表见 `ref/deepseek-harness/packages/AGENTS.md`） |
| 插件怎么接入、bundle / patch 怎么写 | `ref/deepseek-harness/docs/cookbook/`、`docs/user/develop/`、`packages/bundle/` |
| 内部开发约定（类型、错误、测试） | `ref/deepseek-harness/AGENTS.md` 与其子目录的 `AGENTS.md`（**只作为参考**，它约束的是那个仓库，不是本仓库） |
| 版本与迁移 | `ref/deepseek-harness/docs/`（如 `session-format-status.md`、升级指南）、根 `package.json` |

搜索建议：先用 `grep` 在 `packages/*/*/src` 里搜标识符（事件名、服务名、方法名），再顺着声明处读调用方；`docs/*.zh.md` 通常能给出同一事实的中文表述。**引用结论时注明你核对的文件路径（必要时带行号）与 submodule 版本**，别写“应该”“大概”。

注意源码版本与**本机正在运行的 DSH 版本可能不同**（桌面端常落后于 submodule）。行为有出入时以实际运行版本为准，并在文档里写明差异——`docs/` 下已有几篇是这样核对出来的，可以照抄它们的写法。

`ref/` 是只读参考：**不要修改它、不要在其中提交、不要用 `dsh plugin add` 安装它**。

## 仓库结构

```text
<插件名>/           每个插件一个根级目录，自带 package.json / cordis.patch.yml / README.md
docs/               仓库级调研与踩坑文档（中文，按主题分文件）
asset/              README 配图，统一放这里
ref/                git submodule，只读参考仓库（deepseek-harness、dsh-skills-manager、dsh-find-plugin）
.dsh/               本机工作区级 DSH 配置，已 gitignore，不提交
test/               本地试验目录，不入库
submodule.md        submodule 操作说明
```

## 插件约定

新增或修改插件时：

- **一个插件一个目录**，放在仓库根下（不要新建 `plugins/` 之类的聚合目录），目录名与 `package.json` 的 `name` 一致。
- `package.json` 必须声明 `dsh.bundle.patch`，否则 DSH 只当普通依赖安装、不会启用。
- `cordis.patch.yml` 用 `- insert:` 插入一行，`id` 全局唯一，`name` 与包名一致。
- 入口导出 `export const name` 和 `export function apply(ctx)`；通过 `ctx` 注册工具、命令、事件或 UI。
- `engines.dsh` 按**实际验证过**的 DSH 版本填，不要照抄 README 示例范围；`files` 要包含运行期需要的全部文件。
- 纯 JS 插件的入口直接放插件目录并提交；TypeScript 插件源码在 `src/`，`tsc` 产物在 `lib/`，**`lib/` 也要入库**（安装是链接而非拷贝）。
- 每个插件目录必须有 `README.md`，写清安装命令、配置项与已知问题。

## 安装与验证

```sh
# 从仓库根安装（相对路径）
dsh plugin --profile desktop add ./<插件名>

# Windows 绝对路径必须用 link: + 原生盘符路径
dsh plugin --profile desktop add "link:E:/Code/dsh-plugin/<插件名>"

# 验证配置层（desktop profile 由 Electron 独占，此命令会被拒绝）
dsh --profile web --dump-config
```

- 需要工作区（Workspace）服务的插件只能装 `desktop`；`acp` 里不生效。
- **不要**用 `dsh plugin add` 安装 `ref/` 下的仓库，它们是只读参考。
- Git Bash 的 `/e/Code/...` 是 MSYS 路径，写进 `link:` 会让 pnpm 记下错误路径，务必换成 `E:/...`。

## 编辑禁区

- `ref/` 是 submodule：只读，不要改里面的文件、不要在其内部提交。submodule 的增删操作见 [`submodule.md`](./submodule.md)。
- `.dsh/` 是本机配置，被 `.gitignore` 忽略；不要为了让某个文件入库而删掉 `/.dsh/` 规则。
- lockfile（`package-lock.json` / `pnpm-lock.yaml`）要提交，用于复现依赖版本。
- `docs/` 里有些文件是某台机器在某个时间点的快照，会过期；引用结论前先看文件头的时间与版本标注，不要把它当成当前事实。

## 文档写法

- 中文，面向“自己以后回来看得懂”：结论前置，命令可直接复制。
- 一处事实只写在一个地方：仓库总览写根 `README.md`，插件细节写插件 `README.md`，`docs/` 只放调研与踩坑记录。
- 根 `README.md` 不逐条介绍 `docs/` 里的文件，只保留一句指向 `docs/` 目录的入口；新增或删除 `docs/` 文件不需要改根 README。
- 结论若来自源码核对，注明核对对象（`ref/` 的 commit 或本机运行版本），别写“应该”“大概”。

## 提交前自检

1. 涉及 DSH 行为的部分（API、事件、配置项、UI 槽位）都在 `ref/deepseek-harness/` 里核对过，并注明了核对的文件与 submodule 版本。
2. 改动的插件能在对应 profile 里装上，`--dump-config` 能看到插件层（或按 `desktop` 的两步验证法确认）。
3. 插件 `README.md` 与代码行为一致（配置项、默认值、已知问题）。
4. 新增/删除文件后，根 `README.md` 的「插件清单」与「目录结构」同步更新。
5. `git status` 里没有 `.dsh/`、`node_modules/`、`test/` 等本机内容。
