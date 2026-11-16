# dsh-startup-overlay

**0.2.0：启动就绪等待。** 保留桌面端原有首次 loading，等共享设置和账号首次状态有结果后，再让宿主挂载界面，减少「首次 loading 结束 → 加载设置 → 正式界面」的二次切屏。**不加速请求，不提前解锁，也不跳过真正的首次引导。**

仅适配 DSH `0.2.2-rc.3`。核对源码：`dsh-v0.2.2-rc.3` / `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`；文档复核于 **2026-11-16**。源码、纯测试和真实客户端 pending → ready 等待已有证据；**用户已确认当前环境重启后未再出现「加载设置」画面**。首装、离线及其他异常/交互场景仍待验收。

## 安装与回滚

在仓库根目录执行（需 `dsh` CLI 已加入 PATH）：

```sh
dsh plugin --profile desktop add ./dsh-startup-overlay

# Windows 绝对路径使用原生盘符
dsh plugin --profile desktop add "link:E:/Code/dsh-plugin/dsh-startup-overlay"
```

也可通过 DSH 插件管理界面安装本地目录。此前已安装的本机链接继续使用，无需移除重装；勿移动源目录。**验证启动效果必须完全退出并重新启动桌面应用**，当前页面加载新版本不等于重启验收通过。

仅面向 `desktop`：Host 入口为空，ACP 无客户端效果；普通 Web 页面不等待。禁用插件可恢复原生启动路径。卸载：

```sh
dsh plugin --profile desktop remove dsh-startup-overlay
```

## 行为与安全边界

**无用户配置项、无 npm 运行期依赖。** 固定 **8000ms** 是从主客户端 `apply` 进入等待流程起算的最大等待期限，不是最短展示时间，也不覆盖 Host/Electron 更早的启动阶段；就绪就立即放行。

1. 主 `async apply` 持有启动 Promise，让宿主已有首次 loading 延续；不创建第二个 loading 页面。
2. 同步依赖回调接入 `configForms.describe()` 和 `accountUi`。即使服务暂缺，也先开始倒计时；没有静态硬服务依赖，不会停在执行不到超时逻辑的 pending 状态。
3. 正常放行条件：设置镜像 `status === 'ready'` 且已有 view，账号已有首次 view。**未登录 `signed-out` 也是有效结果**；不等待登录、头像、余额或 profile。
4. 先订阅后读取；`ensure()` 加入或启动同一共享读取，不发独立 describe RPC，不取消全局请求。
5. 设置错误、账号失败、读取拒绝、适配异常、依赖撤销、插件卸载或超时均安全放行，让原生错误、权限或重试 UI 有机会显示。超时不会被标成 ready。
6. 清理自己的 timer、订阅和取消监听；结束后迟到的服务、Promise 或事件不能重新开启等待。
7. **不读取或修改遮罩 DOM，不插入 CSS，不改 opacity/inert，不替换 onboarding 槽位，不写用户配置。** 仅读取共享快照中的就绪标志，不使用配置内容；0.1.x 的观察器、私有标记和 CSS 方案已全部移除。

> 这是有界的启动衔接，不是请求性能优化。超过 8 秒、发生错误，或首次挂载后连接再次失效时，仍可能显示宿主的加载/错误页面。插件不会为了隐藏它而无限阻塞或绕过真正的引导。

## 从 0.1.x 迁移

0.1.x 只匹配入口无 class 的 loading，同文案的带 class loading 却也可能发生在已完成引导的用户身上。旧 DOM 方案真实重启后未改善，0.2.0 已整体替换为启动等待；不是调长旧定时器，也不是扩大 CSS 选择器。

沿用现有本地链接时无需移除重装，但必须保留源目录，并在修改源码后重新构建。为什么普通插件能在挂载前等待、旧分类为何不完整及 inert 所有权约束，统一见[源码调研与方案取舍](<./startup-overlay-loading-settings.md>)。当前行为以本 README 和[源码](<./src/client.js>)为准。

## 诊断

通过只读 Client Inspect 查询：

```text
platform: client
provider: StartupOverlay
method: status
input: {}
```

这不是 CLI 子命令，需要客户端连接和 Inspect 查询能力。诊断通过同步依赖回调注册，服务晚出现也能读取本次激活的已有记录；**不等待诊断服务，不为诊断阻塞启动。**

