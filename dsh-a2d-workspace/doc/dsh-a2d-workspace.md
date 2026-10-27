# dsh-a2d-workspace 开发与安装文档

> 插件名称：**`dsh-a2d-workspace`**
> 用途：把外部 ACP 客户端（Zed 等）产生的持久会话，按 `cwd` 自动归入桌面端的「工作区（Workspace）」，让它们在会话侧栏里按工作区名分组显示。
> 安装目标 profile：**desktop**（Web 应用 / 桌面端），不是 acp profile。

---

## 1. 背景与目标

在 Zed 里通过 DSH 的 ACP profile（`dsh --profile acp`）开会话，Zed 会把项目根目录作为 `cwd` 传给 `session/new`，DSH 会把它写进 session header。这些会话随后会被加载到桌面端。

**问题**：桌面端里这些会话没有任何工作区归属，只能落在「Ungrouped」里，看不到分组。

**目标**：让每个外部目录产生的会话，在桌面端自动出现一个以目录名为标题的工作区组；若该目录已经是某个工作区（可能已被改名），则直接并入、不覆盖标题。

---

## 2. 根因（技术结论）

三层原因叠加导致「无归属」：

1. **ACP 不挂工作区服务**：acp profile（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-acp-app`）没有挂载 `@deepseek-ai/dsh-workspace`；`@deepseek-ai/dsh-acp` 的 `inject` 只有 `["agents","llm","sessionPersistence","sessions"]`，创建会话时只写 `meta: { cwd }`，从不调用 `workspaceRegistry.attachSession()`。

2. **桌面端没有「按 cwd 自动归组」的钩子**：`@deepseek-ai/dsh-workspace` 只有两条归属路径：
   - Web 会话创建时**显式带 `workspaceId`** 才 `attachSession`（`@deepseek-ai/dsh-api-session-controller` 的 `create`）；
   - **首次启动的一次性 bootstrap**（`WorkspaceRegistry.bootstrap()`）——它按 cwd 把历史会话建组，但一旦 `initialized: true` 就不再自动归组。后来出现的 ACP 会话，重启也不会补。

3. **UI 无法手动补救**：`@deepseek-ai/dsh-api-workspace-controller` 没有暴露「把未归属会话挂进工作区」的 RPC；`insertSessionBefore` 对未归属会话会抛 `WorkspaceMoveInvalidError`。

因此需要本插件：在**桌面端**（web profile，只有这里有 `workspaceRegistry`）监听 + 定时扫描，主动 `resolveByPath → create → attachSession`。

---

## 3. 依赖的关键 API（`@deepseek-ai/dsh-workspace`）

服务名：`ctx.workspaceRegistry`（`WorkspaceRegistry`）。

| 方法 | 作用 | 关键点 |
|---|---|---|
| `list()` | 按耐久顺序返回工作区实体数组 | `workspace.sessionIds` 是已归属会话 id（getter 已按 cwd 过滤） |
| `resolveByPath(path)` | 按规范路径（`fs.realpath`）找拥有该目录的工作区 | 无则返回 `undefined`；**不创建、不改名** |
| `create(path, title?)` | 创建（或幂等复用）一个工作区 | `title` 缺省 = 目录 basename；重复调用返回已存在实体且**不改其标题** |
| `attachSession(id)` | 把会话挂进该工作区 | 幂等；会校验会话 header 的 cwd 与工作区 path 一致 |
| `entity.title` / `entity.path` | 标题 / 规范路径 | — |

---

## 4. 目录结构与完整源码

在你的专用插件工作区里，目录结构如下：

```
<你的插件工作区>/dsh-a2d-workspace/
├── package.json
├── cordis.patch.yml
└── index.js
```

### 4.1 `package.json`

```json
{
  "name": "dsh-a2d-workspace",
  "version": "0.1.0",
  "description": "按会话 cwd 把外部(ACP/Zed)产生的会话自动归入桌面端工作区，实现按工作区名分组显示。",
  "type": "module",
  "main": "index.js",
  "files": [
    "index.js",
    "cordis.patch.yml"
  ],
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.0.5"
  },
  "license": "MIT"
}
```

### 4.2 `cordis.patch.yml`

```yaml
# dsh-a2d-workspace bundle patch：把本插件插入 desktop（web）profile。
# 通过 `dsh plugin --profile desktop add ...` 安装后，插件管理器会把本包
# 加入 dsh.profile.bundles 并合并此 patch。
- insert:
    - id: dsh-a2d-workspace
      name: dsh-a2d-workspace
      config:
        # 扫描间隔（毫秒）。Zed 新建会话而桌面端进程未重启时，靠这个兜底拾取。
        intervalMs: 30000
