# 🏛️ opencode-mempalace

[![npm version](https://img.shields.io/npm/v/opencode-mempalace.svg)](https://www.npmjs.com/package/opencode-mempalace)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Built%20with-Bun-black?logo=bun)](https://bun.sh)

> **AI Memory That Actually Works** — Project-scoped, persistent memory for OpenCode with zero-config setup.

OpenCode plugin integrating [MemPalace](https://github.com/milla-jovovich/mempalace) lifetime memory system. Unlike other memory solutions, this provides **true project-scoped memory** with automatic context injection, background mining, and seamless MCP integration.

---

## ✨ Why This Plugin?

| Feature | opencode-mempalace | Other Solutions |
|---------|-------------------|-----------------|
| **Project-scoped memory** | ✅ Automatic per-workspace | ❌ Global only |
| **Auto-initialization** | ✅ Palace auto-created | ❌ Manual setup |
| **Context injection** | ✅ wakeUp() loads L0+L1 memory | ❌ Manual tool calls |
| **Background mining** | ✅ Idle/threshold/exit triggers | ❌ None or manual |
| **MCP Tools** | ✅ 19 native tools | ❌ CLI only |
| **Auto-update** | ✅ Built-in | ❌ Manual |
| **Curated session sync** | ✅ Optional preview + ingest | ❌ Not available |

---

## 🚀 Quick Start

```bash
# 1. Install mempalace CLI globally
pip install mempalace

# 2. Add plugin to OpenCode config
# Edit ~/.config/opencode/opencode.jsonc
{
  "plugin": ["opencode-mempalace"]
}

# 3. Open any project folder in OpenCode
# The plugin auto-initializes and starts tracking memory!
```

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
- **Process exit**: Emergency sync save on Ctrl+C

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

Live behavior stays the same in v1: MCP registration, PALACE protocol injection, wake-up context, auto-mining, compaction memory injection, diary check tooling, and auto-update notifications all continue to run as before.

Curated OpenCode session sync is additive and manual. It is disabled by default (`sessionSync.enabled: false`) and does not automatically ingest historical sessions. When enabled, it lets you preview selected OpenCode session candidates, inspect their target wing/room/reason, and ingest only the candidates you confirm.

---

## 📋 Configuration

### Minimal plugin config

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "plugin": ["opencode-mempalace"]
}
```

### Enable curated session sync

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "plugin": [
    ["opencode-mempalace", {
      "threshold": 20,
      "palacePath": "/custom/path",
      "disableAutoLoad": false,
      "disableAutoMining": false,
      "disableAutoUpdate": false,
      "disableMcp": false,
      "sessionSync": {
        "enabled": true,
        "requirePreview": true,
        "discoveryMode": "auto",
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

### Skill-compatible wing naming

Use this if you want curated session sync to write project memories with the same wing naming used by the MemPalace session-memory skill:

```jsonc
{
  "plugin": [
    ["opencode-mempalace", {
      "sessionSync": {
        "enabled": true,
        "projectWingStrategy": "skill"
      }
    }]
  ]
}
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `mcpCommand` | `string[]` | `["python3", "-m", "mempalace.mcp_server"]` | Command to start the MCP server |
| `disableMcp` | `boolean` | `false` | Skip auto-registering MCP server |
| `disableProtocol` | `boolean` | `false` | Skip injecting PALACE_PROTOCOL |
| `disableAutoLoad` | `boolean` | `false` | Skip auto-loading context |
| `disableAutoUpdate` | `boolean` | `false` | Skip auto-update check |
| `palacePath` | `string` | `~/.mempalace/palace` | Override palace directory |
| `disableAutoMining` | `boolean` | `false` | Disable background mining |
| `threshold` | `number` | `15` | Messages before auto-mining |
| `sessionSync.enabled` | `boolean` | `false` | Enable manual curated OpenCode session sync tools |
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

The plugin has two memory paths:

| Path | Default | When it runs | What it does |
|---|---:|---|---|
| **Live mining** | On | During the current OpenCode session through threshold, idle, delete, exit, and compaction hooks | Keeps current project context fresh automatically. This remains the primary memory path. |
| **Curated session sync** | Off | Only when you enable `sessionSync.enabled` and call the sync tools manually | Finds candidate memories from OpenCode session files, shows a preview, and ingests confirmed candidates. |

Curated sync does not replace `mempalace mine` or live auto-mining. It is intended for selective recovery or cleanup of useful session details after you inspect them.

### Curated sync workflow

1. Enable `sessionSync.enabled` in the plugin config.
2. Start OpenCode and run `mempalace_session_sync_status` to confirm availability and defaults.
3. Run `mempalace_session_sync_preview` with optional filters such as `sessionId` or lower limits. The tool uses the current OpenCode workspace as the project directory; wing names come from plugin config.
4. Inspect each candidate's content, target wing, target room, and routing reason.
5. Run `mempalace_session_sync_ingest` with the `previewId`, optional `candidateIds`, and `confirm: true`.
6. Rerun the same ingest request if needed; already-ingested candidates should report as skipped.

### Curated sync tool reference

`mempalace_session_sync_status` is always available. `mempalace_session_sync_preview` and `mempalace_session_sync_ingest` are available only when `sessionSync.enabled` is `true`.

| Tool | Args | Notes |
|---|---|---|
| `mempalace_session_sync_status` | none | Shows whether curated sync is enabled and which defaults are active. |
| `mempalace_session_sync_preview` | `sessionId?`, `limitSessions?`, `limitCandidates?` | Discovers candidate memories from the current OpenCode workspace without writing them. Preview output is intentionally bounded by limits, redacts common secret patterns, and uses configured wings. |
| `mempalace_session_sync_ingest` | `previewId`, `candidateIds?`, `confirm: true` | Writes the selected preview candidates. `confirm` must be `true`. If `candidateIds` is omitted, ingest uses all candidates from the preview. |

### Limitations

- Curated sync is manual only in v1; enabling it does not start automatic historical ingestion.
- It is not a bulk historical backfill by default. The defaults inspect up to 3 sessions and 50 candidates.
- SQLite discovery is project-strict when a workspace is available; sessions from other directories are not used as fallback preview input.
- OpenCode session file formats may vary, so discovery and normalization are best-effort.
- Preview output is bounded by `limitCandidates`, `maxCandidateBytes`, JSON/message/part caps, and raw exchange size; long or oversized inputs may be truncated or skipped with warnings.
- Common secret forms (Bearer tokens, GitHub/OpenAI/AWS keys, private keys, and env-style secret assignments) are redacted in preview content before ingest.
- Candidate routing is deterministic and does not use LLM classification.
- Curated sync does not replace live mining or direct MemPalace mining workflows.

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
- ✅ Emergency exit handlers
- ✅ Project-scoped wings
- ✅ AAAK compression support

---

## 🧪 Development

```bash
# Clone and setup
git clone https://github.com/nguyentamdat/opencode-mempalace
cd opencode-mempalace
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

- **[milla-jovovich/mempalace](https://github.com/milla-jovovich/mempalace)** — The original MemPalace memory system architecture, AAAK dialect, and Python implementation. This plugin is just the OpenCode integration layer.

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
