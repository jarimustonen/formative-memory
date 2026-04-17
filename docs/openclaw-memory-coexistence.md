# Coexistence with OpenClaw's memory architecture

OpenClaw's plugin SDK includes interfaces and features designed around its own file-based memory system (memory-core). Since Formative Memory operates on different principles, some of these features are irrelevant to us. This document collects deliberate omissions and their rationale.

## Ignored features

### citationsMode (v2026.4.7)

`assemble()` receives a `citationsMode?: "auto" | "on" | "off"` parameter. Memory-core uses this to control whether memory search results include source citations in `Source: <path#line>` format.

**Ignored.** Formative Memory's memories are associative objects, not files. We have no `path#line` citations to show or hide. The parameter flows through the interface and appears in debug logs but is not acted upon.

### promptCache telemetry (v2026.4.7)

`afterTurn()` and `compact()` receive `runtimeContext.promptCache` data: API provider prompt cache state, token usage, and cache-break observations.

**Observed, not acted upon.** Our assemble cache already produces a stable `systemPromptAddition` for the same transcript, which is the best way to preserve API cache hits. Active cache-aware prioritization could worsen hit rates by changing the system prompt more often. Debug logging added to `afterTurn()` for observability.

### Compaction provider registry (v2026.4.7)

`registerCompactionProvider()` allows custom compaction logic. We delegate compaction to the runtime (`delegateCompactionToRuntime()`), so this does not apply.

## Adopted features

### availableTools (v2026.4.7)

`assemble()` receives `availableTools?: Set<string>`. Logged at debug level. Not yet used in logic, but could in the future control memory context formatting (e.g. only reference `memory_get` tool when it is available).

### registerMemoryPromptSection

Used to register system prompt instructions. Receives the `availableTools` set to tailor guidance based on which memory tools are available.
