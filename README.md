# 🏛️ opencode-mempalace

> **Enhanced fork** — adds opt-in curated OpenCode session sync, project-strict discovery, secret redaction, and hardened state handling on top of the original plugin.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Built%20with-Bun-black?logo=bun)](https://bun.sh)

OpenCode plugin integrating [MemPalace](https://github.com/MemPalace/mempalace) lifetime memory system. Unlike other memory solutions, this provides **true project-scoped memory** with automatic context injection, background mining, and seamless MCP integration.

---

## ✨ Why This Plugin?

| Feature | opencode-mempalace | Other Solutions |
|---------|-------------------|-----------------|
| **Project-scoped memory** | ✅ Automatic per-workspace | ❌ Global only |
| **Auto-initialization** | ✅ Palace auto-created | ❌ Manual setup |
| **Context injection** | ✅ wakeUp() loads L0+L1 memory | ❌ Manual tool calls |
| **Background mining** | ✅ Idle/threshold hooks, plus legacy exit trigger | ❌ None or manual |
| **MCP Tools** | ✅ 19 native tools | ❌ CLI only |
| **Auto-update** | ✅ Built-in | ❌ Manual |
| **Curated session sync** | ✅ Manual preview/ingest or opt-in auto-sync | ❌ Not available |

---

## 🚀 Quick Start

```bash
# 1. Install mempalace CLI globally
pip install mempalace

# 2. Clone this fork
git clone https://github.com/alexzendermarunsai/opencode-mempalace-enhanced
cd opencode-mempalace-enhanced

# 3. Build
bun install
bun run build

# 4. Add the built plugin to OpenCode config
# Edit ~/.config/opencode/opencode.jsonc
{
  "plugin": [
    ["/absolute/path/to/opencode-mempalace-enhanced/dist/index.js", {
      "disableAutoUpdate": true,
      "sessionSync": {
        "enabled": true,
        // Optional: replace legacy threshold/idle/delete mining hooks with curated sync.
        // "autoSync": true
      }
    }]
  ]
}

# 5. Restart OpenCode
```

> Fork of [nguyentamdat/opencode-mempalace](https://github.com/nguyentamdat/opencode-mempalace) with curated session sync, project-strict discovery, secret redaction, and hardened state handling.
>
> If you already have MemPalace MCP configured manually in your OpenCode config, add `"disableMcp": true` to avoid duplicate registration.

---

## 🎯 Key Features

### 1. **Project-Scoped Memory (Wings)**

Each workspace gets its own isolated memory "wing":
```
~/projects/web-app      → wing_web-app
~/projects/api-service  → wing_api-service  
~/projects/mobile-app   → wing_mobile-app
```

Memories never leak between projects. Context is automatically loaded when you switch workspaces.

### 2. **Zero-Config Auto-Initialization**

First time opening a project? The plugin automatically:
- Detects if palace exists
- Initializes it in background if needed
- Loads existing context via `wakeUp()`
- Starts tracking for mining

### 3. **Smart Context Injection**

```
[Session Start] → injects PALACE_PROTOCOL + wakeUp() memory
[Message 2+]    → continues with context aware of previous work  
[Compaction]    → rescues critical memory before context loss
```

### 4. **Background Auto-Mining**

Your conversations are automatically saved:
- **Message threshold**: Every 15 messages (configurable)
- **Session idle**: When you stop chatting
- **Session deleted**: Cleanup trigger
- **Process exit**: Emergency sync save on Ctrl+C for legacy live mining only

### 5. **19 Native MCP Tools**

Full MemPalace integration without CLI:

| Tool | Description |
|---|---|
| `mempalace_status` | Palace overview |
| `mempalace_search` | Semantic memory search |
| `mempalace_kg_query` | Knowledge graph queries |
| `mempalace_diary_read/write` | Session journaling |
| `mempalace_add_drawer` | Store specific memories |
| ...and 14 more |

### 6. **Built-in Auto-Update**

Checks NPM registry on session start, auto-installs updates in background. Never miss improvements.

### 7. **Opt-In Curated Session Sync**

Live behavior stays the same unless you opt into curated auto-sync: MCP registration, PALACE protocol injection, wake-up context, compaction memory injection, diary check tooling, and auto-update notifications all continue to run as before.

Curated OpenCode session sync is disabled by default (`sessionSync.enabled: false`). When enabled, it provides manual preview/ingest tools. If you also set `sessionSync.autoSync: true`, threshold, idle, and deleted-session hooks use curated session sync instead of legacy `mempalace mine`.

---

## 📋 Configuration

### Minimal plugin config

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "plugin": ["/absolute/path/to/opencode-mempalace-enhanced/dist/index.js"]
}
```

### Enable curated session sync

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "plugin": [
    ["/absolute/path/to/opencode-mempalace-enhanced/dist/index.js", {
      "disableAutoUpdate": true,
      "sessionSync": {
        "enabled": true,
        "requirePreview": true,
        "discoveryMode": "auto",
        // Optional: replace legacy threshold/idle/delete mining hooks with curated sync.
        // "autoSync": true,
        // "autoSyncThreshold": 15,
        "limitSessions": 3,
        "limitCandidates": 50,
        "maxCandidateBytes": 4000,
        "projectWingStrategy": "plugin",
        "globalWing": "opencode_global"
      }
    }]
  ]
}
```

> Add `"disableMcp": true` if you already define MemPalace MCP manually in your config.

### Skill-compatible wing naming

Use this if you want curated session sync to write project memories with the same wing naming used by the MemPalace session-memory skill:

```jsonc
{
  "plugin": [
    ["/absolute/path/to/opencode-mempalace-enhanced/dist/index.js", {
      "disableAutoUpdate": true,
      "sessionSync": {
        "enabled": true,
        "projectWingStrategy": "skill"
      }
    }]
  ]
}
```

> Add `"disableMcp": true` if you already define MemPalace MCP manually.

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `mcpCommand` | `string[]` | `["python3", "-m", "mempalace.mcp_server"]` | Command to start the MCP server |
| `disableMcp` | `boolean` | `false` | Skip auto-registering MCP server |
| `disableProtocol` | `boolean` | `false` | Skip injecting PALACE_PROTOCOL |
| `disableAutoLoad` | `boolean` | `false` | Skip auto-loading context |
| `disableAutoUpdate` | `boolean` | `false` | Skip auto-update check |
| `palacePath` | `string` | `~/.mempalace/palace` | Override palace directory |
| `disableAutoMining` | `boolean` | `false` | Disable automatic mining/sync hooks. This disables both legacy automatic mining and curated auto-sync; manual curated sync tools remain available when `sessionSync.enabled` is `true`. |
| `threshold` | `number` | `15` | Messages before auto-mining |
| `sessionSync.enabled` | `boolean` | `false` | Enable curated OpenCode session sync preview/ingest tools; status is always available |
| `sessionSync.autoSync` | `boolean` | `false` | Use curated session sync for threshold, idle, and deleted-session hooks instead of legacy `mempalace mine` |
| `sessionSync.autoSyncThreshold` | `number` | unset | Optional message threshold for curated auto-sync. Falls back to `threshold` when unset. |
| `sessionSync.requirePreview` | `boolean` | `true` | Require ingest to use a previous preview result |
| `sessionSync.discoveryMode` | `"auto"` | `"auto"` | Discover OpenCode session files automatically |
| `sessionSync.limitSessions` | `number` | `3` | Maximum recent sessions to inspect during preview |
| `sessionSync.limitCandidates` | `number` | `50` | Maximum candidates returned by preview |
| `sessionSync.maxCandidateBytes` | `number` | `4000` | Maximum bytes stored per candidate preview |
| `sessionSync.maxJsonFileBytes` | `number` | `5000000` | Maximum JSON session file size read during fallback discovery |
| `sessionSync.maxMessagesPerSession` | `number` | `1000` | Maximum messages read from one session |
| `sessionSync.maxPartsPerMessage` | `number` | `200` | Maximum OpenCode text parts read from one message |
| `sessionSync.maxRawExchangeBytes` | `number` | `100000` | Maximum raw normalized exchange size before preview candidate construction |
| `sessionSync.projectWingStrategy` | `"plugin" | "skill" | "custom"` | `"plugin"` | Project wing naming: `plugin` → existing plugin-style `wing_<project-basename>` (for example `wing_opencode-mempalace`), `skill` → `opencode_mempalace`, `custom` → configured `projectWing` |
| `sessionSync.projectWing` | `string` | unset | Required only when `projectWingStrategy` is `custom` |
| `sessionSync.globalWing` | `string` | `"opencode_global"` | Wing for global/non-project session memories |

---

## 🔄 Live Mining vs Curated Session Sync

The plugin has three memory modes:

| Mode | Default | When it runs | What it does |
|---|---:|---|---|
| **Legacy live mining** | On | During the current OpenCode session through threshold, idle, deleted-session, process-exit, and compaction hooks | Keeps current project context fresh automatically using legacy `mempalace mine`. This remains the default automatic path. |
| **Manual curated sync** | Off | When `sessionSync.enabled` is `true` and you call the sync tools manually | Finds candidate memories from OpenCode sessions, shows a preview, and ingests confirmed candidates. Manual preview/ingest works independently from auto-sync state. |
| **Curated auto-sync** | Off | When `sessionSync.enabled` and `sessionSync.autoSync` are both `true` | Replaces legacy threshold, idle, and deleted-session mining hooks with curated session sync. It uses targeted discovery by `sessionId`, redaction/filtering/routing/idempotency, and writes drawers through `tool_add_drawer`. |

Set `disableAutoMining: true` to disable both legacy automatic mining and curated auto-sync. This does not disable manual curated sync tools.

### Curated sync workflow

1. Enable `sessionSync.enabled` in the plugin config.
2. Start OpenCode and run `mempalace_session_sync_status` to confirm availability and defaults.
3. Run `mempalace_session_sync_preview` with optional filters such as `sessionId` or lower limits. The tool uses the current OpenCode workspace as the project directory; wing names come from plugin config.
4. Inspect each candidate's content, target wing, target room, and routing reason.
5. Run `mempalace_session_sync_ingest` with the `previewId`, optional `candidateIds`, and `confirm: true`.
6. Rerun the same ingest request if needed; already-ingested candidates should report as skipped.

### Natural language triggers

You don't need to type tool names manually. Say any of these and the assistant will run the right tool:

| Say this | Runs |
|---|---|
| `show session sync status` | `mempalace_session_sync_status` |
| `preview session memories` | `mempalace_session_sync_preview` |
| `sync this session's memory` | preview → ingest |
| `ingest those candidates` | `mempalace_session_sync_ingest` |
| `remember this session` | preview → ingest |
| `save session highlights` | preview → ingest |
| `what's in the project memory` | `mempalace_session_sync_status` |

### Curated sync tool reference

`mempalace_session_sync_status` is always available. `sessionSync.enabled` enables the curated sync preview and ingest tools.

| Tool | Args | Notes |
|---|---|---|
| `mempalace_session_sync_status` | none | Shows whether curated sync is enabled and which defaults are active. |
| `mempalace_session_sync_preview` | `sessionId?`, `limitSessions?`, `limitCandidates?` | Discovers candidate memories from the current OpenCode workspace without writing them. Preview output is intentionally bounded by limits, redacts common secret patterns, and uses configured wings. |
| `mempalace_session_sync_ingest` | `previewId`, `candidateIds?`, `confirm: true` | Writes the selected preview candidates. `confirm` must be `true`. If `candidateIds` is omitted, ingest uses all candidates from the preview. |

### Limitations

- Curated auto-sync does not run from `process.on('exit')`. The exit handler intentionally skips legacy `mineSync` when auto-sync is enabled because curated sync is async and unsafe during process exit. Auto-sync relies on threshold, idle, and deleted-session hooks.
- Auto-sync does not bulk backfill historical sessions; it targets the active session hook by `sessionId`. Use manual preview/ingest for selected older sessions. The default manual limits inspect up to 3 sessions and 50 candidates.
- SQLite discovery is project-strict when a workspace is available; sessions from other directories are not used as fallback preview input.
- Real OpenCode session discovery is best-effort. OpenCode storage and session formats may vary, so discovery and normalization can miss or skip sessions.
- Preview output is bounded by `limitCandidates`, `maxCandidateBytes`, JSON/message/part caps, and raw exchange size; long or oversized inputs may be truncated or skipped with warnings.
- Common secret forms (Bearer tokens, GitHub/OpenAI/AWS keys, private keys, and env-style secret assignments) are redacted in preview content before ingest.
- Candidate routing is deterministic and does not use LLM classification.
- Curated auto-sync replaces the legacy threshold, idle, and deleted-session mining hooks only when `sessionSync.autoSync` is enabled.

---

## 🔄 Comparison with option-K/opencode-plugin-mempalace

This plugin is an **evolution** of the excellent [option-K/opencode-plugin-mempalace](https://github.com/option-K/opencode-plugin-mempalace), adding:

| Addition | Benefit |
|----------|---------|
| **MCP Server Integration** | 19 native tools vs CLI-only |
| **Auto-update mechanism** | Self-updating plugin |
| **Diary tracking** | Session journaling with reminders |
| **Bun ecosystem** | Faster builds, no execa dependency |
| **Security hardening** | Path validation, length limits |

**What we kept from the original:**
- ✅ 3-state initialization (empty/initializing/ready)
- ✅ wakeUp() with L0+L1 memory loading
- ✅ Background mining with StateManager
- ✅ Emergency exit handlers for legacy live mining; curated auto-sync intentionally has no process-exit flush
- ✅ Project-scoped wings
- ✅ AAAK compression support

---

## 🧪 Development

```bash
# Clone and setup
git clone https://github.com/alexzendermarunsai/opencode-mempalace-enhanced
cd opencode-mempalace-enhanced
bun install

# Build
bun run build

# Test
bun test

# Check types
bun run check
```

---

## 🙏 Credits & Shout Outs

- **[MemPalace/mempalace](https://github.com/MemPalace/mempalace)** — The MemPalace memory system architecture, AAAK dialect, and Python implementation. This plugin is just the OpenCode integration layer.

- **[option-K/opencode-plugin-mempalace](https://github.com/option-K/opencode-plugin-mempalace)** — The pioneering OpenCode plugin that established the patterns for wakeUp, background mining, and 3-state initialization. We ported and extended these concepts.

- **[OpenCode](https://opencode.ai)** — The AI terminal that makes plugins like this possible.

- **[Bun](https://bun.sh)** — The fast JavaScript runtime that powers our builds.

---

## 📄 License

MIT © [nguyentamdat](https://github.com/nguyentamdat)

---

<div align="center">

**⭐ Star this repo if you find it useful!**  
**🐛 Report issues** — **💡 Suggest features** — **🔧 Submit PRs**

</div>
