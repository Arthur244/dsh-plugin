# 左下角用户信息处（侧栏账号入口）个性化调研

> 依据源码：[`ref/deepseek-harness`](../ref/deepseek-harness)（submodule，`66491b05e3 release(dsh): 0.2.2-rc.1`；初版核对的是 `f3803c9697 0.2.2-alpha.2`，2026-11-05 升级 submodule 时重新逐条对过下文所有行号，槽位、`ctx.remoteAccess`、主题图标替换、`dsh.client` 扫描等结论在 rc.1 上仍成立）。
> 核对对象：初版核对的是本机当时的桌面端 `0.2.1-rc.5`（`resources/app.asar` 反查了槽位、`ctx.remoteAccess`、主题图标替换、`dsh.client` 扫描等关键实现，与当时的源码一致）。**2026-11-05 复核时的本机版本已升级到 `0.2.2-rc.1`**（`resources/app.asar` 内 `package.json` 与 `dsh/desktop-runtime.json` 均为 `0.2.2-rc.1`，与本次升级后的 submodule 同源）；本轮只对源码行号做了逐条复核，未再逐项反查 asar。
> 参考插件：[`dsh-autorevivw-hold`](../dsh-autorevivw-hold)（同为阴影官方槽位的第三方 client 插件，可直接当模板）。
> 调研时间：2026-10-31；源码版本复核：2026-11-05。

---

## 结论速览

| 想改的东西 | 能否不改官方代码做到 | 推荐做法 |
| :--- | :---: | :--- |
| 头像、昵称、副标题、菜单里多几行（工作区 / 余额 / 自定义链接） | ✅ | **阴影 `settings.launcher` 单格槽**：注册一个 `priority: -1` 的同名槽条目，复刻官方那行的样式，内部用 `ReactDOM.createPortal` 把个性化内容送进官方启动器节点（`dsh.autorevivw-hold` 的 `client.js` 是现成模板） |
| 侧栏那行的**级联菜单**（菜单项顺序、额外菜单项） | ⚠️ 只能在「锚点外面加东西」 | 同上：在官方触发按钮旁叠加自定义行/浮层，不接管官方 `Menu` |
| 浏览器标签页标题 | ✅（运行期） | `document.title` 观察 + 改 `<title>`，或构建期 `DSH_CLIENT_TITLE` |
| 账号页（设置 → 账号）里的头像/名字 | ❌（插件侧） | 只能改官方 `ui-settings-account` 的 `AccountSection`（它不在槽里，没有扩展位） |
| 服务端返回的昵称/头像本身 | 只能改 Platform 账号资料 | `AccountProfile` 直接来自 Platform `id_profile.name` / `id_profile.picture`，本地无覆盖点 |
| 全局替换 `user-outline` 这个图标字形 | ✅ | `ctx.theme.register({ icons: { 'dsw-icon-user-outline-medium': '<svg…>' } })`；**只影响仍未签到时的小圆头像和「登录」行** |

一句话：**官方那行是「单格槽 `settings.launcher`」里唯一的占用者 `AccountMenu`，第三方唯一的合法入口就是注册一个更低 `priority` 的同名槽条目去「阴影」它**；除此之外没有账号头像/名字的配置项、没有主题 token 能改文案、也没有 `account/switch` 之类的多账号 API。

---

## 1. 这处 UI 到底是什么

### 1.1 渲染链路

```
SettingsRoot (ui-settings-general，占据 sidebar.settings 的侧栏尾部)
└─ renderSlot('settings.launcher', { wide, settingsOpen, openSettings, openOnboarding, settingsShortcut? })
   └─ 单格槽 SettingsLauncherOwnerProps
      └─ AccountMenu (ui-settings-account)  ← 唯一的官方占用者
         ├─ <button aria-label={t('menu')}>：24px 圆头像 AccountAvatar + 文字 label
         │    · 已登录：<img src={avatar.url}>（仅 avatar.status==='ready'），否则 IconUserOutlineMedium
         │    · 未登录：IconEllipsisOutlineMedium + label "更多"
         └─ <Menu side="top" portal>：设置 / 意见反馈 / 登录|退出登录
```

关键源码位置（相对 `ref/deepseek-harness/packages/client/`）：

