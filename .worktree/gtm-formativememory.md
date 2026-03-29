---
created: 2026-03-09T12:00:00+02:00
source_branch: main
task: GTM strategy and marketing plan for Formative Memory
merged: 2026-03-18T11:24:23+02:00
commits:
  - hash: 4421f80
    message: "docs: add GTM strategy for formativememory.ai"
  - hash: bb474b0
    message: "docs: add worktree prompt for gtm-formativememory"
---

# Task: Go-to-Market Strategy for Formative Memory (formativememory.ai)

## Objective

Create a comprehensive go-to-market strategy document for the Formative Memory open source project. This is an OpenClaw plugin that implements biologically-inspired associative memory for AI coding agents. The domain formativememory.ai has been purchased.

## Context

### What is Formative Memory?

- An open source plugin for OpenClaw (AI coding agent) that replaces basic flat-file memory with a biologically-inspired associative memory system
- Key features: weighted associations between memories, consolidation ("sleep") process that strengthens/weakens memories, temporal awareness, retrieval-based strengthening, hybrid search (embedding + BM25)
- Modeled after how human memory actually works: memories form associations, strengthen through use, decay without reinforcement, and consolidate during "sleep"
- Currently being built for OpenClaw first, but the roadmap includes support for competing AI coding agents (Roo, OpenCode, Aider, etc.)

### Brand

- Name: **Formative Memory**
- Domain: **formativememory.ai**
- This is and will remain an open source project
- The name "formative" conveys that memories shape and evolve over time

### Target audience

- Developers using AI coding agents who want their agent to actually remember and learn
- Early adopters in the AI tooling space
- Open source contributors interested in memory/AI/neuroscience-inspired systems

## Deliverables

Create the following document in `history/plan-gtm-formativememory.md`:

### 1. Landing Page Strategy (formativememory.ai)

- Page structure and sections
- Key messaging and value proposition
- Tone: explanatory and compelling on the front page, documentation-style deeper in
- **Animation storyboard/script** that explains how the system works (the biological memory metaphor: store → associate → consolidate → recall). This should be detailed enough for a designer/developer to implement. Think about frames, transitions, what text appears when.

### 2. Channel Strategy

Specific, actionable plan for each channel:

**Hacker News:**

- What kind of post (Show HN?), title ideas, timing
- What resonates with HN audience

**Reddit:**

- Which specific subreddits and why
- Post format for each

**Discord:**

- Which specific servers/channels are relevant
- How to approach each community

**X (Twitter):**

- Hashtags to use
- Who to tag/engage with
- Thread format ideas

**Other channels:**

- Dev.to, Hashnode, Medium
- YouTube/video content
- Podcasts
- GitHub ecosystem (trending, awesome lists)
- Any other relevant channels

### 3. README Structure

- Design the README.md structure and content outline
- Should serve as both introduction and quick-start
- Must convey the biological memory metaphor clearly
- Include badges, installation, quick example, how it works, roadmap

### 4. Roadmap (public-facing)

- Phase 1: OpenClaw plugin (current)
- Phase 2: Expand to other AI coding agents (Roo, OpenCode, Aider, Cline, etc.)
- Phase 3: Generic memory layer for any AI agent
- This should be presented as an ambitious but credible vision

### 5. Launch Timeline

- Pre-launch activities (what to do before the plugin is ready)
- Launch day plan
- Post-launch follow-up

## Key Principles

- This is an open source project — community building is paramount
- International audience (English-first)
- The biological memory metaphor is the core differentiator — lean into it
- Early adopters matter most — find them where they are
- Authenticity over hype — developers smell BS from a mile away

## Files to Examine

- `TODO.md` — current project status
- `osa-a-openclaw-muutokset.md` — OpenClaw integration status
- `history/03-design-00-index.md` — design overview
- `history/03-design-05-consolidation.md` — the consolidation algorithm (key differentiator)
- `src/types.ts` — data model
- `src/memory-manager.ts` — core functionality

## Success Criteria

- Comprehensive, actionable GTM document in `history/plan-gtm-formativememory.md`
- Animation storyboard detailed enough to implement
- Channel strategy with specific targets (not generic advice)
- README outline that would make a developer want to try it
- Roadmap that positions this as bigger than just an OpenClaw plugin

## Workflow

You implement the task. When complete, the user will review your changes.
The user should commit all changes using `/commit`.
The user should finalize and merge worktree with `/worktree-merge`.
