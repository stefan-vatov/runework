# runework

Purpose: thin zx toolkit for coding agents.

Direction:
- Keep this repo on primitives: adapters, execution, templating, journaling, reusable workflows, and generic pipeline runtime.
- Keep repo-specific prompts, rules, and pipeline policy in each target codebase, not here.
- Do not over-abstract provider differences. Expose shared contracts only where they are real; keep `extraArgs` escape hatches.
- Prefer structured outputs over prose when the provider supports them.
- Route CLI execution through `packages/core/src/core/run-cli.ts`; do not scatter zx shell policy.
- Adapter changes are high-risk. Verify real argv behavior and keep tests for command construction.

Read @CONSTITUTION.md and never stray from it in you decision making.
