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
| **Background mining** | ✅ Threshold/idle/deleted hooks, plus legacy exit trigger | ❌ None or manual |
| **MCP Tools** | ✅ Auto-registers MemPalace MCP plus plugin helper tools | ❌ CLI only |
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

> Enhanced fork of [nguyentamdat/opencode-mempalace](https://github.com/nguyentamdat/opencode-mempalace) — thank you to the original author for the foundational plugin. This fork adds curated session sync, project-strict discovery, secret redaction, and hardened state handling.
>
> If you already have MemPalace MCP configured manually in your OpenCode config, add `"disableMcp": true` to avoid duplicate registration. Make sure that manual MCP config uses the same `MEMPALACE_PALACE_PATH` as your plugin `palacePath`/`palaceMode` if you need one consistent palace.
>
> Package metadata currently retains the upstream npm name/repository. Use the local `dist/index.js` path for this fork unless the metadata is updated for publishing.

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
- Detects if the configured palace exists (global `~/.mempalace/palace` by default)
- Initializes it in background if needed
- Loads existing context via `wakeUp()`
- Starts tracking for mining

### 3. **Smart Context Injection**

```
[Session Start] → injects PALACE_PROTOCOL + wakeUp() memory once per primary session
[Subagent Start] → injects a small hint to use MemPalace MCP tools instead of full context
[Message 2+]    → continues with context aware of previous work  
[Compaction]    → injects diary reminder + wakeUp memory before context loss
```

By default (`wakeUpScope: "primary-session"`), full wake-up memory is only loaded for primary agent sessions. Subagent sessions receive a short hint and can pull memory on demand via MemPalace MCP tools.

The wake-up injection guard persists per OpenCode `sessionID`, so reopening an existing session after an OpenCode or plugin restart does not add another `[SYSTEM — MemPalace Context Load]` block. The guard stores only session metadata in `~/.mempalace/opencode-mempalace/state.json`, not memory content or transcript text.

### 4. **Background Auto-Mining**

Your conversations are automatically saved:
- **Message threshold**: Every 15 messages (configurable)
- **Session idle**: When you stop chatting
- **Session deleted**: Cleanup trigger
- **Process exit**: Emergency sync save on Ctrl+C for legacy live mining only

### 5. **MCP and Plugin Helper Tools**

By default, the plugin auto-registers the external MemPalace Python MCP server. The available MemPalace tool set depends on the installed MemPalace version.

This fork also adds plugin-native helper tools:

| Tool | Description |
|---|---|
| `mempalace_check_diary` | Check whether a session diary entry has been written |
| `mempalace_session_sync_status` | Show curated session sync status; always available |
| `mempalace_session_sync_preview` | Preview curated OpenCode session memory candidates; available when `sessionSync.enabled` is `true` |
| `mempalace_session_sync_ingest` | Ingest confirmed preview candidates; available when `sessionSync.enabled` is `true` |

### 6. **Built-in Auto-Update**

Checks the NPM registry on session start and can auto-install updates in the background on a best-effort basis.

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
      // Optional: use "once-per-process" to restore the previous in-memory guard.
      // "wakeUpInjection": "once-per-session",
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

### Use a specific MemPalace CLI and palace path

By default, all plugin-managed MemPalace operations use the global palace at `~/.mempalace/palace`. Set `palaceMode: "workspace"` to use `<workspace>/.mempalace/palace` instead. Set `palacePath` when you need an explicit path; it has priority over `palaceMode`.

If MemPalace is installed in a virtualenv, configure the plugin-level CLI command used for live `status`, `wake-up`, `mine`, and `init` calls. The resolved palace path is also passed to the auto-registered MCP server and curated session-sync writer.

Use your real absolute paths here. The plugin does not expand shell variables such as `$HOME` inside JSON config values.

```jsonc
{
  "plugin": [
    ["/absolute/path/to/opencode-mempalace-enhanced/dist/index.js", {
      "disableAutoUpdate": true,
      "cliCommand": ["/absolute/path/to/.venvs/mempalace/bin/python", "-m", "mempalace"],
      "palacePath": "/absolute/path/to/.mempalace/palace"
    }]
  ]
}
```

Do not confuse these command options:

- `cliCommand`: plugin-level MemPalace CLI prefix for live memory operations (`status`, `wake-up`, `mine`, `init`).
- `mcpCommand`: plugin-level command for starting the MemPalace MCP server.
- `sessionSync.cliCommand`: curated session-sync discovery command for finding OpenCode sessions; it is not used to run the MemPalace CLI.

### Optional global identity

MemPalace can include L0 identity context from `~/.mempalace/identity.txt`. This file is optional, global, and personal; it is not project-scoped, and the plugin does not auto-create it. Project memory, live mining, manual curated sync, and curated auto-sync all work without it.

If you want identity context in wake-up output, create the file manually and keep it high-level:

```text
# ~/.mempalace/identity.txt
# Name: <what assistants should call you>
# Working style: <brief collaboration preferences>
# Global preferences: <stable preferences that apply across projects>
# Privacy boundaries: <what should not be assumed, stored, or repeated>
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `mcpCommand` | `string[]` | `["python3", "-m", "mempalace.mcp_server"]` | Command to start the MCP server |
| `cliCommand` | `string[]` | fallback chain: `mempalace`, `python3 -m mempalace`, `python -m mempalace` | Command prefix for the MemPalace CLI used by live `status`, `wake-up`, `mine`, and `init` calls. Use a real absolute path when pointing at a virtualenv, for example `["/absolute/path/to/.venvs/mempalace/bin/python", "-m", "mempalace"]`. |
| `disableMcp` | `boolean` | `false` | Skip auto-registering MCP server |
| `disableProtocol` | `boolean` | `false` | Skip injecting PALACE_PROTOCOL |
| `disableAutoLoad` | `boolean` | `false` | Skip auto-loading context |
| `wakeUpInjection` | `"once-per-session" \| "once-per-process"` | `"once-per-session"` | Controls duplicate wake-up context injection. `once-per-session` persists a small guard record per OpenCode `sessionID` so reopened sessions do not get duplicate `[SYSTEM — MemPalace Context Load]` blocks after restart. `once-per-process` keeps the previous process-local behavior. |
| `wakeUpScope` | `"primary-session" \| "all-sessions" \| "none"` | `"primary-session"` | Controls which sessions receive full `wakeUp()` memory context. `primary-session` loads context only for primary (built-in) agents; subagents get a small hint to use MemPalace MCP tools instead. `all-sessions` restores previous behavior (all sessions get full wake-up). `none` disables wake-up injection entirely (same as `disableAutoLoad`). |
| `disableAutoUpdate` | `boolean` | `false` | Skip auto-update check |
| `palaceMode` | `"global" \| "workspace"` | `"global"` | Select the default palace directory when `palacePath` is unset. `global` resolves to `~/.mempalace/palace`; `workspace` resolves to `<workspace>/.mempalace/palace`. |
| `palacePath` | `string` | unset | Highest-priority palace directory override. When unset, the plugin uses `palaceMode`. The resolved path is passed to live CLI calls, auto-registered MCP config, and curated session-sync ingest. |
| `disableAutoMining` | `boolean` | `false` | Disable automatic mining/sync hooks. This disables both legacy automatic mining and curated auto-sync; manual curated sync tools remain available when `sessionSync.enabled` is `true`. |
| `threshold` | `number` | `15` | Messages before legacy auto-mining; also used as the curated auto-sync fallback when `sessionSync.autoSyncThreshold` is unset |
| `sessionSync.enabled` | `boolean` | `false` | Enable curated OpenCode session sync preview/ingest tools; status is always available |
| `sessionSync.autoSync` | `boolean` | `false` | Use curated session sync for threshold, idle, and deleted-session hooks instead of legacy `mempalace mine` |
| `sessionSync.autoSyncThreshold` | `number` | unset | Optional message threshold for curated auto-sync. Falls back to `threshold` when unset. |
| `sessionSync.requirePreview` | `boolean` | `true` | Require ingest to use a previous preview result |
| `sessionSync.discoveryMode` | `"auto" \| "cli" \| "sqlite"` | `"auto"` | Choose automatic discovery, configured CLI discovery, or SQLite discovery |
| `sessionSync.limitSessions` | `number` | `3` | Maximum recent sessions to inspect during preview |
| `sessionSync.limitCandidates` | `number` | `50` | Maximum candidates returned by preview |
| `sessionSync.maxCandidateBytes` | `number` | `4000` | Maximum bytes stored per candidate preview |
| `sessionSync.maxJsonFileBytes` | `number` | `5000000` | Maximum JSON session file size read during fallback discovery |
| `sessionSync.maxMessagesPerSession` | `number` | `1000` | Maximum messages read from one session |
| `sessionSync.maxPartsPerMessage` | `number` | `200` | Maximum OpenCode text parts read from one message |
| `sessionSync.maxRawExchangeBytes` | `number` | `100000` | Maximum raw normalized exchange size before preview candidate construction |
| `sessionSync.projectWingStrategy` | `"plugin" \| "skill" \| "custom"` | `"plugin"` | Project wing naming: `plugin` → existing plugin-style `wing_<project-basename>` (for example `wing_opencode-mempalace`), `skill` → `opencode_mempalace`, `custom` → configured `projectWing` |
| `sessionSync.projectWing` | `string` | unset | Required only when `projectWingStrategy` is `custom` |
| `sessionSync.globalWing` | `string` | `"opencode_global"` | Wing for global/non-project session memories |
| `sessionSync.statePath` | `string` | `~/.mempalace/opencode-session-sync/state.json` | Override the curated sync state file path |
| `sessionSync.cliCommand` | `string[]` | unset | Command used for curated session `cli` discovery, or as an `auto` fallback when configured. This is separate from plugin-level `cliCommand`. |
| `sessionSync.sqlitePath` | `string` | unset | Override the OpenCode SQLite database path; `auto` uses the default OpenCode database path when unset |
| `sessionSync.palacePath` | `string` | unset | (Backward-compat only.) Always overridden by the plugin-level resolved palace path. Use top-level `palacePath` or `palaceMode` instead. |

Wake-up injection guard state is stored at `~/.mempalace/opencode-mempalace/state.json`. It contains only the OpenCode session ID key, injection status (`loaded`, `empty`, or `initializing`), and `injectedAt`. Records marked `loaded` or `empty` suppress future injection for that session; `initializing` records allow retry after restart. The file is pruned to at most 1000 records and records no older than 90 days.

---

## 🔄 Live Mining vs Curated Session Sync

The plugin has three memory modes:

| Mode | Default | When it runs | What it does |
|---|---:|---|---|
| **Legacy live mining** | On | During the current OpenCode session through threshold, idle, deleted-session, and process-exit hooks | Keeps current project context fresh automatically using legacy `mempalace mine`. This remains the default automatic path. |
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

### Example prompts

Depending on the assistant and tool-routing setup, prompts like these may map to the related tools:

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

`mempalace_session_sync_status` is always available. It reports `mode` (`disabled`, `manual`, or `curated-auto-sync`), `autoSync`, the effective `palacePath`, and the configured `autoSyncThreshold` when set. `sessionSync.enabled` enables the curated sync preview and ingest tools.

| Tool | Args | Notes |
|---|---|---|
| `mempalace_session_sync_status` | none | Shows whether curated sync is enabled, its mode, auto-sync state, and active defaults. |
| `mempalace_session_sync_preview` | `sessionId?`, `limitSessions?`, `limitCandidates?` | Discovers candidate memories from the current OpenCode workspace without writing them. Preview output is intentionally bounded by limits, redacts common secret patterns, and uses configured wings. |
| `mempalace_session_sync_ingest` | `previewId`, `candidateIds?`, `confirm: true` | Writes the selected preview candidates. `confirm` must be `true`. If `candidateIds` is omitted, ingest uses all candidates from the preview. |

### Session sync Python discovery

Curated ingest writes through a Python interpreter that can import `mempalace.mcp_server`. Discovery tries candidates in this order:

1. `MEMPALACE_PYTHON`
2. `$HOME/.local/share/uv/tools/mempalace/bin/python3`
3. `$HOME/.venvs/mempalace/bin/python`
4. `$HOME/.venvs/mempalace/bin/python3`
5. `python3`
6. `python`

If ingest cannot find MemPalace, set `MEMPALACE_PYTHON` before starting OpenCode:

```bash
# uv tool install
export MEMPALACE_PYTHON="$HOME/.local/share/uv/tools/mempalace/bin/python3"

# virtualenv install
export MEMPALACE_PYTHON="$HOME/.venvs/mempalace/bin/python"
```

Validate the interpreter directly:

```bash
"$MEMPALACE_PYTHON" -c "import mempalace.mcp_server; print('ok')"
```

### Limitations

- Curated auto-sync does not run from `process.on('exit')`. The exit handler intentionally skips legacy `mineSync` when auto-sync is enabled because curated sync is async and unsafe during process exit. Auto-sync relies on threshold, idle, and deleted-session hooks.
- Auto-sync does not bulk backfill historical sessions; it targets the active session hook by `sessionId`. Use manual preview/ingest for selected older sessions. The default manual limits inspect up to 3 sessions and 50 candidates.
- Non-targeted SQLite discovery is project-strict when a workspace is available; sessions from other directories are not used as fallback preview input. Explicit targeted discovery with `sessionId` intentionally looks up by session ID only, to avoid false misses when OpenCode reports the workspace as `/`.
- CLI discovery trusts the configured command output and is not additionally project-filtered unless that command itself returns project-scoped sessions.
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
| **MCP Server Integration** | Auto-registers the external MemPalace Python MCP server and adds plugin helper tools |
| **Auto-update mechanism** | Best-effort update check |
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

- **[nguyentamdat/opencode-mempalace](https://github.com/nguyentamdat/opencode-mempalace)** — The original OpenCode-MemPalace plugin that this enhanced fork builds upon.

- **[OpenCode](https://opencode.ai)** — The AI terminal that makes plugins like this possible.

- **[Bun](https://bun.sh)** — The fast JavaScript runtime that powers our builds.

---

## 📄 License

MIT, matching `package.json`. Add or verify a root `LICENSE` file before redistribution.

---

<div align="center">

**⭐ Star this repo if you find it useful!**  
**🐛 Report issues** — **💡 Suggest features** — **🔧 Submit PRs**

</div>