```

### 4.3 `index.js`

```js
/**
 * `dsh-a2d-workspace` — 把外部（ACP/Zed 等）产生的持久会话按 cwd 自动归入
 * 桌面端的工作区（Workspace），让它们在会话侧栏里按工作区名分组显示。
 *
 * 根因：ACP profile 不挂载 workspace 服务，dsh-acp 也不会调用 workspaceRegistry，
 * 所以 Zed 里创建的会话虽然在 header 里带 cwd，但在桌面端的 workspace 表里没有归属，
 * 只能落入 "Ungrouped"。桌面端 workspaceRegistry 只做首次 bootstrap 归组，也没有
 * "自动按 cwd 给新会话归组" 的钩子。
 *
 * 本插件在桌面端（web profile）运行：启动时 + 定时 + 每次会话创建时，扫描
 * sessionPersistence 里所有根会话，按其 header.cwd 找到（或新建）对应 Workspace，
 * 并 attachSession。attach/create 均幂等，且不会改动已改过名的工作区标题。
 *
 * @module dsh-a2d-workspace
 */

import { isAbsolute } from 'node:path'

export const name = 'dsh-a2d-workspace'
export const inject = ['workspaceRegistry', 'sessionPersistence']

/** 根会话才会归组；子会话/subagent 与 ACP 的 session/list 语义保持一致，不挂进工作区。 */
function isGroupable(header) {
  if (header.origin === 'subagent') return false
  if (header.parentSession !== undefined) return false
  if (header.cwd === undefined || !isAbsolute(header.cwd)) return false
  return true
}

/** 扫描一次：把所有还没归属的根会话按 cwd 归入工作区。 */
async function reconcile(ctx) {
  const registry = ctx.workspaceRegistry
  const owned = new Set(registry.list().flatMap((workspace) => workspace.sessionIds))
  const snapshots = await ctx.sessionPersistence.list()
  for (const { header } of snapshots) {
    if (owned.has(header.id) || !isGroupable(header)) continue
    try {
      let workspace = await registry.resolveByPath(header.cwd)
      if (workspace === undefined) workspace = await registry.create(header.cwd)
      await workspace.attachSession(header.id)
      owned.add(header.id)
    } catch (error) {
      ctx.logger.warn(`dsh-a2d-workspace: session ${header.id} (cwd ${header.cwd}) 未归组: ${error?.message ?? error}`)
    }
  }
}

export function apply(ctx, config = {}) {
  const intervalMs = Number.isFinite(config.intervalMs) ? config.intervalMs : 30000
  const run = () => { void reconcile(ctx).catch((error) => ctx.logger.warn(`dsh-a2d-workspace: ${error?.message ?? error}`)) }

  ctx.on('session/created', () => run())
  run()
  ctx.effect(() => {
    const timer = setInterval(run, intervalMs)
    return () => clearInterval(timer)
  }, 'dsh-a2d-workspace.interval')
}

export default { name, inject, apply }
```

---

## 5. 安装步骤

> 在「专门装插件的工作区」里，先用上面第 4 节的结构建好 `dsh-a2d-workspace/` 目录。

### 5.1 本地 link 安装（开发期推荐）

```bash
# 注意：link 路径必须用「Windows 原生盘符路径」（C:/...），不要用 Git Bash 的 MSYS 路径（/c/...）。
# MSYS 路径会被 pnpm 当字面量记录，导致符号链接断裂（指向 C:\c\Users\...）。

