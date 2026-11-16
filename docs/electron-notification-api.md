# 能不能用 Electron 的 API 发通知：调研结论

> 调研时间：2026-11-06（首轮 Electron API 可行性）；2026-11-07 补充「向主进程通讯」三条路径（第二节）
> 核对对象：`ref/deepseek-harness` = `dsh-v0.2.2-rc.1`（`66491b05e3`）；本机桌面端 `0.2.2-rc.1`（Electron **44.7.0** / Node 24.21.0，`resources/versions.json`）
> 目标：`dsh-notify-on-complete` 现在靠 PowerShell + WinRT 发 toast，问题出在「归属显示为 Windows PowerShell」。这篇回答：**换成 Electron 自己的 API 行不行**；以及**不换 API、改成给主进程发消息行不行**。

## 结论

四句话：

1. **Electron 主进程 API（`new Notification(...)`、`Notification.isSupported()`、`BrowserWindow.flashFrame`）——插件够不到，且没有任何合法入口。** 插件跑在 `desktop-host` 子进程里，那是 **Electron Node 模式**（`ELECTRON_RUN_AS_NODE=1`），`require('electron')` 直接 `MODULE_NOT_FOUND`；通往主进程的 Node IPC 也没有插件可用的消息类型，自己发一条会被主进程判为非法事件并**杀掉整个 Host**。
2. **「发消息给主进程」这条路逐条试过了，全部封死**（见第二节）：`process.send` 通道本身通，但主进程的收端是 fail-closed 白名单，发未知消息 → Host 被杀 → 弹「禁用三方插件」恢复对话框；主进程也没有 HTTP 服务或文件监听可以旁路。
3. **渲染进程的 Web Notification（`new Notification()`）——是唯一「不改 DSH 源码就能用上的 Electron 系通知路径」，前提条件已逐条核对齐备，但没有实际跑通验证。** 它只在页面活着时有效（窗口「关闭」是隐藏不是销毁，所以托盘场景仍然有效），并且要另写一份客户端半边的触发逻辑。
4. **顺带查清两件不用 Electron API 就能落地的事。** 其一：DSH 有自己的 AppUserModelID —— `com.deepseek.dsh`（开始菜单快捷方式带的就是它），`README.zh.md` 第 248 行「DSH 未注册自己的 AppUserModelID，插件侧无法注册」对 toast 归属而言**已经不成立**，把候选顺序换成它优先，toast 就从 DSH 自己名下投递（已验证注册状态、`Setting=Enabled`、能进操作中心；横幅**显示名仍需肉眼确认**）。其二：**用 `spawn(DeepSeek Harness.exe, ['dsh://open'])` 能把窗口唤回前台**——纯 Node 就够，只要先从 env 里删掉 `ELECTRON_RUN_AS_NODE`（否则子进程以 Node 模式启动、exit 1 什么都不发生）。

## 一、主进程 API：为什么够不到

三条独立的硬阻塞，任何一条都足以否掉：

| 阻塞 | 证据（submodule 路径:行） |
| :--- | :--- |
| 插件进程不是 Electron 主进程，是 Node 模式的子进程 | `apps/desktop/src/host-process.ts:212` 用 `this.node` 起 Host；`apps/desktop/src/main.ts:206` `const node = process.execPath`（即 Electron 可执行文件）；`apps/desktop/src/node-environment.ts:15` 注入 `ELECTRON_RUN_AS_NODE: '1'`；`apps/desktop/README.md:144` 明说「Both host and plugins execute in the same Electron Node-mode process」 |
| Node 模式下没有 `electron` 模块 | 实测：`ELECTRON_RUN_AS_NODE=1 "…/DeepSeek Harness.exe" -e "require('electron')"` → `Cannot find module 'electron'`；安装目录里也确实没有 `electron` npm 包（`resources/runtime`、`resources/app.asar.unpacked/dsh/node_modules` 均无） |
| 主进程的 Node IPC 不接收插件消息，收到就杀 Host | `apps/desktop/src/host-process.ts:241` `if (!isDesktopHostEvent(message)) { this.fail(...); child.kill('SIGTERM') }`，合法类型只有 `host-process.ts:28` 那一串（starting/ready/fatal/platform-session/…），没有通知类 |

