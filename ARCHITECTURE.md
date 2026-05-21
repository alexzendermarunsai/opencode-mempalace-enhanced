# Architecture

## Overview

opencode-mempalace is an OpenCode plugin that integrates the MemPalace memory system. It follows a **factory pattern architecture** inspired by the oh-my-openagent (OMO) project, emphasizing modularity, testability, and separation of concerns.

## Design Philosophy

### Factory Pattern
The plugin is composed of discrete factory functions that create and configure different aspects of the plugin:

```typescript
// Main orchestration in index.ts
const hooks = createHooks(context);
const { flushDirtySessions, dispose } = createPluginDispose(context);
```

Benefits:
- **Testability**: Each factory can be tested in isolation
- **Composability**: Factories can be combined in different ways
- **Clear dependencies**: Each factory declares its dependencies explicitly
- **Lifecycle management**: Clean disposal patterns

### Domain-Driven Organization

```
src/
├── config/           # Configuration schemas and validation (Zod)
├── features/         # Feature-specific modules (dispose, notifications)
├── hooks/            # OpenCode hook implementations
├── session-sync/     # Curated OpenCode session sync subsystem
├── shared/           # Domain-specific utilities (no catch-all utils.ts)
├── auto-update.ts    # NPM registry update check
├── mempalace-cli.ts  # MemPalace CLI wrapper
├── spawn.ts          # Runtime-agnostic process spawning
└── index.ts          # Plugin entry point
```

Following OMO's rule: **No catch-all files**. Each file has a single, clear responsibility.

## Module Breakdown

### 1. Configuration (`src/config/`)

**Purpose**: Runtime validation and type-safe configuration

**Key Files**:
- `index.ts`: Zod schemas, parsing functions, default values. Imports `SessionSyncConfigSchema` and `DEFAULT_SESSION_SYNC_CONFIG` from `../session-sync/contracts.js`.
- `palace.ts`: Central palace path resolver. `palacePath` is the highest-priority override; otherwise `palaceMode` selects global `~/.mempalace/palace` or workspace `<workspace>/.mempalace/palace`.

**Patterns**:
- Zod for runtime validation
- `parsePluginOptions()`: Full validation with fallback
- `parsePartialOptions()`: Partial validation for user overrides

```typescript
const opts = parsePluginOptions(options ?? {});
// Returns validated config or defaults on error
```

