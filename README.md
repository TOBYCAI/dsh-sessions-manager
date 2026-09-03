# dsh-sessions-manager

> **可能是目前最稳定、体验最好的 DSH 会话管理插件。**

> 中文 | [English](./README.en.md)

![GitHub stars](https://img.shields.io/github/stars/TOBYCAI/dsh-sessions-manager?style=flat-square&color=facc15)
![Downloads](https://img.shields.io/github/downloads/TOBYCAI/dsh-sessions-manager/total?style=flat-square&color=14b8a6)
![License](https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square)
![daily compat](https://img.shields.io/github/actions/workflow/status/TOBYCAI/dsh-sessions-manager/compat.yml?branch=main&label=daily-compat&style=flat-square)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe?style=flat-square)

> DSH 会话管理器：在**设置 → 会话管理**里统一归档、移动、恢复、查看详情；在**主页侧边栏**直接标记未读、移动、删除会话。删除先进入回收站，可恢复或彻底清理。

一个 DSH 持久化插件（host + browser 双半）。v3.0.0 起同时覆盖「设置面板」与「主页侧边栏」两个入口，无需打开设置即可完成高频会话操作。

## 功能

### 设置面板：会话管理

- **统一面板**：顶部提供「全部 / 活动 / 已归档 / 已收藏 / 回收站」五个视图，支持按标题、会话 ID、工作区搜索，按工作区筛选，并按创建时间或标题排序。筛选栏下方另有一行维护栏，收纳「自动归档」与「存储占用」两个按需展开的工具，不占用视图位置。
- **收藏（星标）**：会话行左侧常驻星标按钮，单击即收藏 / 取消（乐观更新、失败回滚）；「已收藏」视图与 DSH 的活动 / 归档状态正交、可叠加；收藏索引为插件自有 schema v3，不触碰 DSH 日志，会话被彻底删除时自动清理。
- **冷态标题同步**：侧栏使用日志中最新的 `session/title` 修正冷启动缓存，改名后的会话无需先打开即可显示新名称。
- **侧栏跨工作区拖拽**：直接把会话拖到目标工作区标题即可切换工作区；目标高亮、同工作区拦截、失败反馈，并保留“更多 → 移动会话”作为键盘操作入口。
- **归档 / 恢复**：归档把会话从侧栏隐藏；恢复取消归档并放回原工作区分组。
- **移动到工作区**：任选**已有工作区**或**新建目录路径**（自动创建），新建目录支持点击 **「浏览…」** 调用系统目录选择窗口。会话的工作目录与日志一起迁移；即使会话处于打开状态也可安全移动。
- **会话详情**：展开单条会话查看**磁盘占用**、**轮次 / 步骤 / 用户·助手消息 / 工具调用 / 图片附件**统计、**工具使用分布**、**搜索·抓取记录**、**write/edit 写过的文件列表**（已过滤磁盘上已不存在的路径），以及**血统**（父会话 / 子会话 / 子代理）。
- **导出**：详情面板底部提供两个入口——「**下载原始日志 (ZIP)**」直接走 DSH 官方 `session.export` 端点（含子会话与附件，持久化后端不支持时自动隐藏）；「**导出 Markdown**」由本插件把会话渲染为人类可读对话记录（front matter + 按轮分节 + 用户 / 助手 / 工具调用摘要，流式增量不重复）。
- **存储占用分析**：维护栏的「存储占用」按钮按需展开，按工作区聚合会话日志的磁盘占用（占比条 + 会话数），并列出占用最大的会话 Top 10。纯只读统计，不修改任何数据；默认收起、展开时才统计，因此不会拖慢会话列表的加载。
- **自动归档**：可设为把 **30 / 60 / 90 天未活跃**的会话自动收进「已归档」，**默认关闭**。当前正在使用的会话与已收藏的会话（该保护可关闭）永不自动归档；只做归档标记，不删除任何数据，随时可恢复。检查在打开面板时惰性触发，每天最多一次，也可点「立即检查」手动执行。
- **批量多选**：全选 / 批量归档 / 恢复所选 / 删除所选（批量删除一次二次确认）。

### 主页侧边栏：会话 ⋯ 菜单增强

- **标记未读**：在会话的 ⋯ 菜单顶部新增「标记未读 / 标记已读」切换；也可直接点击会话左侧的状态圆点切换。进入该会话后自动取消未读标记。
- **移动会话**：点击后右侧悬浮子菜单列出工作区名称，选择即移动到目标工作区；当前工作区以「当前」标注并置灰。
- **删除会话**：删除会先把会话**移入回收站**（非立即物理删除），设置面板可回收站恢复或彻底清理。

### 主页侧边栏：状态圆点

每行会话左侧显示一个小圆点，颜色直接读取 DSH 原生 `StateDot` 状态，含义如下：

| 颜色 | 状态 | 说明 |
|---|---|---|
| 🔵 蓝 | 手动标记未读 | 通过 ⋯ 菜单或点击圆点手动标记；进入会话后自动清除 |
| 🟡 黄 | 工作中 | 会话正在运行（`running`） |
| 🟠 琥珀 | 等待反馈 | 会话有追问，需要用户输入或确认（`warning`） |
| 🟢 绿 | 完成后未读 | 会话已完成（`done`）但你还没重新打开看过；看过一次后不再显示 |
| 🔴 红 | 出错 / 需关注 | 会话遇到错误（`error`） |
| 无圆点 | 完成后已读 / 空闲 | — |

圆点与 DSH 自带状态点接管对齐：插件隐藏 DSH 原生点并按上表重新渲染，避免两个点并存。

### 回收站

- 回收站是会话管理中的独立视图，显示待清理数量和删除时间。
- 正常删除的会话先进入回收站，**不会立即从磁盘移除**，也不会被归到「未分组」。
- 回收站内可对单条会话执行**恢复**（回到原工作区）或**彻底删除**（物理清理日志）。
- 支持**清空回收站**一键彻底删除全部内容。
- 支持永久保留或 7 / 30 / 90 天自动清理，并可校验日志完整性。
- 回收站索引采用版本化 schema、串行变更和原子写入；旧版数组索引会自动迁移。
- 已彻底删除的会话会被永久隐藏，不再出现在侧栏与会话管理列表。
- 永久删除会先写入后端墓碑，再等待 live Session 与持久化控制器退出、移除日志并重建工作区索引；即使重连或宿主仍有旧索引，也不会重新出现或生成空的「未分组」。

## 截图

<details>
<summary>展开查看截图（设置面板 / 自动归档 / 存储占用 / 已收藏 / 回收站 / 会话详情 / 侧边栏菜单）</summary>

![主页侧边栏 ⋯ 菜单（标记未读、移动会话、删除会话）](assets/screenshot-session-submenu.png)

![设置面板「会话管理」](assets/screenshot-session-settings.png)

![自动归档面板（维护栏内联展开）](assets/screenshot-session-autoarch.png)

![存储占用分析（维护栏内联展开）](assets/screenshot-session-storage.png)

![已收藏（星标）视图](assets/screenshot-session-starred.png)

![回收站](assets/screenshot-session-trash.png)

![会话详情（磁盘占用 / 统计 / 工具使用）](assets/screenshot-session-details.png)

</details>

## 安装

```sh
# 方式一：Git 依赖直装（推荐，无需本地 clone，重启 DSH 生效）
dsh plugin --profile desktop add "github:TOBYCAI/dsh-sessions-manager"

# web 端（若你也用 dsh web）：
dsh plugin --profile web add "github:TOBYCAI/dsh-sessions-manager"

# 方式二：本地 link（开发调试）
git clone https://github.com/TOBYCAI/dsh-sessions-manager.git
dsh plugin --profile desktop add link:/path/to/dsh-sessions-manager
```

> 装完**重启 DSH**（或刷新页面重新加载 bundle）后，设置 → 会话管理 / 主页侧栏 ⋯ 菜单 即可用。

## 卸载

```sh
dsh plugin --profile desktop remove dsh-sessions-manager
dsh plugin --profile web remove dsh-sessions-manager
```

## 结构

```
package.json       npm 元数据 + dsh.bundle.patch + dsh.client（浏览器半注册）
cordis.patch.yml   向 profile bundle 插入本插件行
src/index.js       host 源码（/archived-sessions/* JSON 路由）
src/client/index.jsx  client 源码（React，settings.section + 侧栏 DOM 增强）
src/auto-archive.js   自动归档设置（schema v4）+ 候选判定纯函数
src/storage-stats.js  存储占用聚合（纯函数，按工作区 / Top N）
build.mjs          esbuild 构建脚本（本地开发时生成 lib/）
lib/index.js       预构建 host（ESM）
lib/client.js      预构建 client（ModuleLoader CJS handshake）
```

`lib/` 已预构建，clone 下来即可直接用、无需 esbuild。若要改源码，运行 `npm i -D esbuild && npm run build` 重新生成 `lib/`。

## Host 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/archived-sessions/sessions` | 列出全部会话（含已归档标记），供「会话管理」面板 |
| POST | `/archived-sessions/list` | 列出归档会话（跳过已删除/不存在者） |
| POST | `/archived-sessions/archive` | 归档（隐藏）单个会话 |
| POST | `/archived-sessions/archive-many` | 批量归档 |
| POST | `/archived-sessions/restore` | 取消归档单个 |
| POST | `/archived-sessions/restore-many` | 批量取消归档 |
| POST | `/archived-sessions/delete` | 删除单个会话——**移入回收站**（非立即物理删除） |
| POST | `/archived-sessions/delete-many` | 批量移入回收站 |
| POST | `/archived-sessions/trash/list` | 列出回收站中的会话 |
| POST | `/archived-sessions/trash/restore` | 从回收站恢复会话 |
| POST | `/archived-sessions/trash/purge` | 彻底删除回收站中的单个会话 |
| POST | `/archived-sessions/trash/purge-many` | 清空/批量彻底删除回收站会话 |
| POST | `/archived-sessions/trash/settings` | 读取或更新自动清理策略 `{ retentionDays }` |
| POST | `/archived-sessions/trash/verify` | 校验回收站日志是否仍存在 |
| POST | `/archived-sessions/workspaces` | 列出可选目标工作区 |
| POST | `/archived-sessions/move` | 把会话移动到目标工作区 `{ sessionId, targetPath }` |
| POST | `/archived-sessions/details` | 会话详情（磁盘/统计/工具/fetch/文件/血统）`{ sessionId }` |
| POST | `/archived-sessions/sidebar-state` | 返回侧栏权威标题、回收站 ID 与永久删除墓碑 |
| POST | `/archived-sessions/star/set` | 收藏 / 取消收藏 `{ sessionId 或 sessionIds, starred }` |
| GET | `/archived-sessions/export-md?sessionId=` | 单会话 Markdown 导出（人类可读对话记录） |
| POST | `/archived-sessions/storage` | 存储占用聚合（按工作区排行 + 最大的会话）`{ topN }` |
| POST | `/archived-sessions/auto-archive/settings` | 读取或更新自动归档策略 `{ inactiveDays, skipStarred }`；读取时惰性触发每日检查 |
| POST | `/archived-sessions/auto-archive/run` | 立即执行一次自动归档检查（忽略每日节流） |

> 删除会话默认进入回收站，只有回收站内的「彻底删除」才会物理移除日志。被彻底删除的会话由前端永久隐藏，避免 DSH 运行时缓存使其重新出现在侧栏或「未分组」中。

## 兼容性

- **适配系统**：跨平台（macOS / Windows / Linux）——只要 DSH 能在该系统运行即可；本插件 host 基于 Node（约 `^22.19` 或 `>=24`）、浏览器端为 React，不依赖特定操作系统 API。
- DSH Desktop / web 均可（同一套 host + client）。
- peerDependencies 见 `package.json`；`react`、`@deepseek-ai/*` 由 DSH 运行时提供。

## License

[MIT](./LICENSE) © TOBYCAI