| 关注点 | 文件:行 |
| :--- | :--- |
| 槽类型声明（唯一权威） | `ui-settings/src/client/contract/slots.ts:17` — `'settings.launcher': { kind: 'single'; scope: 'root'; owner: SettingsLauncherOwnerProps }` |
| 运行时声明 + 渲染 | `ui-settings-general/src/client/SettingsRoot.tsx:226`；`ui-settings-general/src/client/index.ts:220` |
| 官方占用者注册 | `ui-settings-account/src/client/index.ts:333` — `ctx.remoteAccess.whenAccess('account/watch', () => ctx.slots.inject('settings.launcher', () => ctx.slots.register({ name: 'settings.launcher', locale: 'settings.account', inject: () => operations }, AccountMenu)))` |
| 入口组件 | `ui-settings-account/src/client/AccountMenu.tsx` |
| 头像组件 | `ui-settings-account/src/client/AccountAvatar.tsx`（`img` 或 `IconUserOutlineMedium size={16}`） |
| 头像加载状态机 | `ui-settings-account/src/client/account-avatar.ts`（`loading / ready / failed`，`referrerPolicy='no-referrer'`，失败回落图标） |
| 文案来源 | `ui-settings-account/src/client/locales.ts:17-19`（命名空间 `settings.account`） |
| 行样式 token | `ui-settings-account/src/client/AccountMenu.module.css`（`--dsh-sidebar-row-padding`、`--dsw-alias-interactive-bg-hover`、`--dsw-radius-md`，折叠态 36×36，展开 44px 行） |

### 1.2 头像与名字从哪来（数据流）

```
Platform /auth-api/v0/users/current
  → package profile() 投影：AccountProfile
      { id, name: id_profile.name || null, contact: 手机号||邮箱||null, avatarUrl: id_profile.picture || null }
        credentials/deepseek-account-platform/src/details.ts:38-44
        credentials/deepseek-account/src/types.ts:49-52
  → custom plugin 通过 Host 查询：ctx.remote.account.getProfile(clientMetadata)
        api/account-controller/src/index.ts 的 @Remote getProfile()
        （clientMetadata = { version, locale, timezoneOffsetSeconds }，用于 Platform 请求头，credentials/deepseek-account/src/client-metadata.ts）
  → ui-settings-account 缓存进 AccountSnapshot.details.profile / details.balance
        ui-settings-account/src/client/index.ts 的 refresh()
  → 侧栏文字：AccountMenu.tsx:43-44
        name ?? contact ?? t('signedIn')
        即「昵称 → 服务端脱敏邮箱/手机号 → "已登录 DeepSeek"」
  → 侧栏头像：AvatarLoader.setUrl(avatarUrl)（index.ts:106），加载成功才 <img>
```

要点：

- **本地没有「改昵称/换头像」的覆盖点**。`AccountProfile` 是 Platform 读取结果的投影，`ui-settings-account` 也不读任何 `config`；
- `profile.name` 是 Platform 上的 `id_profile.name`，`avatarUrl` 是 `id_profile.picture`。想「从根本上」换名字/头像，只能改 Platform 账号资料（Web 端平台设置）。
- 头像 URL 走浏览器直连（`referrerPolicy='no-referrer'`，无 DSH token），失败一次仍会回落图标，并在每次进入设置 / 手动刷新（`refreshAccount` → `avatar.retry()`，index.ts:182）时重试。
- 资料读取绑定访问控制 `account/watch`：非 owner 页面（liveshare 等）没有授权时**整个启动器都不存在**（`whenAccess` 包住了 `slots.inject`，见 `api/remote-access/src/client/mount.ts:55`、`README.zh.md:65`）。注意它判定的是 `global` 资源，而不是某种 `account` 资源。。第三方替换件应同样只对 owner、或同样包在 `whenAccess('account/watch', …)` 里，避免在别人页面上出现个性化入口。

### 1.3 「单格槽」与优先级语义（能不能被替换）

`ui-slots/src/index.ts:1215-1220`：

```ts
// Cell occupancy clashes only at the exact priority: a different priority shadows.
const priority = options.priority ?? 0
// … single slot "x" already has a registration at priority 0 — register at a different priority to shadow it (lowest renders)
```

- 官方注册没写 `priority` → 取默认 `0`；
- 第三方写 `priority: -1` 即可「阴影」，写 `0` 会在激活时**直接抛错**（不是静默覆盖）；
- 数值最低者渲染，卸载后自动回落到官方条目（effect 生命周期）；
- `docs/subsystems/slots.zh.md:68`：「复用已有 cell 表示有意替换其展示」——阴影是官方认可的机制，`ui-settings-general/README.zh.md:69` 也明确「贡献入口自行拥有内缩」。