绕路也堵死：

- **渲染进程拿不到 `ipcRenderer`**：`apps/desktop/src/main.ts:282-290` 是 `sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`；preload 只经 `contextBridge` 暴露固定成员（`apps/desktop/src/ipc.ts:81` 的 `DshDesktopProductApi`，`apps/desktop/src/preload-app.ts:118` 挂成 `window.dshDesktop`），频道表 `ipc.ts:10-41` 里没有任何通知频道，主进程侧还有 `assertDesktopSender`（`ipc.ts:108`）按来源校验。文档把它写成设计承诺：`apps/desktop/README.md:146`「No renderer receives filesystem access, raw Electron IPC, a shell, or arbitrary pnpm arguments」。
- **想另起一个 Electron 进程来跑自己的通知壳**：打包后的 Electron 可执行文件永远加载自己的 `app.asar`，命令行传一个目录不会切换成别的 app。实测 `…/DeepSeek Harness.exe <目录>` 没有跑起那个目录里的 `main.js`（进程数与日志都说明被正式应用接管）。

一句话：要走主进程 API，只能改 DSH 自己的 Electron 壳（`ref/` 只读，正式包还带签名），插件侧没有位置。

## 二、主动「向主进程通讯」：逐条试过

既然直接 `require('electron')` 不通，就试「发消息给主进程，让它去调 API」。结论是**这条路被一道 fail-closed 的校验封死**，但试的过程里挖出一条真正可用的替代路径。

### 试 1：`process.send()` 打到主进程 —— 技术上通，业务上被拒

先确认「能不能发」：插件（与 Host 同进程）确实拿得到 `process.send`。我用与 DSH 完全相同的启动方式（`spawn(node, [, 'ipc']` 四段 stdio）做了对照实验，子进程里 `process.send({type:'notify', ...})`，父进程确实收到了这条消息——**通道本身是通的**。

问题出在主进程的收端（`apps/desktop/src/host-process.ts:229-244`）：

```ts
child.on('message', (message) => {
  if (message.type === 'plugin-operation') { /* 解析失败就静默丢弃 */ return }
  if (!isDesktopHostEvent(message)) {
    this.fail(new Error('dsh desktop host sent an invalid IPC event'))
    child.kill('SIGTERM')      // ← 发一条未知消息 = 自杀整个 Host
    return
  }
  ...
})
```

合法类型只有 `host-process.ts:28` 列的那几种（starting / ready / fatal / platform-session / update-tasks / file-drag-resource / quit-inspection / shutdown-complete），`default: return false`（`host-process.ts:108`）。

所以插件发一条 `{type:'notify'}` 的后果不是「被忽略」，而是：

1. `this.fail(...)` → `backend-controller.ts:144` `this.update(errorState(error))` 把状态切成 `error`
2. `main.ts:593` `if (state.phase === 'error') reportFatal(...)`
3. → 弹出「Disable third-party plugins, back up profile patch, and restart」的原生恢复对话框，**整个应用停摆**

这不是「可能失败」，是设计上的 fail-closed：**任何不认识的消息都按 Host 崩溃处理**。`apps/desktop/tests/host-process.spec.ts:320` 还专门断言了这一点（`process.send({type:'ready', url:4})` → `'invalid IPC event'`）。

唯一不触发这条的例外是 `type: 'plugin-operation'`（`host-process.ts:230`，在校验之前就 `return`）。但它要求 record 通过 `parsePluginOperationRecord` 的 zod 校验且 `runId` 与主进程记的一致——而 `runId` 是 `desktop-host/src/index.ts:23` 里的局部 `randomUUID()`，**没有暴露到 `ctx` 上**，插件拿不到。就算伪造成功，去向也只是操作日志（`main.ts:524` 的 `OperationJournal`），不会弹通知。