dsh plugin --profile desktop add "link:C:/path/to/你的插件工作区/dsh-a2d-workspace"
```

### 5.2 首次 add 后若报「cannot resolve profile bundle」

这是正常的初始化时序：`add` 先把依赖写进 `package.json`，但 bundle 清单与补丁的合并可能落后一步。再跑一次：

```bash
dsh plugin --profile desktop install
```

### 5.3 验证安装结果

```bash
# 1. package.json 里应出现依赖与 bundles 条目
grep -n "dsh-a2d-workspace" ~/.dsh/profiles/desktop/package.json

# 2. node_modules 里应有指向插件目录的符号链接
ls -la ~/.dsh/profiles/desktop/node_modules/dsh-a2d-workspace
```

预期：`bundles` 数组末尾多出 `"dsh-a2d-workspace"`，`dependencies` 里多出 `link:C:/...` 条目。

> 注意：`dsh --profile desktop --dump-config` 会被拒绝，因为 desktop profile 由 Electron 独占管理（`profile "desktop" is managed exclusively by the Electron application`）。所以**无法用 dump-config 做静态验证**，只能重启应用后用行为验证。

### 5.4 生效

**重启桌面端**（DeepSeek Harness 应用 / 刷新当前 Web GUI）。

---

## 6. 行为验证

1. 重启后，在 Zed 里打开一个新目录发一条消息 → 回到桌面端侧栏，应看到以该目录名为标题的新工作区组出现（`session/created` 立即触发）。
2. 若桌面端进程常驻、Zed 并行开会话，最长等一个 `intervalMs`（默认 30s）被定时扫描拾取。
3. 直接给某工作区改名，插件不会覆盖你的标题（因为 `resolveByPath` 命中后不调 `create`，`create` 也只有新建时才用标题）。

---

## 7. 回滚

```bash
dsh plugin --profile desktop remove dsh-a2d-workspace
```

若残留符号链接：

```bash
rm -f ~/.dsh/profiles/desktop/node_modules/dsh-a2d-workspace
```

然后重启桌面端。已归属的工作区记录会保留，**不会丢会话**；已自动归组的会话只是停止「继续自动归组」，不会被移出。

---

## 8. 边界与注意事项

- **只归组根会话**：`origin !== 'subagent'` 且 `parentSession === undefined`（与 acp `session/list` 的过滤语义一致），fork 子会话不摊进工作区组。
- **无 cwd 的会话跳过**：直接忽略并告警，不报错。
- **容错**：单条会话失败只 `logger.warn`，不影响其它会话归组。
- **幂等**：`owned` 集合在单次扫描内去重；`create`/`attachSession` 自身也幂等。
- **性能**：`sessionPersistence.list()` 每次扫描会遍历全部持久会话；`owned` 用 `workspace.sessionIds` 全量对比。会话量极大时考虑调大 `intervalMs` 或改成增量（监听 `session/created` 已覆盖「同进程新建」场景，定时扫描只为兜底跨进程场景）。
- **Windows 路径坑**：`link:` / `file:` 的路径必须用 `C:/...`（或 `C:\\...`），不要用 `/c/...`。

---

## 9. 踩坑记录（本次开发已确认）

1. **`dsh plugin add "link:$PWD/..."` 在 Git Bash 下会坏**：`$PWD` 是 `/c/Users/...` 这种 MSYS 路径，pnpm 原样写入 `package.json` 和 lockfile，符号链接目标变成 `C:\c\Users\...`（不存在）。必须显式传 `C:/Users/...`。
2. **`remove` 不一定清掉 `node_modules` 里的符号链接**：`dsh plugin remove` 会更新 `package.json`/lockfile，但可能残留断链，需手动 `rm -f`。
3. **desktop profile 无法 `--dump-config`**：被 Electron 独占，验证只能靠重启后行为观察。
4. **workspace 只在 web profile**：`@deepseek-ai/dsh-workspace` 由 `dsh-web-app/cordis.patch.yml` 挂载（id `workspace`），acp profile 没有。所以本插件必须装 desktop，不能装 acp。

---

## 10. 若要发布为正式 npm 包

当前结构已满足 `dsh-bundle` 的最小要求（`dsh.bundle.patch` + `cordis.patch.yml` + `index.js`）。发布后即可：

```bash
dsh plugin --profile desktop add dsh-a2d-workspace
```

跨机器安装，无需 `link:`。