已经在本机验证过的先例：`dsh-autorevivw-hold` 用同样的方式阴影了 `settings.general.item` 的官方权限行（`client.js` 中 `priority: -1` 复用 `id: 'permission'`）。

---

## 2. 三条可选路径

### A. 阴影 `settings.launcher` —— 唯一能做「真个性化」的路径

**能力**：完全掌控这一格渲染什么。可以自己画头像（首字母 / emoji / 自定义图片 / 公开 URL）、自己写昵称/副标题、给菜单加行、改行高圆角。

**代价**：

1. 官方那行会消失，必须**复刻行为**：`openSettings`、意见反馈、登录/退出、登录弹窗（`account.loginVisible`）、退出确认（`hasRunningAccountTasks` 有任务时弹窗）、额度/赠礼提示的位置；
2. 官方 `AccountSectionInjected` 里的 `start / cancel / signOut / showLogin / contactUs` 等**不在 owner props 里**，第三方能拿到的只有：
   - owner props：`wide / settingsOpen / openSettings / openOnboarding / settingsShortcut?`；
   - 标准 hook：`useRemoteAccess`、`useSessions`、`useWorkspaces`、`usePanelInfo` 等（`docs/subsystems/slots.zh.md` 的 standard props 表）；
   - 自己的注入。
   若第三方直接调用 `ctx.remote.account.*`，就绕过了官方「有任务时二次确认」「登录弹窗取消 Host 流程」「退出后清空头像」这些时序，属于要自己兜住的风险；
3. 官方后续升级（改样式、加菜单项、加提示）不会自动跟到你的复刻件上。

**两种实现形态**（都能避开「重写整行」的维护成本）：

| 形态 | 做法 | 优点 | 缺点 |
| :--- | :--- | :--- | :--- |
| **A1 纯复刻** | 在 `priority: -1` 的组件里自己渲染整行 + 自己 `Menu` | 不受官方结构变化影响，头像 16px、24px、任意尺寸都能做 | 行为复刻成本高（见上 1–3） |
| **A2 阴影 + Portal**（推荐） | 阴影组件渲染一个 0 高度锚点，`wide` 时 `zIndex > 0`；`ReactDOM.createPortal(个性化内容, 官方行祖先)` 把内容叠到官方头像上；官方行仍负责触发、菜单、登录/退出 | 官方行为零改动；升级后行还在，只是叠层需要复核 | 依赖 DOM 结构（官方 CSS Modules 类名是 hash，只能用 `data-*`、`aria-label`、`aria-haspopup="menu"` 等语义锚点）；Portal 到 React 树外时 `Menu` 的点击判定要用 `getAnchorRect`（见坑 7.2） |

`dsh-autorevivw-hold/client.js` 是本机验证过的现成模板：它阴影了官方权限设置行（`priority: -1` + 复用官方 `id`），DOM 定位只用 `aria-haspopup` 这类语义锚点；本机 `dsh-style-tweaks` 的 `tweaks/desktop-settings-launcher.js` 则演示了「等官方节点出现 → 挂载 → 卸载清理」的 MutationObserver 范式。A2 可以组合这两者：用前者做注册与样式，用后者做节点等待。

> 官方 client 包不导出 CSS Modules 文件，A2 的叠层样式必须自带，且只用 `--dsw-*` token（见 §3.4）；类名在官方 bundle 里是 hash，不能依赖。

### B. 主题 / 图标级替换

**B1. 全局换图标字形**

```js
// ui-theme/src/client/icon-sprite.ts: 12, 31；index.ts: 96 (ThemeDefinition.icons)、:354 register()
ctx.theme.register({
  id: 'my-brand', colorScheme: 'light', tokens: {},
  icons: { 'dsw-icon-user-outline-medium': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">…</svg>' },
})
```

- 规则：必须有 `viewBox` 根、不能有 `<style>/<script>`、元素 id 必须以 `dsw-icon-…-` 前缀开头、`currentColor` 才会继承用色；
- **只对「已登录但头像加载失败/没有 picture」时的图标、以及未登录的「更多」图标生效**（`AccountAvatar.tsx:15-18`），不能画图片、不能写文字；
- 已登录且头像成功时一直是 `<img>`，换图标不会显示；
- 需要保持 `colorScheme` 与当前主题一致，或注册成 active theme；简单做法是 `ctx.theme.register` 一个由用户选择的「品牌主题」+ `ctx.theme.setTheme(id)`，主题切换返回时清掉。

