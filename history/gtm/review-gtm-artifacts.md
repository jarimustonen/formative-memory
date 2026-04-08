# Review: GTM Planning Artifacts

**Reviewed:** README.md, history/plan-website.md, history/plan-repo-cleanup.md
**Reviewers:** Gemini, Codex (GPT-5.4)
**Rounds:** 2 (initial review + cross-review)
**Date:** 2026-04-08

---

## Critical Issues (Consensus)

Both reviewers agree these must be fixed before public release.

### 1. README overclaims "no config needed" while features require API keys

- **What:** Quick Start says "No additional configuration needed" but consolidation merge requires Anthropic/OpenAI API key in `auth-profiles.json`, and semantic search requires an embedding provider.
- **Where:** README.md lines 49, 134
- **Why it matters:** Creates immediate expectation debt. Users install, try `/memory-sleep`, get an error.
- **Fix:** Separate baseline capability (keyword search, storage, no merge) from full capability (embeddings + LLM merge). Document degraded modes clearly. Add a Requirements section.

### 2. Naming inconsistency will damage discoverability

- **What:** Five different names for one product: "Formative Memory", `openclaw-associative-memory`, `memory-associative`, "Memory (Associative)", "Associative Memory"
- **Where:** All three artifacts
- **Why it matters:** Users who hear about "Formative Memory" on HN won't find `openclaw-associative-memory` on npm. Config key `memory-associative` doesn't match package name. Every support interaction will have naming confusion.
- **Fix:** Resolve before public release. At minimum: rename plugin ID and display name to align with brand. Ideally rename package too. Add explicit naming/identifier mapping table in README.

### 3. Missing `files` in package.json

- **What:** No `files` array means `npm publish` would include `history/` (39 files), `docs/`, all test files, `deploy.sh`, and internal artifacts.
- **Where:** package.json
- **Why it matters:** Bloated package, accidental publication of internal material.
- **Fix:** Add `"files": ["dist", "openclaw.plugin.json", "README.md", "LICENSE"]`

### 4. No migration story documented

- **What:** `/memory-migrate` exists in the plugin but README doesn't mention it. No explanation of how existing OpenClaw flat-file memory users transition.
- **Where:** README.md (missing section)
- **Why it matters:** The primary target audience (existing OpenClaw users) needs this path. Without it, they risk losing accumulated knowledge.
- **Fix:** Add Migration section to README explaining `/memory-migrate` and `/memory-cleanup`.

### 5. CLI binary invocation is wrong

- **What:** README shows `memory stats <dir>` but after `npm install`, the binary is in `node_modules/.bin/memory`, not in PATH.
- **Where:** README.md CLI tool section
- **Why it matters:** Copy-pasting the documented command fails immediately.
- **Fix:** Use `npx memory stats <dir>` or document the actual invocation path.

### 6. No evidence/examples section

- **What:** Zero demonstrations that the system works — no transcript, no benchmark, no before/after example.
- **Where:** README.md (missing)
- **Why it matters:** Developers evaluating novel tools need proof, not just architecture diagrams. This is the biggest conversion blocker.
- **Fix:** Add a short example showing auto-recall in action and a `/memory-sleep` summary.

### 7. `autoCapture` behavior is undocumented

- **What:** Plugin config has `autoCapture: boolean` but no documentation of what it captures, how, or privacy implications.
- **Where:** README.md, openclaw.plugin.json
- **Why it matters:** Users don't know what data is being stored. Privacy-conscious users will reject it.
- **Fix:** Document exactly what gets captured, retention behavior, and how to disable.

### 8. Command name inconsistency across docs

- **What:** README uses `/memory-sleep`, docs use `/memory sleep`
- **Where:** README.md vs docs/how-memory-works.md
- **Why it matters:** Users copy wrong commands from docs.
- **Fix:** Verify actual command names from code and standardize everywhere.

### 9. Package.json missing release metadata

- **What:** No `repository`, `homepage`, `bugs`, `author`, `license`, `keywords`, or `types` fields. Also `@rolldown/binding-darwin-arm64` in devDeps may break CI on non-Mac platforms.
- **Where:** package.json
- **Why it matters:** npm discoverability, professional appearance, cross-platform builds.
- **Fix:** Complete all metadata fields. Verify build works on Linux CI.

### 10. Secret scanning guidance is too weak

