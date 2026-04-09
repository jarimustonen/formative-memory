# Website Plan: formativememory.ai

> **Date:** 2026-04-08
> **Status:** Plan

---

## 1. Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Generator** | Astro | Static-first, zero JS by default, component islands for interactive elements (animation). Fast build, good DX. |
| **Styling** | Tailwind CSS | Utility-first, dark theme friendly, no runtime cost |
| **Animation** | CSS scroll-driven + Lottie fallback | Scroll-driven animations are native, performant, user-paced. Lottie for complex sequences |
| **Hosting** | Cloudflare Pages | Free tier sufficient, global CDN, fast deploys from Git |
| **Domain** | formativememory.ai | Already planned |
| **Repository** | Separate repo (`formativememory-site`) | Decoupled from plugin development lifecycle |
| **Analytics** | Plausible or none | Privacy-respecting, no cookie banner needed |

### Why Astro over alternatives

- **vs Next.js:** No SSR needed, no React runtime needed. Landing page is content, not app.
- **vs Hugo:** Astro supports component islands (needed for scroll animation). Better ecosystem for interactive elements.
- **vs plain HTML:** Astro gives component reuse, markdown support, and build-time optimization without runtime cost.

---

## 2. Page Structure

```
┌─────────────────────────────────────────────────────┐
│  Nav: Logo | GitHub | Docs | Discord                │
├─────────────────────────────────────────────────────┤
│  Hero                                               │
│  "Your AI agent forgets everything.                 │
│   What if it didn't?"                               │
│                                                     │
│  Subhead: practical value prop (2 sentences)        │
│  [Star on GitHub]  [Get Started]                    │
├─────────────────────────────────────────────────────┤
│  The Problem                                        │
│  Before/After comparison table                      │
│  (flat memory vs Formative Memory)                  │
├─────────────────────────────────────────────────────┤
│  How It Works (scroll-driven animation)             │
│  Frame 1: Store (content-addressed memory)          │
│  Frame 2: Associate (co-retrieval linking)          │
│  Frame 3: Consolidate (sleep cycle)                 │
│  Frame 4: Recall (hybrid search)                    │
├─────────────────────────────────────────────────────┤
│  Key Features (4 cards)                             │
│  - Automatic recall with token budget awareness     │
│  - Hybrid semantic + keyword search                 │
│  - Self-maintaining: decay, prune, merge            │
│  - Temporal awareness (future/present/past)         │
├─────────────────────────────────────────────────────┤
│  Quick Start                                        │
│  3-step install + first interaction example         │
├─────────────────────────────────────────────────────┤
│  Design Principles (operationally disciplined)      │
│  - No memory mutations during live chat             │
│  - Explicit, inspectable consolidation              │
│  - Content-addressed deduplication                  │
│  - Memory treated as untrusted data                 │
├─────────────────────────────────────────────────────┤
│  Roadmap                                            │
│  Phase 1 (OpenClaw) → Phase 2 (multi-agent)        │
│  → Phase 3 (universal memory layer)                 │
├─────────────────────────────────────────────────────┤
│  Footer                                             │
│  GitHub | Docs | Discord | License: MIT             │
└─────────────────────────────────────────────────────┘
```

---

## 3. Content Strategy

### Tone
Direct and technical. Not marketing-speak. The audience is developers — show the architecture, show the algorithm, explain _why_ this is different. The biological metaphor is the hook, but the engineering is the substance.

### Key messaging hierarchy
1. **Primary:** Better long-term memory for your AI coding agent
2. **Secondary:** Biologically-inspired model (strengthen, decay, associate, consolidate)
3. **Tertiary:** Operationally disciplined — no live mutations, explicit maintenance

### Hero copy
- **Headline:** "Your AI agent forgets everything. What if it didn't?"
- **Subhead:** "Formative Memory gives OpenClaw persistent memory that reinforces what matters, forgets what doesn't, and recalls relevant knowledge automatically."
- **CTA:** [Star on GitHub] [Get Started →]

### Before/After table (prominent, near top)

|               | Flat-file memory      | Formative Memory                                    |
|---------------|-----------------------|-----------------------------------------------------|
| Structure     | Append-only text file | Content-addressed memory objects with associations  |
| Relevance     | Everything is equal   | Strength-weighted: used memories surface, unused decay |
| Duplicates    | Accumulate forever    | Prevented at creation, merged during consolidation  |
| Stale info    | Stays forever         | Updated or pruned during sleep cycles               |
| Connections   | None                  | Weighted bidirectional associations                  |
| Maintenance   | Manual pruning        | Automatic via consolidation                         |

---

## 4. Animation (scroll-driven)

Reuse the storyboard from `plan-gtm-formativememory.md` §1.3 with these adjustments:

- **Implementation:** CSS scroll-driven animation (native `animation-timeline: scroll()`). No JS framework.
- **Fallback:** Static SVG infographic for `prefers-reduced-motion` and no-JS.
- **Mobile:** Vertical scroll, simplified network graph (fewer nodes).
- **Performance:** Lazy-load animation section. Hero + problem sections render instantly.
- **Complexity budget:** 4 frames max. Keep it clean.

---

## 5. Pre-launch: "Coming Soon" page

Deploy immediately with:
- Hero headline + subhead
- Email signup (Buttondown or similar — no heavy service)
- GitHub link (if repo is public)
- "Launching soon" status

This captures early interest from GTM activities.

---

## 6. Post-launch additions

- Blog section (dev.to cross-posts)
- Documentation deep-links
- Demo video embed
- Community links (Discord, GitHub Discussions)

---

## 7. Implementation Timeline

| Step | Description | Effort |
|------|-------------|--------|
| 1 | Set up Astro project, deploy "coming soon" to Cloudflare Pages | 2h |
| 2 | Build full landing page structure (static, no animation) | 4h |
| 3 | Add scroll-driven animation | 4–8h |
| 4 | Content polish, mobile testing, accessibility | 2h |
| 5 | Connect domain, final deploy | 1h |

Total: ~2 days of focused work.
