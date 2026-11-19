# dsh-startup-overlay

**0.2.1：补充 DSH 0.2.2-rc.5 兼容性，启动等待逻辑不变。** 保留桌面端原有首次 loading，等共享设置和账号首次状态有结果后，再让宿主挂载界面，减少「首次 loading 结束 → 加载设置 → 正式界面」的二次切屏。**不加速请求，不提前解锁，也不跳过真正的首次引导。**

兼容范围为 `0.2.2-rc.3 || 0.2.2-rc.5`，不自动放行其他版本，不使用版本豁免。此前 rc.3 基线：`dsh-v0.2.2-rc.3` / `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`（2026-11-16）；当时源码、纯测试和真实客户端 pending → ready 等待已有证据，且用户确认重启后未再出现「加载设置」画面。**该历史验收不等于 rc.5 重启验收；本次 rc.5 的验证范围见下文。** 首装、离线及其他异常/交互场景仍待验收。

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

### rc.5 兼容性修复与验证（2026-11-19）

- 目标为本机 DSH `0.2.2-rc.5`；参考源码 tag `dsh-v0.2.2-rc.5`、commit `9c2670d3bce5275e0d1610272958121af87787bb`，参考目录只读未修改。
- 根因是旧 `engines.dsh` 精确限定 rc.3，宿主会拒绝 rc.5；规则见[宿主兼容性检查](<../ref/deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts#L51-L101>)。现只声明 rc.3 / rc.5 的精确并集，诊断版本和中英文说明同步为 0.2.1；启动等待策略、8000ms 期限和安全放行条件不变。
- 构建、产物一致性、语法检查、28 项离线测试和 `npm pack --dry-run` 通过。[宿主兼容性回归](<./test/runtime-compatibility.mjs>)使用本机已安装的检查函数，先复现旧声明拒绝 rc.5，再验证修复声明获准；rc.4、rc.6、0.2.2 正式版及 0.3.0 仍被拒绝，无版本豁免。
- 单独运行宿主兼容性回归（仓库根目录、当前桌面运行时提供环境变量的 Git Bash）：

  ```sh
  ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" dsh-startup-overlay/test/runtime-compatibility.mjs \
    'D:/Users/Arthur/AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh'
  ```

- 核心等待接口已核对 rc.5 的[设置镜像](<../ref/deepseek-harness/packages/client/ui-settings/src/client/settings-mirror.ts#L27-L59>)、[账号首帧提供方](<../ref/deepseek-harness/packages/client/ui-settings-account/src/client/index.ts#L53-L65>)和[启动先等待后挂载的顺序](<../ref/deepseek-harness/packages/client/web/src/boot.ts#L87-L101>)；这些源码相较上述 rc.3 commit 无变化。完整诊断注册合同等部分源码读取被自动审核拒绝，未绕过拒绝，因此不声称所有接口均完成独立复核。
- 本机沿用现有 `link:` 安装，插件管理器重载返回 `application: applied`、无警告；列表已识别 0.2.1 且无兼容性错误，Host 行为 `active`。没有卸载重装、安装依赖或启用版本豁免。
- 以上不是 rc.5 的完整启动或视觉验收；未自动退出或重启桌面应用。需完全退出并重启后确认启动衔接，不能用 Host 加载成功代替该验收。

### 此前 rc.3 验证证据（2026-11-16）

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
