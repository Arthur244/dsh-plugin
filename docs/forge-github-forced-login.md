# 0.2.2-rc.1 起，本地 GitHub 项目被提示「登录 github.com」

> 调研时间：2026-11-08（Asia/Shanghai）
> 核对对象：`ref/deepseek-harness/`（submodule `dsh-v0.2.2-rc.1`，commit `66491b05e3`）+ 本机运行的桌面端 `0.2.2-rc.1`（`resources/runtime/cli/bin/dsh.cmd --version` 输出 `0.2.2-rc.1`，`app.asar` 内含同一批 forge 文案与代码）。
> 结论对两者一致：本机桌面端与 submodule 同源，行号以 submodule 为准。

## 结论

**DSH 没有强制登录 GitHub 账号，也不需要登录。** 是 0.2.2 新增的 **Forge 面板**（插件页里的「变更请求与工作树」）在探测 `gh` 的登录态，探测没通过就在侧栏「变更请求」标签里常驻一条横幅，文案是「登录 github.com 后才能显示变更请求状态」。

- 本地项目的打开、会话、编辑、`git status/diff/commit`、本地变更卡片、worktree，**全部不需要 GitHub 认证**。
- 这条横幅只影响「PR 状态 / checks / 评审 / 从面板合并」这一个功能区，而这个区在你没有 `gh` 登录态时本来也是空的。
- 本机（2026-11-08 核对）在 `PATH`、`Program Files`、`ProgramData`、`%LOCALAPPDATA%\Programs`、scoop/winget 链接目录里都找不到 `gh`，也没有 `~/.config/gh` 或 `%APPDATA%\GitHub CLI`，所以实际落在「无法读取 github.com 上的变更请求」这条 unavailable 分支上。

**想做掉这条横幅、又不影响本地项目管理，只需要关掉 `forge-github` 这一行**（下面「处置」A 档），不要跑 `gh auth login`。

## 为什么 0.2.2-rc.1 才出现

Forge 一整套包是 0.2.2 引入的，0.2.1-rc.5 里不存在：

```text
$ git -C ref/deepseek-harness ls-tree dsh-v0.2.1-rc.5 --name-only packages/experimental/ | grep -i -E "forge|worktree"
packages/experimental/tool-worktree
packages/experimental/worktree

$ git -C ref/deepseek-harness ls-tree dsh-v0.2.2-rc.1 --name-only packages/experimental/ | grep -i -E "forge|worktree"
packages/experimental/client-ui-forge
packages/experimental/forge-bundle
packages/experimental/forge-github
packages/experimental/forge-session
packages/experimental/forge
packages/experimental/tool-worktree
packages/experimental/worktree
```

而本机 `desktop` profile 的 `dsh.profile.bundles` 里现在有 `@deepseek-ai/dsh-experimental-forge-bundle`（`C:\Users\Arthur\.dsh\profiles\desktop\package.json` 的 `dsh.profile.bundles` 末位，`dependencies` 里没有同名条目，由安装包自带），于是这层 patch 自动挂载：

```yaml
# ref/deepseek-harness/packages/experimental/forge-bundle/cordis.patch.yml
- insert:
    - id: worktree
      name: '@deepseek-ai/dsh-experimental-worktree'
    - id: tool-worktree
      name: '@deepseek-ai/dsh-experimental-tool-worktree'
    - id: forge
      name: '@deepseek-ai/dsh-experimental-forge'
    - id: forge-github          # ← 探测 gh 登录态的就是它
      name: '@deepseek-ai/dsh-experimental-forge-github'
    - id: forge-session
      name: '@deepseek-ai/dsh-experimental-forge-session'
    - id: optional-forge-panel  # ← 组：侧栏标签 + 标题栏按钮 + 新建会话「工作树」选项
      name: cordis:group
      group: true
      isolate:
        worktrees: true
      config:
        - id: forge-worktree
          name: '@deepseek-ai/dsh-experimental-worktree'
        - id: forge-panel
          name: '@deepseek-ai/dsh-experimental-client-ui-forge'
```

## 根因链路（源码）

### 1. 面板识别出 remote 的托管平台后，就去探测登录态

`packages/experimental/client-ui-forge/src/panel.ts:297`：一次巡检认出代码托管平台（且与上次主机不同）就发起探测。

```ts
// panel.ts:295-297
const readiness = sameHost ? this.current.readiness : null
this.publish({ ...this.current, checkout, repository, readiness, worktree: this.worktree(), local })
if (repository !== null && !sameHost) void this.probe(repository)
```

