# Go-to-Market Strategy: Formative Memory

> **Domain:** formativememory.ai
> **Date:** 9.3.2026
> **Status:** Plan

---

## 1. Landing Page Strategy (formativememory.ai)

### 1.1 Page Structure

```
┌─────────────────────────────────────────────┐
│  Hero                                       │
│  "Your AI agent forgets everything.         │
│   What if it didn't?"                       │
│  [Star on GitHub]  [Get Started]            │
├─────────────────────────────────────────────┤
│  The Problem (short, punchy)                │
├─────────────────────────────────────────────┤
│  Animated Explainer (§1.3)                  │
├─────────────────────────────────────────────┤
│  How It Works (technical, 4 pillars)        │
├─────────────────────────────────────────────┤
│  Before / After comparison                  │
├─────────────────────────────────────────────┤
│  Quick Start (3-step install)               │
├─────────────────────────────────────────────┤
│  Roadmap (vision)                           │
├─────────────────────────────────────────────┤
│  Footer (GitHub, Discord, License)          │
└─────────────────────────────────────────────┘
```

### 1.2 Key Messaging

**Headline:** "Your AI agent forgets everything. What if it didn't?"

**Subhead:** "Formative Memory is an open source plugin that gives AI coding agents biologically-inspired memory — memories that form associations, strengthen through use, decay without reinforcement, and consolidate during sleep."

**The Problem (2–3 sentences):**

> Every AI coding session starts from scratch. Your agent doesn't remember that you prefer Tailwind over styled-components, that the auth module was refactored last week, or that the CI breaks on Node 18. You've been teaching the same lessons over and over. Flat-file memory is a band-aid — a pile of text with no structure, no prioritization, no forgetting.

**Core value proposition pillars:**

| Pillar            | One-liner                                        | Detail                                                                                                                                        |
| ----------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Associations**  | Memories link to related memories                | When your agent recalls "auth module," it automatically surfaces the related refactor, the deployment config, and that edge case you debugged |
| **Strength**      | Important memories surface, irrelevant ones fade | Memories you use grow stronger. Memories you never reference decay. No manual curation needed                                                 |
| **Consolidation** | Your agent sleeps on it                          | A background "sleep" process merges duplicates, updates outdated memories, and strengthens patterns — just like biological memory             |
| **Hybrid Search** | Find by meaning and by keyword                   | Embedding similarity + BM25 full-text search, weighted by memory strength                                                                     |

**Before/After comparison:**

|               | Flat-file memory      | Formative Memory                                            |
| ------------- | --------------------- | ----------------------------------------------------------- |
| Structure     | Append-only text file | Content-addressed memory objects with associations          |
| Relevance     | Everything is equal   | Strength-weighted: used memories surface, unused ones decay |
| Duplicates    | Accumulate forever    | Merged during consolidation                                 |
| Outdated info | Stays forever         | Updated ("colored") based on newer associated memories      |
| Connections   | None                  | Weighted bidirectional associations                         |
| Maintenance   | Manual pruning        | Automatic via sleep process                                 |

**Tone:** Direct and technical on the front page. Not marketing-speak. The audience is developers — show the architecture, show the algorithm, explain _why_ this is different. The biological metaphor is the hook, but the engineering is the substance.

### 1.3 Animation Storyboard: "How Memory Works"

A single horizontal-scrolling or vertical-scrolling animated sequence. Minimalist style — dark background, bright accent colors, monospace type for technical labels. Think: a blend of a biology textbook diagram and a system architecture diagram.

**Duration:** ~60 seconds autoscroll, user can scroll manually.

---

#### Frame 1: "Store" (0–10s)

**Visual:**

- A code snippet appears on the left: a user telling the agent "We use Tailwind, not styled-components"
- A glowing dot (a "memory node") materializes in the center of the canvas
- The dot gets a label: `preference: tailwind-over-styled`
- Subtle hash text appears briefly next to it: `sha256: a3f2...`
- The dot lands in a zone labeled **"Working Memory"** (left region of the canvas)
- A small strength bar appears next to it, full (1.0)

**Text overlay:**

> "When your agent learns something, it creates a memory object — content-addressed, timestamped, typed."

