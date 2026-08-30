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

## 更新日志

- **v3.2.2**：工程加固版，无功能变化。侧栏判定纯逻辑抽取到 `src/client/logic.js`（状态点语义 / 拖拽校验 / fiber 行识别），新增 13 个回归测试；CI 新增 runtime 版本冒烟（真实 cordis DI 契约校验 + 版本漂移追踪）。
- **v3.2.1**：zstd 会话日志安全修复（帧边界定位误匹配压缩数据内的 magic）。
- **v3.2.0**：侧栏跨工作区拖拽 + 完整会话管理工作台。

## v3.2 亮点

- **侧栏跨工作区拖拽**：把会话拖到目标工作区标题即可完成迁移；与 DSH 原生同组排序兼容，提供目标高亮、同工作区拦截、失败反馈，并保留键盘可达的菜单入口。
- **完整会话管理工作台**：全部 / 活动 / 已归档 / 回收站统一入口，加入全文搜索、工作区筛选、创建时间与标题排序、批量操作和结果计数。
- **可靠回收站生命周期**：软删除、原位恢复、单条彻底删除、批量清空、7 / 30 / 90 天自动清理和日志完整性校验；索引采用 schema v2、串行变更和原子写入。
- **删除后不再“复活”**：永久删除先持久化墓碑，再等待 live Session 与持久化控制器退役、物理删除日志并重建工作区索引，避免会话或空的「未分组」重新出现。
- **归档状态往返一致**：活动或归档会话进入回收站后，恢复时回到删除前状态；并发归档 / 恢复串行执行，避免重复 ID、覆盖和竞态。
- **冷启动标题权威同步**：从日志折叠最新 `session/title`，改名后的会话无需先打开即可在侧栏显示最新名称。
- **打开会话也能安全迁移**：移动过程同步日志 header、持久化状态、live Session 与 WorkspaceRegistry，配合备份、校验和失败回滚。
- **界面一致性与可访问性**：标签统一采用 DSH 官方 4px R 角；危险操作二次确认、忙碌 / 空 / 错误状态清晰，拖拽之外保留键盘操作路径。

## 功能

### 设置面板：会话管理

- **统一面板**：顶部提供「全部 / 活动 / 已归档 / 回收站」四个视图，支持按标题、会话 ID、工作区搜索，按工作区筛选，并按创建时间或标题排序。
- **冷态标题同步**：侧栏使用日志中最新的 `session/title` 修正冷启动缓存，改名后的会话无需先打开即可显示新名称。
- **侧栏跨工作区拖拽**：直接把会话拖到目标工作区标题即可切换工作区；目标高亮、同工作区拦截、失败反馈，并保留“更多 → 移动会话”作为键盘操作入口。
- **归档 / 恢复**：归档把会话从侧栏隐藏；恢复取消归档并放回原工作区分组。
- **移动到工作区**：任选**已有工作区**或**新建目录路径**（自动创建），新建目录支持点击 **「浏览…」** 调用系统目录选择窗口。会话的工作目录与日志一起迁移；即使会话处于打开状态也可安全移动。
- **会话详情**：展开单条会话查看**磁盘占用**、**轮次 / 步骤 / 用户·助手消息 / 工具调用 / 图片附件**统计、**工具使用分布**、**搜索·抓取记录**、**write/edit 写过的文件列表**（已过滤磁盘上已不存在的路径），以及**血统**（父会话 / 子会话 / 子代理）。
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

![主页侧边栏 ⋯ 菜单（标记未读、移动会话、删除会话）](assets/screenshot-session-submenu.png)

![设置面板「会话管理」](assets/screenshot-session-settingsmenu.png)

![回收站](assets/screenshot-session-trash.png)

![会话详情（磁盘占用 / 统计 / 工具使用）](assets/screenshot-session-details.png)

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

> 删除会话默认进入回收站，只有回收站内的「彻底删除」才会物理移除日志。被彻底删除的会话由前端永久隐藏，避免 DSH 运行时缓存使其重新出现在侧栏或「未分组」中。

## 兼容性

- **适配系统**：跨平台（macOS / Windows / Linux）——只要 DSH 能在该系统运行即可；本插件 host 基于 Node（约 `^22.19` 或 `>=24`）、浏览器端为 React，不依赖特定操作系统 API。
- DSH Desktop / web 均可（同一套 host + client）。
- peerDependencies 见 `package.json`；`react`、`@deepseek-ai/*` 由 DSH 运行时提供。

## License

[MIT](./LICENSE) © TOBYCAI