**B2. token 改动**（`ctx.theme.overrideTokens(source, { light, dark })`，`index.ts:388`）

只能改颜色类 token：`--dsw-alias-interactive-bg-hover`、`--dsw-alias-brand-primary`、`--dsw-radius-md`、`--dsw-alias-bg-skeleton` 等；**不能**改文案、尺寸、结构。适合「悬停色 / 头像底环色 / 品牌主色」这类轻量定制。

**B3. 浏览器标题**：`AppFrame.tsx:261` 取 `process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')`，构建期决定；运行期只能旁路改 `document.title`（注意 `DocumentTitle.tsx` 会在 session 切换时重写，需要 MutationObserver 跟随）。本机装着的 `dsh-style-tweaks` 0.1.8 没有做这一项（已查 `lib/client.js`），不会冲突。

### C. 官方包内改造（仅源码自建）

直接改 `AccountMenu.tsx / AccountAvatar.tsx / locales.ts`，或用 `cordis.patch.yml` 覆盖 `ui-settings-account` 行的 `config`。适用「自编译 DSH」；对已安装的桌面端不可行（asar 只读，且升级即被覆盖），**不推荐**。

另外两种「看起来能改但没有入口」的地方：

- **账号设置页的头像/名字**（`AccountSection.tsx:167-171`）不在任何槽里 → 插件无法接管；
- **Platform 资料本身**（名字/头像）没有本地覆盖配置 → 只能改平台账号。

---

## 3. 推荐方案：`dsh-account-persona`（阴影 + Portal）

### 3.1 功能范围（MVP）

1. **头像**
   - `auto`：有 Platform 头像则用；否则用昵称首字（可配色）；再否则用图标；
   - `photo`：强制用平台头像；
   - `initial`：首字/emoji 头像；
   - `custom`：本地选择的图片（`FileReader` → `data:` URL，存 `localStorage`，限 256KB）+ 可选「公开 URL」（纯 `<img>` 直连，需用户自担隐私）；
2. **昵称 / 副标题**：侧栏文字优先用用户昵称，其次平台昵称 → 脱敏联系方式 → 默认文案；副标题出现在菜单顶端；
3. **入口行增强**
   - 默认形态：官方行原样 + 头像/文字叠层（A2）；
   - 可选形态：上方多一行（工作区名 / 当前会话数 / 今日成本）；
   - 可选菜单行：工作区、用量、费用、设置、反馈、登录/退出。
4. **持久化**：偏好存 Host 设置（`settings` 服务 + `Config` 的 `volatile()` 字段，无需重启热生效）或浏览器 `localStorage`；图片走 localStorage。

### 3.2 数据可行性核对

| 需求 | 可行数据源 | 备注 |
| :--- | :--- | :--- |
| 平台昵称 / 联系方式 | `ctx.remote.account.getProfile(client)` | 需 `inject`：`remote.account`；Host 侧 `@Remote getProfile`（`api/account-controller/src/index.ts`） |
| 登录态 | `ctx.remote.$stream({ name: 'account', open: s => ctx.remote.account.watch(s) })` | 与官方一致的流；或薄复刻 `useAccount` hook |
| 当前工作区 | owner 标准 prop `useWorkspaces(s => s.items)`（`WorkspaceView`：`workspaceId/path/title/sessionIds/createdAt/updatedAt`） | 当前选中项需 `usePanelInfo` / `useSessions` 推导，官方 sidebar 行已有现成推导 |
| 用量 / 余额 | `ctx.remote.account.getBalance(client)`；或超链接 `AccountView.links.usageUrl / topUpUrl` | 链接由 Host 按 `platformOrigin` 派生 |
| **今日成本** | 标准 props 里**没有**成本聚合 API 发现 | 需读会话 projection（`useSessions`）自行累计，或复用 `dsh-connect-workbuddy` 等插件的读数；MVP 先不做，仅留扩展位 |
| 自定义头像图片 | `FileReader.readAsDataURL` + `localStorage` | 不走任何 Remote，无上传通道（官方 client 资源 `ctx.resources` 只提供了 `ui-plan` 的 `plan` 协议作为范例，没有图片/附件协议可复用） |

