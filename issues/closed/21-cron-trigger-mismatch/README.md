# Bug: Consolidation reads MEMORY.md (should not)

**Reporter**: Jari Mustonen
**Date**: 2026-04-15
**Version**: formative-memory 0.2.0
**Environment**: OpenClaw 2026.4.12, Node 24.14.0, Podman on Hetzner CPX32
**Bots affected**: otso (confirmed), ursa (no consolidation attempted — installed later in the evening)

## Summary

The first nightly consolidation after upgrading from 0.1.0 to 0.2.0 failed because the consolidation process attempted to read `/home/node/.openclaw/workspace/MEMORY.md`, which does not exist. This file is an **OpenClaw session memory** artifact (written by hooks), not a formative-memory file. Consolidation should not depend on or read this file.

## Timeline

| Time (UTC) | Event |
|------------|-------|
| 2026-04-14 18:26:34 | deploy-agent.sh pushed new config (`formative-memory` replacing `memory-associative`) |
| 2026-04-14 18:26:40 | Gateway restarted, formative-memory 0.2.0 loaded (7 plugins including formative-memory) |
| 2026-04-14 18:26:40 | Warning: `plugin kind mismatch (manifest uses "memory,context-engine", export uses "memory")` |
| 2026-04-14 18:26:41 | `Registered consolidation cron job` |
| 2026-04-14 18:26:41 | `Registered temporal transitions cron job` |
| 2026-04-15 03:00:00 | Consolidation cron fires, plugins reload |
| 2026-04-15 03:00:13 | **ERROR**: `[tools] read failed: ENOENT: no such file or directory, access '/home/node/.openclaw/workspace/MEMORY.md'` (logged twice) |

No further consolidation output after the ENOENT error. No evidence the consolidation completed successfully.

## Expected behavior

Consolidation should operate on formative-memory's own database (`/home/node/.openclaw/memory/associative/associations.db`) and not attempt to read workspace files like `MEMORY.md`.

## Actual behavior

Consolidation crashes on `ENOENT` when trying to read `MEMORY.md` from the workspace directory. The file doesn't exist because this bot (otso) has never had a `MEMORY.md` — it uses formative-memory's own DB for memory storage.

## Additional observations

### Plugin kind mismatch warning

At load time:
```
[gateway] [plugins] plugin kind mismatch (manifest uses "memory,context-engine", export uses "memory") (plugin=formative-memory)
```

This may be related — if the plugin registers as a context-engine, it might inherit MEMORY.md reading behavior from OpenClaw's legacy context engine.

### Database state (pre-upgrade, 0.1.0 era)

The existing `associations.db` has data from the 0.1.0 era:
- `associations.db`: 4 KB (schema only?)
- `associations.db-wal`: 1.4 MB (last modified Apr 14 03:00 — previous night's 0.1.0 consolidation)
- `retrieval.log`: 18 store operations from Apr 13

### No MEMORY.md exists

```
/home/node/.openclaw/workspace/memory/   <-- session memory files (from /nollaa hook)
/home/node/.openclaw/workspace/MEMORY.md <-- DOES NOT EXIST
```

The `workspace/memory/` directory contains session context dumps written by the `/nollaa` hook — these are not formative-memory artifacts.

### Ursa comparison

Ursa was upgraded later the same evening and had no overnight consolidation attempt. Its log shows no formative-memory activity after deployment (no cron jobs registered in the captured log window). This may be because ursa was restarted after the cron registration window, or because deploy-agent.sh overwrote the config that the plugin installer had modified.

## Reproduction

1. Install formative-memory 0.2.0 in an OpenClaw instance that has no `MEMORY.md` in its workspace
2. Wait for the consolidation cron (default 03:00 UTC)
3. Observe ENOENT error in logs

## Attached logs

| File | Description |
|------|-------------|
| `otso-openclaw-2026-04-14.log` | Full OpenClaw file log, Apr 14 (553 lines, JSON format) |
| `otso-openclaw-2026-04-15.log` | Full OpenClaw file log, Apr 15 (4 lines — only the consolidation attempt) |
| `otso-compose-full.log` | Full podman-compose log output (532 lines, human-readable format) |
| `otso-formative-memory-filtered.log` | Filtered: only formative-memory/consolidation/ENOENT lines from compose log |
| `ursa-formative-memory-filtered.log` | Filtered: ursa's formative-memory lines for comparison (81 lines) |