- **What:** Cleanup plan suggests a git log pattern-match command and "considers" trufflehog/gitleaks.
- **Where:** history/plan-repo-cleanup.md §4
- **Why it matters:** Pattern matching misses secrets embedded in .ts/.json files. False confidence.
- **Fix:** Make automated scanning (gitleaks/trufflehog) mandatory, not optional.

---

## Disputed Issues

### 11. Should `history/` be kept or removed?

- **Gemini:** "Nuke it. 39 raw AI logs look like unmaintained noise."
- **Codex:** "Directionally agree but overstated. Some are genuine design docs. Curate aggressively rather than delete all."
- **Moderator:** Codex has the stronger argument. The design docs (03-design-* series) have real value. Remove review/proposal/research files, keep design and planning docs. A curated history/ with a README explaining its purpose is better than either extreme.

### 12. Is the trust/security model adequate?

- **Gemini:** "Over-engineered concern. This is a local SQLite database, not a multi-tenant web app."
- **Codex:** "The system stores untrusted text and reinjects it into prompts. That needs more than a paragraph."
- **Moderator:** Codex is right that the current trust model section is too thin for a system that replays stored text into LLM context. However, Gemini is right that a formal threat model is overkill. Middle ground: expand the trust model section with concrete statements about data flow (what goes to external providers, what stays local) and explicit security limitations.

### 13. Is synchronous `/memory-sleep` a critical UX flaw?

- **Gemini:** "Major architectural flaw. Blocking the runtime for minutes is unacceptable."
- **Codex:** "Severity depends on actual runtime, which neither reviewer measured. Already documented as a limitation. Acceptable for v0.1 if runtime is documented."
- **Moderator:** Codex is right — this is honestly disclosed and on the roadmap. The missing piece is performance expectations (how long does consolidation take for N memories?). Not a release blocker but needs runtime guidance.

### 14. Should the website be in a separate repo?

- **Codex:** "Adds unnecessary operational overhead for a pre-traction project."
- **Gemini (implicit):** No strong opinion expressed.
- **Moderator:** Valid concern. Keep in main repo initially or defer the decision. The website plan correctly notes it "probably goes in a different repo" but this can wait.

---

## Minor Findings

- `openclaw.plugin.json` `autoRecall` help text says "associated memories" but associations don't drive retrieval — should say "relevant memories"
- Plugin description mentions "retrieval-based strengthening" but strengthening happens during consolidation, not retrieval
- `embedding.provider` schema lacks enum validation
- `dbPath` doesn't clarify file vs directory path
- README doesn't mention default storage location or backup/restore guidance
- No versioning/DB schema migration policy documented
- Content-addressed identity downsides (metadata collapse) mentioned in docs but omitted from README
- Website plan overinvests in animation before proof/examples exist

---

## What's Solid

Both reviewers agree on:
- **"Mutations only during consolidation" framing** is the strongest differentiator and is well-articulated
- **Before/after comparison table** is clear and effective
- **Technical tone** is appropriate — not marketing-speak
- **Progressive disclosure structure** (benefits → usage → internals) is correct
- **Content-addressed deduplication** is a strong architectural choice
- **Temporal state machine** is a genuinely useful and under-discussed feature

---

## Unresolved Questions (Need Human Judgment)

1. **Naming:** Should the package be renamed to `openclaw-formative-memory` before v0.1.0? Trade-off: cleaner branding vs. breaking existing deploy scripts and references.
2. **history/ curation:** Which specific files to keep? The design series and GTM plan are valuable; reviews and proposals are not.
3. **autoCapture default:** Is it on or off by default? What exactly does it capture? This needs an answer before docs can be accurate.
4. **Website timing:** Should the website launch before or after repo cleanup is complete?
5. **Lock file policy:** Should `pnpm-lock.yaml` be committed for reproducibility?

---

## Moderator's Assessment

**Codex produced the stronger review** — more specific, more actionable, better prioritized. Gemini had sharper rhetoric but some findings were less precisely targeted (e.g., the blanket "nuke history/" recommendation).

**Issues neither reviewer caught:**
- The README doesn't mention `/memory-migrate` or `/memory-cleanup` commands at all, despite them being registered in the plugin
- The website plan and README use different messaging — website leads with "Your AI agent forgets everything" (emotional hook), README leads with "Long-term memory for OpenClaw" (factual). These should be aligned or consciously divergent.

**Single most important thing to address:**
The README needs a Requirements/Prerequisites section and clear degraded-mode documentation. The "it just works" framing will cause the most immediate user frustration and is the easiest to fix.