### 3.3 骨架代码（与官方 client bundle 同构、无 JSX）

```js
window.__ModuleLoader__.load({
  id: 'dsh-account-persona',
  factory: (require) => {
    const React = require('react')          // 平台基座模块（PLATFORM_MODULES 种子表）
    const { createPortal } = require('react-dom')
    const h = React.createElement
    const NS = 'persona'
    const zh = { nickname: '昵称', avatar: '头像', … }
    const en = { nickname: 'Nickname', avatar: 'Avatar', … }

    const inject = ['slots', 'locale', 'remote', 'remote.account']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'persona: dictionaries')
      const t = ctx.locale.bind(NS)

      // 1) 自身偏好：root Observable + 外部 UI 卡片写入（见 §3.5）
      const store = createPersonaStore()   // {getSnapshot, subscribe, set(...)}
      ctx.effect(() => () => store.dispose(), 'persona: store')

      // 2) 账户快照（薄复刻官方 hooks.account）
      const account = createAccountMirror(ctx)   // {hooks:{account:{getSnapshot,subscribe}}, refresh()}

      // 3) 阴影 settings.launcher（仅 owner：whenAccess 与官方一致）
      ctx.remoteAccess.whenAccess?.('account/watch', () => ctx.slots.inject('settings.launcher', () =>
        ctx.slots.register({ name: 'settings.launcher', priority: -1, locale: NS,
          inject: () => ({ hooks: { account: account.hooks.account, persona: store } }) },
          PersonaLauncher)))
    }

    // 4) 组件：官方行旁边叠一层，或自己整行
    function PersonaLauncher({ wide, settingsOpen, openSettings, useAccount, usePersona }) { … }
    return { inject, apply }
  },
})
```

要点：

- `priority: -1` 写在 register options 的最外层（`KindOptions`，`ui-slots/src/index.ts:770-797`），不是 `inject` 里；
- 组件 props 只拿 `PropsRuntime` 的 owner 值 + 注入面；**组件里不碰 ctx**；
- 文本用 `t(...)`，语言切换时 `t` 是「按 revision 新函数引用」（`ui-renderer/src/client/scoped-slots.tsx` 的 `localeSeat`），memo 组件会随语言刷新；
- 需要在 `dsh.client.inject` 里声明 `@deepseek-ai/dsh-client-ui-settings`、`@deepseek-ai/dsh-client-ui-settings-general`，但它们只是加载/诊断用的**信息性边**（`ui-workspace/src/client/index.ts:98` 有明确说明），真正的等待必须靠 `ctx.slots.inject`。

### 3.4 样式约束

- 只用 `--dsw-*` 语义 token（`ui-theme` 的 `BUILTIN_INSPECT_TOKENS`）：`--dsw-alias-label-primary/secondary/tertiary`、`--dsw-alias-bg-module-platform`、`--dsw-alias-bg-skeleton`、`--dsw-alias-interactive-bg-hover`、`--dsw-alias-brand-primary`、`--dsw-radius-md`；
- 行几何沿用官方：折叠态 36×36、展开态 44px、内缩 `--dsh-sidebar-row-padding`/`--dsh-sidebar-paint-inset`；
- 深浅色两套都要看（token 自带两套值，不要硬编码颜色）；
- 头像 24px（行内）/ 32px（自定义行）需 `border-radius:50%; corner-shape:round; object-fit:cover`，与官方 `AccountAvatar.module.css` 一致。

### 3.5 设置入口放哪

官方没有为单个插件提供「账号头像设置」这类行，推荐二选一：

1. **插件自己的设置卡片**：`Config` 字段用 `volatile()`（`docs/cookbook/adding-a-settings-card.zh.md`），出现在「设置 → 插件」里可热改；
2. **自建对话框**：从阴影入口行的菜单/长按头像打开自己的 `Modal`（`ui-primitives` 的 `Modal`，`data-modal-autofocus` 管初始焦点），写偏好到 `localStorage` 或 `ctx.remote.settings.mutate`。

### 3.6 坑位清单

