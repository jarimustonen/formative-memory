---
created: 2026-04-15
updated: 2026-04-15
type: bug
reporter: jari
assignee: jari
status: closed
priority: high
commits:
  - hash: cc91ae8
    summary: "fix: use lazy agentDir getter and decouple init from workspace creation"
---

# 20. Fix embedding auth failures during heartbeat/cron-triggered recall

## Description

Recurring embedding provider errors during assemble() calls triggered by heartbeat/cron (observed at 02:19, 02:49, 03:30). The context engine's getWorkspace(".") was called without agentDir, causing the embedding provider to fail auth resolution. Consolidation worked fine because it uses SQLite directly.

## Root Cause

ContextEngineFactory receives no runtime context (agentDir, workspaceDir) from OpenClaw. When heartbeat/cron wakes the agent, assemble() creates the workspace singleton before any tool call provides agentDir. The embedding provider was initialized with undefined agentDir and the error was permanently cached.

## Fix

Three structural changes (documented as workaround in code):

1. **Lazy agentDir getter** — `createWorkspace` receives `() => runtimePaths.agentDir` instead of a static value. Provider resolution reads agentDir dynamically at each embed call.
2. **Decoupled init** — startup tasks (migration, cleanup) tracked with separate `startupTasksTriggered` flag, not tied to workspace creation.
3. **Non-permanent provider caching** — all provider errors clear the cache, allowing retry. Missing agentDir returns uncached rejection (self-healing).
4. **Migration pre-check** — `ws.initProvider()` verifies embedding before expensive LLM enrichment.

## Known Limitation

`workspaceDir` is still first-caller-wins. If context engine creates workspace from "." before a tool call, the DB may land in wrong directory. Requires upstream OpenClaw change: `issues/open/08-upstream-prs/proposal-factory-context.md`.