`probe` 只调 `ctx.forge.readiness`（`panel.ts:346-357`）。

### 2. 「登录态」= `gh auth status --hostname github.com` 的退出码

`packages/experimental/forge-github/src/provider.ts:168-179`：**只有退出码 0 才算 ready**，其他一律 `unauthenticated`。

```ts
async readiness(host: string, signal: AbortSignal): Promise<ForgeReadiness> {
  const failure = this.hostFailure(host)
  if (failure !== undefined) return { state: 'unavailable', message: failure.message }
  try {
    const output = await this.gh(['auth', 'status', '--hostname', host], signal)
    if (output.exitCode === 0) return { state: 'ready', message: null }
    return { state: 'unauthenticated', message: firstLine(output.stderr) ?? firstLine(output.stdout) ?? `gh is not signed in to ${host}` }
  } catch (error) {
    if (error instanceof GhUnavailableError) return { state: 'unavailable', message: error.message }
    throw error
  }
}
```

### 3. 环境变量里的 token 用不上

`packages/experimental/forge-github/src/gh.ts:55` 用 `scrubbedParentEnv()`（`packages/subprocess/subprocess/src/index.ts:47` 的模式是 `/KEY|PASSWORD|SECRET|TOKEN/i`，第 69 行按它剔除），所以 `GH_TOKEN` / `GITHUB_TOKEN` 不会透传给子进程，`gh` 只能读它自己的凭据库。也就是说：**即使你在环境里配了 token，这条探测照样报未登录**。

### 4. 前端把三种状态渲染成两种横幅

`packages/experimental/client-ui-forge/src/client/ForgeTab.tsx:122-149`（`SignIn`，由 `ForgeTab.tsx:227` 挂进「变更请求」标签）：

| `readiness.state` | 你看到的文案 | 触发条件（本机） |
| :--- | :--- | :--- |
| `unauthenticated` | 登录 github.com 后才能显示变更请求状态 + `gh auth login --hostname github.com` + 复制按钮 | 装了 `gh` 但没登录 |
| `unavailable` | 无法读取 github.com 上的变更请求：gh could not start: … | **本机现状**：没装 `gh` |
| `ready` | 不显示 | 已 `gh auth login` |

### 5. DSH 不会替你去登录

整条链路上没有任何代码执行 `gh auth login`：它只把命令**显示出来**并给一个「复制登录命令」按钮（`ForgeTab.tsx:133`）。真正会写 `~/.config/gh/hosts.yml`（并把 token 交给系统凭据管理器）的只有你自己在终端里跑这条命令——**所以不要去跑它**。

### 6. 顺带一提：Git 本身不会弹登录框

面板所有 Git 查询（`inspectCheckout`、`localDiff`、`forkPoint`）都在 `packages/experimental/client-ui-forge/src/git.ts` 里跑，环境里有 `GIT_TERMINAL_PROMPT: '0'`（`git.ts:70`）并清掉 `GIT_ASKPASS` 等。worktree 侧同样（`packages/experimental/worktree/src/process.ts:59`）。**它们只读 refs / config / 工作区，从不上网、不弹认证框**——`gh pr create`、`git push` 之类的联网操作仍然是 agent 在 shell 里执行、走你自己的 Git 凭据。

## 处置：三档，按需要的功能选

所有改动都写在 **`C:\Users\Arthur\.dsh\profiles\desktop\cordis.patch.yml`**（profile patch 层在 bundle 层之后应用，同 id 后者胜；`packages/bundle/base/cordis.patch.yml:1-4` 有这条规则说明，`packages/boot/app-boot/src/profile-context.ts:74-80` 是拼装顺序）。**不需要动 `package.json` 的 `bundles`**（C 档除外），也不需要跑 `pnpm`。

### A 档（推荐）：只关 `forge-github` 行

**正规路径：** 插件页 → 「变更请求与工作树」详情 → 组件行里关掉 `forge-github`。这一行的开关就是 `pluginManager.setPluginEnabled`，它按同样规则把 `disabled: true` 写进 profile 的 `cordis.patch.yml`（`packages/client/ui-plugin-manager/README.zh.md`「切换组合包里的一行」）。

**手改路径**（等价，追加到 `cordis.patch.yml` 末尾）：

```yaml
- id: forge-github
  disabled: true
```

效果：

