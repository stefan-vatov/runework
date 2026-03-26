# runework

Thin `zx` runtime for durable AI CLI execution. `runework` owns adapters, execution, journaling, templating, and a generic pipeline runtime. It does not ship prompts, review loops, agent rules, or starter workflows.

## Install

```bash
npm install
npm test
```

Install any wrapped CLIs separately:

- `codex`
- `claude`
- `opencode`

## CLI

Single-provider run:

```bash
npm run run -- codex "Summarize this repository"
```

Availability check:

```bash
npm run detect
```

Scaffold a blank `.runework/` package in another repo:

```bash
node --conditions=source src/cli/init.ts /path/to/target-repo
```

Run a user-authored pipeline from that repo:

```bash
cd /path/to/target-repo/.runework
npx runework-pipeline my-pipeline
```

All adapter runs are journaled into `.runework/.work/runs/` when your scripts or pipelines call `writeJournal()`.

## Library Usage

```ts
import { getAdapter } from 'runework'

const codex = getAdapter('codex')

const result = await codex.run({
  prompt: 'Summarize this repository',
  cwd: process.cwd(),
})
```

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
src/
  adapters/     provider wrappers and argv builders
  cli/          thin entrypoints
  core/         execution, templating, journaling, JSON helpers
  pipelines/    durable local pipeline runtime
scripts/
  build.mjs     clean build + CLI permission fixup
templates/
  runework/     blank .runework scaffold
```