**Technical detail (smaller text):**

> "Content hash ensures identity. No duplicates from the start."

---

#### Frame 2: "Associate" (10–25s)

**Visual:**

- Two more memory dots appear in quick succession:
  - `decision: migrate-to-tailwind-v4`
  - `fact: tailwind-config-in-root`
- All three dots are in the canvas. Lines start drawing between them — first faint, then glowing brighter
- The lines get weight labels: `0.4`, `0.7`, `0.3`
- A fourth, older dot (`bug: css-specificity-issue`) is already in the **"Consolidated Memory"** zone (right region). A faint line connects it to the Tailwind preference
- Camera pulls back to reveal a small network graph of ~8 nodes with various connection strengths

**Text overlay:**

> "Memories don't exist in isolation. They form associations — weighted links that grow stronger when memories are retrieved together."

**Technical detail:**

> "Co-retrieval tracking: when two memories appear in the same search, their association weight increases. Hebbian learning — neurons that fire together wire together."

---

#### Frame 3: "Consolidate" (25–45s)

**Visual:** This is the centerpiece of the animation.

- The canvas dims slightly. A crescent moon icon appears in the top corner. Text: **"Sleep"**
- The animation cycles through sub-steps, each with a brief visual:

**3a. Strengthen & Decay (3s)**

- Memory dots pulse: frequently-used ones glow brighter (strength bar fills up)
- Unused ones fade slightly (strength bar shrinks)
- One very faint dot blinks out entirely (pruned)
- Small formula appears: `strength × 0.977 per sleep cycle`

**3b. Move to Long-term (3s)**

- Dots from the Working Memory zone slide rightward into the Consolidated Memory zone
- Their strength bars reset to full (1.0)
- Label: "Working → Consolidated: a fresh start in long-term memory"

**3c. Merge Duplicates (4s)**

- Two similar dots in Consolidated zone pulse, then merge into one with a brief flash
- Before: `"user prefers Tailwind"` + `"always use Tailwind, not styled-components"`
- After: `"project uses Tailwind exclusively — never styled-components"`
- Association lines from both original dots transfer to the merged node

**3d. Color (Update) (4s)**

- A dot labeled `"considering migration to Tailwind v4"` is connected to a newer dot `"migrated to Tailwind v4 last week"`
- The older dot morphs/rewrites: `"considering migration..."` → `"completed migration to Tailwind v4"`
- Text: "Memories update based on newer information — they stay functional, not archival"

**3e. Prune (2s)**

- A few very faint dots and thin association lines dissolve away
- `strength ≤ 0.05 → removed`

**Text overlay:**

> "During consolidation — 'sleep' — the system strengthens what matters, merges duplicates, updates outdated memories, and prunes what's irrelevant. 10 steps. Fully automatic."

---

#### Frame 4: "Recall" (45–60s)

**Visual:**

- Daytime returns. The canvas brightens
- A search query appears: `"what CSS framework do we use?"`
- Ripples emanate from the query through the network graph
- The strongest, most-connected nodes light up: the merged Tailwind memory, the config location, the v4 migration
- These rise to the top, ordered by relevance
- The recalled nodes pulse — their strength bars tick up slightly (retrieval strengthens memory)
- Faint text: "Next time, these memories will surface even more easily"

**Text overlay:**

> "Retrieval is hybrid: semantic similarity + keyword search, weighted by memory strength. And every retrieval makes the memory stronger — just like in your brain."

---

#### Final Frame: CTA

**Visual:** The network graph settles. One line of text:

> **"Memory that learns. Open source."**
>
> `npm install formative-memory` ← (or whatever the install command will be)
>
> [Star on GitHub] [Read the Docs] [Join Discord]

---

### 1.4 Implementation Notes for Animation

- **Format:** CSS/JS scroll-driven animation, or Lottie/Rive for more complex motion. Scroll-driven is preferred — users control the pace, works on all devices
- **Fallback:** For slow connections or no-JS: a static infographic with the same 4 frames as PNG/SVG
- **Mobile:** Vertical scroll, same frames stacked. Simplify the network graph (fewer nodes)
- **Accessibility:** All text content should be in the DOM (not just in the animation). Prefers-reduced-motion: show static frames instead
- **Performance:** Lazy-load the animation. Hero and problem sections should render instantly