返回当前激活的 `version`、`strategy`、`desktop`、`timeoutMs`、`startedAtMs`、`phase`、最终 `result` 和最多 16 条 history。`startedAtMs` 与 history 的 `atMs` 是页面相对时钟，不是墙钟时间；`elapsedMs` 只度量门闩，不代表桌面应用全部启动时间。

2026-11-16 真实客户端响应节选：

```json
{
  "version": "0.2.0",
  "strategy": "readiness-barrier",
  "desktop": true,
  "timeoutMs": 8000,
  "startedAtMs": 11912,
  "phase": "released",
  "result": { "reason": "ready", "settings": "ready", "account": "ready", "elapsedMs": 3306 }
}
```

| `result.reason` | 含义 |
| --- | --- |
| `ready` | 已观察到设置和账号首次状态均就绪 |
| `settings-error` / `account-error` | 相应读取失败，放行给原生界面处理 |
| `adapter-error` | 快照、订阅或适配过程异常，安全放行 |
| `services-revoked` / `disposed` | 依赖撤销或插件卸载，结束等待 |
| `timeout` | 到达期限后仍未满足正常条件，放行；不等同于 ready |

`phase` 为 `waiting` 时结果尚未产生；桌面端结束后为 `released`，普通 Web 为 `skipped`。记录仅含就绪枚举、理由与计时，不包含设置内容、账号身份、页面文字、HTML 或会话；不落盘，重新激活会重新计时记录，卸载时注销 Provider。查询本身不会刷新设置、重启门闩或修改页面。

## 开发与验证

```sh
cd dsh-startup-overlay
npm run build
npm run check
npm test
npm pack --dry-run
```

[构建器](<./scripts/build.mjs>)将[源码](<./src/client.js>)封装为自包含[客户端产物](<./client.js>)。产物随仓库保留，链接安装不需要安装构建依赖。

### 已有验证证据（2026-11-16）

- 构建、语法与产物一致性检查通过；28 项纯门闩/服务适配层/包契约测试通过。覆盖账号与设置乱序、未登录、异常、8 秒超时、缺服务、依赖撤销、卸载、同步订阅竞态及晚到诊断。
- 生成产物的主 apply Promise 在状态就绪前保持 pending、随后 resolve，适配层有断言；它不是实际 Cordis/React/DOM 仿真，不能替代宿主完整启动集成测试。
- 两次真实客户端诊断都返回 `0.2.0`、`desktop: true`、`reason: ready`，但证明范围不同：

  | 样本 | 观察 | 能证明什么 |
  | --- | --- | --- |
  | 实现阶段，已运行页面加载新版 | 两项已有就绪状态，门闩约 1ms 放行 | 新版已执行、已有就绪状态时不固定等待 8 秒 |
  | 本次文档复核，页面早期激活 | 起点 11912ms；12821ms 时两项 pending；12987ms 设置先 ready，15218ms 账号也 ready；最终 `elapsedMs: 3306` | 新版确实等待了迟到的账号首帧，不只是返回一份已就绪快照 |

- 第二条记录的约 3.306 秒**不是性能提升值或固定启动耗时**，也不能单独证明用户完成了完整退出再启动、或界面已无二次 loading。
- **用户可见验收**：2026-11-16 用户反馈「重启后目前没有看到加载设置的画面了」。据此确认当前安装环境的重启主路径效果；不扩大为首装、离线或所有异常场景均通过。
- 本轮仅更新文档并只读复核；不重装、不改 profile、不自动重启、不修改实现或只读参考源码，不执行 Git 写操作。

### 实际桌面验收清单

主路径已由用户确认，其余场景仍需独立验收，不因诊断 ready 而自动算通过：

- [x] 当前安装环境重启后未再看到「加载设置」画面（2026-11-16 用户确认）。
- [ ] 未完成引导及未登录：该出现的首次引导或登录入口仍可操作，不要求用户先登录才放行。
- [ ] 离线、拒绝请求、权限等待：错误安全放行；无结果时到期限放行，原生错误/重试/权限 UI 可显示，不永久卡住。
- [ ] 分别覆盖设置先到与账号先到；保存进度为 done 的账号先到路径不再因 class 差异漏处理。
- [ ] 等待中禁用/卸载、依赖撤销、HMR：无残留 timer/订阅，不新建遮罩或锁；真实引导保存/退出动画仍由宿主管理。
- [ ] 实测键盘焦点、Tab/Escape 和读屏反馈，确认真实引导的交互隔离未受影响。

只读诊断支持等待链路已执行的结论，不替代上述视觉与交互验收。