| 项目 | 关 `forge-github` 后 |
| :--- | :--- |
| 「登录 github.com」横幅 | 消失（`signin.*` 只在 `repository !== null` 时渲染，没有 provider 就 `repository: null`，`panel.ts:335-343`） |
| 本地变更卡片 / 差异视图 / 工作树（新建会话勾选、`create_worktree`） | 全部保留 |
| PR 状态、checks、评审、合并 | 不再读取（这些本来也读不到） |
| `git push` 后按分支反查 PR | 不发请求：`forge-session` 先 `repositoryFromRemote(remote)`，无 provider 直接 return（`packages/experimental/forge-session/src/index.ts:234-236`） |
| 之前已绑定的 PR | 仍列在面板里，标注「暂不支持读取该平台的变更请求状态」（`change.unserved`） |
| 调用 `gh` | 一次都不调 |

> 这档已用 `dsh.cmd --profile web --patch …` 模拟验证过：patch 层正确把 `forge-github` 置为 `disabled: true`，且 `forge` / `forge-session` / `optional-forge-panel` 不受影响（命令与输出见下文「验证方法」）。

### B 档：连「变更请求」标签、标题栏按钮、新建会话「工作树」选项一起去掉

```yaml
- id: optional-forge-panel
  disabled: true
- id: forge-github
  disabled: true
- id: forge-session
  disabled: true
```

`optional-forge-panel` 是 `cordis:group` 行，禁用整组即撤掉侧栏标签、标题栏按钮、`conversation.hero.options` 里的「工作树」选项、PR 相关的会话行图标与悬浮卡片。**必须同时禁用 `forge-github` 与 `forge-session`**，否则这两行仍会在 `git push` / 上游分支识别后调用 `gh`。

模型的 `create_worktree` 工具是顶层 `tool-worktree` 行，不在这组里，B 档仍保留它。

> B 档同样用 `dsh.cmd --profile web --patch … --dump-config` 验证过：三行被分别覆写成 `disabled: true`（组行的 `disabled: true` 落在 `config:` 之后，YAML 里等价）。

### C 档：整层移除

从 `C:\Users\Arthur\.dsh\profiles\desktop\package.json` 的 `dsh.profile.bundles` 里删掉 `"@deepseek-ai/dsh-experimental-forge-bundle"`（或插件页关掉这张组合包卡片）。

面板、工作树选项、`create_worktree` 工具、所有 `gh` 调用一起消失，profile 生态最干净。已有 worktree 目录与分支不受影响（组合包文档明确说明）。

## 验证方法

`desktop` profile 由 Electron 独占，`dsh --profile desktop --dump-config` 会被拒绝：

```text
$ dsh --profile desktop --dump-config
error: profile "desktop" is managed exclusively by the Electron application
```

两条可用的验证路径：

```sh
# 1) 确认改法本身有效：用 web profile 叠上「forge 组合包 + 这一行禁用」
#    顺序要紧：先组合包，后禁用覆盖（同 id 后者胜）
cd /tmp && cat > forge-off.yml <<'EOF'
- id: forge-github
  disabled: true
EOF
dsh.cmd --profile web \
  --patch "$(cygpath -w /e/Code/dsh-plugin/ref/deepseek-harness/packages/experimental/forge-bundle/cordis.patch.yml)" \
  --patch "$(cygpath -w /tmp/forge-off.yml)" \
  --dump-config | grep -A3 "id: forge-github"
```

本机实测输出（2026-11-08）：

```text
- id: forge-github
  name: '@deepseek-ai/dsh-experimental-forge-github'
  disabled: true
```

> `dsh.cmd` 已在 `PATH` 里（`…\DeepSeek Harness\resources\runtime\cli\bin`），Git Bash 里直接敲即可；路径参数用 `$(cygpath -w …)` 转成原生盘符，别喂 MSYS 的 `/c/...`。

```text
2) 桌面端实际生效：改完 C:\Users\Arthur\.dsh\profiles\desktop\cordis.patch.yml 后
   打开一个本地 GitHub 项目会话（右栏「变更请求」标签）：
   - 不再出现「登录 github.com 后才能显示变更请求状态」/「无法读取 github.com 上的变更请求」
   - 本地变更卡片、「变更」视图（左右对比、逐文件 diff）照常
   - 新建会话页的「工作树」勾选项照常
```

`dsh-hmr` 会监视 profile 的 `cordis.patch.yml`（`packages/boot/hmr/src/index.ts:384-405`），通常改完即重组，不必重启；没反应就重启桌面端。

