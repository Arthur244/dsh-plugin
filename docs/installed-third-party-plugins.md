# 本机 Agent 已安装的三方插件清单

> 统计对象：当前运行的 DeepSeek Harness（桌面端 / `desktop` profile）。
> 统计时间：2026-10-27 23:10（Asia/Shanghai）　·　运行时版本：`0.2.1-rc.3`
> 统计口径：以 profile 的 `package.json`（`dependencies` = 已安装，`dsh.profile.bundles` = 已启用）+ 实际 `node_modules` + npm registry 最新版本三方交叉核对。

## 结论速览

| 项目 | 数量 |
| :--- | :---: |
| 官方 bundle（`@deepseek-ai/*`） | 3（`dsh-base`、`dsh-web-app`、`dsh-experimental-auto-review`） |
| **三方插件（已启用）** | **11** |
| 三方插件已安装但未启用（孤儿） | 0 |
| 已启用但缺依赖的插件 | 0 |
| 可升级的三方插件 | 6 |

三方插件全部命中「装了 + 写进 bundles」双条件，`dependencies` 与 `bundles` 完全一致，无残留孤儿。

## 三方插件总表

| # | 包名 | 版本 | 启用 | 客户端半边 | 安装形态 | 许可 | 上游最新 | 状态 |
| :-: | :--- | :--- | :-: | :-: | :--- | :--- | :--- | :-: |
| 1 | `dsh-web-fetch-fakeip` | 0.2.0 | ✅ | 无（纯服务端） | registry | MIT | 0.2.0 | 最新 |
| 2 | `dsh-gitbash-shell` | 0.43.2 | ✅ | web | registry | MIT | 0.43.3 | 落后 1 |
| 3 | `dshmarket` | 1.70.1 | ✅ | web | registry | MIT | 1.71.1 | 落后 |
| 4 | `dsh-better-sidebar` | 0.28.0 | ✅ | web | registry | MIT | 0.28.1 | 落后 1 |
| 5 | `dsh-update-checker` | 1.7.3 | ✅ | web | registry | MIT | 1.7.3 | 最新 |
| 6 | `@michengai/dsh-archive-manager` | 1.1.12 | ✅ | web | registry | Apache-2.0 | 1.1.18 | 落后 6 |
| 7 | `dsh-style-tweaks` | 0.1.8 | ✅ | web | registry | MIT | 0.1.8 | 最新 |
| 8 | `@michengai/dsh-skills-manager` | 1.2.16 | ✅ | web | registry | Apache-2.0 | 1.2.20 | 落后 4 |
| 9 | `dsh-loulan-rules` | 0.3.0 | ✅ | 无（纯服务端） | registry | 未声明 | 0.3.0 | 最新 |
| 10 | `dsh-connect-workbuddy` | 5.11.0 | ✅ | web | registry | MIT | 5.12.2 | 落后 |
| 11 | `dsh-a2d-workspace` | 0.1.0 | ✅ | 无（纯服务端） | **本地 link** | MIT | —（自研） | 本地 |

