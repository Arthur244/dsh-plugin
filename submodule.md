# submodule 使用说明

本仓库用 git submodule 引入**外部第三方仓库**作为实现参考，统一放在 [`ref/`](./ref/) 下。
`ref/` 里的内容是只读参考，**不是本仓库的插件**，不要执行 `dsh plugin add ref/...`。

> 本文只讲本仓库的通用操作。命令均在 Git for Windows + Git 2.37 下实测验证。

## 基本概念

submodule 在宿主仓库里**只存两样东西**，都不含参考代码本体：

| 存什么 | 位置 | 说明 |
| :--- | :--- | :--- |
| 声明 | `.gitmodules` 文件 | 记录每个 submodule 的 `path` 与 `url` |
| 指针 | 索引里的 gitlink（mode `160000`） | 指向被引用仓库的某个**具体 commit** |

远端仓库的 `config` 里**没有**任何 submodule 配置，`git clone` 也不会继承任何拉取开关。
所以「拉取方必须自己加参数」是 git 的设计，不是配置没写对。

## 添加

```sh
cd /e/Code/dsh-plugin

git submodule add --name <短名> <上游HTTPS地址> ref/<目录名>

git add .gitmodules ref/<目录名>
git commit -m "chore: 引入 <短名> 作为实现参考"
```

参数各司其职，实测互相独立：

- `--name <短名>`：`.gitmodules` 里的键名与本地 config 的键名（`submodule.<短名>.url`）。
  不写则默认为路径（如 `ref/xxx`），之后引用配置时要写全路径，较繁琐。
- 第 2 个参数：**上游地址**，决定「从哪拿」。
- 第 3 个参数：**落地路径**，决定「放在你仓库哪里」。省略时会用仓库名落到**仓库根**，通常不是你想要的。

实际示例（已在本仓库生效）：

```sh
git submodule add --name dsh-skills-manager \
  https://github.com/MichengAI/dsh-skills-manager \
  ref/dsh-skills-manager
```

对应的 `.gitmodules`：

```ini
[submodule "dsh-skills-manager"]
	path = ref/dsh-skills-manager
	url = https://github.com/MichengAI/dsh-skills-manager
```

### URL 必须异地可达

这是唯一真正决定别人能不能拉到的地方。

| 写法 | 异地能否拉到 | 说明 |
| :--- | :--- | :--- |
| HTTPS / SSH 绝对地址 | ✅ 推荐 | 唯一普遍可达 |
| `../lib.git` 相对路径 | ⚠️ 依赖布局 | 相对**origin 仓库的 URL**解析，不是相对你的工作目录 |
| `C:/Users/...` 本地绝对路径 | ❌ 必然失败 | 别人机器上没有这个路径 |

加完先自查一遍，看到 `C:/` 或 `/e/` 开头就说明有问题：

```sh
git config -f .gitmodules --get-regexp 'submodule\..*\.url'
```

### 可选：让参考目录不污染 `git status`

```sh
git config -f .gitmodules submodule.<短名>.ignore dirty
git add .gitmodules
```

`ignore = dirty` 只忽略「工作区脏」，**指针变化仍会照常显示**（实测），不会掩盖真正需要提交的更新。
该键随 `.gitmodules` 提交，拉取方 clone 后自动生效。

## 拉取（异地 clone 本仓库时）

```sh
# 一步到位
git clone --recurse-submodules https://github.com/Arthur244/dsh-plugin.git

# 已经普通 clone 过了
git submodule update --init --recursive
```

不做这一步，`ref/` 下会是**空目录**（实测）。

可选：让后续 `git pull` 也自动更新 submodule。这是**每个拉取方自己机器**上的配置，不会随仓库传播：

```sh
git config submodule.recurse true
```

## 更新到上游最新

```sh
git submodule update --remote ref/<目录名>
git add ref/<目录名>
git commit -m "chore: 更新 <短名> 参考版本"
```

注意 `update --remote` 会**直接改写该目录里的文件**。如果该目录正被 `dsh plugin` 以 link 方式安装引用，更新等于热替换运行中的插件代码，需要重启 DSH。

## 查看

```sh
git submodule status                    # 前面有 - 表示未初始化，+ 表示与记录不一致
git config -f .gitmodules --get-regexp 'submodule\..*'   # 声明一览
```

在参考仓库里看实现时，它保留完整独立历史，可正常 `git log` / `git blame`。

## 修改 URL

改 `.gitmodules` 后，**已 init 过的本地不会自动跟随**（实测），需要用 `sync` 把新 URL 同步到本地 config：

```sh
# 1. 改 .gitmodules 里的 url
git config -f .gitmodules submodule.<短名>.url https://github.com/<owner>/<repo>.git

# 2. 同步到本地 config
git submodule sync

# 3. 提交
git add .gitmodules && git commit -m "fix: 修正 <短名> url"
```

反向也一样：直接改本地 `git config submodule.<短名>.url` **不会**回传 `.gitmodules`，只在你这台机器生效。

## 删除

```sh
# 1. 注销并清空工作区目录
git submodule deinit -f ref/<目录名>

# 2. 从索引移除
git rm -f ref/<目录名>

# 3. 清理残留的 git 元数据（deinit 不会自动删，实测）
rm -rf .git/modules/<短名>

# 4. 提交
git add .gitmodules
git commit -m "chore: 移除 <短名>"
```

`git rm` 之后 `.gitmodules` 可能变成**空文件**（0 字节，实测）。最后一个 submodule 被删除时，直接删掉这个文件更干净：

```sh
git rm .gitmodules    # 或 rm .gitmodules && git add -A
```

## 常见问题

- **`fatal: '<path>' already exists in the index`** —— 目标路径已被本仓库跟踪。submodule 只能装进未被跟踪（或被忽略规则放行）的路径。
- **`fatal: '<path>' already exists and is not a valid git repo`** —— 想替换一个已有目录为 submodule，`git rm --cached` 不够，必须**先把目录从磁盘移走**再 add。
- **`The following paths are ignored by one of your .gitignore files`** —— 目标路径被 `.gitignore` 命中（本仓库的 `node_modules/`、`/\.dsh/` 等规则）。换目录名或加 `-f` 强制。
- **clone 后 `ref/` 是空的** —— 没加 `--recurse-submodules`，补跑 `git submodule update --init --recursive`。
- **改了 `.gitmodules` 的 url 但没生效** —— 已 init 的 clone 用本地 config 里的旧 url，跑 `git submodule sync`。
- **`--depth 1` 没起作用** —— 本地路径克隆时会被忽略（提示 `use file:// instead`），必须用 `file://` 或远程 URL。

## 参考

- [git-submodule 官方文档](https://git-scm.com/docs/git-submodule)
- [Git 工具 - 子模块](https://git-scm.com/book/zh/v2/Git-%E5%B7%A5%E5%85%B7-%E5%AD%90%E6%A8%A1%E5%9D%97)