**Session sync config** is defined in `src/session-sync/contracts.ts` and nested under `sessionSync` in the main schema. See the [Session Sync Configuration](#session-sync-configuration) section below.

### 2. Features (`src/features/`)

**Purpose**: Self-contained feature modules

**Key Files**:
- `plugin-dispose.ts`: Cleanup lifecycle management. Handles process exit (SIGINT, SIGTERM) and legacy dirty-session flushing for non-autoSync mode.
- `update-notification.ts`: Formats update notification string for system prompt injection.

**Patterns**:
- Each feature exports a `create*()` factory function
- Features declare their context dependencies
- Idempotent disposal patterns

### 3. Hooks (`src/hooks/`)

**Purpose**: OpenCode hook implementations

**Key Files**:
- `index.ts`: All hook implementations (chat.message, session.compacting, tool.execute.after, event). Exports `createHooks(context)` factory and `shouldResetCountAfterAutoSync()` helper.

**Patterns**:
- Single factory `createHooks(context)` returns all hook handlers
- Context object contains all dependencies
- Conditional curated auto-sync vs legacy mining based on config

**Curated auto-sync integration**: When `autoMiningEnabled && sessionSync.enabled && sessionSync.autoSync`, threshold/idle/deleted hooks call `autoSyncSession()` instead of legacy `mempalace mine`. The `shouldResetCountAfterAutoSync()` helper determines whether to reset the message counter after a sync attempt.

### 4. Session Sync (`src/session-sync/`)

**Purpose**: Curated OpenCode session sync — discover, normalize, filter, route, redact, preview, and ingest session memories into MemPalace.

**Key Files**:

| File | Lines | Purpose |
|---|---|---|
| `contracts.ts` | 155 | All Zod schemas and TypeScript types (SessionSyncConfig, PreviewArgs, IngestArgs, MemoryCandidate, RawSession, NormalizedExchange, Route, SessionSyncState, etc.) |
| `discovery.ts` | 237 | Session discovery from SQLite, CLI, or JSON file fallback. Project-strict filtering by workspace directory. |
| `export.ts` | 66 | Converts raw sessions into MemoryCandidates via normalize → filter → redact → route → deduplicate pipeline. |
| `normalize.ts` | 140 | Session normalization, `[SYSTEM — MemPalace Context Load]` stripping, stable SHA-256 content hashing. |
| `filters.ts` | 20 | Transient noise detection (short messages, tool calls, action confirmations) and candidate byte truncation. |
| `redaction.ts` | 29 | Secret redaction for Bearer tokens, GitHub/OpenAI/AWS keys, private keys, env-style secret assignments. |
| `routing.ts` | 49 | Deterministic candidate routing: project wing (session_memory) vs global wing (preferences/decisions/lessons) based on content pattern matching. |
| `ingest.ts` | 127 | MemPalace Python tool_add_drawer writer with automatic Python discovery and candidate ingestion with idempotency tracking. |
| `state.ts` | 76 | Persistent sync state (JSON file with atomic writes), preview ID generation, scan params hashing. |
| `auto-sync.ts` | 56 | Async auto-sync orchestration with state lock. Used by hooks when curated auto-sync is enabled. |
| `index.ts` | 100 | Public API: `previewSessionSync()`, `ingestSessionSync()`, `statusSessionSync()`, `resolvePreviewConfig()`. Re-exports contracts and auto-sync. |
| `session-sync.test.ts` | — | Test suite for the session sync subsystem. |

**Data flow (curated sync)**:

```
discovery.ts → (RawSession[]) → export.ts → (MemoryCandidate[])
    │                                           │
    ├─ SQLite (bun:sqlite)                      ├─ normalize.ts → NormalizedExchange[]
    ├─ CLI command                              ├─ filters.ts → noise rejection
    └─ JSON file walk                           ├─ redaction.ts → secret masking
                                                ├─ routing.ts → wing/room assignment
                                                └─ state.ts → idempotency dedup
                                                     │
                                                     ▼
                                              ingest.ts → tool_add_drawer (Python)
                                                     │
                                                     ▼
                                              State saved (atomic JSON write)
```

### 5. Shared (`src/shared/`)

**Purpose**: Domain-specific utilities

**Key Files**:
- `state.ts`: StateManager — mining locks, message counters, dirty session tracking
- `wake-up-injection-state.ts`: Persistent duplicate-injection guard for first-message wake-up context, keyed by OpenCode `sessionID`
- `logger.ts`: Buffered async logging (500ms flush interval)
- `utils.ts`: Path and workspace utilities, `getWingFromPath()`, `isEmptyWorkspace()`
- `protocol.ts`: PALACE_PROTOCOL, MAX_MEMORY_LENGTH, STATUS_MESSAGES constants
- `error-classifier.ts`: Error classification for init/retry logic (`safeAsync`, `classifyInitError`, `isRetryableSpawnError`)

**Patterns**:
- Each utility is domain-specific
- No generic `utils.ts` catch-all
- Testing reset utilities (`_resetForTesting()`)

### 6. Supporting Modules (root `src/`)

| File | Lines | Purpose |
|---|---|---|
| `auto-update.ts` | 287 | NPM registry version check, cache invalidation, and `bun install` orchestration for self-update. Mirrors oh-my-openagent conventions. |
| `mempalace-cli.ts` | 219 | MemPalace CLI wrapper with fallback command chain (mempalace → python3 -m mempalace → python -m mempalace). Resolves and passes `--palace` for live operations. Exports: `initialize()`, `isInitialized()`, `mine()` (async), `mineSync()` (sync), `wakeUp()` (with 30s TTL cache). |
| `spawn.ts` | 171 | Runtime-agnostic process spawning — prefers `Bun.spawn`/`Bun.spawnSync`, falls back to `node:child_process`. Exports: `spawnAsync()`, `spawnSyncWrapper()`, `runCommand()` (async), `runCommandSync()`, `runCommandWithOutput()`. |
| `index.ts` | 232 | Plugin entry point. Orchestrates config parsing, workspace setup, MCP registration, system prompt injection, hook creation, tool registration (mempalace_check_diary, mempalace_session_sync_status/preview/ingest). |

## Data Flow

### Plugin Initialization

```
1. index.ts receives PluginInput + options
2. parsePluginOptions() validates configuration (including sessionSync)
3. Setup workspace path with security validation
4. Determine wing from workspace path
5. Resolve the effective palace path (`palacePath` override, else `palaceMode` default)
6. Thread the resolved palace path through CLI options, MCP environment, and session sync
7. Create StateManager with threshold (from sessionSync.autoSyncThreshold or opts.threshold)
8. If `wakeUpInjection` is `once-per-session`, create the persistent wake-up injection state manager
9. Define ensureInitialized() for 3-state init
10. Create plugin dispose handlers (conditionally registers exit handlers)
11. Fire-and-forget auto-update check (if not disabled)
12. Create hooks via createHooks()
13. Return plugin object with:
    - config hook (MCP registration)
    - experimental.chat.system.transform (protocol + update notification)
    - chat.message hook
    - tool.execute.after hook
    - experimental.session.compacting hook
    - event hook (if autoMiningEnabled)
    - tool definitions (diary check, session sync tools)
```

### Session Lifecycle

```
[Session Start]
  ↓
chat.message hook (first message)
  ↓
Check wake-up injection guard
  ├─ [once-per-session + previous loaded/empty record] mark session seen; skip duplicate injection
  └─ [no suppressing record / once-per-process] continue
  ↓
ensureInitialized() → wakeUp() → inject L0+L1 context
  ↓
Persist guard metadata when applicable:
  ├─ loaded / empty → suppress future injection for this OpenCode sessionID
  └─ initializing → allow retry after restart
  ↓
[state === "ready"] continue normally
[state === "initializing"] notify background init
[state === "empty"] proceed without context
  ↓
Auto-mining: increment message counter; if threshold reached:
  ├─ [curated auto-sync enabled] → autoSyncSession(sessionId)
  │    → discover → export → ingest → reset counter (or mark pending)
  └─ [legacy mining] → mine(workspaceDir, "convos", wing, cliOptions)
  ↓
[Session End / Compaction]
  ↓
session.compacting hook:
  → Check diaryWritten → inject diary reminder if needed
  → wakeUp() → inject L0+L1 memory context
  ↓
[event: session.idle / session.deleted]
  ↓
If pending messages:
  ├─ [curated auto-sync] → autoSyncSession(sessionId)
  └─ [legacy mining] → mine(workspaceDir, "convos", wing, cliOptions)
  ↓
[Process exit (SIGINT/SIGTERM)]
  ├─ [curated auto-sync] → no-op (async unsafe during exit)
  └─ [legacy mining] → mineSync() → flush dirty sessions
```

### Curated Session Sync Workflow

```
User calls mempalace_session_sync_preview
  ↓
discovery.ts → find sessions (SQLite/CLI/JSON)
  ↓
export.ts → normalize → filter noise → redact secrets → route to wing/room → deduplicate against state
  ↓
Return PreviewReport with candidates
  ↓
User calls mempalace_session_sync_ingest(previewId, confirm: true)
  ↓
ingest.ts → call Python tool_add_drawer for each candidate using the resolved palace path
  ↓
State saved (atomic JSON write with idempotency tracking)
```

## Session Sync Configuration

Session sync config is defined in `src/session-sync/contracts.ts` via the `SessionSyncConfigSchema` Zod schema and nested under `sessionSync` in the main plugin options:

| Option | Type | Default | Description |
|---|---|---|---|
| enabled | boolean | false | Enable curated session sync preview/ingest tools |
| autoSync | boolean | false | Use curated sync for threshold/idle/deleted hooks instead of legacy mining |
| autoSyncThreshold | number | unset | Optional message threshold for curated auto-sync; falls back to plugin `threshold` |
| requirePreview | boolean | true | Require ingest to use a previous preview result |
| discoveryMode | "auto" \| "cli" \| "sqlite" | "auto" | Session discovery method |
| limitSessions | number | 3 | Max recent sessions to inspect during preview |
| limitCandidates | number | 50 | Max candidates returned by preview |
| maxCandidateBytes | number | 4000 | Max bytes stored per candidate |
| maxJsonFileBytes | number | 5000000 | Max JSON session file size during fallback discovery |
| maxMessagesPerSession | number | 1000 | Max messages read from one session |
| maxPartsPerMessage | number | 200 | Max OpenCode text parts read from one message |
| maxRawExchangeBytes | number | 100000 | Max raw normalized exchange size before preview |
| projectWingStrategy | "plugin" \| "skill" \| "custom" | "plugin" | Wing naming strategy for project memories |
| projectWing | string | unset | Required when strategy is "custom" |
| globalWing | string | "opencode_global" | Wing for global/non-project memories |
| statePath | string | unset | Override sync state file path |
| cliCommand | string[] | unset | CLI command for session discovery |
| sqlitePath | string | unset | Override OpenCode SQLite database path |
| palacePath | string | unset | (Backward-compat only.) Always overridden by the plugin-level resolved palace path. Use plugin-level `palacePath` or `palaceMode` instead. |

## Plugin Configuration Reference

Top-level plugin config is defined in `src/config/index.ts` and includes the live MemPalace integration settings as well as the nested `sessionSync` object:

| Option | Type | Default | Description |
|---|---|---|---|
| mcpCommand | string[] | `["python3", "-m", "mempalace.mcp_server"]` | Command to start the MemPalace MCP server |
| cliCommand | string[] | unset | Optional MemPalace CLI prefix for live `status`, `wake-up`, `mine`, and `init` calls |
| disableMcp | boolean | false | Skip automatic MCP registration |
| disableProtocol | boolean | false | Skip PALACE protocol injection |
| disableAutoLoad | boolean | false | Skip first-message wake-up context injection |
| wakeUpInjection | `"once-per-session" \| "once-per-process"` | `"once-per-session"` | Duplicate-injection guard mode. `once-per-session` persists metadata by OpenCode `sessionID`; `once-per-process` uses only the in-memory `sessionsSeen` set. |
| wakeUpScope | `"primary-session" \| "all-sessions" \| "none"` | `"primary-session"` | Controls which sessions receive full `wakeUp()` memory context. `primary-session` loads context only for built-in primary agents; subagents get a hint to use MemPalace MCP tools. |
| disableAutoUpdate | boolean | false | Skip update check |
| palaceMode | `"global" \| "workspace"` | `"global"` | Select default palace path when `palacePath` is unset. `global` resolves to `~/.mempalace/palace`; `workspace` resolves to `<workspace>/.mempalace/palace`. |
| palacePath | string | unset | Highest-priority palace directory override for plugin-managed operations |
| disableAutoMining | boolean | false | Disable automatic mining/sync hooks |
| threshold | number | 15 | Message threshold for legacy mining and fallback curated auto-sync threshold |
| sessionSync | object | defaults below | Curated session sync configuration |

### Wake-up injection guard state

When `wakeUpInjection` is `once-per-session`, the plugin stores duplicate-injection guard metadata in `~/.mempalace/opencode-mempalace/state.json`. The state contains only:

- OpenCode `sessionID` as the key
- status: `loaded`, `empty`, or `initializing`
- `injectedAt` timestamp

No memory content or transcript text is stored in this file. `loaded` and `empty` records suppress future `[SYSTEM — MemPalace Context Load]` injection for that session after plugin/OpenCode restart. `initializing` records do not suppress injection, so a session can retry wake-up loading after restart. State pruning keeps at most 1000 records and removes records older than 90 days.

## Error Handling Strategy

### Error Classification

The `error-classifier.ts` module provides:

1. **Retryable Error Detection**: `isRetryableSpawnError()`
   - ETIMEDOUT, ECONNREFUSED, EAGAIN
   - Pattern matching for "timeout", "rate limit", etc.

2. **Error Categorization**: `classifyInitError()`
   - "missing_dependency": mempalace not installed
   - "timeout": initialization timeout
   - "unknown": other errors

3. **Safe Async Wrapper**: `safeAsync()`
   - Wraps operations with error classification
   - Returns structured result: `{ success, data?, error?, retryable? }`

### Best Practices

- Fail silently in background operations (mining)
- Log errors without throwing
- Provide graceful degradation
- Never block user workflow on memory operations
- Curated auto-sync errors are captured in AutoSyncResult, not thrown

## Testing Strategy

### Test Setup

**bunfig.toml**:
```toml
preload = ["./test-setup.ts"]
```

**test-setup.ts**: Centralized beforeEach that resets stateful modules

### Test Organization

- Tests co-located with source files: `feature.ts` + `feature.test.ts`
- `_resetForTesting()` exports for stateful modules (state.ts, mempalace-cli.ts)
- Factory pattern enables easy mocking

### Test Files

| Test file | Tests for |
|---|---|
| `src/index.test.ts` | Plugin entry point |
| `src/spawn.test.ts` | Process spawning (Bun & Node.js) |
| `src/mempalace-cli.test.ts` | CLI wrapper (mine, init, wakeUp) |
| `src/auto-update.test.ts` | Auto-update mechanism |
| `src/session-sync/session-sync.test.ts` | Curated session sync subsystem |
| `src/shared/logger.test.ts` | Buffered async logger |
| `src/shared/state.test.ts` | StateManager (locks, counters) |
| `src/shared/utils.test.ts` | Path and workspace utilities |

### Test Patterns

```typescript
describe("StateManager", () => {
  beforeEach(() => {
    stateManager = new StateManager();
  });
  
  it("should handle edge case", () => {
    // Test with fresh instance
  });
});
```

## Performance Optimizations

### Current Optimizations

1. **Buffered Logging**: Batches log writes (500ms flush interval)
2. **Mining Locks**: Prevents concurrent mining on same session
3. **Lazy Initialization**: Palace init happens in background
4. **3-State Initialization**: empty → initializing → ready
5. **wakeUp() Caching**: Results cached with 30-second TTL
6. **Idempotency Tracking**: Processed candidates are never re-ingested
7. **State Lock**: Sequential async state access via promise chain

### Opportunities

1. **wakeUp() Caching Tuning**: Configurable TTL
2. **Path Validation Caching**: Cache workspace validation results
3. **Event Debouncing**: Debounce rapid session events
4. **Memory Truncation**: Configurable MAX_MEMORY_LENGTH
5. **Incremental Mining**: Mine only changed conversations
6. **Memory Compression**: Better AAAK compression integration
7. **Metrics**: Track mining success/failure rates

## Security Considerations

### Path Validation

```typescript
let workspaceDir = path.resolve(workspaceDirRaw);
if (!workspaceDir || workspaceDir.includes("\0") || workspaceDir.length > 4096) {
  logWarn("Invalid workspace path, using current directory");
  workspaceDir = process.cwd();
}
```

### String Length Validation

```typescript
if (wing.length > 100) {
  logWarn("Wing name too long, truncating");
  wing = wing.substring(0, 100);
}
```

### Input Sanitization

- Wing names sanitized: `/[^a-z0-9]/g` → `-`
- Empty workspace detection with ignored files list

### Secret Redaction (Session Sync)

- Bearer tokens, GitHub/OpenAI/AWS keys, private keys, env-style secret assignments are redacted from preview content before ingest
- Redaction is content-only (no secrets logged or stored)

### State File Security

- Sync state file created with `0o700` directory, `0o600` file permissions
- Atomic writes via temp + rename

## Configuration Reference

### Plugin Options (Zod Schema)

| Option | Type | Default | Description |
|---|---|---|---|
| mcpCommand | string[] | ["python3", "-m", "mempalace.mcp_server"] | MCP server command |
| cliCommand | string[] | unset | MemPalace CLI command prefix (fallback: mempalace → python3 -m mempalace → python -m mempalace) |
| disableMcp | boolean | false | Skip MCP registration |
| disableProtocol | boolean | false | Skip PALACE_PROTOCOL injection |
| disableAutoLoad | boolean | false | Skip wakeUp injection |
| wakeUpInjection | `"once-per-session" \| "once-per-process"` | `"once-per-session"` | Duplicate-injection guard mode. `once-per-session` persists metadata by OpenCode `sessionID`; `once-per-process` uses only the in-memory `sessionsSeen` set. |
| disableAutoUpdate | boolean | false | Skip auto-update check |
| palaceMode | `"global" \| "workspace"` | `"global"` | Select default palace directory when `palacePath` is unset |
| palacePath | string | unset | Highest-priority palace directory override for plugin-managed operations |
| disableAutoMining | boolean | false | Disable auto-mining (both legacy and curated) |
| threshold | number | 15 | Messages before auto-mining trigger |
| sessionSync | object | { enabled: false } | Curated session sync config (see [Session Sync Configuration](#session-sync-configuration)) |

### Environment Variables

- `MEMPALACE_PALACE_PATH`: Override palace directory (set by auto-registered MCP config from the resolved plugin palace path; set it manually if you provide your own `mcp.mempalace` config)
- `MEMPALACE_PYTHON`: Preferred Python binary for ingest tool_add_drawer script
- `XDG_CACHE_HOME`: Log file location
- `XDG_CONFIG_HOME`: Auto-update config directory

## Future Enhancements

### Planned

1. **Schema Caching**: Cache parsed Zod schemas
2. **Metrics**: Track mining success/failure rates
3. **Plugin Skills**: Add `.opencode/skills/` for domain-specific behaviors
4. **Custom Protocols**: User-defined protocol strings
5. **Multi-Wing Support**: Cross-project memory correlation

### Considered

1. **Incremental Mining**: Mine only changed conversations
2. **Memory Compression**: Better AAAK compression integration
3. **wakeUp() Caching Tuning**: Configurable TTL

## References

- [OMO Project](https://github.com/code-yeongyu/oh-my-openagent): Factory pattern inspiration
- [MemPalace](https://github.com/mempalace/mempalace): Memory system architecture
- [OpenCode Plugin API](https://opencode.ai/docs): Hook system documentation