---

## 2. Channel Strategy

### 2.1 Hacker News

**Post type:** Show HN

**Timing:** Tuesday or Wednesday, 8–10am US Eastern. Avoid Mondays (crowded) and Fridays (low engagement).

**Title options (pick one):**

1. `Show HN: Formative Memory – biologically-inspired memory for AI coding agents`
2. `Show HN: Formative Memory – giving AI agents memory that actually works like memory`
3. `Show HN: I built a memory system for AI coding agents modeled on how human memory works`

Option 3 is the most HN-native (first person, builder's voice).

**What resonates with HN:**

- Technical depth. Link to the consolidation algorithm design doc or a blog post explaining the neuroscience inspiration
- Honest scope: "this is an OpenClaw plugin today, the vision is broader"
- Open source with real architecture, not a wrapper around an API
- The biological metaphor is interesting to HN's science-curious audience, but ground it in engineering decisions
- Don't oversell. "It's early" is fine — HN respects that

**Post body structure:**

```
I built an open source memory plugin for AI coding agents that replaces
flat-file memory with something modeled on how biological memory actually
works.

Key ideas:
- Memories are content-addressed objects with weighted associations
- A "sleep" process (consolidation) strengthens used memories, merges
  duplicates, updates outdated info, and prunes irrelevant memories
- Hybrid search: embedding similarity + BM25, weighted by memory strength
- Zero DB writes during normal operation — all state changes happen
  during consolidation

Currently built for OpenClaw, with plans to support Roo, Aider, OpenCode,
and eventually any AI agent.

GitHub: [link]
Site: formativememory.ai
Architecture docs: [link to design docs]

Would love feedback on the approach.
```

**Follow-up:** Be in the thread for the first 2–3 hours. Answer every technical question. If someone says "this is overengineered" — have a ready answer about why flat-file memory doesn't scale and what specific problems this solves.

### 2.2 Reddit

| Subreddit         | Subscribers | Why                                                             | Post format                                                   |
| ----------------- | ----------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| r/LocalLLaMA      | 500k+       | Power users running local AI, deeply technical audience         | Technical deep-dive post with architecture diagram            |
| r/ChatGPTCoding   | 200k+       | AI coding users — direct target audience                        | Before/after demo, practical angle                            |
| r/ClaudeAI        | 100k+       | Claude users, many use Claude Code (which OpenClaw is based on) | "I built a memory plugin" angle, show real examples           |
| r/MachineLearning | 2.5M+       | Academic/research angle: the neuroscience-inspired architecture | Paper-style post focused on the consolidation algorithm       |
| r/programming     | 6M+         | General programming audience                                    | Blog post link, focus on the problem ("why AI agents forget") |
| r/SideProject     | 100k+       | Makers/builders                                                 | Project showcase                                              |

**Format by subreddit:**

**r/LocalLLaMA, r/MachineLearning:**
Title: "I built an open source memory system for AI coding agents, modeled on biological memory consolidation"
Body: Technical write-up. Architecture diagram. Link to design docs. Emphasize the neuroscience parallels (Hebbian learning, memory consolidation, decay curves). These audiences appreciate academic rigor.

**r/ChatGPTCoding, r/ClaudeAI:**
Title: "After months of my AI agent forgetting everything between sessions, I built a real memory system for it"
Body: Problem-focused. "Here's what happens today: [flat file example]. Here's what Formative Memory does instead: [example]." Show concrete before/after. Keep it practical.

**r/programming:**
Wait for a blog post or Show HN post and cross-post the link. Don't self-promote directly — let HN traction carry.

**Timing:** Post on different days. Don't carpet-bomb all subreddits on the same day — it looks spammy and you can't engage with all threads simultaneously. Spread over 1–2 weeks.

### 2.3 Discord

| Server                                            | Why                              | Approach                                                                                                             |
| ------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **OpenClaw Discord** (if exists)                  | Home turf — the plugin ecosystem | Post in plugin/extension channel. This should be the _first_ place you announce. Engage with other plugin developers |
| **Cursor Discord**                                | AI coding agent users            | Share in general or showcase. Frame as "this is for OpenClaw today, but the approach applies to any AI agent"        |
| **LMStudio / Ollama Discord**                     | Local LLM users, technical       | Technical approach. These users care about running things locally                                                    |
| **AI/ML servers** (MLOps, Weights & Biases, etc.) | ML practitioners                 | Research angle: "biologically-inspired memory consolidation"                                                         |

**Approach:** Don't drop a link and leave. Introduce yourself, explain the problem you're solving, share the link, and stick around to answer questions. Discord is a conversation medium, not a billboard.

### 2.4 X (Twitter)

**Strategy:** Launch thread + ongoing presence.

**Launch thread (10-12 tweets):**

```
1/ I built an open source memory system for AI coding agents that works
   like biological memory.

   It's called Formative Memory.

   Your AI agent's flat-file memory is broken. Here's why, and what I
   built instead. 🧵

2/ The problem: every AI coding session starts from scratch. Your agent
   doesn't remember your preferences, past decisions, or what broke last
   time. Flat-file memory is just an append-only text file with no
   structure.

3/ Formative Memory replaces that with content-addressed memory objects
   that form weighted associations. When two memories are retrieved
   together, their connection strengthens. Hebbian learning for AI agents.

4/ But the killer feature is consolidation — "sleep."

   A background process that:
   • Strengthens frequently-used memories
   • Decays unused ones
   • Merges duplicates
   • Updates outdated memories
   • Prunes irrelevant ones

5/ [Animated GIF or short video of the consolidation process]

6/ This isn't just a metaphor. The math is real:
   - Working memory decays at 0.906/cycle (7-cycle half-life)
   - Consolidated memory: 0.977/cycle (30-cycle half-life)
   - Retrieval strengthens: strength ← 1-(1-s)×e^(-η×w)

7/ Search is hybrid: embedding similarity + BM25 full-text, weighted
   by memory strength. Important memories surface first. No manual
   curation.

8/ Built for OpenClaw today. Roadmap: support for every AI coding agent
   — Roo, Aider, OpenCode, Cline. Then: a generic memory layer for any
   AI agent.

9/ Fully open source. MIT license.

   The architecture docs are public — this is a real system, not a demo.

10/ Check it out:
    🌐 formativememory.ai
    📦 github.com/[repo]

    Star it if this resonates. PRs welcome.
    I'd love to hear what you think.
```

**Hashtags:** `#AI` `#OpenSource` `#DevTools` `#AIAgents` `#LLM` — use sparingly, 2–3 per tweet max. On X, hashtag-heavy posts look like spam.

**Who to tag/engage with:**

- **AI coding tool creators:** @aaborovkov (Roo Code), @aikirai_dev, @mckaywrigley (Cursor users), @aaborovkov
- **AI/LLM influencers who cover developer tools:** @swyx, @simonw (Simon Willison — covers AI developer tools extensively), @karpathy (if the neuroscience angle is strong enough)
- **Open source AI accounts:** @huggingface, @LangChainAI
- **Developer tool accounts:** @GitHubNext

Don't @ everyone in the launch tweet — engage individually after they naturally discover it, or in reply to their relevant posts.

**Ongoing presence:**

- Share short insights from building: "TIL about Hebbian learning applied to code memory," "Here's what happens when you let AI memory decay"
- Respond to posts about AI memory/context problems with "I'm building something for this: [link]"
- Post technical snippets: the consolidation algorithm, the decay math, real before/after examples

### 2.5 Other Channels

**Dev.to / Hashnode / Medium:**

Write 2–3 blog posts (publish on dev.to and cross-post):

1. **"Why Your AI Agent Has Amnesia (And How to Fix It)"** — The problem post. Hook: everyone's experienced this. Explain the limitations of flat-file memory. Introduce Formative Memory as the solution. This is the post you share on Reddit/HN.

2. **"I Modeled AI Memory After How Your Brain Actually Works"** — The neuroscience deep-dive. Explain the biological parallels: working vs. long-term memory, Hebbian learning, memory consolidation during sleep, decay curves. This is the "interesting" post that gets shared for the ideas, not just the product.

3. **"Building a 10-Step Memory Consolidation Algorithm for AI Agents"** — Pure technical post. Walk through the 10-step consolidation process. Code examples. Architecture diagrams. This is the post that earns credibility with engineers.

**YouTube / Video:**

- **Short demo video (2–3 min):** Screen recording of an AI coding session with vs. without Formative Memory. Show the agent remembering context from previous sessions, surfacing relevant memories, and forgetting irrelevant ones.
- **Technical deep-dive (10–15 min):** Architecture walkthrough. Good for embedding in blog posts and the landing page.
- **Format:** Record with a screen recorder and voiceover. No need for a polished studio setup — developers trust rough, authentic content more than slick marketing.

**Podcasts:**

Target AI/developer podcasts for guest appearances:

| Podcast                                    | Why                                         |
| ------------------------------------------ | ------------------------------------------- |
| Latent Space                               | AI engineering focus, perfect audience      |
| Changelog                                  | Open source focus, large developer audience |
| Practical AI                               | Applied AI, broad developer reach           |
| AI-Powered Devs (various YouTube channels) | Direct target audience                      |

**Pitch angle:** "I built an open source memory system modeled on neuroscience for AI coding agents — here's why flat-file memory doesn't work and what the brain can teach us about AI context."

**GitHub ecosystem:**

- **GitHub Topics:** Tag the repo with: `ai-memory`, `ai-agents`, `openclaw`, `associative-memory`, `developer-tools`, `llm-tools`
- **Awesome lists:** Submit to `awesome-ai-agents`, `awesome-llm-tools`, `awesome-developer-tools`
- **GitHub Trending:** Timing matters. Coordinate the launch across channels to drive stars on the same day/week. GitHub Trending is algorithmic — a burst of activity helps.
- **GitHub Discussions:** Enable and seed with architecture discussions. This builds community directly on the platform where contributors live.

**ProductHunt:**

Submit ~1 week after the initial launch, once there's social proof (stars, comments, HN discussion). ProductHunt audience skews less technical, but it's good for visibility. Prepare assets: logo, screenshots, tagline, maker comment.

---

## 3. README Structure

````markdown
# 🧠 Formative Memory

**Biologically-inspired associative memory for AI coding agents.**

Your AI agent forgets everything between sessions. Formative Memory
fixes that — with memory that forms associations, strengthens through
use, and consolidates during sleep.

[![GitHub stars](badge)][repo]
[![License: MIT](badge)][license]
[![npm version](badge)][npm]
[![Discord](badge)][discord]

---

## The Problem

AI coding agents use flat-file memory — an append-only text file with
no structure, no prioritization, no forgetting. Everything is equally
important. Nothing is connected. Stale information lives forever.

You end up teaching your agent the same things over and over.

## How Formative Memory Works

### Store

Memories are content-addressed objects (SHA-256). When your agent learns
something, it creates a typed memory object with stable identity.

### Associate

Memories form weighted bidirectional associations. When two memories are
retrieved together, their connection strengthens — Hebbian learning for
AI agents.

### Consolidate ("Sleep")

A background process runs when your agent is idle:

1. **Strengthen** memories based on usage
2. **Decay** unused memories (working: 7-cycle half-life, consolidated:
   30-cycle)
3. **Update associations** from co-retrieval patterns
4. **Move** working memory to long-term (strength resets to 1.0)
5. **Merge** duplicate memories
6. **Update** outdated memories based on newer information
7. **Prune** irrelevant memories and weak associations

### Recall

Hybrid search: embedding similarity + BM25 full-text, weighted by
memory strength. Important memories surface first.

## Quick Start

### Install

```bash
openclaw plugin install formative-memory
```
````

### That's it

Formative Memory replaces the default memory system. No configuration
needed — it works out of the box with sensible defaults.

### Configure (optional)

```yaml
# .openclaw/plugins/formative-memory.yaml
consolidation:
  schedule: "0 3 * * *" # 3am daily
  model: "claude-haiku" # cheaper model for consolidation
search:
  embedding_weight: 0.6 # vs BM25
  auto_recall_budget: 2000 # tokens
```

## Architecture

```
┌─────────────┐    ┌──────────────┐    ┌────────────────┐
│  Agent       │───▶│  Memory API  │───▶│  SQLite + FTS5 │
│  (OpenClaw)  │◀───│  (plugin)    │◀───│  + sqlite-vec  │
└─────────────┘    └──────┬───────┘    └────────────────┘
                          │
                    ┌─────▼──────┐
                    │ Retrieval  │──▶ retrieval.log
                    │ Log        │    (append-only)
                    └─────┬──────┘
                          │ (during sleep)
                    ┌─────▼──────┐
                    │ Consoli-   │──▶ 10-step process
                    │ dation     │
                    └────────────┘
```

## The Biological Metaphor

Formative Memory is modeled on how human memory actually works:

| Human Memory                       | Formative Memory                                  |
| ---------------------------------- | ------------------------------------------------- |
| Short-term → long-term memory      | Working → consolidated (with strength reset)      |
| Memories strengthen through recall | Retrieval-based strength reinforcement            |
| Unused memories fade               | Exponential decay during "sleep"                  |
| Sleep consolidation                | Background consolidation process                  |
| Associative recall                 | Weighted bidirectional associations               |
| Memory reconsolidation             | "Coloring" — updating memories with newer context |
| Forgetting                         | Pruning (strength ≤ 0.05)                         |

## Roadmap

- [x] Design complete (architecture docs public)
- [ ] **Phase 1:** OpenClaw plugin (in development)
- [ ] **Phase 2:** Support for Roo, Aider, OpenCode, Cline
- [ ] **Phase 3:** Generic memory layer for any AI agent
- [ ] Association-boosted retrieval
- [ ] Memory-type-specific search strategies
- [ ] Visual memory graph explorer

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md).