### 试 2：主进程还有没有别的收端？

没有。逐个查过：

- **没有 HTTP 服务**：`apps/desktop/src` 全目录无 `createServer` / `listen`（`protocol.handle` 只服务 `dsh-app://` 的页面请求）。
- **没有文件监听**：无 `fs.watch` / `watchFile`。`operation-journal` 是主进程**自己写**的，不读 Host 写的文件。
- **IPC 频道里没有任何通知项**：整份 `apps/desktop/src` 一共 41 个 `ipcMain.handle/on`，按来源分组是「产品页（18 个：`main.ts`）／Platform 视图／强制更新／更新对话框／欢迎页／目录选择／文件操作／拖拽／快捷键」。它们全都是各自功能的桥，且每个都先 `assertDesktopSender` / `assertMainApplication` 校验来源（`ipc.ts:108`）。preload 暴露的成员（`preload-app.ts:80/94/100/103/107/118/121`）也是一一对应，没有通配入口。

一句话：**主进程的入站接口就是那 8 种 Host 事件 + 41 个功能 IPC 频道，全部白名单，没有扩展口。**

### 试 3：绕开 IPC，用 OS 层唤起主进程 —— 这条真的能用

不能用 Electron API，但可以用 **协议激活**让已经在跑的主进程干活：`DeepSeek Harness.exe dsh://open` → 单实例锁 → `focusPrimaryWindow()`（`main.ts:1338` + `single-instance.ts:24`）。

实测（从普通 Node 进程 spawn）：

| 环境 | 结果 |
| :--- | :--- |
| 继承当前 shell env（含 `ELECTRON_RUN_AS_NODE=1`） | **exit 1**，什么都没发生 |
| 从 env 里删掉 `ELECTRON_RUN_AS_NODE` | **exit 0**，进程数仍是 6（没起第二个实例，交给运行中的那个） |
| `cmd /c start "" dsh://open` | exit 0（692ms），走 shell 的协议关联 |

注意：**「没起第二个实例」只能证明消息到了主实例，不能证明窗口真的被提到前台**——后者我没法自动验证（要人眼看）。理论上链路是通的（`setAsDefaultProtocolClient('dsh')` → `open-url` → `focusPrimaryWindow()`），但第二实例被 single-instance 接住时走的是 `second-instance` 事件而不是 `open-url`（`single-instance.ts:24`），这条 Windows 路径我没有单独验证过。

**关键坑**：插件进程的 env 里就有 `ELECTRON_RUN_AS_NODE=1`（`node-environment.ts:15` 注入的）。直接继承着 spawn 子进程，子进程会以 Node 模式启动，跑不成 GUI。必须 `delete env.ELECTRON_RUN_AS_NODE` 再 spawn。这条正好是「插件侧能不能唤起窗口」的分水岭，现有 `notify.ts` 的 spawn 没处理它。

这条的价值：**它不需要 Electron API、不需要改 DSH 源码，纯 Node `spawn` 就能把一个已经在跑的应用叫回来**。缺点是无法携带任何 payload（`main.ts:1335-1338` 只认 `dsh://open` / `dsh://open/`，别的 URL 一律 `preventDefault` 后什么都不做），所以它只能做「把人叫回来」，不能做「发一条通知」。

## 三、渲染进程 Web Notification：可用的那一条

**先说清楚：这一节是静态证据链，没有跑通验证。** 想用打包的 Electron 可执行文件跑一个自建探针 app 来实测，结果它永远加载自己的 `app.asar`（见上节最后一条），所以 `new Notification()` 在本机的实际表现只能人工验。

前提逐条核对（全部成立）：