安装位置：`C:\Users\Arthur\.dsh\profiles\desktop\node_modules\`
启用清单：`C:\Users\Arthur\.dsh\profiles\desktop\package.json` → `dsh.profile.bundles`

## 逐个插件明细

### 1. dsh-web-fetch-fakeip @ 0.2.0

- **作用**：给 DSH 的 web seam 提供「fake-ip 感知」的 `WebFetchProvider`，让 mihomo / Clash 开启 fake-ip 时 `web_fetch` 仍可用，不必关 fake-ip、也不必设代理环境变量。
- **来源**：https://github.com/kaminn/dsh-web-fetch-fakeip
- **入口**：`src/index.js`　·　**挂载行**：`web-fetch-fakeip`（同时 `disabled: true` 掉官方 `web-fetch-http`）
- **说明**：注册的 provider id 是 `http`（与官方同 id，故必须禁掉官方行）。

### 2. dsh-gitbash-shell @ 0.43.2

- **作用**：Windows 上给 agent 真正的 Git Bash 命令工具——私有 Git Bash 执行器实例（官方 PowerShell 执行器保留）、统一 MSYS 盘根路径方言、官方 `pwsh` 工具默认隐藏可开关、四个内置预设的 Git Bash 变体、侧栏终端接管可开关。
- **来源**：https://github.com/KannaKuron/dsh-gitbash-shell
- **入口**：`src/index.js`　·　**挂载行**：`gitbash-shell`（另 `edit` 了 `better-sidebar` 行以指定 shell）
- **本机配置覆盖**：`cordis.patch.yml` → `gitbash-shell.experimentalNative: false`（Windows 下原生执行路径关闭，退回 Git Bash 安全路由）
- **特征**：带 optionalDependency `@dsh-ops/fastctx-win32-x64@0.2.1`（FastCtx 文件工具的 Win x64 运行时，仅此插件引入）
- **兼容**：`engines.dsh >=0.1.7-rc`，当前运行时 0.2.1-rc.3 满足

### 3. dshmarket @ 1.70.1

- **作用**：DSH 内置可视化插件市场，逛/搜/一键装社区插件。
- **来源**：https://github.com/dsh-market/dsh-market　·　站点 https://dshmarket.com
- **入口**：`lib/index.js`　·　**挂载行**：`dsh-market`
- **备注**：插件更新走「GitHub 优先、npm 兜底」；本机市场日志显示多次 `ENOBUILD` 后回退 npm 安装。

### 4. dsh-better-sidebar @ 0.28.0

- **作用**：右侧栏一体化——文件树、编辑器、变更、任务、侧聊，按会话独立；同时对外暴露服务，供其它插件注册侧栏页签与文件查看器。
- **来源**：https://github.com/omdsh-dev/DSH-better-sidebar
- **入口**：`lib/index.js`　·　**挂载行**：`better-sidebar`（带聚合包重复挂载守卫 `!!js` 表达式）
- **本机配置覆盖**：`agentOpenTools: true`、`tabsEnabled.sidechat: false`
- **体积**：约 19 MB，是全部三方插件里最大的一个（内置 CodeMirror / mermaid / xterm / d3 等）。

### 5. dsh-update-checker @ 1.7.3

- **作用**：同时检查 dsh web 与桌面端的本体更新、检查三方插件更新，GUI 内通知、一键更新（带备份/回滚）与重启看门狗。
- **来源**：https://github.com/Airmetro/dsh-update-checker
- **入口**：`lib/index.js`　·　**挂载行**：`dsh-update-checker`
- **跨 profile 安装**：`desktop`（启用）、`acp`（装了但未写进 bundles）、`web`（装了但未写进 bundles）——后两者属「装了不启用」的孤儿，见下文。
- **本机状态文件**：`~/.dsh/dsh-update-checker-state.json`、`~/.dsh/dsh-update-checker-ops.log`

### 6. @michengai/dsh-archive-manager @ 1.1.12

- **作用**：归档 / 恢复 / 收藏 / 永久删除会话，并诊断损坏的会话日志。
- **来源**：https://github.com/MichengAI/dsh-archive-manager
- **入口**：`lib/index.js`　·　**挂载行**：`ui-workspace-archive-manager`（另 `edit` 官方 `ui-workspace` → `disabled: false`，不替换官方 workspace / session-projection-cache）
- **兼容**：`engines.dsh >=0.2.0-rc.1 <0.3.0-0`，当前 0.2.1-rc.3 满足
- **落后最多**：1.1.12 → 1.1.18

### 7. dsh-style-tweaks @ 0.1.8

- **作用**：一组可逐项开关的 UI 微调——对话列宽精确控制、侧栏首次打开宽度、会话历史分页条数、工作区会话行数、0.1.7 版回合读数回归、插件管理面板位置记忆、外部设置启动器、关闭（隐藏）工作区等。
- **来源**：https://github.com/zhj9709/dsh-style-tweaks
- **入口**：`lib/index.js`　·　**挂载行**：`style-tweaks`

### 8. @michengai/dsh-skills-manager @ 1.2.16

- **作用**：在 DSH 里统一加载并安全管理本机 Agent Skills（聚合 `~/.dsh/skills`、`~/.agents/skills`、Claude / Codex / Cursor / Windsurf / Trae / Qoder 等 20 余个来源，支持分类与逐项启停）。
- **来源**：https://github.com/MichengAI/dsh-skills-manager
- **入口**：`lib/index.js`　·　**挂载行**：`skills-manager`
- **本机状态文件**：`~/.dsh/skills-manager/state.json`、`~/.dsh/dsh-skills-manager.log`

### 9. dsh-loulan-rules @ 0.3.0

- **作用**：把 `$DSH_HOME/rules`（全局）与 `<cwd>/.dsh/rules`（项目）下的规则文件组合成一条 `<system-reminder>`，在首次 `agent/pre-step` 注入会话历史。
- **来源**：npm 包无 `repository` / `license` 字段（发布方未声明）
- **入口**：`lib/index.js`　·　**挂载行**：`dsh-loulan-rules`（`name: ./lib/index.js`，由 loader 按 patch 所在目录解析）
- **纯服务端**：无 `dsh.client`

### 10. dsh-connect-workbuddy @ 5.11.0

- **作用**：把本机登录的 WorkBuddy 模型（国内版 / 国际版）接入 DSH：按上游目录自动读取每个模型的积分倍率、逐模型图片输入开关、多账号切换与账号池自动换号，附带每日签到、卡片与输入框胶囊积分读数。
- **来源**：https://github.com/dingminhua/dsh-connect-workbuddy（作者 dingminhua）
- **入口**：`lib/index.js`　·　带 bin：`dsh-connect-workbuddy`　·　**挂载行**：`dsh-connect-workbuddy`
- **本机配置覆盖**：`cordis.patch.yml` 里有 `regions.cn.lastCatalog` 等长清单（模型目录快照）

### 11. dsh-a2d-workspace @ 0.1.0

- **作用**：把外部 ACP 客户端（Zed 等）产生的持久会话，按 `cwd` 自动归入桌面端「工作区」，让其在会话侧栏按工作区分组显示。
- **来源**：**本地 link**，指向本仓库 `E:/Code/dsh-plugin/dsh-a2d-workspace`（`link:E:/Code/dsh-plugin/dsh-a2d-workspace`）
- **入口**：`index.js`　·　**挂载行**：`dsh-a2d-workspace`（`config.intervalMs: 30000` 兜底扫描）
- **纯服务端**：无 `dsh.client`

## 其它 profile 的三方安装情况

| profile | `dependencies` 里的三方包 | 实际启用（在 bundles 中） | 结论 |
| :--- | :--- | :--- | :--- |
| `desktop` | 11 | 11 | 一致，无孤儿 |
| `acp` | 4：`dsh-connect-workbuddy@5.11.0`、`dsh-loulan-rules@0.3.0`、`dsh-web-fetch-fakeip@0.2.0`、`dsh-update-checker@^1.7.3` | 3（缺 `dsh-update-checker`） | ⚠️ `dsh-update-checker` 装了但没进 bundles，永远不加载 |
| `web` | 1：`dsh-update-checker@^1.7.3` | 0 | ⚠️ 唯一的三方依赖未启用，纯占位 |

## 观察与待办

1. **`dsh-web-fetch-fakeip` 已挂载但被配置绕过**：桌面 `cordis.patch.yml` 里 `web.fetchProvider: deepseek-fetch-api`，而 fakeip 注册的 provider id 是 `http`；web seam 按 `config.fetchProvider` 选 provider，所以当前实际走的是官方 `@deepseek-ai/dsh-web-deepseek-api`，fakeip 行虽激活但不被选中。若确实想用 fake-ip 修正，需要把 `fetchProvider` 改回 `http`（或删掉该键用默认值）。
2. **acp / web 两个 profile 里的 `dsh-update-checker` 是孤儿**：装了但不启用，白占磁盘与安装时间，可清理或补进 bundles。
3. **6 个插件可升级**：`dsh-gitbash-shell` 0.43.2→0.43.3、`dshmarket` 1.70.1→1.71.1、`dsh-better-sidebar` 0.28.0→0.28.1、`@michengai/dsh-archive-manager` 1.1.12→1.1.18、`@michengai/dsh-skills-manager` 1.2.16→1.2.20、`dsh-connect-workbuddy` 5.11.0→5.12.2。其中 `dsh-update-checker` 自身即可一键完成（含备份/回滚）。
4. **`~/.dsh` 下有 3 个已卸载插件的残留数据目录**：`dsh-pet/`（含 memory.json 对话记录）、`dsh-config-manager/`（含 market 缓存）、`status-rotator/`（bank.remote.json 88 KB）。这些插件已不在任何 profile 的依赖里，目录可安全删除。
5. **`dsh-loulan-rules` 未声明 license 与 repository**，商用/二次分发前需确认授权。

## 复核方法（可重复执行）

```bash
# 1. 已装 + 已启用清单
cat ~/.dsh/profiles/desktop/package.json

# 2. 实体安装与版本
cd ~/.dsh/profiles/desktop && npx dsh plugin --profile desktop list

# 3. 每个包的元数据（版本 / 客户端半边 / 引擎约束 / 挂载 patch）
cd ~/.dsh/profiles/desktop/node_modules
node -e "const j=require('./dsh-better-sidebar/package.json');console.log(j.version,j.dsh)"

# 4. 上游最新版本
npm view <包名> version

# 5. 各 profile 的 bundles 与 dependencies 差集（找孤儿）
node -e "const p=require(process.argv[1]);const b=(p.dsh.profile.bundles||[]).filter(x=>!x.startsWith('@deepseek-ai/'));const d=Object.keys(p.dependencies||{});console.log('孤儿:',d.filter(x=>!b.includes(x)))" ~/.dsh/profiles/acp/package.json
```

> 判定规则：`dsh.profile.bundles` 是「是否加载」的唯一权威来源；`dependencies` 只管「是否安装」。两者不一致即为孤儿（装了不生效）。
