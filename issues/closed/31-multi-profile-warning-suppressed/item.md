---
created: 2026-04-16
updated: 2026-04-16
type: bug
reporter: jari
assignee: jari
status: closed
priority: normal
commits:
  - hash: ba2085b
    summary: "fix: surface multi-profile ambiguity warning through auto-select (#31)"
---

# 31. Multi-profile ambiguity warning swallowed by auto-select

_Source: `src/standalone-embedding.ts` `autoSelectStandaloneProvider`_

## Description

When `auth-profiles.json` contains multiple profiles for the same provider without a `:default` profile (e.g. `openai:work` + `openai:primary`), `resolveEmbeddingApiKey` is supposed to log a `Multiple auth profiles match openai (...). Using "<first>". Add a "openai:default" profile to select explicitly.` warning. The warning never appeared in production logs.

## Root Cause

`autoSelectStandaloneProvider` called `tryCreateStandaloneProvider(id, profiles, undefined, undefined)` — passing `undefined` as the logger to suppress the per-provider "no key found" probing noise. As a side effect, `resolveEmbeddingApiKey` also received `undefined`, so its multi-profile ambiguity warning was suppressed too.

The "no key" suppression is desirable (it's expected during auto-probing). The multi-profile suppression is not — that warning is the only signal users get that their config is ambiguous.

## Reproduction

1. `auth-profiles.json` with `openai:work` and `openai:primary` (no `openai:default`).
2. Plugin starts, embedding provider is auto-resolved.
3. Expected: warning `Multiple auth profiles match openai (openai:work, openai:primary). Using "openai:work". Add a "openai:default" profile to select explicitly.`
4. Actual (before fix): no warning. Plugin silently picks the first.

## Fix

Skip `tryCreateStandaloneProvider` in the auto-select loop and call `resolveEmbeddingApiKey` directly with the real logger, then instantiate the provider inline based on `id`. This preserves the "no key" suppression intent (per-provider noise is not surfaced) while letting the multi-profile warning through.

## Verification

- Unit test added: `surfaces multi-profile ambiguity warnings during auto-select (#31)` in `src/standalone-embedding.test.ts`. Asserts the warning text appears when `autoSelectStandaloneProvider` is called with two non-default same-provider profiles.
- All 38 unit tests pass.
- Found during v0.3.0 live verification on jari's bot — will roll out in the next release.