- **安全上下文有**：`dsh-app://app/` 在 `apps/desktop/src/main.ts:185-195` 注册为 `standard + secure`，`Notification` 不会被当成不安全来源禁掉。
- **权限不会被壳拦**：`apps/desktop/src/microphone-permissions.ts:17-30` 只对 `media` 做限制，**其它权限一律 `callback(true)`**，所以通知权限不会像麦克风那样被拒。
- **页面在窗口隐藏后仍活着**：`apps/desktop/src/main.ts:1177-1189` 关窗口走 `event.preventDefault()` + `window.hide()`，Host 与渲染进程都继续跑（这也是为什么托盘里任务还在跑）。
- **DevTools 开着**，可以手动验：`main.ts:289` `devTools: true`，F12 打开控制台敲 `new Notification('test')`。

限制也要说清楚：

- 只在**页面存活**时有效。桌面端没问题（隐藏≠销毁），但 CLI 一次性运行、`dsh web` 的浏览器标签关掉之后都没有渲染进程可用——现有 Host 侧实现仍然覆盖这些场景。
- 触发逻辑得写在**客户端半边**（`dsh.client` 的 `platform: 'web'` 包）。数据源是现成的：`ctx.uiSession.sessionStatus`（`packages/client/ui-session/src/client/index.ts:299`）每会话带 `{ running, pendingInteraction, completionUnread }`；`completionUnread` 算的是「运行结束**且不在主视图**」（同文件 508-515）——正好是「用户没盯着」的信号，但和现有插件「无论看不看都通知」的语义不同，要显式选一个。子代理过滤也有 `origin?: 'subagent'`（`packages/api/session-controller/src/client/sessions/service.ts:36`）。
- 隐藏窗口的 `requestAnimationFrame` 会被 Chromium 节流（`backgroundThrottling` 没关）。本插件要通知的状态来自 WebSocket 事件推送、走同步的 subscribe 回调，不受影响；但别把触发逻辑挂在 rAF 批处理上。
- 归属 AUMID 走 Electron 的应用值。本机注册表里 `…\Notifications\Settings\electron.app.DeepSeek Harness` 有 2026-10-22 的投递时间戳，说明**这个壳至少有一条通知路径**落在 Electron 默认 id 上（DSH 源码里只有 `apps/desktop/src/update-attention.ts:43` 这一处 `new Notification`，所以那条记录来自主进程；渲染进程是否共用同一 id 属于推断，未验证）。正式包没有 `setAppUserModelId` 调用（全仓 grep 为 0）。因此渲染进程通知的显示名大概率是 Electron 默认名而**不是**「DeepSeek Harness」——这条必须在真机上肉眼确认后，才能决定它比现有 AUMID 方案好还是差。

## 四、顺带查到的两件事（不需要 Electron API 就能用）

### 1. `com.deepseek.dsh` 是有效的 toast AUMID

| 证据 | 结果 |
| :--- | :--- |
| `Get-StartApps` | `DeepSeek Harness` → `AppID = com.deepseek.dsh` |
| 开始菜单快捷方式属性存储 | 含 UTF-16 的 `com.deepseek.dsh` |
| `CreateToastNotifier('com.deepseek.dsh').Setting` | `Enabled` |
| 对照：随手编的 AUMID（`zzz.random.things`） | `Setting = ''`（未注册） |
| 实测发一条 toast 到该 id | `Show()` 成功；`History.GetHistory` 里能查到 |

注意**历史记录不能当作「横幅真的弹出来了」的证据**：随手编的未注册 id 也会进 History，`Show()` 也不抛错。真正区分「注册过」的是 `Setting` 那一列——这也是下面实现建议的依据。

因此 `dsh-notify-on-complete/src/notify.ts:126-129` 的候选顺序应该反过来：`com.deepseek.dsh` 优先，PowerShell 兜底。但现有「候选」逻辑在实现上等价于「只用第一个」：`Show()` 对未注册 id 不抛错，`try/catch` 永远接不住失败（`notify.ts:176-179` 的注释其实已经写明这一点）。要真正做到失败回退，得在 `Show()` 之前先读 `CreateToastNotifier($id).Setting`，只有值为 `Enabled` 才用这个 id（上面已验证该值可读、且注册/未注册分别是 `Enabled` / `''`）。

