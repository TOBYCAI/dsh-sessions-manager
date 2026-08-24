# dsh-sessions-manager

> 中文 | English

![GitHub stars](https://img.shields.io/github/stars/TOBYCAI/dsh-sessions-manager?style=flat-square&color=facc15)
![Downloads](https://img.shields.io/github/downloads/TOBYCAI/dsh-sessions-manager/total?style=flat-square&color=14b8a6)
![Downloads@latest](https://img.shields.io/github/downloads/TOBYCAI/dsh-sessions-manager/latest/total?style=flat-square&color=14b8a6)
![License](https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square)
![daily compat](https://img.shields.io/github/actions/workflow/status/TOBYCAI/dsh-sessions-manager/compat.yml?branch=main&label=daily-compat&style=flat-square)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe?style=flat-square)

> Manage **all your sessions** in DSH from one place — **Session Manager**.
> Archive / restore / permanently delete / move to another workspace, with workspace tags and session dates, plus batch actions.
> Target directories can be an **existing workspace** or a **new path** (auto-created); the new-path mode also supports the **native OS directory picker**, and the settings nav gets a dedicated archive-box icon.

A persistent DSH plugin (host + browser halves). Under **Settings → 会话管理 (Session Manager)** unify all conversations: archive (hide from sidebar), restore, permanently delete, and relocate between workspaces.

## Features

- **Unified panel**: a single Session Manager entry with an **All / Archived** filter; each row shows the title (falls back to the first user message), **archive status** (active / archived), the **session date**, and a **workspace tag** (title or directory name; a dashed "原工作区已删除 / workspace deleted" tag when the original workspace is gone).
- **Archive / Restore**: archive hides a session from the sidebar; restore unarchives and puts it back into its group.
- **Permanently delete**: physically removes the session log file + detaches workspace accounting — **irreversible** (asks for confirmation first).
- **Move to a workspace**: pick an **existing workspace**, or enter a **new directory path** (auto-created); the new-path mode also lets you open the **native OS directory picker** with a **「浏览…」** button. The session's working directory and log are migrated, and it moves into the corresponding workspace group. Even a session that is currently open can be moved safely — its log follows the session and the live in-memory object is re-synced to the new path.
- **Batch multi-select**: select-all / archive selected / restore selected / delete selected (single confirmation for batch delete).
- **Adaptive UI**: follows the theme tokens (light/dark), stacks vertically on narrow screens; loading / empty / error / busy states, keyboard focus and `prefers-reduced-motion` support; dedicated archive-box nav icon.
- **Session details (v2.0.0)**: expand any session with a **「详情」** toggle to see **disk usage**, **turns / steps / user·assistant messages / tool calls / image attachments** stats, **tool-usage breakdown**, **search·fetch records**, the **write/edit file list** (already filtered for paths that no longer exist on disk), and **lineage** (parent session / child sessions / subagents) — handy for understanding each session's cost and output, and for cleaning up large sessions. The detail statistics follow the same approach as the community plugin `Zephyr-vibe/dsh-archived-sessions`.

## Screenshots

![Session Manager panel (v2.0.0)](assets/screenshot-session-manager.png)

![Session details (disk usage / stats / tool usage)](assets/screenshot-session-details.png)

## Install

```sh
# Option 1: install as a Git dependency (recommended — no local clone; restart DSH to apply)
dsh plugin --profile desktop add "github:TOBYCAI/dsh-sessions-manager"

# For the web UI (if you also use dsh web):
dsh plugin --profile web add "github:TOBYCAI/dsh-sessions-manager"

# Option 2: local link (for development)
git clone https://github.com/TOBYCAI/dsh-sessions-manager.git
dsh plugin --profile desktop add link:/path/to/dsh-sessions-manager
```

> After installing, **restart DSH** (or refresh the page to reload the bundle). Then Settings → 会话管理 (Session Manager) becomes available.

## Uninstall

```sh
dsh plugin --profile desktop remove dsh-sessions-manager
dsh plugin --profile web remove dsh-sessions-manager
```

## Structure

```
package.json       npm metadata + dsh.bundle.patch + dsh.client (browser-half registration)
cordis.patch.yml   inserts this plugin's row into the profile bundle
src/index.js       host source (/archived-sessions/* JSON routes)
src/client/index.jsx  client source (React, settings.section)
build.mjs          esbuild build script (regenerates lib/)
lib/index.js       pre-built host (ESM)
lib/client.js      pre-built client (ModuleLoader CJS handshake)
```

`lib/` is pre-built, so cloning and using it needs no esbuild. To modify the source, run `npm i -D esbuild && npm run build` to regenerate `lib/`.

## Host routes

| Method | Path | Description |
|---|---|---|
| POST | `/archived-sessions/list` | List archived sessions (skips deleted / non-existent ones) |
| POST | `/archived-sessions/archive` | Archive (hide) a single session |
| POST | `/archived-sessions/archive-many` | Archive many |
| POST | `/archived-sessions/restore` | Unarchive a single session |
| POST | `/archived-sessions/restore-many` | Unarchive many |
| POST | `/archived-sessions/delete` | Permanently delete a single session (physically removes log, keeps hidden) |
| POST | `/archived-sessions/delete-many` | Permanently delete many |
| POST | `/archived-sessions/sessions` | List all sessions (with archived flag) for the Session Manager panel |
| POST | `/archived-sessions/workspaces` | List available target workspaces |
| POST | `/archived-sessions/move` | Move a session to a target workspace `{ sessionId, targetPath }` |
| POST | `/archived-sessions/details` | Session details (disk / stats / tools / fetch / files / lineage) `{ sessionId }` |

> On delete the session **stays archived** (is not unarchived), so it won't pop back into the sidebar / "ungrouped"; entries whose log is already gone are skipped.
> DSH has no official session-delete API; this plugin implements "physically remove log + detach ownership + keep hidden".

## Compatibility

- **Supported platforms**: cross-platform (macOS / Windows / Linux) — wherever DSH runs the plugin runs; the host half is Node (about `^22.19` or `>=24`) and the client is React, with no OS-specific APIs.
- Works in both DSH Desktop and DSH web (same host + client halves).
- Peer dependencies are listed in `package.json`; `react` and `@deepseek-ai/*` are provided by the DSH runtime.

## License

[MIT](./LICENSE) © TOBYCAI
