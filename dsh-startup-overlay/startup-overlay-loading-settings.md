# 启动后「正在加载设置…」：源码调研与方案取舍

> 初始调研：2026-11-15；复核与更正：2026-11-16（Asia/Shanghai）。
> 源码基准：只读 [DSH submodule](<../ref/deepseek-harness/>)，`dsh-v0.2.2-rc.3` / `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`；实现适配本机 DSH `0.2.2-rc.3`。相同版本号不表示已逐字比对所有安装产物。
> 本文保留问题分析、旧方案失败原因和取舍。**当前插件行为、安装、诊断证据及验收状态统一见[插件 README](<./README.md>)**；0.1.x 的 DOM 方案不是现行操作指南。

## 结论

源码支持这种启动路径：**客户端插件装配完成，但共享设置或账号首次状态尚未就绪**。应用挂载后，onboarding 会显示「正在加载设置…」，形成「首次 loading → 设置 loading → 正式界面」的二次切屏。

0.2.0 采用有界启动就绪等待：利用宿主等待主插件异步启动任务的机制，在应用挂载前衔接两项读取。它改变的是等待发生在哪个画面，**不是缩短请求耗时**。错误或超时仍须交还原生界面处理，不能为隐藏提示而无限等待。

需要区分以下证据层级：

- **源码已确认**：两条同文案 loading 分支、保存进度尚未读取时的临时状态、挂载前可等待异步主插件任务。
- **已有运行证据**：新版在真实客户端执行了从 pending 到 ready 的等待；具体样本及计时口径见[诊断与验证](<./README.md#诊断>)。
- **用户已确认的效果**：2026-11-16 反馈重启后未再看到「加载设置」画面，当前环境的重启主路径已验证。
- **尚未完成的验收**：首装、离线、错误恢复、其他切屏及焦点/读屏行为。用户反馈覆盖当前环境，不能扩展成所有场景均已通过；诊断 ready 本身也不等于视觉验收。

## 1. 相同文案有两个渲染分支

仅定位本地化 key 不足以识别当前画面。[入口组件](<../ref/deepseek-harness/packages/client/ui-settings-account/src/client/DesktopOnboardingEntry.tsx#L57-L63>)先计算：

```ts
const displayed = state.visible ? state : exiting || pendingCompletion ? lastVisible : null
```

随后有两条路径：

| 路径 | 条件与渲染 | 识别边界 |
| --- | --- | --- |
| 入口裸 loading | `displayed === null` 且 `state.status === 'loading'`，在 `OnboardingSurface` 内渲染无 class 的 `div[role=status]` | 是旧插件唯一覆盖的路径 |
| 内层 loading | [`DesktopOnboarding`](<../ref/deepseek-harness/packages/client/ui-settings-account/src/client/DesktopOnboarding.tsx#L78-L80>) 在 `state.visible && state.status === 'loading'` 时，渲染带 `css.loading` 的 `div[role=status]` | 使用相同 `onboardingLoading` 文案；不能据 class 认定用户确实未完成引导 |

[OnboardingSurface](<../ref/deepseek-harness/packages/client/ui-settings-account/src/client/OnboardingSurface.tsx#L18-L39>)挂载时保存根节点原有 opacity、隐藏根节点并取得 inert 锁，卸载时由自己恢复。这解释了为何等待可能表现为主界面不可见、只剩 loading 文案；**不能反推所有同文案画面一定来自入口裸分支**。

## 2. 已完成引导的用户也可能进入内层 loading

[状态推导](<../ref/deepseek-harness/packages/client/ui-settings-account/src/client/onboarding-state.ts#L198-L224>)先选择：

```ts
const progress = this.draft ?? this.readProgress() ?? freshProgress()
const done = progress.step === 'done'
```

可见性由 `!done && signedIn && !unavailable` 决定；状态判定还包含：

```ts
host.status === 'loading' || account === undefined ? 'loading' : 'ready'
```

因此，账号先返回、保存进度尚未读取时，临时使用的默认进度可能令 `visible` 为 true，同时 `status` 为 loading。即使磁盘中保存的是 done，这一刻也会走带 class 的内层 loading。

这不是只靠推测列出的竞态：[宿主测试](<../ref/deepseek-harness/packages/client/ui-settings-account/tests/onboarding-state.client.spec.ts#L177-L183>)明确覆盖保存进度为 welcome 和 done、设置延迟返回的情况。

这能证明旧 DOM 分类存在覆盖缺口，**不能证明用户每一次失败启动都恰好命中了这一分支**；此前没有采集到失败时的完整浏览器时序。

## 3. 普通客户端插件并非天然晚于应用挂载

核对到的顺序是：

1. [Web 启动入口](<../ref/deepseek-harness/packages/client/web/src/boot.ts#L82-L101>)先等待 `bootClient`，再调用 `mountClient`。
2. [客户端装配](<../ref/deepseek-harness/packages/client/web/src/boot-client.ts#L69-L77>)等待入口启动、Loader 收敛及激活检查。
3. [入口启动](<../ref/deepseek-harness/packages/client/modules/src/client/entries.ts#L95-L100>)创建 manifest 中的客户端插件，并等待 Loader。
4. [Cordis 执行](<../ref/deepseek-harness/vendor/cordis/src/fiber.ts#L362-L380>)处理插件返回的 Promise；[重载生命周期](<../ref/deepseek-harness/vendor/cordis/src/fiber.ts#L681-L704>)等待执行完成才清理 inertia；[Loader](<../ref/deepseek-harness/vendor/loader/src/config/tree.ts#L73-L85>)等待初始化任务或 inertia 收敛。

所以，**有限的主 `async apply` 可以延后首次应用挂载**。不能把异步等待藏在未被主 apply 持有的 child 回调里，并假定它必然阻塞启动。

另外，[`immediately`](<../ref/deepseek-harness/packages/client/web/src/boot.ts#L119-L125>)影响这里的脚本预取，不是一个替代生命周期契约的“更早执行”开关。

## 4. 为什么等待共享设置和账号首次状态

两条读取不要求先挂载 React：

- [设置插件](<../ref/deepseek-harness/packages/client/ui-settings/src/client/index.ts#L40-L53>)在 apply 中启动共享镜像读取并提供 ConfigForms。[镜像接口](<../ref/deepseek-harness/packages/client/ui-settings/src/client/settings-mirror.ts#L26-L59>)提供快照、订阅和 `ensure()`；**ensure 结束不等于读取成功**，必须区分 ready/view 和 error。
- [账号插件](<../ref/deepseek-harness/packages/client/ui-settings-account/src/client/index.ts#L99-L139>)在挂载前启动账号流并发布状态；[公开只读接口与事件](<../ref/deepseek-harness/packages/client/ui-settings-account/src/client/account-ui.ts#L5-L38>)区分首次 view 尚未到达和读取失败。

选择这两个共享状态，是为了对齐 onboarding 的初始判定，而不是增加一轮独立 RPC。未登录本身也是有效首次结果；若等待“已登录”，就会在登录入口尚未挂载时等待用户登录，形成循环依赖。

同理，不能等待头像、余额或 profile 等后续信息。依赖迟到、权限 UI 尚未显示、网络错误等情况必须有退出路径。当前固定期限、放行条件和清理语义见[行为与安全边界](<./README.md#行为与安全边界>)。

## 5. 旧 DOM 方案为何废弃

0.1.x 曾用 MutationObserver、结构匹配和临时 CSS 处理入口裸 loading；用户实际重启后仍报告没有改善。后续核对得到以下限制：

| 限制 | 结论 |
| --- | --- |
| 把带 class 的 loading 排除为“真引导” | 漏掉上文保存进度尚未到达的场景，不能覆盖完整目标 |
| 从插件 apply 开始计 30 秒发现期 | 计时开始于应用挂载之前，慢装配时可能在目标出现前耗尽；未测得用户失败启动是否真的超过此期限 |
| 全局存在 `role=dialog` 就放弃 | [侧栏 drawer](<../ref/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.tsx#L307-L318>)有关闭时仍保留 role 的路径；这是可达误判，不是已确认的用户现场根因 |
| 只在 apply 时查询一次可选诊断服务 | 服务晚提供时无法注册诊断；缺少 Provider 不能直接证明客户端代码未运行 |
| 从外部清理 root 的 inert | 违反锁的所有权，不能作为安全补救 |

最后一项尤其重要：[计数式 inert](<../ref/deepseek-harness/packages/client/ui-settings-account/src/client/overlay-inert.ts#L2-L22>)保存 count 和 previous。幂等的是 owner 获得的 release 函数，不是外部执行 `root.inert = false`。[PlatformOverlay](<../ref/deepseek-harness/packages/client/ui-settings-account/src/client/PlatformOverlay.tsx#L36-L44>)也可能持有同一根节点的锁；绕过计数清锁会破坏其他 owner 的模态隔离。

因此，0.2.0 不再拓宽 DOM 匹配来追逐第二条路径，也不从外部恢复 root 的 opacity 或 inert。只处理启动等待，界面与交互锁仍由宿主管理。

## 6. 其他可选方向及未证实事项

| 方向 | 可行范围 | 当前取舍 |
| --- | --- | --- |
| 有界启动就绪等待 | 以宿主已存在的启动画面衔接初始读取，异常时放行 | 已实现；行为和验收状态以[插件 README](<./README.md>)为准 |
| 宿主侧调整 loading 呈现 | 在拥有引导状态和 inert 锁的位置决定是否阻塞，可同时覆盖两个 loading 分支 | 更合适的长期修复位置；尚未提交上游 patch，不能把“只改入口几行”当成完整修复 |
| 替换整个 onboarding 槽位 | 必须一并维护首装、保存、错误、退出及持锁语义 | 接管范围过大，本插件不采用 |
| 减少插件或优化请求 | 需要先测 describe、账号首帧和装配各阶段的耗时，再评估改动收益与功能影响 | 没有通用“零风险”或“必省 1–2 秒”的结论；本轮未改 profile |

初始记录曾把本机旧快照（bundle/设置数量、安装日志、进程时间）与“更新导致每次启动变慢”直接关联。它们不足以证明当前瓶颈，也不能用安装重试耗时替代后续启动测量；不再将这些数字或推断作为本插件效果依据。

同样，单条 loading 文案不能证明只有设置读取慢，也不能排除账号首帧、错误、权限或连接重试。应把**源码可达路径、单次诊断观察、用户可见验收**分开记录。

## 7. 后续如何验证

按[桌面验收清单](<./README.md#实际桌面验收清单>)操作，并结合只读 `StartupOverlay.status`：

- `reason: ready` 说明本次等待看到了两项就绪；`timeout` 或错误理由说明已按安全边界放行，而非成功隐藏全部后续页面。
- `startedAtMs` 与 history 的 `atMs` 使用页面相对时钟，`elapsedMs` 只度量插件门闩；它们不是 Electron/Host 全部启动耗时。
- 要判断“首次 loading 后是否直接进入主界面”，还需实际观察完整退出再启动。普通刷新或 HMR 不能替代该项验收。
- 要定位性能瓶颈，需要同时采集设置读取、账号首帧与客户端装配阶段，而不是把 overlay 可见时长和 describe 往返中较长的一项直接判成根因。

本记录不要求安装额外插件、修改 profile 或改写只读参考源码。
