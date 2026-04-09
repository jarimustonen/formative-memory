# OpenClaw Associative Memory Plugin

OpenClaw plugin implementing a biologically-inspired associative memory system. Standalone repo; installs as an OpenClaw extension.

## Gitignored directories

- `history/` — agent scratchpad and ephemeral planning docs (not tracked)

## Documentation Pattern

Every directory follows this structure:

- `CLAUDE.md` — symlink to `AGENTS.md`
- `AGENTS.md` — all AI-relevant info (consolidated)
- `AGENTS-<TOPIC>.md` — complex topics split out (optional)

## Issues & Planning

Work is tracked as issues in `issues/`. Use `/issue` to create, search, update, and close issues.

- `issues/open/NN-slug/item.md` — active issues
- `issues/closed/NN-slug/item.md` — completed issues
- `issues/AGENTS.md` — templates, types, and workflow docs

All planning documents (plans, analyses, designs, todos) belong under their parent issue directory — not as standalone files. If work needs a planning document, it also needs an issue. This ties every piece of planning to a trackable item.

- `issues/open/NN-title/plan.md` — architecture, implementation plans
- `issues/open/NN-title/analysis.md` — research and analysis
- `issues/open/NN-title/design.md` — design documents
- `issues/open/NN-title/todo.md` — task checklists
