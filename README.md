# dsh-sessions-manager

> 中文 | [English](./README.en.md)

![GitHub stars](https://img.shields.io/github/stars/TOBYCAI/dsh-sessions-manager?style=flat-square&color=facc15)
![Downloads](https://img.shields.io/github/downloads/TOBYCAI/dsh-sessions-manager/total?style=flat-square&color=14b8a6)
![License](https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square)
![daily compat](https://img.shields.io/github/actions/workflow/status/TOBYCAI/dsh-sessions-manager/compat.yml?branch=main&label=daily-compat&style=flat-square)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe?style=flat-square)

> DSH 会话管理插件：在**设置 → 会话管理**里统一归档、移动、恢复、查看详情与血缘；在**主页侧边栏**的会话 ⋯ 菜单直接标记未读、移动、删除会话。删除先进入回收站，可恢复或彻底清理。

host + browser 双半结构，覆盖「设置面板」与「主页侧边栏」两个入口，不打开设置也能完成高频会话操作。读写一律走当前 Runtime 的官方接口；无法安全验证的能力（路径推导失败、写所有权不可判定等）在界面与 host 端同步禁用并给出原因，不以方法存在与否冒充行为兼容，也不在没有真正执行时报成功。

## 功能

### 设置面板：会话管理

- **统一面板**：顶部提供「全部 / 活动 / 已归档」三个常驻视图，低频的「已收藏 / 空白 / 回收站」收进行尾的箭头按钮，点按横向滑出展开（低频视图处于选中态时自动保持展开）；支持按标题、会话 ID、工作区搜索，按工作区筛选（除全部与各真实工作区外，另有「未分组」与「工作区已删」两个专门口径，对应卡片上的同名 chip），并按创建时间或标题排序。结果行合并为一句说明，如「显示 5 个会话，另有 4 个子代理折叠在父会话下」。筛选栏下方的维护栏收纳「存储占用」「标签管理」「自动归档」等按需展开的面板级工具，不占用视图位置。
- **收藏（星标）**：会话行左侧常驻星标按钮，单击即收藏 / 取消（乐观更新、失败回滚）；「已收藏」视图与 DSH 的活动 / 归档状态正交、可叠加；收藏索引为插件自有 schema v3，不触碰 DSH 日志，会话被彻底删除时自动清理。
- **标签与保存筛选**：给会话贴自定义标签（全局 ≤200、单会话 ≤10；支持重命名、合并、删除——**删除标签只删标签，绝不触碰会话**），并按标签筛选列表；「视图 + 工作区 + 排序 + 标签」的组合可保存为筛选预设（≤20 条）一键应用。标签与预设存在插件自有索引里（同星标索引纪律），跟随这台机器的 DSH 数据目录、不跟账号走。
- **冷态标题同步**：侧栏使用日志中最新的 `session/title` 修正冷启动缓存，改名后的会话无需先打开即可显示新名称；冷启动大库里标题先留空、后台分批补齐，补齐后**已经在屏幕上的侧栏行和「⑂ 分支」标记的悬停说明会跟着自动更新**，不必等页面重建。
- **侧栏跨工作区拖拽**：直接把会话拖到目标工作区标题即可切换工作区；目标高亮、同工作区拦截、失败反馈，并保留「⋯ → 移动会话」作为键盘操作入口。拖到侧栏列表的上 / 下边缘会自动滚动列表（越靠边越快，到顶到底即停），视口外的工作区标题也能拖到。
- **归档 / 恢复**：归档把会话从侧栏隐藏；恢复取消归档并放回原工作区分组。
- **移动到工作区**：任选**已有工作区**或**新建目录路径**（自动创建），新建目录支持点击 **「浏览…」** 调用系统目录选择窗口。会话的工作目录与日志一起迁移。被 DSH 打开的会话（日志写所有权被 agent-loop 持有）不会被强行搬运，而是**自动排队**、释放后由插件完成，详见下文「移动活跃会话（排队移动）」。
- **会话详情**：展开单条会话查看**磁盘占用**、**轮次 / 步骤 / 用户·助手消息 / 工具调用 / 图片附件**统计、**工具使用分布**、**搜索·抓取记录**、**write/edit 写过的文件列表**（已过滤磁盘上已不存在的路径），以及**血缘**（父会话 / 子会话 / 子代理）。
- **血缘分层披露**：「分组」下拉提供**血缘（折叠分组，默认）**与**平铺（全部并列）**两种视图。血缘视图下：子代理会话折叠在其父会话下（「▸ N 子代理」）；由同一来源会话派生的**分支（fork）自动聚拢成组**（「▸ N 分支」，组内按创建时间升序，来源父行原位保留；父会话被筛掉 / 归档 / 删除时降级为「来源：<短 ID>」组头，一行不丢——因此**「活动」视图里已归档父会话的分支会挂在「来源」组头下，这是设计不是 bug**）。聚拢只发生在设置面板的血缘视图；侧栏受官方 React 托管行 DOM 限制只打标记不重排。子代理会话不占顶层行：血缘视图下它们不计入「全部 / 活动 / 已归档 / 空白」的计数、不参与全选；父会话不在当前列表（已删除 / 已归档 / 被筛掉）的子代理统一收进列表末尾的**「未归属的子代理会话」**卡片（默认收起，展开后可逐条打开 / 归档 / 删除，搜索命中自动展开），不会以「(无标题)」行铺满列表。切到**平铺视图**则与 DSH 原生一致，子代理逐行并列、可单独勾选。分支会话带绿色「⑂ 分支」标记（悬停显示来源父会话；父标题为后到数据，到达后自动刷新），空白会话带灰色标记并可进入「空白」视图统一查看与清理。
- **空白会话识别**：采用**事件类型法**——`0.1.3` 起日志头部扩容且创建时恒写一帧生命周期元数据，体积阈值法失效；插件对候选会话做官方解码精判，头部之外没有任何内容事件才判空白（解码失败按非空兜底）。**插件注入的上下文不算内容**：`agent/inbox/spliced` 只插入 `source.kind` 以 `plugin:` 开头或 `form: 'instructions'` 的消息、且未删除任何消息时，该会话仍判空白（真用户消息与无法识别的载荷照旧算内容）。精判完全在数据返回路径之外：侧栏数据**首拍即回**，空白与否先按「未知」处理（未知一律不隐藏、不计入空白分类），后台小队列逐条判定、结论落盘跨重启复用，后续拍自动收敛。
- **导出**：详情面板底部提供两个入口——「**下载原始日志 (ZIP)**」直接走 DSH 官方 `session.export` 端点（含子会话与附件，持久化后端不支持时自动隐藏）；「**导出 Markdown**」由本插件把会话渲染为人类可读对话记录（front matter + 按轮分节 + 用户 / 助手 / 工具调用摘要，流式增量不重复）。
- **存储占用分析**：维护栏的「存储占用」按钮按需展开，按工作区聚合会话日志的磁盘占用（占比条 + 会话数），并列出占用最大的会话 Top 10。纯只读统计，不修改任何数据；默认收起、展开时才统计，因此不会拖慢会话列表的加载。
- **自动归档**：可设为把 **30 / 60 / 90 天未活跃**的会话自动收进「已归档」，**默认关闭**。当前正在使用的会话与已收藏的会话（该保护可关闭）永不自动归档；只做归档标记，不删除任何数据，随时可恢复。检查在打开面板时惰性触发，每天最多一次，也可点「立即检查」手动执行。
- **批量多选**：全选 / 批量归档 / 恢复所选 / 删除所选（批量删除一次二次确认）。**全选只覆盖当前列表里真正占一行、可单独勾选的会话**——折叠中的子代理、聚拢的分支成员与「来源：」组头都不参与，避免选中界面上看不见的会话；批量删除同样按父会话级联子代理，提示会写明连带数量。勾选后批量操作栏**吸顶**钉在面板顶部，列表再长也无需滑回顶部操作；另提供「**移动所选…**」批量跨工作区移动（复用单移动面板：已有工作区 / 新建目录 / 系统目录浏览），单条失败不阻断整批，失败明细逐条回报。

### 主页侧边栏：会话 ⋯ 菜单增强

三项增强按危险度递增排在官方会话项之间（置顶 / 重命名 / 分叉 / 复制 Session ID / 归档仍由 DSH 提供）：

- **标记未读**（排最前）：菜单顶部新增「标记未读 / 标记已读」切换；进入该会话后自动取消未读标记。手动未读的蓝点本身也可点击取消。
- **移动会话**（排在归档之后）：点击后右侧悬浮子菜单列出工作区名称，选择即移动到目标工作区；当前工作区以「当前」标注并置灰。
- **删除会话**（排最末，红字）：删除会先把会话**移入回收站**（非立即物理删除），设置面板可恢复或彻底清理。

> `0.2.2` 起菜单由宿主用 portal 渲染、沿 DOM 已取不到会话行，插件改用官方 `ctx.contextMenus.register({ target: 'session' })` 注册——会话 ID 由宿主直接给出，不依赖任何 DOM 形状；`0.1.7`–`0.2.1` 拿不到该服务时自动回退到 DOM 注入。

### 主页侧边栏：子代理折叠与分支标记

- **子代理折叠**：DSH 上游侧栏按设计不渲染子代理行，插件按官方血缘字段（`origin: 'subagent'` / `parentSession` / `delegationDepth`）把子代理行**就地注入**父会话之下——「▸ N 子代理」徽标在该行被选中或悬停时出现，点击展开缩进的子代理行，行内点击即通过官方 API 打开对应子代理会话；子代理被删除后折叠列表同步收敛。
- **分支标记**：由父会话分支（fork）产生的会话，行上会在选中或悬停时显示绿色「⑂ 分支」chip，提示其血缘来源。
- **空白会话**：上游不把空白会话渲染进侧栏，插件侧同步隐藏并固化为默认行为；空白会话的管理入口收敛到设置面板的「空白」视图。

### 主页侧边栏：状态圆点

状态点交还 DSH 原生 `StateDot`：运行中是缓冲圈、需要接管是琥珀点、完成未读是绿点、出错是红点——都由 DSH 自己渲染，插件不重画、也不隐藏原生的点，形状与动效这层信息不会丢失。

插件只补 DSH 没有的一条语义：

| 圆点 | 状态 | 说明 |
|---|---|---|
| 🔵 蓝 | 手动标记未读 | 通过 ⋯ 菜单标记；进入会话后自动清除，也可直接点蓝点取消 |

手动未读命中时，蓝点占住同一个状态槽（原生点临时让位）；取消标记后原生点立刻回来。

### 回收站

- 回收站是会话管理中的独立视图，显示待清理数量和删除时间。
- 正常删除的会话先进入回收站，**不会立即从磁盘移除**，也不会被归到「未分组」。
- 删除是**软删除**：日志留在原工作区目录，回收站只记索引。为了让 DSH 自己的账本也跟着收敛，删除的同时会把会话**写入 DSH 原生归档**——所以即使停用或移除本插件，这些会话也不会重新冒回活动列表（它们仍在 DSH 的「已归档」里），恢复时会按删除前的状态对称还原。
- 回收站内可对单条会话执行**恢复**（回到原工作区）或**彻底删除**（物理清理日志）。两者都先核对日志是否真的在盘上：索引记录的路径与磁盘实际代际不符时按实际文件纠偏；目标确实不在、或删除后复核文件仍在，都返回明确错误并**保留条目**，绝不「报成功但文件还在」。
- **删除父会话会连带回收它的子代理**：默认把整棵子代理子树一起移入回收站（子代理生命周期跟随父会话），删除确认框可取消勾选以保留它们；恢复或彻底删除父会话时，这些连带条目同样级联处理，不会在回收站里留下无父的孤儿。用户自己单独删掉的子代理不会被父会话重新认领（恢复父会话也不会把它带回来）。
- 支持**清空回收站**一键彻底删除全部内容。
- 支持永久保留（默认）或 7 / 30 / 90 天自动清理，并可校验日志完整性。
- 回收站索引采用版本化 schema、串行变更和原子写入；旧版数组索引会自动迁移。
- 已彻底删除的会话会被永久隐藏，不再出现在侧栏与会话管理列表。
- 永久删除会先写入后端墓碑，再等待 live Session 与持久化控制器退出、移除日志并重建工作区索引；即使重连或宿主仍有旧索引，也不会重新出现或生成空的「未分组」。

### 移动活跃会话（排队移动）

DSH 给每个会话日志加了**单写者锁**：会话一旦被 DSH 打开（包括只是选中当前会话），写所有权就被 agent-loop 持有。**官方没有提供「关闭会话 / 释放所有权」的入口——该所有权只在 DSH 进程退出时释放**（切换会话不释放；实测空闲等待也不会释放）。此时强行搬运是危险的：写者会继续往旧文件写，并在旧路径重建空壳目录。

因此本插件对「被占用的会话」采用**排队延迟移动**：

- 命中占用时**不会失败**，而是登记进待移动队列（`~/.dsh/sessions-manager/pending-moves.json`），并**如实提示「已排队」**——绝不会在没有真正搬运的情况下报「已移动」。
- 队列的自动执行时机：**插件启动后立即并密集重试**（0 / 1 / 3 / 6 / 12 / 30 秒，必须抢在浏览器打开会话之前）、之后每 2 分钟轻量兜底、以及宿主释放会话时。
- 队列最多保留 50 条；同一条连续 5 次因**非占用原因**失败会被放弃并记录日志（启动 30 秒内的失败不计入，避免启动竞态丢队列）。
- 查看与取消：`POST /archived-sessions/pending-moves`、`POST /archived-sessions/pending-moves/cancel { sessionIds }`；队列非空时面板显示「待移动队列」小节（逐条取消）。
- **结果不再静默**：后台完成或最终放弃（连续 5 次非占用失败）会落成通知，下次打开 DSH 页面时以提示弹出（放弃类附原因）。通知在服务端保留到确认展示（最多 20 条、最长 7 天），没弹就不会丢。
- **要真正搬走一个活跃会话**：先发起移动（进队列），再**重启 DSH 并先别打开那个会话**——启动后几秒内会自动完成。未完成的项跨重启保留，不会丢。

### 会话格式 v3 / v4

DSH 0.1.5 把会话日志格式升级到 **v3**，0.1.7 再升到 **v4**，均由 runtime 自己在读取时完成迁移：

- 迁移是**自动**的，且**保留原文件**——所以同一个会话目录里可能同时出现 `session.jsonl.zstd` 与更高代的 `session.vN.jsonl.zstd`，属官方预期行为；本插件按**磁盘上实际存在的最高代**读取，与官方一致。
- 迁移**单向、不支持降级读取**：升级并打开过会话之后，把 runtime 回滚到旧版本会导致那些会话无法读取。回滚前请先备份 `~/.dsh/sessions`。
- 官方只迁移**受支持的旧日志**；遇到未知事件或损坏数据会**拒绝迁移且不做任何修复**。这类会话在插件里会表现为读取 / 移动报 `SessionFormatUnsupportedMigrationError` / `SessionFormatError`——插件无法代修，只能如实报错（可先确认该会话是否确实异常，再决定保留或删除）。
- **新建会话严格要求当前格式（v4）头部**：跨工作区移动时插件会按当前后端的格式重新采样会话头，旧格式（v3 及更早）会话可以正常移动，移动后的副本直接落在当前格式。
- 格式版本由插件从后端的格式目录包**动态探测**，不写死版本号，所以 `0.1.7` / `0.2.x` 共用同一套处理。

## 截图

<details>
<summary>展开查看截图（侧边栏菜单 / 侧栏子代理折叠 / 设置面板 / 批量移动 / 空白视图 / 自动归档 / 存储占用 / 已收藏 / 回收站 / 会话详情）</summary>

![主页侧边栏 ⋯ 菜单（标记未读、移动会话、删除会话）](assets/screenshot-session-submenu.png)

![主页侧边栏子代理折叠（「▸ N 子代理」徽标 + 就地展开）与「⑂ 分支」标记](assets/screenshot-session-subagent.png)

![设置面板「会话管理」（血缘分组 / 空白视图 / 筛选收纳）](assets/screenshot-session-settings.png)

![批量移动面板与吸顶批量操作栏](assets/screenshot-session-multimove.png)

![空白会话视图（事件类型法识别）](assets/screenshot-session-empty.png)

![自动归档面板（维护栏内联展开）](assets/screenshot-session-autoarch.png)

![存储占用分析（维护栏内联展开）](assets/screenshot-session-storage.png)

![已收藏（星标）视图](assets/screenshot-session-starred.png)

![回收站](assets/screenshot-session-trash.png)

![会话详情（磁盘占用 / 统计 / 工具使用）](assets/screenshot-session-details.png)

</details>

## 安装

```sh
# 方式一：npm（推荐，无需 clone，重启 DSH 生效）
dsh plugin --profile desktop add dsh-sessions-manager

# 方式二：Git 依赖直装（跟随 main 最新提交）
dsh plugin --profile desktop add "github:TOBYCAI/dsh-sessions-manager"

# 方式三：本地 link（开发调试）
git clone https://github.com/TOBYCAI/dsh-sessions-manager.git
dsh plugin --profile desktop add link:/path/to/dsh-sessions-manager
```

> 装完**重启 DSH**（或刷新页面重新加载 bundle）后，设置 → 会话管理 / 主页侧栏 ⋯ 菜单 即可用。
> 若你也用 `dsh web`，把 `--profile desktop` 换成 `--profile web` 再执行一次即可。

## 卸载

```sh
dsh plugin --profile desktop remove dsh-sessions-manager
dsh plugin --profile web remove dsh-sessions-manager
```

> 卸载不会删除任何会话日志。被本插件删除过的会话仍在 DSH 的「已归档」里，可在 DSH 侧恢复。

## 结构

```
package.json         npm 元数据 + dsh.bundle.patch + dsh.client（浏览器半注册）
cordis.patch.yml     向 profile bundle 插入本插件行
build.mjs            esbuild 构建脚本（生成 lib/，构建指纹可复现）
lib/index.js         预构建 host（ESM）
lib/client.js        预构建 client（ModuleLoader CJS handshake）

src/index.js               host 入口：/archived-sessions/* 路由、归档 / 回收站 / 移动编排
src/compat/capabilities.js 能力探测（按持久化代际决定开放哪些操作）
src/compat/persistence.js  持久化适配：官方 locate 结果先验盘，失败再按磁盘布局推导
src/handle-era-ops.js      SessionHandle 世代的操作实现（归档 / 移动 / 彻底删除）
src/handle-era-paths.js    守卫式路径推导（根目录 → 目录结构 → 会话 ID 归属 → 最高代际）
src/path-guard.js          日志路径归属校验（纯函数）
src/active-session.js      活跃会话上报（clientId 分桶 + 45s TTL）
src/pending-moves.js       排队移动队列（跨重启保留 + 重试计划）
src/move-notices.js        排队移动终局通知的保留与确认
src/auto-archive.js        自动归档设置（schema v4）+ 候选判定纯函数
src/storage-stats.js       存储占用聚合（纯函数）
src/lineage.js             血缘分类与空白会话判定（事件类型法）
src/empty-scan-index.js    空白精判结论的磁盘缓存（指纹 + TTL 双闸门）
src/star-index.js          星标索引（schema v3）
src/tag-index.js           标签索引（schema v4）
src/saved-filters.js       筛选预设（schema v1）
src/title-persist-index.js 标题 / 元数据的磁盘小索引
src/session-meta-cache.js  会话元数据内存缓存（按日志内容指纹校验）
src/markdown.js            会话 → 人类可读 Markdown
src/zstd-frame.js          zstd 多帧扫描与重写
src/state-temp-sweep.js    原子写入残留临时文件清理

src/client/index.jsx       client 入口：设置面板、侧栏增强、官方 slot / contextMenus 注册
src/client/logic.js        可单测的纯逻辑（折叠、计数、筛选、拖拽步长等）
```

`lib/` 已预构建，clone 下来即可直接用、无需 esbuild。若要改源码，运行 `npm i -D esbuild && npm run build` 重新生成 `lib/`；提交前用 `npm run check:dist` 重建并与仓库产物比对（CI 跑同一道检查），**改版本号后务必一并重建**——构建指纹可复现为 `vX.Y.Z+源码哈希`，正是为了让这道比对精确可靠。

## Host 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/archived-sessions/sessions` | 列出全部会话（含已归档标记），供「会话管理」面板 |
| POST | `/archived-sessions/list` | 列出归档会话（跳过已删除 / 不存在者） |
| POST | `/archived-sessions/archive` | 归档（隐藏）单个会话 |
| POST | `/archived-sessions/archive-many` | 批量归档 |
| POST | `/archived-sessions/restore` | 取消归档单个 |
| POST | `/archived-sessions/restore-many` | 批量取消归档 |
| POST | `/archived-sessions/delete` | 删除单个会话——**移入回收站**（非立即物理删除），同时写入 DSH 原生归档；默认连带整棵子代理子树（`cascadeSubagents: false` 可保留），返回 `cascaded` / `cascadedIds` |
| POST | `/archived-sessions/delete-many` | 批量移入回收站（按父会话级联子代理，返回 `cascaded` 总数） |
| POST | `/archived-sessions/trash/list` | 列出回收站中的会话 |
| POST | `/archived-sessions/trash/restore` | 从回收站恢复会话（连带恢复当初跟随它一起回收的子代理，返回 `cascaded`） |
| POST | `/archived-sessions/trash/purge` | 彻底删除回收站中的单个会话（连带条目同样级联，返回 `cascaded`） |
| POST | `/archived-sessions/trash/purge-many` | 清空 / 批量彻底删除回收站会话（按父会话级联） |
| POST | `/archived-sessions/trash/settings` | 读取或更新自动清理策略 `{ retentionDays }`（0 / 7 / 30 / 90） |
| POST | `/archived-sessions/trash/verify` | 校验回收站日志是否仍存在 |
| POST | `/archived-sessions/workspaces` | 列出可选目标工作区 |
| POST | `/archived-sessions/move` | 把会话移动到目标工作区 `{ sessionId, targetPath }`；目标会话正被 DSH 打开时返回 `{ queued: true }` 并登记排队 |
| POST | `/archived-sessions/move-many` | 批量跨工作区移动 `{ sessionIds, targetPath }`——单条失败不阻断，失败明细逐条回报，被占用的会话进 `queued` 列表，末尾统一重建索引 |
| POST | `/archived-sessions/pending-moves` | 查看待移动队列（会话被占用时排队，释放后自动完成） |
| POST | `/archived-sessions/pending-moves/cancel` | 取消排队 `{ sessionIds }` |
| POST | `/archived-sessions/pending-moves/notices/ack` | 确认排队移动终局通知（展示后清理；未确认项最长保留 7 天） |
| POST | `/archived-sessions/details` | 会话详情（磁盘 / 统计 / 工具 / fetch / 文件 / 血缘）`{ sessionId }` |
| POST | `/archived-sessions/sidebar-state` | 返回侧栏权威标题、回收站 ID、永久删除墓碑、**血缘分层**（子代理 / 分支 / 空白标记）、`warmPending` / `refinePending`（标题预热、空白精判两条后台队列是否仍在途）与 `moveNotices`（排队移动终局通知，空则省略字段） |
| POST | `/archived-sessions/lineage-tree` | 递归子代理树（面板血缘分组与侧栏折叠的数据源），已过滤回收站与墓碑 |
| POST | `/archived-sessions/star/set` | 收藏 / 取消收藏 `{ sessionId 或 sessionIds, starred }` |
| POST | `/archived-sessions/tags/list` | 标签定义 + 会话→标签映射 `{ tags, assignments }` |
| POST | `/archived-sessions/tags/create` | 新建标签 `{ name }`（重名 / 超 200 拒绝，错误带 code） |
| POST | `/archived-sessions/tags/rename` | 重命名 `{ id, name }`（id 不变） |
| POST | `/archived-sessions/tags/merge` | 并入 `{ fromId, toId }`（去重合并后源标签消失） |
| POST | `/archived-sessions/tags/delete` | 删除标签 `{ id }`（只删定义与映射，不碰会话） |
| POST | `/archived-sessions/tags/set` | 全量设置某会话的标签 `{ sessionId, tagIds }` |
| POST | `/archived-sessions/filters/list` / `save` / `delete` | 筛选预设 `{ name, filters }`（≤20；filters 为不透明载荷） |
| GET | `/archived-sessions/export-md?sessionId=` | 单会话 Markdown 导出（人类可读对话记录） |
| POST | `/archived-sessions/storage` | 存储占用聚合（按工作区排行 + 最大的会话）`{ topN }` |
| POST | `/archived-sessions/auto-archive/settings` | 读取或更新自动归档策略 `{ inactiveDays, skipStarred }`；读取时惰性触发每日检查 |
| POST | `/archived-sessions/auto-archive/run` | 立即执行一次自动归档检查（忽略每日节流） |
| POST | `/archived-sessions/capabilities` | 返回当前持久化代际、读取 / 归档 / 回收站 / 永久删除 / 跨工作区移动能力，以及两份客户端回显：`clientMenu: { mode, at }`（菜单通道，`contextMenus` 或 `dom`）与 `clientUi: { navSection, navIcons, navOwn, navFallback, navIconRenders, sessionRows, workspaceRows, overflowRows, stateDots, tokenBgLayer2, tokenWarn, at }`（界面自证：只含计数与令牌解析值，不含任何标题或正文） |

> 删除会话默认进入回收站，只有回收站内的「彻底删除」才会物理移除日志。被彻底删除的会话由前端永久隐藏，避免 DSH 运行时缓存使其重新出现在侧栏或「未分组」中。

## 兼容性

- **适配系统**：跨平台（macOS / Windows / Linux）——只要 DSH 能在该系统运行即可；host 按 `node22` 目标构建为 Node ESM，浏览器端为 React，不依赖特定操作系统 API。
- DSH Desktop / web 均可（同一套 host + client）。
- peerDependencies 见 `package.json`；`react`、`@deepseek-ai/*` 由 DSH 运行时提供。

| Runtime | 状态 | 关键适配 |
|---|---|---|
| `0.2.2-rc.3` | 已实测 | 左导航图标走官方 `settings.section.icon` 槽（不再靠 CSS 遮罩叠出第二颗）；菜单解析改为同步 + 快照预热（rc.3 对异步 `resolve` 有 1s 预算）；重复注册守卫（rc.3 同 id 重复注册直接抛错）；设计令牌直连 `bg-layer-1/2` 等现行名；空白判定补齐 0.2.2 的状态类事件 |
| `0.2.2-rc.1` | 已实测 | 会话菜单改官方 `contextMenus` 数据注册；删除同步写入原生归档；`inject` 只保留真实存在的包 |
| `0.2.1-rc.2` | 已实测 | 会话格式仍 v4；persistence 改为 cordis 插件形态（双形态均可挂载）；侧栏行包 wrapper、折叠计数改 `sessionCount` 校准；空分组容器改为无 role 的 `groupSection` |
| `0.2.0-rc.1` / `0.2.0-rc.2` | 已实测 | `ctx.sessions` 退化为数据流服务，打开会话改走 `uiWorkspace.openSession`；peer 范围放宽到 `>=0.1.0-rc.6`；存储域为领域数据形式；活跃会话改由客户端心跳上报 |
| `0.1.7-rc.2` | 已实测 | 会话格式 v4，格式目录拆到独立包；移动时按后端当前格式重采样会话头 |
| `0.1.5` / `0.1.3` / `0.1.2` | 已实测 | 旧代运行时只开放可安全验证的能力，详见下节 |

> 未经验证的未来 Runtime 默认只开放能够识别的安全能力；插件不会用方法存在与否冒充行为兼容。能力以面板实际提示与 `/archived-sessions/capabilities` 返回为准。

### 行为差异与降级说明

- **回收站恢复需要校验**：恢复前会确认底层会话仍存在（live / `stat` / 列表三级判定）。底层会话已不存在（`DSM_SESSION_MISSING`）、已被彻底删除（`DSM_SESSION_PURGED`）或索引仍在但日志文件消失（`DSM_SESSION_LOG_MISSING`）时返回准确错误；无法核验日志位置时如实标注 `unverified`，不会假装校验通过。恢复到「工作区已删除」的会话会成功并提示其暂归「未分组」。
- **彻底删除 / 清空回收站 / 自动物理清理**：官方公共契约未提供删除 API，插件沿用 legacy 时代的半官方路线——从后端实例的存储根目录字段出发做**三层守卫式路径推导**（根目录 → 会话目录结构 → 会话 ID 归属校验），通过后整目录删除并以官方 `stat` 复核；存在活跃写入的会话会被拒绝（409）。推导失败（如无法确认存储根目录）时自动禁用并说明原因，绝不盲删。同目录并存的多代日志会一并清理，否则 DSH 会回退读到旧代、等于没删。
- **跨工作区移动**：主路径为官方 `create` + `append` 事件重放（写所有权探测会拒绝**被 DSH 占用写权限**的会话、revision 前后校验防并发写入、备份回滚保证失败不留半移动状态）；后端存在同 ID 幽灵记录时回退到 frame0 cwd 改写搬运（帧数与内容逐位校验）。路径同样来自守卫式推导；移动后自动重建工作区分组索引，无需重启。官方按「同一 ID 只能落在一个项目目录」校验——因此移动是**整目录搬运**：先把源会话目录整体移开（对官方扫描彻底不可见），目标侧重放校验成功后再删除源目录；顺带**自动回收**其它项目目录里被取代的旧代副本，避免同一会话永久卡在「跨目录重复」而无法移动或删除。
- **彻底删除墓碑不压制新会话**：若同 ID 会话被重新创建，墓碑自动让位，新会话正常出现在列表与侧栏。
- **元数据缓存**：判断会话日志有没有变化，新 Runtime 用官方快照的 `revision`（仅同一进程内可比，绝不写进跨重启的缓存文件），旧 Runtime 用文件 `(mtime, size)` 指纹。列表的目录 / 创建时间直接来自快照会话头，不需要读日志；标题也不在页面加载时现读——缓存里没有就先留空显示，后台分批补齐后自动刷出。**读取失败与「会话确实没有标题」严格区分**：失败不写入任何缓存，稍后自动重试（该会话日志一变就立刻再试），偶发一次失败不会让会话永久显示「（无标题）」。
- **自动归档**：新 Runtime 不提供可靠的「最后活跃时间」，无法证明会话闲置时检查会跳过（`no-activity-data`），绝不基于猜测归档。
- **侧栏注入**：DOM / React fiber 识别收敛为可版本化的 adapter；上游侧栏结构不被识别时整体安全停用，不影响官方侧栏本身。识别正常时以 MutationObserver 增量驱动为主，仅保留低频兜底检查。
- **血缘分层**：子代理会话以官方头部字段识别（`origin: 'subagent'`、`parentSession`、`delegationDepth`）；上游侧栏不渲染子代理行与空白会话，插件据此把子代理行就地注入父会话下、把空白行隐藏。空白判定用**事件类型法**——创建会话时恒写一帧生命周期元数据（`permission/preset` / `sandbox/mode` / `approval/policy`），体积阈值法失效；插件对候选会话走官方解码精判，头部之外无内容事件才判空白，解码失败按非空兜底。结果按会话 + 跨重启稳定的体积指纹缓存并落盘（只有真解码成功的结论才持久化），日志没变就不重复读；精判在独立的后台小队列进行（批间让出事件循环），侧栏数据的返回始终零解码。

## License

[MIT](./LICENSE) © TOBYCAI
