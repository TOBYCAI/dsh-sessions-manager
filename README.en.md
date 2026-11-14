# dsh-sessions-manager

> [中文](./README.md) | English

![GitHub stars](https://img.shields.io/github/stars/TOBYCAI/dsh-sessions-manager?style=flat-square&color=facc15)
![Downloads](https://img.shields.io/github/downloads/TOBYCAI/dsh-sessions-manager/total?style=flat-square&color=14b8a6)
![License](https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square)
![daily compat](https://img.shields.io/github/actions/workflow/status/TOBYCAI/dsh-sessions-manager/compat.yml?branch=main&label=daily-compat&style=flat-square)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d6bfe?style=flat-square)

DSH gives you exactly one way to close out a session: archive it. You can't delete one, can't move it to another workspace, can't tell which session spawned which, and have no idea which forgotten conversation is sitting on a few hundred megabytes of disk.

This plugin fills those gaps. A new panel under Settings, three extra items in the sidebar's session ⋯ menu. Deletes land in a recycle bin first, so a wrong click is recoverable. Moving a session across workspaces no longer means starting a new conversation. Subagents and forks become visible, and empty sessions can be cleaned up in bulk. Reads and writes go through DSH's official surface. The host isn't forked or patched.

## Install

```sh
dsh plugin --profile desktop add dsh-sessions-manager
```

Restart DSH afterwards. Settings → 会话管理 and the sidebar's session ⋯ menu are there.

Two other ways in:

```sh
# track the latest commit on main
dsh plugin --profile desktop add "github:TOBYCAI/dsh-sessions-manager"

# working on the source locally (clone, then link)
git clone https://github.com/TOBYCAI/dsh-sessions-manager.git
dsh plugin --profile desktop add link:/path/to/dsh-sessions-manager
```

On `dsh web` too? Run the same thing with `--profile web`.

To remove it: `dsh plugin --profile desktop remove dsh-sessions-manager`. No session log is touched. Sessions deleted through this plugin still sit in DSH's Archived section and can be restored from there.

## What you get

| Where | What's added |
|---|---|
| Sidebar session ⋯ menu | Mark unread, move session, delete session |
| Sidebar parent rows | "▸ N 子代理" folding, a green "⑂ 分支" badge |
| Settings → 会话管理 | Every session, with search, filters, details and batch actions |
| Same panel → Recycle bin | Deleted sessions, restorable or purgeable |

## Sidebar

### The ⋯ menu

Three items, slotted between DSH's own by risk. Pin, rename, fork, copy Session ID and archive stay exactly as they were.

- **Mark unread** (top). The status dot turns blue, and the mark clears itself when you open the session. The blue dot is clickable too, and clicking it clears the mark.
- **Move session** (below Archive). A workspace list opens to the right; pick one and it moves. The workspace it's already in is labeled "当前" and can't be picked.
- **Delete session** (bottom, in red). Goes to the recycle bin, not an immediate physical delete.

Since `0.2.2` the host renders this menu in a portal, so walking up the DOM no longer reaches the session row. The plugin registers through the official `ctx.contextMenus.register({ target: 'session' })` instead. The session id is handed over by the host, and nothing depends on DOM shape. On `0.1.7` through `0.2.1`, where that service doesn't exist, it falls back to DOM injection.

### Dragging to another workspace

Besides the menu, you can drag a session row onto a workspace heading and drop it there. The target highlights, dropping it back where it came from is refused, and failures report themselves.

Hold the drag near the top or bottom edge of the sidebar list and it scrolls. It speeds up the closer you get and stops at either end, which puts a workspace heading outside the viewport within reach.

### Subagents and branches

DSH's sidebar deliberately doesn't render subagent rows. The plugin reads the official header fields (`origin: 'subagent'`, `parentSession`, `delegationDepth`) and injects those rows under their parent: a "▸ N 子代理" badge shows up when the parent row is selected or hovered, clicking it expands the indented children, clicking a child opens that subagent through the official API. Delete a subagent and the folded list shrinks with it.

Forked sessions carry a green "⑂ 分支" badge; hover to see which session they came from.

The sidebar only badges rows, it doesn't reorder them. Those rows are owned by the host's React tree, and rearranging things underneath it goes out of sync fast. For a grouped tree, use the settings panel.

### Titles on a cold start

Sidebar titles aren't read from logs on the spot. Since `0.2.2` they come from the runtime's persisted projection cache, which reads the header and nothing else, so a historical session you never opened still shows its title. A genuine miss renders blank first and fills in from a background queue; once it lands, rows already on screen and the "⑂ 分支" chip's tooltip update themselves without waiting for a rebuild. On older runtimes the plugin corrects the cache from the latest `session/title` in the log, so a rename shows up without opening the session either.

### Status dots

Running, waiting on you, finished-unread and errored: those four dots are still drawn by DSH's own `StateDot`. The plugin doesn't repaint them or cover them. It adds one state DSH doesn't have:

| Dot | State | Notes |
|---|---|---|
| 🔵 Blue | Manually marked unread | Set from the ⋯ menu; cleared when you open the session, or by clicking the dot |

The blue dot takes the same slot (the native dot steps aside for the moment) and the native dot is back the instant you clear the mark.

## Settings panel

### Browsing and search

Three views sit at the top permanently: All, Active, Archived. Starred, Empty and Recycle bin live behind an arrow at the end of the row and slide out sideways. The common ones stay out front; the rare ones stay out of the way. A low-frequency view stays expanded while it's selected.

Search matches title, session ID and workspace name. The workspace dropdown lists your real workspaces plus two special ones: "未分组" for sessions with no workspace, and "工作区已删" for sessions whose workspace directory is gone. Same meaning as the chips on the cards. Sort by creation time or title.

Above the list there's a single sentence telling you what you're looking at, like "Showing 5 sessions, 4 more subagents folded under their parents".

Under the filter row sits a strip of maintenance buttons: storage usage, tags, auto-archive. They only take up room once opened.

### Session details

Expand a session to see:

- disk usage
- turns, steps, user / assistant message counts, tool calls, image attachments
- tool-usage breakdown
- search and fetch records
- files touched by write / edit (paths that no longer exist on disk are filtered out)
- lineage: parent, children, subagents

Two export buttons at the bottom. "Download raw log (ZIP)" goes straight to the official `session.export` endpoint, subsessions and attachments included; the button hides itself when the backend doesn't support it. "Export Markdown" renders the session into something readable: front matter, per-turn sections, user / assistant / tool-call summaries, with streaming deltas deduplicated.

### Lineage grouping

The "Grouping" dropdown has two options:

- **Lineage** (default): subagents fold under their parent, sessions forked from the same source gather into a "▸ N 分支" group.
- **Flat**: same as native DSH. Subagents sit inline and can be selected one by one.

A few rules worth knowing while you're in lineage view:

- Branch groups are ordered by creation time, oldest first, and the source row stays where it was.
- When the parent is filtered out, archived or deleted, the group header degrades to "来源：<short id>" and no row is lost. So a "来源：" header showing up in the Active view is expected, not a bug.
- Subagents don't take top-level rows: they're left out of the All / Active / Archived / Empty counts and out of select-all.
- Subagents whose parent isn't in the current list collect into a "未归属的子代理会话" card at the end, collapsed by default and auto-expanded by a search hit. The list never fills up with rows of "(untitled)".

### Batch actions

Once anything is selected you can archive, restore, delete or move in bulk. Archiving takes sessions out of the sidebar; restoring puts them back into their original workspace group.

The action bar pins to the top of the panel, so a long list doesn't make you scroll back up.

Select-all only covers rows that render and can be checked individually. Folded subagents, gathered branch members and "来源：" headers are excluded, so you can't select something you can't see. Batch delete cascades to subagents and says how many it took along.

"Move selected…" reuses the single-move sheet: existing workspace, new directory, or the native directory picker. One failure doesn't block the rest, and each failure is reported on its own.

### Stars, tags, saved filters

Stars are the button that always sits on the left of a session row: click to star, click again to unstar. The UI updates first and rolls back if the write fails. Starred is its own view and stacks with active / archived, so an archived session can be starred.

Tags are for your own classification: up to 200 overall, 10 per session, renameable and mergeable. Deleting a tag removes the tag and its assignments, never the sessions.

"View + workspace + sort + tag" can be saved as a preset, up to 20, restored with one click.

All three live in plugin-owned indexes under this machine's DSH data directory. They don't follow your account and won't sync to another machine. Purge a session and its stars and tag assignments are cleaned up with it.

### Storage usage and auto-archive

**Storage usage** aggregates session-log disk usage per workspace with share bars and session counts, then lists the ten largest sessions. It is read-only, collapsed by default, and computed only when opened, so it never slows the list down.

**Auto-archive** can push sessions untouched for 30 / 60 / 90 days into Archived. Off by default. The session you're currently in and any starred session are never archived (the starred guard can be turned off). It only sets an archived flag and deletes nothing, so it's one click back. The check runs lazily when you open the panel, at most once a day, and there's a "Check now" button.

## Recycle bin

Deleting is a soft delete: the log stays in its original workspace directory and the recycle bin just records an index entry, with the pending count and deletion date shown in the list.

One side effect tends to surprise people: deleting also **writes the session into DSH's native archive**. That way, even with this plugin disabled or removed, those sessions don't reappear in the active list; they stay put under DSH's Archived. Restoring puts the pre-delete state back symmetrically.

What you can do in there:

- **Restore**: back to the original workspace.
- **Permanently delete**: physically remove the log.
- **Deleting a parent takes its subagents along**: the whole subtree moves in by default (subagent lifetime follows the parent), and the dialog lets you opt out. Restoring or purging the parent cascades the same way, so no parentless orphans are left behind. A subagent you deleted on its own is never re-adopted by its parent.
- **Empty the bin**: everything at once. Retention is forever by default, or 7 / 30 / 90 days, and there's a log-integrity check.

Both actions verify that the file is really on disk first. If the recorded path disagrees with the generation actually present, it's corrected from disk; if the target really is gone, or a file survives the unlink, you get an explicit error and **the entry stays**. No "success" while the file is still there.

The bin index is a versioned schema with serialized, atomic writes; older array indexes migrate automatically. A permanent delete writes a tombstone first, waits for the live Session and the persistence controller to retire, removes the log and rebuilds the workspace index. A reconnect, or a host still holding a stale index, can't bring it back or spawn an empty "未分组".

## Two things that aren't obvious

### Moving a session that's currently open

Every session log has a single-writer lock. The moment a session is opened, even by selecting it, the agent loop owns its write handle. The host exposes no "close session" action, and that ownership is released only when the DSH process exits. Switching away doesn't release it. Waiting doesn't either.

Forcing the move at that point is dangerous: the live writer keeps appending to the old file and re-creates a shell at the old path.

So held-open sessions get queued instead:

- The request doesn't fail. The session goes into a queue (`~/.dsh/sessions-manager/pending-moves.json`) and the UI says "queued", which is the truth.
- The plugin retries densely right after startup (0, 1, 3, 6, 12, 30 s), because it has to win the race against the browser opening those sessions. After that it falls back to every 2 minutes, and fires whenever the host releases a session.
- Up to 50 entries. An entry that fails five times for **non-lock** reasons is dropped and logged; failures within the first 30 s after startup don't count, so a startup race can't quietly eat your queue.
- While the queue isn't empty, the panel shows a "待移动队列" section where you can cancel entries one by one.
- A background completion or a final give-up becomes a notice, surfaced as a toast the next time a DSH page opens (give-ups carry the reason). Notices stay on the server until acknowledged, up to 20 of them and at most 7 days, so closing the page early doesn't lose one.

To get one moved: request the move (it queues), restart DSH, and **don't open that session first**. It completes a few seconds after startup. Unfinished entries survive restarts.

### What counts as an empty session

Since `0.1.3` the log header grew, and creating a session always writes a lifecycle-metadata frame first, so guessing "does it have content" from size no longer works. The plugin looks at event types instead: candidates go through official decoding, and a session is empty only when there is no content event beyond the header. Decode failures count as non-empty, on the principle that keeping one extra beats deleting something real.

One case deserves its own paragraph: **plugin-injected context doesn't count as content**. If an `agent/inbox/spliced` event only inserts messages whose `source.kind` starts with `plugin:` or whose `form` is `'instructions'`, and removed nothing, the session is still empty. Real user messages, and payloads it can't identify, still count.

The check stays off the data path: sidebar data answers on the first tick, emptiness starts as "unknown" (unknown is neither hidden nor counted), a small background queue decides, verdicts persist across restarts, and later ticks converge.

The plugin hides empty rows in the sidebar, but **the current session is never hidden**. A conversation you just created has to be visible. Upstream filters only the rows it already knows are blank and that aren't the current one; for cold sessions with no projection-cache record it treats them as unknown, i.e. non-empty, and this plugin covers the rest. Managing them lives in the panel's Empty view.

## Screenshots

<details>
<summary>Expand for screenshots (sidebar menu / sidebar subagent folding / settings panel / batch move / empty view / auto-archive / storage usage / starred / recycle bin / session details)</summary>

![Sidebar ⋯ menu: mark unread, move session, delete session](assets/screenshot-session-submenu.png)

![Sidebar subagent folding ("▸ N 子代理" badge + in-place expansion) and the "⑂ 分支" branch badge](assets/screenshot-session-subagent.png)

![Settings panel "Session Manager" (lineage grouping / empty view / collapsed filters)](assets/screenshot-session-settings.png)

![Batch move sheet and the sticky batch action bar](assets/screenshot-session-multimove.png)

![Empty-sessions view (event-type detection)](assets/screenshot-session-empty.png)

![Auto-archive panel (inline sheet in the maintenance bar)](assets/screenshot-session-autoarch.png)

![Storage analysis (inline sheet in the maintenance bar)](assets/screenshot-session-storage.png)

![Starred (favorites) view](assets/screenshot-session-starred.png)

![Recycle bin](assets/screenshot-session-trash.png)

![Session details: disk usage / stats / tool usage](assets/screenshot-session-details.png)

</details>

## Known limitations

- **An open session can't be moved without a restart.** Upstream doesn't release write ownership, so it queues until the process exits.
- **Rolling the runtime back makes recently opened sessions unreadable.** Log migration is one-way: once a session has been opened on a newer runtime, an older one has no decoder for it. Back up `~/.dsh/sessions` before a rollback. Migration keeps the original files, so a session directory legitimately holds `session.jsonl.zstd` next to a higher-generation `session.vN.jsonl.zstd`; the plugin reads the highest generation actually on disk.
- **Corrupted old logs can't be repaired.** The runtime migrates supported old logs only, and refuses unknown events or damaged data without repairing anything. Those sessions surface as `SessionFormatUnsupportedMigrationError` or `SessionFormatError`. The plugin has no repair path and reports what it sees.
- **The sidebar doesn't reorder.** Subagent rows are injected, not sorted into a new tree. See above.
- **Empty detection leans conservative.** Decode failures count as non-empty, which is deliberate, so the Empty view may miss a few genuinely empty sessions.
- **Deleting also writes DSH's native archive.** It's what keeps DSH's own ledger in agreement and stops sessions from coming back after you uninstall. If you want one gone for good, purge it from the recycle bin.
- **Stars, tags and presets are per machine.** They live in the local DSH data directory and don't sync to your account.
- **Older runtimes expose less.** On `0.1.5` and earlier only operations that can be verified safely are enabled; the rest are marked in the panel with a reason.

## Compatibility

Works on DSH Desktop and `dsh web` with the same host + client, and on macOS / Windows / Linux, anywhere DSH runs. The host is built as Node ESM targeting `node22`, the browser half is React, and neither depends on OS-specific APIs.

| Runtime | Status | What this version did |
|---|---|---|
| `0.2.2-rc.3` | verified | Left-nav icon uses the official `settings.section.icon` slot; menu resolution is synchronous with a pre-warmed snapshot (rc.3 gives async `resolve` a 1 s budget); duplicate registration guarded (rc.3 throws on the same id twice); design tokens moved to current names; blank detection covers the 0.2.2 state events; cold titles come from the official persisted projection cache (`sessionProjectionCache`, zero I/O), whose `blank` is used as a one-way pre-filter, and blank sidebar rows now match upstream by hiding everything except the current session |
| `0.2.2-rc.1` | verified | Session menu moved to the official `contextMenus` data registration; delete also writes the native archive flag; `inject` keeps only packages that really exist |
| `0.2.1-rc.2` | verified | Session format still v4; persistence became a cordis plugin (both shapes mount); sidebar wraps rows, folded counts calibrated from `sessionCount`; the empty-group container is the role-less `groupSection` |
| `0.2.0-rc.1` / `rc.2` | verified | `ctx.sessions` became a data-stream service, opening a session goes through `uiWorkspace.openSession`; peer ranges widened to `>=0.1.0-rc.6`; the active session is reported by the client heartbeat |
| `0.1.7-rc.2` | verified | Session format v4, format catalog split into its own package; moves re-sample the header against the backend format |
| `0.1.5` / `0.1.3` / `0.1.2` | verified | Older runtimes only enable operations that can be verified safely |

Unverified future runtimes get only the safely recognisable subset. The panel's own messages and the `/archived-sessions/capabilities` payload are what count, not whether a method happens to exist.

<details>
<summary>What's reduced on old runtimes, and where the workarounds sit</summary>

- **Restoring from the bin** first confirms the underlying session still exists (live / `stat` / list, three levels). Gone returns `DSM_SESSION_MISSING`, already purged returns `DSM_SESSION_PURGED`, index present but log vanished returns `DSM_SESSION_LOG_MISSING`; when the location can't be verified it says `unverified` rather than pretending. Restoring into a deleted workspace succeeds and notes that the session is temporarily ungrouped.
- **Permanent delete / empty bin / automatic purge**: the official contract has no delete API, so this keeps the legacy half-official route: three guarded derivations from the backend instance's storage root (root → session-directory layout → session-id ownership check), then the directory is removed and re-checked with the official `stat`. Sessions with active writes are refused (409). If derivation fails (say the storage root can't be established) the capability is disabled with a reason rather than deleting blind. Sibling generations in the same directory go too, otherwise DSH falls back to an older one and the delete accomplishes nothing.
- **Cross-workspace moves** primarily replay official `create` + `append` events: a write-ownership probe refuses sessions DSH holds for writing, revision checks bracket the write, and a backup rollback guarantees no half-moved state. When the backend carries a same-id ghost record, it falls back to rewriting the frame-0 cwd, verifying frame count and content byte for byte. Paths come from the same guarded derivation, and the workspace group index is rebuilt after the move, so no restart is needed. Because the runtime enforces "one project directory per session id", a move relocates the whole directory: the source is moved aside first (invisible to official scanning), the target is replayed and verified, and only then is the source removed. Superseded generations left in other project directories are reclaimed along the way, so a session never gets stuck as a cross-directory duplicate that can be neither moved nor deleted.
- **Purge tombstones don't suppress new sessions.** If a session with the same id is created again, the tombstone steps aside and the new one shows up normally.
- **Metadata caching**: change detection uses the official snapshot `revision` on newer runtimes (comparable within one process only, never written to a cross-restart cache file) and a `(mtime, size)` fingerprint on older ones. List cwd and creation time come straight from the snapshot header without reading the log; titles aren't read at page load either: a missing title renders blank and arrives from a background queue. A read failure and "this session truly has no title" are kept strictly apart: a failure writes no cache and is retried later (immediately once that log changes), so one transient failure never leaves a session stuck at "(untitled)".
- **Auto-archive** finds no reliable "last active" signal on newer runtimes, so when idleness can't be proven the check is skipped (`no-activity-data`) instead of guessing.
- **Sidebar injection** keeps DOM / React-fiber recognition inside a versionable adapter. When the upstream sidebar shape isn't recognised the whole augmentation disables safely and the official sidebar is untouched. When it is recognised, it runs mostly on incremental MutationObserver updates with a low-frequency fallback sweep.

</details>

## Development

`lib/` is prebuilt, so a clone works as-is without esbuild. To change the source:

```sh
npm i -D esbuild
npm run build       # regenerate lib/
npm run check:dist  # rebuild and diff against the committed artefacts (CI runs this too)
npm test
```

Always rebuild when you bump the version. The build stamp is a reproducible `vX.Y.Z+source-hash`, which is what makes that diff meaningful.

<details>
<summary>Source layout</summary>

```
package.json        npm metadata + dsh.bundle.patch + dsh.client (browser-half registration)
cordis.patch.yml    inserts this plugin's row into the profile bundle
build.mjs           esbuild build script (emits lib/, reproducible build stamp)
lib/index.js        prebuilt host (ESM)
lib/client.js       prebuilt client (ModuleLoader CJS handshake)

src/index.js               host entry: /archived-sessions/* routes, archive / recycle-bin / move orchestration
src/compat/capabilities.js capability probe (decides which operations a persistence generation allows)
src/compat/persistence.js  persistence adapter: stat the official locate() result first, derive from disk otherwise
src/handle-era-ops.js      SessionHandle-era operations (archive / move / permanent delete)
src/handle-era-paths.js    guarded path derivation (root → directory layout → session-id ownership → highest generation)
src/path-guard.js          log-path ownership checks (pure)
src/active-session.js      active-session reporting (per-clientId buckets + 45s TTL)
src/pending-moves.js       queued-move store (survives restarts, retry schedule)
src/move-notices.js        retention and acknowledgement of queued-move outcome notices
src/auto-archive.js        auto-archive settings (schema v4) + the pure candidate rule
src/storage-stats.js       storage usage aggregation (pure)
src/lineage.js             lineage classification and empty-session detection (event-type method)
src/projection-hints.js    cold reader for the official projection cache (title / blank hints, zero I/O)
src/empty-scan-index.js    on-disk cache of empty-session verdicts (fingerprint + TTL gates)
src/star-index.js          starred-session index (schema v3)
src/tag-index.js           tag index (schema v4)
src/saved-filters.js       saved filter presets (schema v1)
src/title-persist-index.js small on-disk index of titles / metadata
src/session-meta-cache.js  in-memory session metadata cache (validated by log-content fingerprint)
src/markdown.js            session → human-readable Markdown
src/zstd-frame.js          zstd multi-frame scanning and rewriting
src/state-temp-sweep.js    sweeps stale temp files left by atomic writes

src/client/index.jsx       client entry: settings panel, sidebar augmentation, official slot / contextMenus registration
src/client/logic.js        unit-tested pure logic (folding, counting, filtering, drag step, …)
```

</details>

<details>
<summary>Host routes</summary>

| Method | Path | Description |
|---|---|---|
| POST | `/archived-sessions/sessions` | List every session (with archived flags) for the Session Manager panel |
| POST | `/archived-sessions/list` | List archived sessions (skipping deleted / missing ones) |
| POST | `/archived-sessions/archive` | Archive (hide) a single session |
| POST | `/archived-sessions/archive-many` | Batch archive |
| POST | `/archived-sessions/restore` | Unarchive one session |
| POST | `/archived-sessions/restore-many` | Batch unarchive |
| POST | `/archived-sessions/delete` | Delete one session **into the recycle bin** (not an immediate physical delete) and into DSH's native archive; cascades the whole subagent subtree by default (`cascadeSubagents: false` keeps them), returning `cascaded` / `cascadedIds` |
| POST | `/archived-sessions/delete-many` | Batch move to the recycle bin (cascades subagents, returns the total `cascaded`) |
| POST | `/archived-sessions/trash/list` | List sessions in the recycle bin |
| POST | `/archived-sessions/trash/restore` | Restore from the recycle bin (also restores the subagents that were carried along, returns `cascaded`) |
| POST | `/archived-sessions/trash/purge` | Permanently delete one recycle-bin session (cascades the same way, returns `cascaded`) |
| POST | `/archived-sessions/trash/purge-many` | Empty / batch-purge recycle-bin sessions (cascades by parent) |
| POST | `/archived-sessions/trash/settings` | Read or update the retention policy `{ retentionDays }` (0 / 7 / 30 / 90) |
| POST | `/archived-sessions/trash/verify` | Verify that recycle-bin logs still exist |
| POST | `/archived-sessions/workspaces` | List candidate target workspaces |
| POST | `/archived-sessions/move` | Move a session to a target workspace `{ sessionId, targetPath }`; returns `{ queued: true }` and enqueues when DSH holds the session open |
| POST | `/archived-sessions/move-many` | Batch cross-workspace move `{ sessionIds, targetPath }`. One failure never blocks the rest, failures are reported per session, held-open sessions land in `queued`, and indexes are rebuilt once at the end |
| POST | `/archived-sessions/pending-moves` | Inspect the pending-move queue (held-open sessions are queued and complete on release) |
| POST | `/archived-sessions/pending-moves/cancel` | Cancel queued moves `{ sessionIds }` |
| POST | `/archived-sessions/pending-moves/notices/ack` | Acknowledge queued-move outcome notices (cleared after display; unacknowledged items are kept up to 7 days) |
| POST | `/archived-sessions/details` | Session details (disk / stats / tools / fetch / files / lineage) `{ sessionId }` |
| POST | `/archived-sessions/sidebar-state` | Authoritative titles, recycle-bin ids, purge tombstones, **lineage classification** (subagent / branch / empty flags), `warmPending` / `refinePending` (whether the title-warmup and empty-detection queues are still in flight), and `moveNotices` (queued-move outcomes; omitted when empty) |
| POST | `/archived-sessions/lineage-tree` | Recursive subagent tree (data source for panel grouping and sidebar folding), already filtered against the recycle bin and tombstones |
| POST | `/archived-sessions/star/set` | Star / unstar `{ sessionId or sessionIds, starred }` |
| POST | `/archived-sessions/tags/list` | Tag definitions + session→tag assignments `{ tags, assignments }` |
| POST | `/archived-sessions/tags/create` | Create a tag `{ name }` (rejects duplicates / over 200, error carries a code) |
| POST | `/archived-sessions/tags/rename` | Rename `{ id, name }` (id is stable) |
| POST | `/archived-sessions/tags/merge` | Merge into another tag `{ fromId, toId }` (deduplicated; the source tag disappears) |
| POST | `/archived-sessions/tags/delete` | Delete a tag `{ id }` (definition and assignments only, never the sessions) |
| POST | `/archived-sessions/tags/set` | Replace a session's tags `{ sessionId, tagIds }` |
| POST | `/archived-sessions/filters/list` / `save` / `delete` | Saved filter presets `{ name, filters }` (≤20; `filters` is an opaque payload) |
| GET | `/archived-sessions/export-md?sessionId=` | Single-session Markdown export (human-readable transcript) |
| POST | `/archived-sessions/storage` | Storage aggregation (per-workspace ranking + largest sessions) `{ topN }` |
| POST | `/archived-sessions/auto-archive/settings` | Read or update the auto-archive policy `{ inactiveDays, skipStarred }`; reading lazily triggers the daily check |
| POST | `/archived-sessions/auto-archive/run` | Run the auto-archive check once, ignoring the daily throttle |
| POST | `/archived-sessions/capabilities` | Current persistence generation, read / archive / recycle-bin / purge / cross-workspace-move capabilities, plus two client echoes: `clientMenu: { mode, at }` (menu channel, `contextMenus` or `dom`) and `clientUi: { navSection, navIcons, navOwn, navFallback, navIconRenders, sessionRows, workspaceRows, overflowRows, stateDots, tokenBgLayer2, tokenWarn, at }` (UI self-evidence: counts and resolved token values only, never titles or message bodies) |

</details>

## License

[MIT](./LICENSE) © TOBYCAI
