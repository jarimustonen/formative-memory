---
created: 2026-04-15
updated: 2026-04-15
type: bug
reporter: jari
assignee: jari
status: in-progress
priority: high
---

# 21. Cron-triggered consolidation not intercepted — LLM reads MEMORY.md instead

## Description

First nightly consolidation on otso (v0.2.0) failed with ENOENT on `/home/node/.openclaw/workspace/MEMORY.md`. The file doesn't exist — otso uses formative-memory's DB, not file-based memory.

The `before_agent_reply` hook checks `event.cleanedBody` for the trigger string `__associative_memory_consolidation__`. If the match fails, the hook returns undefined, OpenClaw lets the LLM respond, and the LLM attempts to read MEMORY.md on its own initiative.

## Root Cause Analysis

Compared our implementation with OpenClaw's memory-core dreaming feature (the known-good reference). Two LLM reviewers (Gemini, Codex) analyzed the hypothesis across multiple rounds.

### Findings

1. **Naive trigger matching** — we use `body.includes(trigger)` while memory-core uses `includesSystemEventToken()` with exact line matching and string normalization. Our matching is vulnerable to formatting differences, wrapping, and partial matches.

2. **Missing trigger context gating** — memory-core checks `ctx.trigger === "heartbeat"` before processing. We check nothing about the trigger context.

3. **Missing pending event queue verification** — memory-core checks `hasPendingManagedDreamingCronEvent(ctx.sessionKey)` using `peekSystemEventEntries()` with session-aware heartbeat isolation (`:heartbeat` suffix handling). This serves as both anti-spoofing and session-routing correctness. We have none of this.

4. **`wakeMode: "next-heartbeat"` vs `"now"`** — memory-core uses `"now"`. With `"next-heartbeat"` the payload enters a pending queue and is delivered on the next heartbeat cycle, which may change how `cleanedBody` is populated. Reviewers disagree on whether this alone is the root cause (Gemini: yes, Codex: contributing factor only), but agree it should be changed.

5. **Cron reconciliation doesn't check wakeMode** — changing wakeMode in code won't update existing cron jobs because the reconciliation only compares `schedule.expr`.

### Consensus

The interception logic is fundamentally too naive compared to memory-core's battle-tested pattern. Even if `wakeMode: "now"` fixes the immediate symptom, the matching and session handling must be hardened.

## Evidence

- Log shows `[tools] read failed: ENOENT` at 03:00:13 — this is OpenClaw's tool layer, meaning the LLM called the read tool
- No formative-memory consolidation log lines appear (no `consolidation: starting`)
- The `before_agent_reply` hook should have returned `handled: true` and prevented LLM from running
- Attached logs in this directory (from prior investigation)

## Implementation Plan

### 1. Add debug instrumentation to the hook

At the top of `api.on("before_agent_reply")`, log the event shape:

```ts
log.debug(
  `cron-check trigger=${String(ctx?.trigger)} session=${String(ctx?.sessionKey)} ` +
  `body=${JSON.stringify(event?.cleanedBody ?? null)}`
);
```

Log on each branch exit (matched, skipped, no body, etc.).

### 2. Add `ctx.trigger === "heartbeat"` gate

Only process cron triggers during heartbeat context, matching memory-core:

```ts
if (ctx?.trigger !== "heartbeat") return;
```

### 3. Replace `includes()` with exact line token matching

Copy memory-core's `includesSystemEventToken()` pattern:

```ts
function includesSystemEventToken(cleanedBody: string, eventText: string): boolean {
  const normalizedBody = cleanedBody.trim();
  const normalizedToken = eventText.trim();
  if (!normalizedBody || !normalizedToken) return false;
  if (normalizedBody === normalizedToken) return true;
  return normalizedBody.split(/\r?\n/).some((line) => line.trim() === normalizedToken);
}
```

### 4. Add pending event queue check (anti-spoofing + session awareness)

Import `peekSystemEventEntries` from `openclaw/plugin-sdk/infra-runtime` (if available to plugins) and replicate memory-core's session-aware check with heartbeat isolation:

```ts
function hasPendingCronEvent(sessionKey: string | undefined, token: string): boolean {
  const keys: string[] = [];
  const normalized = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (normalized) {
    keys.push(normalized);
    if (normalized.endsWith(":heartbeat")) {
      const base = normalized.slice(0, -":heartbeat".length).trim();
      if (base) keys.push(base);
    }
  }
  return [...new Set(keys)].some((key) =>
    peekSystemEventEntries(key).some(
      (e) => e.contextKey?.startsWith("cron:") === true && e.text?.trim() === token,
    ),
  );
}
```

If `peekSystemEventEntries` is not available to external plugins, skip this step and document as a limitation. The other fixes should be sufficient.

### 5. Change `wakeMode` to `"now"`

For both consolidation and temporal cron jobs. This aligns with memory-core's approach.

### 6. Fix cron reconciliation to detect wakeMode changes

Current code only checks `schedule.expr`. Must also compare `wakeMode`:

```ts
if (existing.schedule?.expr !== desired.schedule.expr || existing.wakeMode !== desired.wakeMode) {
  await cron.update(existing.id, { schedule: desired.schedule, wakeMode: desired.wakeMode });
}
```

Apply to both consolidation and temporal cron jobs.

## Files

- `src/index.ts` — lines 885-980: cron registration and reconciliation
- `src/index.ts` — lines 982-1045: `before_agent_reply` hook
- Reference: `../openclaw/extensions/memory-core/src/dreaming.ts` — known-good pattern
- Reference: `../openclaw/extensions/memory-core/src/dreaming-shared.ts` — `includesSystemEventToken()`
- Attached logs in this directory

## Success Criteria

- Consolidation cron fires and is intercepted by the hook (log shows `consolidation: starting trigger=cron`)
- No `[tools] read failed: ENOENT` for MEMORY.md
- Debug log shows event shape and trigger matching
- Hook correctly ignores non-heartbeat triggers
- Existing cron jobs are updated on deploy (wakeMode reconciliation)
