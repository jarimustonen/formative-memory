# Brainstorm: Salience Profile Design

**Contributors:** Gemini (gemini-3.1-pro-preview), Codex (gpt-5.4)
**Date:** 2026-04-14

## Consensus Recommendations

### 1. Use hybrid markdown with structured sections, not pure freeform

Both recommend a markdown file with known section headings for machine parseability, while keeping it human-editable:

```md
---
version: 1
---

# Salience Profile

## Remember
- Technology decisions and architecture choices
- Family events, birthdays, plans
- People I mention and their roles

## Deprioritize
- One-off code formatting requests
- Temporary debugging steps

## Never Remember
- Health information
- Secrets, tokens, passwords
- Financial account details

## Notes
For this workspace, prioritize design decisions over implementation minutiae.
```

**Why not pure freeform:** Can't reliably distinguish "prefer" from "forbid". Hard to merge profiles. Susceptible to prompt injection.
**Why not pure YAML/JSON:** Poor UX, discourages editing, too brittle.

### 2. Negative salience ("Never Remember") is essential, not optional

Both strongly agree this is the most valuable part of the feature. Must be enforced in two layers:

1. **Prompt instruction:** Tell the LLM not to extract these categories
2. **Post-extraction filtering:** Programmatically reject facts matching exclusion rules before `store()`

Prompt-only enforcement is insufficient — small models may still extract forbidden content. A salience-aware filter after `parseExtractionResponse()` is needed.

### 3. No autonomous agent edits in v1

Both agree the agent should NOT silently modify the salience profile from conversation. Risks: prompt injection into memory policy, overreach from offhand remarks, weakened privacy exclusions.

**Safe pattern:** Agent proposes changes, user confirms explicitly before write.

### 4. Support global + workspace profiles eventually, architect for it now

- **Global** (`~/.openclaw/salience.yaml` or similar): Personal preferences, global exclusions
- **Workspace** (`./workspace/.openclaw/salience.yaml`): Project-specific context

Precedence: Never Remember > workspace Remember > global Remember > defaults.

Start with workspace-only in v1, but use an abstraction (`SalienceProfileProvider`) so layering is additive later.

### 5. Do not auto-generate profiles silently

Both agree auto-generated starter profiles from early conversations risk encoding accidental priorities as policy.

Better: offer `/memory salience suggest` that inspects observed patterns and proposes a starter profile for user approval.

### 6. Salience should refine defaults, not replace them

User profile augments the hardcoded extraction rules. If user writes "Remember: dietary preferences", the system still extracts standard durable facts too. "Never Remember" overrides everything.

### 7. Add preview/feedback tooling

Users need to answer: "Is my profile doing anything?" At minimum:
- Structured debug logs: profile loaded, rules count, facts extracted, facts filtered
- `/memory salience test` or `--dry-run` to preview extraction with current profile

## Key Architecture Recommendations

### Type/Interface

```typescript
export type SalienceProfile = {
  remember: string[];
  deprioritize: string[];
  neverRemember: string[];
  notes?: string;
};

export interface SalienceProfileProvider {
  getProfile(): SalienceProfile | null;
}
```

### Engine integration

```typescript
export type AssociativeMemoryContextEngineOptions = {
  // ... existing options
  getSalienceProfile?: () => SalienceProfile | null;
};
```

### Prompt builder accepts profile

```typescript
export function buildExtractionPrompt(
  turnContent: string,
  profile?: SalienceProfile | null,
): string
```

### Post-extraction filter

```typescript
function filterExtractedFacts(
  facts: ExtractedFact[],
  profile: SalienceProfile | null,
): { accepted: ExtractedFact[]; rejected: Array<{ fact: ExtractedFact; reason: string }> }
```

### Prompt structure with profile

```
Base rules:
- Extract durable preferences, facts, goals, plans, project context, relationships, recurring patterns, commitments, and corrections.
- Do not extract transient operational details, pleasantries, or assistant reasoning.

Hard exclusions:
- Never extract secrets, credentials, access tokens, or highly sensitive personal data.

User salience profile:
Remember:
{profile.remember items}

Deprioritize:
{profile.deprioritize items}

Never remember:
{profile.neverRemember items}

Precedence: "Never remember" overrides all. "Remember" broadens extraction. "Deprioritize" means include only if clearly recurring or consequential.
```

## Divergent Ideas

### Gemini: Structured YAML instead of markdown

Gemini prefers pure YAML for schema enforcement. Codex argues this is poor UX and discourages editing. Both agree the key requirement is structured sections, not a specific syntax.

### Gemini: Agent tool `update_salience`

Gemini recommends exposing a dedicated tool. Codex recommends only diff-and-confirm flow. Both agree no silent mutation.

### Codex: Behavioral learning as complement

Codex suggests learning salience suggestions from feedback signals (memory_feedback ratings, retrieval patterns, deletions). Gemini is cautious about implicit learning. Both agree: explicit profile is primary, learned suggestions require confirmation.

## Recommended Implementation Phases

### Phase 1: Core
- `SalienceProfileProvider` abstraction
- One workspace markdown file with known sections
- Parse Remember / Deprioritize / Never Remember
- Inject into extraction prompt
- Post-extraction filtering for exclusions
- Debug logging (profile loaded, facts filtered)

### Phase 2: Scoping
- Global + workspace profile merge
- Precedence rules
- Profile hash/version in logs

### Phase 3: Learning
- `/memory salience suggest` from observed patterns
- Suggest edits from feedback signals
- Require explicit confirmation

### Phase 4: Lifecycle Integration
- Salience-aware consolidation (decay multipliers, pruning resistance)
- Salience-aware retrieval ranking
