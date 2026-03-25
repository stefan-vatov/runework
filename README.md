# runework

Thin `zx` toolkit for orchestrating `codex`, `claude`, and `opencode` while keeping repo-specific prompts, rules, and pipeline policy inside each target codebase.

## Install

```bash
npm install
npm test
```

Install any wrapped CLIs separately:

- `codex`
- `claude`
- `opencode`

To scaffold another repo from a local checkout, run:

```bash
node --conditions=source src/cli/init.ts /path/to/target-repo
```

## CLI

Single-provider runs:

```bash
npm run run -- codex "Summarize this repository"
npm run run -- claude "Summarize this repository"
npm run run -- opencode "Summarize this repository"
```

Cross-provider compare:

```bash
npm run compare -- "Summarize this repository"
```

Availability check:

```bash
npm run detect
```

All runs are journaled into `.runework/.work/runs/`.

## Releases

This repo uses Nx Release for semantic versioning, changelog generation, and git tags. The public root package and the private bundled workspace packages are versioned together so the publish manifest stays npm-compatible.

```bash
npm run release:dry-run
npm run release
```

Use `npm run release:patch`, `npm run release:minor`, or `npm run release:major` when you want an explicit bump instead of the interactive prompt. See [`docs/releasing.md`](docs/releasing.md) for the exact workflow and the later npm publishing path.

## Library Usage

```ts
import { compareProviders, getAdapter } from 'runework'

const codex = getAdapter('codex')

const result = await codex.run({
  prompt: 'Summarize this repository',
  cwd: process.cwd(),
})

const comparisons = await compareProviders({
  adapters: [codex],
  promptTemplate: 'Summarize {{repo}} in 3 bullets',
  variables: { repo: 'runework' },
  common: { cwd: process.cwd() },
})
```

Provider-specific flags should go through `extraArgs`. `compareProviders()` accepts only request fields supported by every selected adapter.

## Layout

```text
src/
  adapters/     provider wrappers and argv builders
  cli/          small entrypoints
  core/         execution, templating, journaling, JSON helpers
  pipelines/    durable local workflow runtime
  workflows/    reusable orchestration
scripts/
  build.mjs     clean build + CLI permission fixup
templates/
  repo-local/   seed files for per-repo automation
```

## Repo-Local Seeds

Use `templates/repo-local/` as the seed for target repositories. Keep project-specific prompts, skills, rules, and local pipeline policy there so this repo stays focused on primitives and reusable workflows.
