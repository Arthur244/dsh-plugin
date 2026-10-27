# dsh-a2d-workspace

把外部 ACP 客户端（Zed 等）产生的持久会话，按 `cwd` 自动归入桌面端的「工作区（Workspace）」，让它们在会话侧栏里按工作区名分组显示。

## 安装

安装目标 profile 是 **desktop**（Web 应用 / 桌面端），不是 acp profile。

```bash
# link 路径必须用 Windows 原生盘符路径（C:/...），不要用 Git Bash 的 MSYS 路径（/c/...）
dsh plugin --profile desktop add "link:C:/path/to/dsh-a2d-workspace"

# 首次 add 后若报「cannot resolve profile bundle」，再跑一次：
dsh plugin --profile desktop install
```

安装后**重启桌面端**（DeepSeek Harness 应用 / 刷新当前 Web GUI）生效。

## 配置项

| 配置 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `intervalMs` | `30000` | 定时扫描间隔（毫秒），用于跨进程兜底拾取新会话 |

## 行为

- 启动时、每次 `session/created`、以及每 `intervalMs` 定时扫描一次；
- 只归组根会话（`origin !== 'subagent'` 且无 `parentSession`），无 cwd 的会话跳过；
- 按 `cwd` 先 `resolveByPath` 找已有工作区，找不到才 `create`（标题取目录 basename）；
- `create` / `attachSession` 均幂等，不会覆盖已改名的工作区标题。

## 已知问题

- `dsh --profile desktop --dump-config` 会被拒绝（desktop profile 由 Electron 独占管理），只能重启后靠行为验证。
- `sessionPersistence.list()` 每次扫描遍历全部持久会话，会话量极大时建议调大 `intervalMs`。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-a2d-workspace
# 若残留符号链接：
rm -f ~/.dsh/profiles/desktop/node_modules/dsh-a2d-workspace
```

已归属的工作区记录会保留，不会丢会话。