1. **只有 owner 才有这个槽**：`account/watch` 无授权时官方注册都不存在，`slots.inject` 回调不会执行。阴影件同样要用 `whenAccess` 包住，否则会在别人页面上出个性化入口。
2. **只能「加」，不能「进」官方菜单**：官方 `Menu` 的 `items` 是闭包常量（`AccountMenu.tsx:74-81`）。要加菜单项只能叠自己的浮层；没有 `menuClassName`/`renderItem` 扩展位——`Menu` 组件本身有 `className/listClassName`，但那是官方内部使用的 props，插件拿不到它的实例。
3. **CSS 类名是 hash**（`css-modules`），跨插件只能用属性锚点：`button[aria-haspopup="menu"]`、`button[aria-label="账号菜单"]`、`ul[aria-haspopup="menu"]`、`[data-avatar-status]`、`[data-signed-out]`、`[data-collapsed]`。本机 `dsh-style-tweaks` 用的也是同样的锚点策略（`[class*="_settingsArea"]` 这种是脆弱写法，不建议）。
4. **Portal 的祖先必须是官方锚点子树**：`Menu.tsx:355-364` 的「点击外部关闭」只看 `rootRef`（锚点子树）与 `listRef`（portaled 列表）是否 `contains(e.target)`。
   - A2 把内容 Portal 进**官方触发按钮的祖先节点**时，点击仍算内部，菜单不会误关；Portal 到 `document.body` 则会一点就关；
   - `getAnchorRect` 只在「你自己的浮层需要跟着官方按钮定位」时用到（portal 模式传矩形而不是元素），与官方菜单无关；
   - 在 React 事件外面同步改 DOM 时，对 React 树内节点用 `flushSync`，否则叠层内容可能滞后一拍。
5. **登录/退出必须交给官方流程**：`start()` 会在弹窗上报错并等待 Host 状态；`signOut()` 有「有任务时确认」；`avatar.reset()` 会在流帧/撤权时清空。复刻时**应优先在 A2 形态下跳出**（只做呈现），A1 形态必须逐条对齐。
6. **头像失败会重试**：`refreshAccount` 每次进入设置/从充值页返回都会 `avatar.retry()`，自定义图片加载失败要自管，避免无限 `onError` 循环。
7. **语言**：账号命名空间是 `settings.account`（不是 `common`），自定义文案用自己的 NS；`zh`/`en` 之外的语言会回落到 `en`。
8. **卸载即恢复**：所有注册走 `ctx.effect`/`slot 注册返回的 disposer`；阴影条目卸载后官方行自动回来。
9. **不要把偏好放进 Session**：这是纯展示状态，不进会话日志、不进模型提示（「Model-visible ⟺ logged」），放设置文档或 `localStorage` 即可。
10. **`data:`** **URL** **尺寸**：`localStorage` 每域约 5MB，256KB 图片（base64 约 340KB）足够，超过要提示用户压缩；别把图片塞进设置文档（`settings.mutate` 的 revision 会膨胀、同步慢）。

---

## 4. 原生安装与调试

### 4.1 运行环境事实

- 桌面端 bundle 在 `…/DeepSeek Harness/resources/app.asar`，其中**只有 Host 进程自己的文件读取能打开它**——`ls`/`cat`/`node`/pnpm/glob/grep 都会失败（官方 skill 文档里同样写明）。所以：读官方源码用 `ref/deepseek-harness`，读运行态实现用 `node -e "fs.readFileSync('app.asar')"` 的字节探测；
- 第三方 client 插件必须是 lazy-CJS factory 格式（`window.__ModuleLoader__.load({ id, factory })`），源码外的包要自建这一步（`docs/cookbook/adding-a-settings-card.zh.md` 第 5 节）；
- 本机 Node 24 可以直接 `node --check client.js` 做语法检查，`node -e "import('./index.js')"` 检查 Host 侧导出。

### 4.2 最小 manifest（沿用 `dsh-autorevivw-hold`）

```json
{
  "name": "dsh-account-persona",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg", "README.md"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-settings-general"
      ]
    }
  },
  "engines": { "dsh": ">=0.2.1-rc.3 <0.3.0" },
  "license": "MIT"
}
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: account-persona
      name: dsh-account-persona
      config:
        enabled: true
        avatarStyle: auto
        nickname: ''
```

`index.js`（Host 侧只是配置座位）：`export const name = 'dsh-account-persona'`、`export function apply() {}`；若要偏好存 Host 设置，就在 Host 侧 `export const Config`（schemastery，`volatile()` 字段）。