副作用要接受：用户在 Windows「通知」设置里关掉 DeepSeek Harness，toast 就彻底不来了。这大概率是**用户期望的行为**，但和现在「关掉 PowerShell 通知」的语义不同，属于行为变更。

### 2. 点 toast 可以唤回 DSH

- toast XML 加 `activationType="protocol" launch="dsh://open"`：实测 `LoadXml` + `Show` 都接受。
- `dsh://` 已注册：`HKCU\Software\Classes\dsh\shell\open\command` → `"…\DeepSeek Harness.exe" "%1"`。
- 壳侧处理：`apps/desktop/src/main.ts:1335-1338` 收到 `dsh://open` 就 `focusPrimaryWindow()`；`main.ts:1448` 单实例锁把第二次启动也路由到 `focusPrimaryWindow`。
- 实测：`Start-Process "…/DeepSeek Harness.exe" -ArgumentList 'dsh://open'` 之后进程数仍是 6，没有起第二个实例（被运行中的实例接住）——但「窗口是否被提前台」我没法自动确认。
- 边界：CLI-only 安装没注册 `dsh://`，点击无反应（无害）；toast 的**点击**我没法自动化验证，只验证了 XML 合法与链路存在。

## 五、路线对比

| 路线 | 能否用 Electron API | 改动面 | 覆盖场景 | 结论 |
| :--- | :--- | :--- | :--- | :--- |
| 主进程 `Notification` | — | 改 DSH 壳源码 + 重签名发布 | CLI + 桌面 | **不可行** |
| 向主进程发 IPC 请求 | 技术上通，业务上被 fail-closed 拒绝 | 需要 DSH 改收端白名单 | — | **不可行**（且尝试会崩掉 Host） |
| 渲染进程 `new Notification()` | 是（Electron 的渲染侧通知） | 插件加客户端半边 | 仅桌面/网页页面存活时 | **可行（未实测）**，只能作为桌面端增强 |
| `spawn(exe, ['dsh://open'])` 唤醒窗口 | 不用 Electron API，走 OS 协议 | 现有 `spawnNotify` 加一次调用 | 仅桌面 | **可用**，只能「叫人回来」，不能发通知 |
| 现有 PowerShell + WinRT toast | 否，但同一套系统 toast | 改 AUMID 优先序 + activation | CLI + 桌面 | **保留并改进** |

## 六、建议

1. **不动 Electron、也不发 IPC**：主进程路线要 fork 并自签；IPC 路线的实际后果是**把用户的应用打崩**（弹「禁用三方插件」恢复框），比没有通知严重得多。
2. **先把 AUMID 修对**（改 `notify.ts` 的 `WINDOWS_AUMIDS` 顺序 + 读 `Setting` 判断回退 + 加 `activationType/launch`），这是当前唯一「花 20 行代码就把归属和点击补齐」的改动，并且顺便修正 `README.zh.md:248` 的过期结论。
3. **加一个「唤回窗口」按钮/动作**：用户的真实需求往往是「通知来了我想直接跳回去」，而不是「我要看到 DSH 名字的 toast」。`spawn(exe, ['dsh://open'])` 已经实测可用，唯一要求是先从 env 删掉 `ELECTRON_RUN_AS_NODE`。这比 Web Notification 那条路便宜得多。
4. **Web Notification 作为可选项**（不是替代）：加一个客户端半边，检测到 `window.dshDesktop`（桌面壳）时用页面通知，其余场景继续走 Host 侧 PowerShell/osascript/notify-send。两条路要互斥，否则一次运行弹两条。
5. 落地前先手工验一件事：F12 控制台执行 `new Notification('probe')`，确认（a）真的弹出、（b）在 Windows 通知设置里归属显示成什么名字。这一步决定第 4 条值不值得做。

## 七、顺带发现的偏差

- `dsh-notify-on-complete/README.zh.md:248` 关于 AppUserModelID 的说法已过期（见上文第四节）。
- 本机桌面端为 `0.2.2-rc.1`，与 submodule `dsh-v0.2.2-rc.1` 同源，本文引用的源码行号可直接对应。
