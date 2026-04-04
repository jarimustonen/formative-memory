# Review: Embedding Provider Integration

**Reviewed:** `src/index.ts`, `src/config.ts`, `src/embedding-circuit-breaker.ts`, `src/memory-manager.ts`, `openclaw.plugin.json`, tests
**Reviewers:** Gemini (3.1 Pro Preview), Codex (GPT-5.4)
**Rounds:** 2

## Critical Issues (Consensus)

### 1. Existing user configs break on upgrade

`memoryConfigSchema.parse()` uses `assertAllowedKeys` which rejects `embedding.apiKey` as an unknown key. Existing users who have `apiKey` in their config will get a startup error — the plugin won't load at all.

- **Where:** `src/config.ts` lines 30-35, `openclaw.plugin.json`
- **Why it matters:** 100% of existing users are affected on upgrade. No migration path or deprecation period.
- **Suggested fix:** Allow `apiKey` as a recognized (but ignored) key for one deprecation cycle, or emit a clear error message explaining migration steps.

### 2. Circuit breaker timeout is broken

The old `createEmbedder()` passed `AbortSignal` to `fetch({ signal })`, enabling cooperative cancellation. The new code explicitly ignores the signal:

```ts
void signal;
return provider.embedQuery(text);
```

Since `provider.embedQuery()` doesn't accept an `AbortSignal`, the circuit breaker's timeout is dead code. A hanging provider will block the tool call indefinitely.

- **Where:** `src/index.ts` embedder wrapper in `getWorkspace()`
- **Why it matters:** Timeout was a key reliability feature. This is a behavioral regression.
- **Suggested fix:** Either extend the provider call with a `Promise.race` against the abort signal, or change the circuit breaker to use a hard timeout race instead of cooperative cancellation.

### 3. Workspace state management is architecturally broken

Three related sub-issues:

**a) `lastWorkspace` is a global mutable singleton.** In multi-agent environments, any tool call overwrites it. The context engine and `/memory sleep` command then operate on whichever workspace was touched last — potentially the wrong agent's database. This can leak data between sessions.

**b) Cache key is incomplete.** The workspace cache key is `${memoryDir}:${provider}:${model}` but provider resolution also depends on `openclawConfig` and `agentDir`. Two agents sharing the same memoryDir/provider/model but different configs will reuse the same workspace and provider instance.

**c) Split-brain config resolution.** Tool calls use `ctx.config ?? openclawConfig`, but context engine and command paths always use the global `openclawConfig`. Agent-level config overrides are not respected by background operations.

- **Where:** `src/index.ts` — `workspaces` map, `lastWorkspace`, `getLastWorkspace()`, `register()`
- **Why it matters:** Cross-agent contamination, wrong DB for context assembly, non-deterministic behavior.
- **Suggested fix:** Scope workspace cache inside `register()` instead of module scope. Replace `lastWorkspace` with a map keyed by workspace/session identity. Include config identity in cache key (e.g. via `WeakMap<OpenClawConfig, ...>`).

### 4. Explicit provider failures don't degrade gracefully

When `providerId !== "auto"` and `adapter.create()` throws (e.g. missing API key), the error propagates through the circuit breaker into `MemoryManager`. Since it's not an `EmbeddingCircuitOpenError`, `EmbeddingTimeoutError`, or `ProviderUnavailableError`, it gets rethrown — breaking `memory_store` and `memory_search` instead of falling back to BM25.

- **Where:** `src/index.ts` `resolveEmbeddingProvider()`, `src/memory-manager.ts` catch blocks
- **Why it matters:** `embedding.provider: "openai"` without a configured API key crashes store/search instead of degrading.
- **Suggested fix:** Wrap explicit provider creation in try/catch and throw `ProviderUnavailableError` (preserving cause) so degradation works consistently.

## Disputed Issues

### Auto-selection priority ordering

- **Gemini:** Standard ascending sort where lower numbers = higher priority. Not a bug — matches common conventions (z-index, nice values).
- **Codex:** Should verify SDK contract explicitly and add a test. Lower-is-higher isn't universal.
- **Assessment:** The OpenClaw SDK code (`provider-adapters.ts`) uses `autoSelectPriority` values 10, 20, 30, 40, 50 and the reference `createEmbeddingProvider()` sorts ascending. So the implementation is correct, but a test would be prudent.

### Auto-mode exception swallowing (`catch { continue }`)

- **Gemini:** The loop must swallow errors to try the next adapter. Fix by logging, not by stopping.
- **Codex:** Bare `catch {}` hides genuine bugs in adapters and makes selection non-deterministic.
- **Assessment:** Both have valid points. The loop should continue but should log adapter errors (at least at debug level). Currently `api.logger` is not threaded into `resolveEmbeddingProvider()`.

## Medium-Severity Findings

1. **Concurrent lazy initialization race** — Two simultaneous first calls both execute `resolveEmbeddingProvider()`. Fix: cache the promise, not the resolved value.

2. **Sticky null cache** — If `getProvider()` resolves to `null` at startup (no credentials), `null` is cached forever. Adding credentials later won't help without process restart. Fix: only cache successful resolutions, or add a TTL/retry mechanism.

3. **`ProviderUnavailableError` increments circuit breaker failure counter** — "No provider configured" is a static condition, not a transient service failure. Opening the circuit for static unavailability is semantically wrong and interacts badly with sticky null caching.

4. **Empty string model forwarded to providers** — `model ?? adapter.defaultModel ?? ""` can pass `""` to a provider SDK that interprets it as an explicit invalid model rather than "use default". Fix: omit model from create options when undefined.

5. **JSON schema vs runtime validation mismatch** — `openclaw.plugin.json` defines a fixed enum of providers; `memoryConfigSchema.parse()` accepts any string. If the registry is extensible, the enum is too restrictive. If provider IDs are fixed, runtime validation is too permissive.

6. **Providers without `autoSelectPriority` excluded from auto mode** — The `.filter(a => typeof a.autoSelectPriority === "number")` drops providers that don't declare priority, potentially excluding valid third-party providers from auto-selection.

7. **Unused import** — `MemoryEmbeddingProviderCreateOptions` is imported but never used.

## Test Gaps

Both reviewers flagged significant missing test coverage:

- No test for BM25-only degradation when no provider is available
- No test for explicit provider failure behavior
- No test for auto-selection ordering across multiple adapters
- No test for model forwarding to `adapter.create()`
- No test for lazy initialization (provider created on first embed, not on workspace init)
- No test for provider creation happening only once across repeated calls
- No test for workspace cache sensitivity to different configs/agentDirs
- No test for malformed config values (`embedding: []`, `provider: 123`, etc.)

## What's Solid

- Core direction is correct — using the registry instead of hardcoded OpenAI fetch
- Lazy provider initialization is the right approach (implementation needs fixes)
- `ProviderUnavailableError` as a distinct error type for graceful degradation
- Config simplification — removing mandatory apiKey is the right end state
- Existing non-embedding tests all pass (398/398)
