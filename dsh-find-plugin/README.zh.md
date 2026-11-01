# dsh-find-plugin [![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[English](README.md) | 中文

**一个用来找插件的插件**——就像 skills.sh 的 [`/find-skills`](https://skills.sh)，DSH 版。

想要什么能力，直接跟 agent 说（比如"任务完成时给我发微信通知"），它就去
GitHub 上的 DSH 插件生态里帮你搜——按 star 排序，每条带一句话说明和安装
命令。

<img src="https://raw.githubusercontent.com/awesome-dsh-plugin/dsh-find-plugin/main/assets/demo-zh.png" alt="find_dsh_plugin 实际效果" width="640">

## 安装

```sh
# 本仓库的本地副本（与当前 DSH 0.2.1-rc.5 适配过的版本）
dsh plugin --profile desktop add /path/to/dsh-find-plugin

# 上游 npm 包
# dsh plugin --profile web add dsh-find-plugin
```

当前 `desktop` 与 `web` 两个 profile 都已安装本副本（`dsh plugin ... add` 是链接安装，
移动或删除源目录会让插件失效）。

## 使用

### 手动触发：`/find-plugin`

在输入框直接打斜杠命令，**不经过模型、不产生模型消息、不消耗 token**，结果直接渲染在聊天里：

```text
/find-plugin 跨会话记忆
/find-plugin --lang zh --limit 3 终端 TUI
/find-plugin -n 5 -l en wechat notifications
```

| 用法 | 含义 |
| --- | --- |
| `/find-plugin <关键词>` | 默认返回 5 条、描述用英文 |
| `--limit N` / `-n N` | 返回条数，1–20 |
| `--lang zh|en` / `-l zh|en` | 精选描述语言 |
| 只打 `/find-plugin` | 显示用法提示，不会发起搜索 |

命令与 agent 工具 `find_dsh_plugin` **共用同一套搜索实现**，只在参数默认值和呈现上不同（工具默认 8 条、由模型决定摘要）。没有 `commands` 服务的宿主（无人界面运行时）只会自动跳过命令注册，工具照常可用。

### 自然语言（无需记命令）

安装后重启 `dsh web`，然后直接跟 agent 对话即可——需要找插件时它会自己调用
`find_dsh_plugin`：

- "有什么终端 TUI 插件？"
- "我想任务完成时收到微信通知，有插件吗？"
- "找个能在 DSH 里做 git diff 审查的东西。"

每条结果都带 star 数、功能描述、仓库链接和可直接执行的 `dsh plugin add`
安装命令——让 agent 帮你装，它可以直接替你执行。

## 工作方式

- 实时搜索打了官方 `dsh-plugin` topic 的 GitHub 仓库，按 star 数降序
  （每查询 5 分钟成功缓存、1 分钟失败缓存）。
- 命中 [awesome-dsh-plugin](https://awesome-dsh-plugin.com) 精选列表的仓库，
  会换用列表中人工撰写的双语描述（`lang` 参数选择语言），排序不受影响。
- 每条结果附可直接执行的 `dsh plugin add` 安装命令；插件均为第三方代码，
  请自行审阅源码并锁定 commit。

### 限流与离线兜底

GitHub **搜索**接口在未认证时只有 **10 次/分钟/公网 IP** 的额度，且该额度由同一出口 IP
背后的所有主机共享（运营商 CGNAT、公司 NAT…），因此搜索可能因你无法控制的原因返回
`HTTP 403`。插件因此做了三件事：

- 配置了 **DSH 的 `GITHUB_TOKEN` 凭据**时会使用它（30 次/分钟、按账号计数，不受共享
  IP 影响）。这是可选项——不配也能用，只是更接近匿名上限；
- 遇到限流（403/429）或请求失败时先重试一次，仍失败则**降级而非报错**：改用 curated
  列表的关键词匹配，并在结果末尾的 note 里说明；
- 把 curated 列表缓存到磁盘（`$DSH_HOME/cache/dsh-find-plugin/`）并用
  `If-None-Match` / `If-Modified-Since` 重新验证，因此重启和离线时用的是完整的
  约 8100 条列表，而不是随包发布的快照；
- 会说明**失败原因**。Node 把所有传输层失败都统一报成 `fetch failed`，真正有用的信息
  藏在 `cause` 里，所以插件会把整条因果链显示出来
  （`fetch failed ← certificate has expired (CERT_HAS_EXPIRED)`），并指出那个最容易被
  误认为插件 bug 的坑：系统代理 / VPN 加速器。Node 的 `fetch` 在 DSH 自身启动时没有
  `NODE_USE_ENV_PROXY=1`（或 `--use-env-proxy`）的情况下**不读代理环境变量**，而浏览器
  没有这条规则——这就是「浏览器能打开 GitHub、插件却报错」的原因。

## 兼容性

DSH 的插件 API 是预发布版本号，而 node-semver 规定：只有当 range 里存在与版本号
**major.minor.patch 相同**的 prerelease 比较器时，预发布版本才算满足该 range。因此
把 peer range 钉在某一条宿主线上，下一条线一发布就会悄悄失效。本插件声明的
`@deepseek-ai/dsh-tools` range 覆盖 `0.1.0-rc.6` … `0.2.2-alpha.2` 的全部已发布宿主线；typecheck 与测试在
兼容底线 `0.1.0-rc.8` 和当前宿主 `0.2.1-rc.5` 上各跑一遍。CI 里的 `npm run check:peers`
从 registry 解析当前 `latest` / `next` 两条线，一旦覆盖不到就直接失败（该脚本依赖
`@deepseek-ai/dsh` 的发布标签，见「已知问题」）。

## 配置项

本插件没有 Config 字段（`Config.listConfigs` 中显示为 `status: absent`），装好即用。可选的运行时输入：

| 项 | 作用 |
| --- | --- |
| DSH 凭据 `GITHUB_TOKEN` | 设置后以 `Authorization: Bearer` 调 GitHub 搜索（30 次/分钟、按账号计数）；未设置或凭据服务不可用时自动匿名（10 次/分钟） |
| `DSH_HOME` | 缓存目录基准，默认 `~/.dsh`；缓存文件为 `$DSH_HOME/cache/dsh-find-plugin/registry.json` |
| `NODE_USE_ENV_PROXY=1` / `--use-env-proxy` | 让 DSH 进程的 `fetch` 走系统代理（VPN 加速器 / 公司代理场景必需，否则请求直连并可能失败） |

## 与当前版本的适配（DSH 0.2.1-rc.5）

先按上游 0.4.0 原样复刻（`src/`、`lib/`、`test/` 与上游逐字节一致并通过其全部测试），再针对当前宿主做了以下改动：

- `package.json`：`peerDependencies` 指向当前宿主线——`@deepseek-ai/dsh-tools` 覆盖 `0.1.0-rc.6` … `0.2.2-alpha.2` 的全部已发布版本，`@deepseek-ai/cordis` 为 `^4.0.5`；新增 `engines.dsh: >=0.2.1-rc.5 <0.3.0`；`files` 补上 `README.md` / `README.zh.md`。
- `src/index.ts`：当前 Cordis 的 `ctx.get('credentials')` / `ctx.get('timer')` 在服务缺失时会抛错，读取已包裹在降级逻辑里；工具调用自带的取消信号 `exec.signal` 同时传给 GitHub 搜索与 curated 列表请求；`limit` 做了数值安全钳制（当前 `defineTool` 已在执行前做类型校验，这里是纵深防御）。
- `src/github.ts`：调用方取消信号与单次超时合并（不依赖 `AbortSignal.any` 是否存在），重试间隔可被取消立即中断，超时单独报 `GitHub search timed out after 8000ms`，而不是匿名的 abort。
- `src/registry.ts`：请求截止时间优先走宿主的 `ctx.timer`（随插件释放），无该服务时回退 `setTimeout`；超时/取消会先真正中止请求再走 磁盘缓存 / 快照 兜底；修复「内存中的新数据被 304 覆盖了磁盘 ETag」的校验器问题；快照文件损坏时给出可读错误。
- `data/registry-snapshot.json`：随包快照从 176 条刷新为当前完整列表（8107 条，2026-10-31）。
- 测试：保留上游全部用例，新增宿主适配用例（严格 `ctx.get`、取消信号、可取消的重试间隔、宿主 timer、304 校验器、损坏快照等），共 40 例。
- **新增手动入口 `/find-plugin`**（`src/command.ts`）：用当前宿主的 `ctx.commands.register` 注册斜杠命令，把原本只在工具 `execute` 里的搜索逻辑抽成共用的 `findPlugins()`，工具与命令都调用它；`commands` 服务按可选依赖读取（`ctx.get`），缺失时只跳过命令注册。命令不产生模型消息、不耗 token；新增 11 个用例（`test/command.test.mjs`），合计 51 例。

### 已知问题

- 上游用例「a proxy the host will ignore is named in the failure, and not when it opted in」在复刻阶段即失败：本机环境总是设置 `HTTPS_PROXY` / `https_proxy`，提示文案按变量名拼接成 `HTTPS_PROXY/https_proxy is set`，与用例的精确正则不符。属上游用例的环境敏感问题，未改动断言。
- 上游 `check-peer-range` 脚本按 `@deepseek-ai/dsh` 的 `dist-tags` 解析版本，在当前 registry 组合下解析不出可用的 `dsh-tools` 线，故以 `package.json` 中覆盖 `0.1.0-rc.6` … `0.2.2-alpha.2` 的 range，加上在 `0.1.0-rc.8`（兼容底线）与 `0.2.1-rc.5`（当前宿主）两个版本上的 typecheck / 测试，作为兼容性证据。
- `desktop` profile 由 Electron 应用独占，CLI 不能对其 `--dump-config`；装载情况以运行期 `Config.listConfigs`（出现 `include:find-dsh-plugin`）与 `Tool.listTools`（出现 `find_dsh_plugin`）为准。

## 开发

```sh
npm run typecheck                     # tsc --noEmit
npm test                              # 离线用例（mock fetch）
FINDP_LIVE=1 npm run test:live        # 可选：真实网络用例
```

## 许可

MIT © awesome-dsh-plugin
