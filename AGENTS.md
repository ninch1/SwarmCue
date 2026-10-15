# SwarmCue Agent Guidelines

## Project context

SwarmCue is a browser-first, peer-to-peer watch-party application.

Read `docs/architecture.md` before making architectural or multi-file changes. Treat documented decisions as authoritative unless the developer explicitly changes them.

## Working approach

- The developer owns product and architectural decisions.
- Keep changes limited to the current task.
- Prefer simple, explicit implementations over unnecessary abstractions.
- Explain unfamiliar patterns and important tradeoffs.
- Before significant or multi-file changes, present a short plan.
- Do not silently change documented architecture.
- Do not add production dependencies without explaining why they are needed.
- Ask for clarification when ambiguity would materially affect behavior or architecture.
- Do not implement unrelated future features.
- Do not generate the entire application at once.
- Before using an unfamiliar or version-sensitive library API, inspect the official documentation and the installed package’s types or source. Do not rely only on remembered API details. Explain any uncertainty or discrepancy before implementing it.

## Code changes

- Use TypeScript with clear types.
- Avoid premature abstractions and speculative infrastructure.
- Keep domain logic separate from framework and transport code where practical.
- Validate untrusted data at system boundaries.
- Handle errors explicitly.
- Run relevant tests, type checks, and linting after changes.
- Summarize what changed and report any checks that were not run.
- Do not read, expose, or modify secret values or `.env` files.
- Update `.env.example` only when the application's configuration contract changes.

## Learning

When introducing a concept the developer may not know:

1. Explain the problem it solves.
2. Explain how the proposed approach works.
3. Mention meaningful alternatives or tradeoffs.
4. Keep the implementation small enough to review and understand.
