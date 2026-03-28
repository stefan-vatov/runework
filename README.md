# runework

Thin `zx` runtime for durable AI CLI execution. `runework` owns adapters, execution, journaling, templating, and a generic pipeline runtime. It does not ship prompts, review loops, agent rules, or starter workflows.

## Install

```bash
npm install
npm test
```

Install the provider CLIs you want to use separately. Current built-in adapters:

- `codex`
- `claude`
- `opencode`

If you only need a one-off prompt, call the provider CLI directly. `runework` earns the extra layer when you need durable steps, resumable pipelines, provider composition, or a stable adapter contract.

## Library Usage

```ts
import { getAdapter } from 'runework'

const codex = getAdapter('codex')

const result = await codex.run({
  prompt: 'Summarize this repository',
  cwd: process.cwd(),
})
```

Each adapter result includes `result.command` with the exact `bin`, `args`, and `cwd` used for the underlying CLI invocation.

Provider-specific flags should go through `extraArgs`. Shared request fields stay limited to what the underlying adapter actually supports.

For durable local workflows, author your own pipeline files:

```ts
import { defineWorkflowPipeline } from 'runework/pipelines'

export default defineWorkflowPipeline({
  version: 1,
  async run(ctx) {
    const summary = await ctx.step('summary', async () => 'ready')
    const outputPath = await ctx.writeOutput('summary.txt', summary)
    return { ok: true, outputPath, summary: 'pipeline complete' }
  },
})
```

## Thin CLI Utilities

`runework-run` stays thin. Use it for scripting, journaling, or adapter diagnostics when the provider CLI alone is not enough.

Single-provider run:

```bash
npx runework-run codex "Summarize this repository"
```

Single-provider run with structured JSON output:

```bash
npx runework-run --json codex "Summarize this repository"
```

Availability check:

```bash
npx runework-detect
```

Availability check with structured JSON output:

```bash
npx runework-detect --json
```

Scaffold a blank `.runework/` package in another repo:

```bash
npx runework-init /path/to/target-repo
```

Run a user-authored pipeline from that repo:

```bash
cd /path/to/target-repo/.runework
npx runework-pipeline my-pipeline
```

Run a pipeline with the final result emitted as JSON:

```bash
cd /path/to/target-repo/.runework
npx runework-pipeline --json my-pipeline
```

All adapter runs are journaled into `.runework/.work/runs/` when your scripts or pipelines call `writeJournal()`.

From a source checkout of this repo, the equivalent development commands are `npm run run -- ...`, `npm run detect`, `npm run detect -- --json`, and `node --conditions=source src/cli/init.ts`.

## Scaffold

`runework-init` creates a blank user-owned runtime package:

```text
.runework/
  package.json
  tsconfig.json
  scripts/
  pipelines/
```

You author the scripts, prompts, and policies inside that target repo. `runework` only provides the substrate.

## Layout

```text
packages/
  core/         adapters, execution, templating, journaling, JSON helpers
  pipelines/    durable local pipeline runtime
  cli/          thin CLI command implementations
  reporters/    adjacent reporter utilities kept out of the root runtime surface
src/
  index.ts      root compatibility facade
  adapters/     root adapter re-exports
  core/         root core re-exports
  pipelines/    root pipeline re-exports
  cli/          root entrypoints
scripts/
  build.mjs     clean build + CLI permission fixup
templates/
  runework/     blank .runework scaffold
```