Areas where help is especially welcome:

- Consolidation algorithm tuning
- Embedding model benchmarks
- Adapters for other AI coding agents
- Documentation and examples

## License

MIT

## Links

- 🌐 [formativememory.ai](https://formativememory.ai)
- 📖 [Architecture docs](history/)
- 💬 [Discord][discord]
- 🐛 [Issues][issues]

```

---

## 4. Public-Facing Roadmap

### Phase 1: OpenClaw Plugin (current)

**"Give one agent real memory"**

- Content-addressed memory objects with stable identity
- Weighted bidirectional associations between memories
- 10-step consolidation ("sleep") process
- Hybrid search: embedding + BM25, strength-weighted
- Retrieval-based strengthening (Hebbian learning)
- Temporal awareness (future/present/past states)
- Zero DB writes during normal operation
- CLI inspection tools: `memory stats`, `memory inspect`, `memory_browse`
- CLI: `memory stats`, `memory consolidate`, `memory inspect`

### Phase 2: Multi-Agent Support

**"Memory for every AI coding agent"**

- Adapter architecture for different AI coding agents
- **Roo Code** adapter
- **Aider** adapter
- **OpenCode** adapter
- **Cline** adapter
- Agent-agnostic core library (extracted from OpenClaw plugin)
- Shared memory format specification
- Import/export between agents

### Phase 3: Universal Memory Layer

**"Memory infrastructure for AI"**

- Generic memory SDK for any AI agent or application
- Multi-workspace memory (cross-project associations)
- Memory visualization and exploration UI
- Memory sharing between team members (optional, encrypted)
- Memory-type-specific retrieval strategies
- Association graph analysis and insights
- Plugin marketplace for custom consolidation strategies

### Research Directions

- New association discovery during consolidation (random sampling + embedding similarity)
- Adaptive decay rates per memory type
- Multi-modal memory (diagrams, screenshots, terminal output)
- Federated memory across machines

---

## 5. Launch Timeline

### Pre-Launch (now → plugin ready)

**Week -8 to -4: Foundation**
- [ ] Set up formativememory.ai with a "coming soon" page — email signup for launch notification
- [ ] Create GitHub repo with README, architecture docs (public), and clear "in development" status
- [ ] Set up Discord server (or channel in OpenClaw Discord)
- [ ] Create X account (@formativememory or similar)
- [ ] Write blog post #1: "Why Your AI Agent Has Amnesia" (draft, don't publish yet)

**Week -4 to -2: Build Presence**
- [ ] Start posting on X: technical insights from building, neuroscience parallels, development progress
- [ ] Engage with AI coding tool discussions on X, Reddit, Discord — don't promote yet, just be helpful and visible
- [ ] Write blog post #2: "I Modeled AI Memory After How Your Brain Actually Works" (draft)
- [ ] Record short demo video showing the concept (can use prototype/mockup)
- [ ] Submit PRs to OpenClaw (the A-series changes) — this creates visibility in the OpenClaw community
- [ ] Build landing page with animation storyboard (§1.3)

**Week -1: Pre-Launch**
- [ ] Finalize README
- [ ] Finalize landing page
- [ ] Prepare all channel-specific posts (HN, Reddit, X thread)
- [ ] Line up 5–10 people to star the repo on launch day (friends, colleagues, early testers)
- [ ] Test the installation flow end-to-end
- [ ] Write blog post #3: "Building a 10-Step Memory Consolidation Algorithm" (draft)

### Launch Day

**Sequence (all times US Eastern, adjust for author timezone):**

1. **8:00am** — Push final version, make repo public (if was private), publish landing page
2. **8:30am** — Publish blog post #1 on dev.to
3. **9:00am** — Post Show HN (Tuesday or Wednesday only)
4. **9:00am** — Post X launch thread
5. **9:15am** — Post in OpenClaw Discord
6. **9:30am** — Email the launch notification list
7. **All day** — Monitor HN thread, respond to every comment. Monitor X mentions. Engage genuinely.

**Do NOT do on launch day:**
- Post to all Reddit subreddits (wait — see post-launch)
- Submit to ProductHunt (wait 1 week)
- Cold-DM influencers

### Post-Launch: Week 1

- [ ] **Day 2:** Post to r/LocalLLaMA and r/ClaudeAI (if HN went well, reference the discussion)
- [ ] **Day 3:** Post to r/ChatGPTCoding
- [ ] **Day 4:** Publish blog post #2 ("Neuroscience angle")
- [ ] **Day 5:** Post to r/MachineLearning (link to blog post #2)
- [ ] **Day 7:** Publish blog post #3 ("Technical deep-dive"). Share on X.

### Post-Launch: Week 2–4

- [ ] Submit to ProductHunt
- [ ] Submit to awesome-lists on GitHub
- [ ] Pitch to podcasts (Latent Space, Changelog)
- [ ] Engage with issues and PRs — first contributors are gold, treat them well
- [ ] Write a "Week 1" retrospective post (what people said, what surprised you, what's next)
- [ ] Start planning Phase 2 publicly (GitHub Discussions) — let the community influence which agents to support next

### Ongoing

- Weekly X posts: development updates, interesting technical decisions, memory consolidation examples
- Monthly blog post: technical deep-dive on a specific aspect
- Respond to every issue within 24 hours
- Highlight contributors publicly
- Track which channels drive the most stars/engagement — double down on what works

---

## 6. Key Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| "Too complex for the benefit" perception | Lead with the problem, not the solution. Show concrete before/after. Emphasize that it's zero-config by default |
| OpenClaw is niche | Phase 2 roadmap shows this is bigger. The architecture is agent-agnostic by design |
| LLM costs for consolidation | Emphasize: consolidation uses a cheap model and runs infrequently. Jaccard+embedding pre-filter minimizes LLM calls |
| "Why not just use RAG?" | Blog post explaining the difference: RAG is stateless retrieval, Formative Memory is a living memory system with decay, associations, and consolidation |
| Competition from agent-native memory improvements | Move fast. Community matters more than features. Open architecture means the community can outpace any single team |

---

## 7. Success Metrics

**Launch day:**
- 100+ GitHub stars
- HN front page (or top 10 Show HN)
- 50+ email signups

**Month 1:**
- 500+ GitHub stars
- 10+ contributors (issues, PRs, discussions)
- 3+ blog posts published
- Coverage in 1+ newsletter or podcast

**Month 3:**
- 1000+ GitHub stars
- Active Discord community (50+ members)
- Phase 2 in development with community input
- 1+ adapter for a non-OpenClaw agent

These are aspirational targets, not commitments. The real metric is: are developers actually using this and finding it valuable?
```
