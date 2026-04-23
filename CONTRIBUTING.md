# Contributing to Formative Memory

Thanks for your interest in contributing! This guide covers how to set up the project and submit changes.

## Setup

```bash
git clone https://github.com/jarimustonen/formative-memory.git
cd formative-memory
pnpm install
```

Requires **Node.js >= 22.12.0** and **pnpm 10.x**.

## Development

```bash
pnpm build            # Build with tsdown
pnpm test             # Run tests with vitest
pnpm test:watch       # Run tests in watch mode
pnpm lint             # Lint with oxlint
pnpm format:check     # Check formatting with oxfmt
pnpm check            # Full check (format + typecheck + lint)
```

## Code Style

- **Linting:** [oxlint](https://oxc.rs/docs/guide/usage/linter) — run `pnpm lint` or `pnpm lint:fix`
- **Formatting:** [oxfmt](https://oxc.rs/docs/guide/usage/formatter) — run `pnpm format` to auto-format

Please run `pnpm check` before submitting a PR to catch formatting, type, and lint issues.

## Submitting Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm check` and `pnpm test` to verify everything passes
4. Open a pull request with a clear description of the change

Keep PRs focused — one logical change per PR makes review easier.

## Areas Where Help Is Welcome

- **Consolidation algorithm** — tuning decay rates, merge heuristics, evaluation
- **Embedding model benchmarks** — comparing providers and models for retrieval quality
- **Adapters for other AI coding agents** — porting beyond OpenClaw
- **Documentation and examples** — usage guides, tutorials, real-world examples
- **Bug reports** — if something doesn't work as expected, please open an issue

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
