# README 里的本地图片在 DSH 中不显示：排查结论

> 排查时间：2026-10-31（Asia/Shanghai）　·　运行环境：DeepSeek Harness **桌面端**（`desktop` profile），运行时 `0.2.1-rc.5`

## 结论

四份 README（根 `README.md`、`dsh-a2d-workspace/`、`dsh-autorevivw-hold/`、`dsh-agent-config/`）的写法**没有问题**：相对路径 `./asset/*.jpg`、`../asset/*.jpg`，图片文件确实存在。问题出在 **DSH 自带的 Markdown 渲染器**，与仓库内容、图片格式、插件都无关：

1. **默认不认本地相对路径**：`MarkdownText` 只把「绝对 http(s) URL」或「所有者提供的本地路径词表」当作图片地址，其余一律降级成 alt 文本。因此 `./asset/readme-hero.jpg` 在聊天、插件详情等默认场景里只是一行灰字。
2. **侧栏文档预览（看 README 的主入口）有路径白名单，但相对路径会解析错位**：它虽然通过 `api/file` 路由支持本地图片，却把 `./asset/x.jpg` 直接拼到文档绝对路径后面，得到 `E:\Code\dsh-plugin/./asset/x.jpg`（盘符路径混用 `/`），再交给 **Windows 上按 POSIX 语法制路径的 `/api/file` 路由**，结果 400 或找不到文件。
3. **桌面端地址是 `dsh-app://app/`**：该协议只转发 `/`、`/index.html`、`/assets/...` 之外的 Host 路由给 `/api/file`；当前版本的 Markdown 渲染（`ui-primitives`）里还有「只放行绝对 http(s)」的兜底检查，进一步闸住图片。
4. **线上仓库/其他编辑器**（GitHub、Zed 等）按 GitHub 语义把相对图片解析到文件所在目录，自然正常。

## 证据链（第 2 条）

- 相对路径拼接（`ui-sidebar-documentpreview/src/client/markdown/path-images.ts`）：

  ```ts
  path = pathPartsOf(documentPath).directory + path   // 'E:\Code\dsh-plugin\' + './asset/readme-hero.jpg'
  return fileMediaUrl(base, path)                     // → api/file?path=E%3A%5CCode%5Cdsh-plugin%5C.%2Fasset%2Freadme-hero.jpg
  ```

  已安装的构建产物（`app.asar` 内 `dsh-client-ui-sidebar-documentpreview/lib/client.js` L1535–1550）与源码一致，没有归一化 `./`、`../`，也不统一分隔符。
- 路由端（`api/session-controller/src/media-references.ts`）：

  ```ts
  if (path.includes('\0') || !isAbsolute(path)) return fail(400, 'absolute path required')  // node:path.isAbsolute 按运行平台
  const target = await fs.resolve(path, { signal: ctx.fs.config.cwd })
  ```

  POSIX 语法下 `E:\Code\...` 不是绝对路径；即便按 Windows 处理，`.\`/`./` 混用与大小写规范化也会导致 `resolve` 落空（`FS_NOT_FOUND` → 404）。错误只回显在浏览器网络面板（`<img>` 加载失败），界面上只看到 alt 文本，没有任何提示。
- 同一条路由的其他约束：被覆盖时 `GET` 先 302（`private, no-store`）到带 `v` 的历史版本 URL，再返回 `immutable` 缓存；单文件上限取 `attachments.imageLimits.maxImageBytes`（默认 50 MiB，超出 413）；`img` 元素可能以 `Referer` 为 `Origin` 发请求，而处理函数不校验 Origin。这些都只是「不显示」的后续可能原因，当前仓库图片只有 0.5 MB 左右，上限不是原因。
- 桌面端转发（`app.asar/lib/main.js`）：`dsh-app://app/*` 除静态资源外统一 `forwardWebRequest` 到 Host 并附鉴权 Cookie，`/api/file` 不会被协议层拦截；是否显示只取决于渲染器给出的 URL 与 Host 的读取结果。

## 为什么其他软件正常

| 环境 | 相对图片解析方式 | 结果 |
| :--- | :--- | :--- |
| GitHub 网页 | 相对 README 所在目录（blob 语义） | 正常 |
| Zed 等编辑器预览 | 相对文档路径解析文件 | 正常 |
| DSH 聊天 / 插件详情 | 仅绝对 http(s) 图片 | 只显示 alt 文本 |
| DSH 侧栏 README 预览 | 原样拼接路径 → `/api/file` | Windows 下 400/404 |

## 一个需要现场确认的前提

按仓库设计（`.dsh/README.md`、各插件 README），这四份 README 主要是在**侧栏文档预览**里打开的。若在侧栏预览中也是「只有 alt 文本、连坏图占位都没有」，说明本地文件路由在桌面端整体不可达（鉴权 Cookie、`ctx.fs` 的 `resolve` 或版本 302），需要看一次浏览器网络面板确认是 400、401、404 还是 413——状态码分别对应上面的第 2 条、（鉴权）、文件落空、体积上限。

## 规避与修复选项（按改动成本排序）

1. **改用绝对 URL**：把图片换成线上地址（如 GitHub raw / jsDelivr），两处环境都能显示。
2. **README 里只放包裹用的绝对路径**：不推荐，换机器即失效。
3. **做个小插件补词表**：插件可用 `ctx.slots` 注册自己的文档正文渲染器，或在聊天侧包一层 `MarkdownDelegateProvider.fileImages`，把 `./asset/...` 归一化（`path.posix`/`path.win32` 规整 + 反斜杠统一）后交给 `api/file`；这也是绕开第 1 条（默认不认相对路径）的唯一稳定方式。
4. **上游修复**：在 `path-images.ts` 拼接前对 `directory + path` 做一次路径规范化（含 `./`、`../`、分隔符统一），并让 `/api/file` 在 Windows 上同时接受两种分隔符。属于 `ref/deepseek-harness` 行为，需要提 issue/PR，不能在本仓库内改。

> 注：以上结论基于 `ref/deepseek-harness` 源码与已安装的 `app.asar` 构建产物交叉核对（运行时 `0.2.1-rc.5`）。升级 DSH 后相关实现可能变化，以届时源码为准。