### 4.3 自检（无浏览器控制时的边界）

1. `node --check client.js`、`node -e "import('./index.js')"`；
2. `dsh plugin --profile desktop add ./dsh-account-persona` → 重启 DSH → 硬刷新页面；
3. Chrome DevTools 控制台应无 `slot … already has a registration`（`priority` 撞了会报）与 slot entry crash；
4. 真机看：浅/深两套主题、折叠/展开两种侧栏、已登录/未登录两种状态、有头像/无头像/头像加载失败三种头像态；
5. **在桌面端 asar 里查不到 devtools 是否能连的结论时，不要声称「视觉已验证」**——只报「已安装、已激活、无槽冲突」，视觉部分说明未验证。

---

## 5. 源码里没有的东西（避免白找）

- ❌ 账号显示名的配置项：`ui-settings-account` 无 `Config`，`AccountProfile` 无本地覆盖字段；
- ❌ 头像/昵称槽：只有整行 `settings.launcher`，没有 `account.launcher.avatar`、`account.menu.items` 之类的子槽；
- ❌ 多账号 API：`account` 命名空间只有 `getState/getProfile/getBalance/getUnnotifiedBonuses/ackBonusNotified/startSignIn/cancelSignIn/signOut/hasRunningAccountTasks/watch/watchExpiry`（`api/account-controller/src/index.ts`）；
- ❌ 图片资源协议：`ctx.resources` 只有 `ui-plan` 注册 `plan` 协议作范例，没有可复用的图片/blob 协议；
- ❌ 成本/费用聚合的标准 prop：`useSessions` 只到会话粒度，今日成本需要自行 fold。

---

## 6. 如果决定动手做插件

建议直接复制 `dsh-autorevivw-hold` 目录结构（`package.json` / `cordis.patch.yml` / `index.js` / `client.js` / `locale/{en,zh}.json` / `icon.svg` / `README.md`），把 `client.js` 的 `ctx.slots.inject('settings.general.item', …)` 换成 `ctx.slots.inject('settings.launcher', …)` + `priority: -1`，按 §3.3 的骨架补上头像、昵称、Portal 叠层与本仓库约定的 README/自检步骤。本仓库约定见 [[dsh-plugin-conventions]] 技能（项目级技能，放在本机忽略的 `.dsh/skills/` 下，路径 `.dsh/skills/dsh-plugin-conventions/SKILL.md`），插件清单表格在 [README.md](../README.md)。

---

## 7. 参考源码索引

| 主题 | 路径（`ref/deepseek-harness/` 下） |
| :--- | :--- |
| 槽位契约 | `packages/client/ui-settings/src/client/contract/slots.ts:17` |
| 槽外框与渲染 | `packages/client/ui-settings-general/src/client/SettingsRoot.tsx:226` |
| 官方启动器 | `packages/client/ui-settings-account/src/client/AccountMenu.tsx`、`AccountAvatar.tsx`、`account-avatar.ts`、`AccountMenu.module.css` |
| 官方注册与数据刷新 | `packages/client/ui-settings-account/src/client/index.ts:49,106,182,333` |
| 账户页（不可插件化） | `packages/client/ui-settings-account/src/client/AccountSection.tsx:93-171` |
| 账户投影类型 | `packages/credentials/deepseek-account/src/types.ts:44-58`；`packages/credentials/deepseek-account-platform/src/details.ts:6-44` |
| Remote 端点 | `packages/api/account-controller/src/index.ts` |
| 访问控制 | `packages/api/remote-access/src/client/mount.ts:55`；`packages/api/remote-access/README.zh.md:65` |
| 槽优先级语义 | `packages/client/ui-slots/src/index.ts:1215-1220`；`docs/subsystems/slots.zh.md:60-68` |
| 主题图标/token | `packages/client/ui-theme/src/client/index.ts:354,388`；`packages/client/ui-theme/src/client/icon-sprite.ts:12,31`；`packages/client/ui-primitives/src/icons/artwork.ts:61,146` |
| 浏览器标题 | `packages/client/ui-layout/src/client/AppFrame.tsx:261`；`packages/client/ui-layout/src/client/DocumentTitle.tsx` |
| client 插件装载 | `docs/subsystems/client-modules.zh.md`；`packages/client/modules/src/index.ts:891-918`；`docs/cookbook/adding-a-settings-card.zh.md` 第 5 节 |