## 坑与注意事项

- **不要用 `gh auth login` 来消横幅。** 那是真的去登录远端账号：写 `~/.config/gh/hosts.yml` 并把 token 存进系统凭据管理器，而且 `forge-github` 的探测用不上 `GH_TOKEN`/`GITHUB_TOKEN` 环境变量（见上文第 3 点）。
- **不要为了这件事去改 `ref/`。** `ref/deepseek-harness/` 是只读 submodule 参考；上面的行号只是一次核对的坐标，升级 submodule 后可能漂移。
- **不要把 `ref/` 当插件装。** 想自定义 Forge 行为时，正确做法是在本仓库写一个 patch/插件包，再 `dsh plugin add`。
- **`gh` 没装时是 `unavailable` 而不是 `unauthenticated`**，所以两条横幅文案不同（见第 4 点表格）。装了 `gh` 但没登录会变成「登录 github.com 后才能显示变更请求状态」。
- **GitHub Enterprise 不受影响**：`forge-github` 的 `hosts` 默认只有 `['github.com']`（`packages/experimental/forge-github/src/index.ts:27`），GHE 主机本来就不会被识别。
- **只认 github.com 这一家**：`forge-bundle` 的已知限制写明「只有 GitHub 一个代码托管提供方」；GitLab 等其他平台的仓库不会触发这条横幅。

## 排除的其他可能

排查时顺手确认过这几处，都不是「管理本地 GitHub 项目」的登录来源：

| 环节 | 何时才跑 | 会不会弹 GitHub 登录 |
| :--- | :--- | :--- |
| 插件管理器的 GitHub 连接检查 | 只在 `dsh plugin add <GitHub 地址>` 时 | 不会：`git -c credential.helper= ls-remote`，显式禁掉凭据助手与提示（`packages/boot/plugin-manager/src/github-connection.ts:56,64-65`） |
| 插件市场的仓库读取 | 只在浏览/打开市场里的 Git 源插件时 | 不会：匿名 API + 部分克隆，带 `GIT_TERMINAL_PROMPT: '0'`、空 `GIT_ASKPASS`、`GCM_INTERACTIVE: 'never'`（`packages/boot/plugin-market/src/repository-cache.ts:98`） |
| Forge 面板的 Git 巡检 / 本地 diff / worktree | 打开会话、看变更、建 worktree | 不会：`GIT_TERMINAL_PROMPT: '0'`（`client-ui-forge/src/git.ts:70`、`worktree/src/process.ts:59`），且只读 refs/config/工作区 |
| DeepSeek 账号登录 | 想用官方账号模型时 | 与 GitHub 无关，本地插件与本地项目不需要 |
| `dsh-find-plugin` 的 GitHub 搜索 | 调 `/find-plugin` | 不会弹登录；可选读 DSH 的 `GITHUB_TOKEN` 凭据提高限流（`dsh-find-plugin/src/index.ts:47,88-94`） |

真正会写 GitHub 凭据的只有两件事：你自己跑 `gh auth login`，或者 Git 在 `git push`/`fetch` 时由凭据管理器（本机是 `manager-core`）弹窗——后者与 DSH 无关。

## 参考

- Forge 子系统：[`ref/deepseek-harness/docs/subsystems/forge.zh.md`](../ref/deepseek-harness/docs/subsystems/forge.zh.md)
- 组合包说明：[`ref/deepseek-harness/packages/experimental/forge-bundle/README.zh.md`](../ref/deepseek-harness/packages/experimental/forge-bundle/README.zh.md)（原文即写「GitHub 状态来自宿主上已登录的 `gh` 命令行；创建本地工作树无需 GitHub 认证」）
- 面板包说明：[`ref/deepseek-harness/packages/experimental/client-ui-forge/README.zh.md`](../ref/deepseek-harness/packages/experimental/client-ui-forge/README.zh.md)
- GitHub 提供方：[`ref/deepseek-harness/packages/experimental/forge-github/README.zh.md`](../ref/deepseek-harness/packages/experimental/forge-github/README.zh.md)
- 升级指南（工作树入口统一到 Forge）：[`ref/deepseek-harness/docs/upgrade-guide/v0.2.2-alpha.2/forge-worktree-entry/guide.zh.md`](../ref/deepseek-harness/docs/upgrade-guide/v0.2.2-alpha.2/forge-worktree-entry/guide.zh.md)
