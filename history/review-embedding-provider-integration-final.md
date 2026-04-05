# Review: Embedding Provider Integration (Final)

**Reviewed:** `src/index.ts`, `src/config.ts`, `src/embedding-circuit-breaker.ts`, `src/memory-manager.ts`, `openclaw.plugin.json`, tests
**Reviewers:** Gemini (3.1 Pro Preview), Codex (GPT-5.4)
**Rounds:** 2

## Critical Issues (Consensus)

### 1. Workspace identity: single singleton for all callers

- **What:** Context engine and `/memory sleep` call `getWorkspace(".")` which can initialize workspace before tools run with actual `workspaceDir`. First call wins forever, locking all subsequent calls to the wrong DB/log path. Multiple agents also share the same workspace instance.
- **Where:** `src/index.ts` — `getWorkspace()`, context engine registration, command handler
- **Why it matters:** Data isolation failure, cross-agent memory leakage, wrong DB paths.
- **Fix:** Restore `Map<string, ManagedWorkspace>` keyed by resolved memoryDir, scoped inside `register()`. Do NOT restore `lastWorkspace` (ambient mutable state).

### 2. Circuit breaker wraps provider initialization — contradicts design

- **What:** `adapter.create()` failures counted as breaker failures. After threshold, breaker opens → `MemoryManager` swallows `EmbeddingCircuitOpenError` → silent BM25 degradation. This contradicts the "provider required, no BM25 degradation" design.
- **Where:** `src/index.ts` — embedder wrapper in `createWorkspace()`
- **Why it matters:** Config/auth errors masked as transient failures, silent search degradation.
- **Fix:** Move `getProvider()` outside `circuitBreaker.call()`. Only wrap `provider.embedQuery(text)`.

### 3. Rejected provider promise permanently poisons lazy init

- **What:** If `resolveEmbeddingProvider()` rejects once, the rejected promise is cached forever. All future calls fail immediately even if the condition is fixed.
- **Where:** `src/index.ts` — `getProvider()` closure
- **Why it matters:** Transient init failure requires full process restart to recover.
- **Fix:** `.catch((err) => { providerPromise = null; throw err; })`

### 4. Promise.race orphan rejection can crash the process

- **What:** When timeout wins `Promise.race`, the losing `fn()` promise continues in background. If it later rejects, this is an `UnhandledPromiseRejection` which crashes Node.js by default.
- **Where:** `src/embedding-circuit-breaker.ts` — `call()` method
- **Why it matters:** A memory plugin taking down the host process is a P0 bug.
- **Fix:** `const op = fn(); op.catch(() => {}); await Promise.race([op, timeoutPromise]);`

## Disputed Issues

### AbortSignal support alongside Promise.race

- **Codex:** Recommends reintroducing optional AbortSignal — pass signal to `fn()`, abort on timeout. Provides both prompt timeout and resource cleanup.
- **Gemini:** Not needed. Promise.race + `.catch(() => {})` is sufficient and matches memory-core.
- **Assessment:** Both approaches work. Promise.race is the agreed pattern matching memory-core. AbortSignal can be added later if providers gain support.

### lastWorkspace as context engine fallback

- **Gemini:** Restore `lastWorkspace` for context engine since the factory has no context parameter.
- **Codex:** `lastWorkspace` is ambient mutable state — restoring it reintroduces the original bug under interleaved/multi-agent use.
- **Assessment:** Codex is right. Use Map-based caching. Context engine's `getWorkspace(".")` is an SDK limitation to address explicitly, not hide with heuristics.

## Minor Findings

- Auto-selection should record "returned no provider" when `adapter.create()` resolves but `result.provider` is falsy
- Config parser should reject non-string `provider`/`model` instead of silently defaulting
- `model: ""` fallback may cause provider SDK validation errors; consider omitting when undefined
- Removing `vectorDimsForModel()` makes dimension mismatches possible — `cosineSimilarity()` returns 0 on length mismatch, causing silent degraded retrieval rather than explicit failure

## What's Solid

- Provider registry integration is architecturally correct
- Promise caching for concurrent lazy init safety
- Promise.race timeout matching memory-core pattern (needs orphan rejection fix)
- Comprehensive test coverage for provider resolution, config validation, lazy init
- Clean separation: `createWorkspace()`, `createMemoryTools()`, `resolveEmbeddingProvider()`

## Test Gaps

- Workspace initialization order: engine/command before tools
- Rejected provider promise recovery (first fails, second succeeds)
- `adapter.create()` returns `{ provider: undefined }` in auto mode
- No auto-selectable providers (empty list or no priority)
- Late rejection after timeout (orphan promise)
- `/memory sleep` before any tool call
