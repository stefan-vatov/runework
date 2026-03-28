# Using runework in your project

`runework` gives a repository a small, typed execution substrate for AI CLI workflows. It does not bring prompts, rules, or methodology with it. You author those locally.

## Prerequisites

- Node.js 24+
- At least one installed AI CLI: `codex`, `claude`, or `opencode`

## Setup

From a local checkout of `runework`:

```bash
node --conditions=source /path/to/runework/packages/runework/src/cli/init.ts
```

Or from an installed package:

```bash
runework-init
```

This creates a blank `.runework/` package:

```text
.runework/
  package.json
  tsconfig.json
  scripts/
  pipelines/
```

No prompts, review loops, AGENTS files, or tool-specific configs are copied into your repo. Those remain user-owned.

`.runework/.work/` is created lazily on the first pipeline run or journal write.

### Flags

```bash
runework-init [target-dir]
  --no-install
  --force
  --runework-url <url>
```

## Writing scripts

Scripts live in `.runework/scripts/` and run with plain `node`.

```ts
#!/usr/bin/env node
import { getAdapter, writeJournal } from 'runework'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const runeworkDir = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(runeworkDir)

const adapter = getAdapter('claude')
const result = await adapter.run({
  prompt: 'Summarize the current repository state in 3 bullets.',
  cwd: repoRoot,
})

await writeJournal(
  { type: 'summary', provider: adapter.name, ok: result.ok },
  join(runeworkDir, '.work', 'runs'),
)

console.log(result.text)
```

Key imports:

```ts
import { getAdapter, detectTools, renderTemplate, writeJournal } from 'runework'
import { runCli } from 'runework/core'
import { defineWorkflowPipeline, runPipeline } from 'runework/pipelines'
```

If you want prompt files, create your own `.runework/prompts/` directory and load those files yourself. `runework` only provides `renderTemplate()`.

## Writing pipelines

Pipelines live in `.runework/pipelines/` and use the durable runtime from `runework/pipelines`.

```ts
import { defineWorkflowPipeline } from 'runework/pipelines'

export default defineWorkflowPipeline({
  version: 1,
  async run(ctx) {
    const state = await ctx.step('collect-state', async () => {
      return { ready: true }
    })

    const outputPath = await ctx.writeOutput(
      'state.json',
      JSON.stringify(state, null, 2),
    )

    return { ok: true, outputPath, summary: 'pipeline complete' }
  },
})
```

Pipeline helpers on `ctx`:

- `step(id, fn)` caches a durable step result.
- `checkpoint(id, value)` and `getCheckpoint(id)` persist arbitrary state.
- `spawn({ id, pipelineName, options })` runs a child pipeline durably.
- `repeatUntil({ id, initialState, step, until, maxIterations })` handles resumable loops.
- `writeOutput()` stores run artifacts under `.runework/.work/`.

Run a pipeline:

```bash
cd .runework
npx runework-pipeline my-pipeline
```

For agent callers that want a machine-readable result:

```bash
cd .runework
npx runework-pipeline --json my-pipeline
```

In `--json` mode, progress stays on `stderr` and the final pipeline result is written as JSON on `stdout`.

Resume a failed run:

```bash
cd .runework
npx runework-pipeline my-pipeline --resume-run <run-id>
```

## Journals and outputs

`writeJournal()` writes run metadata into `.runework/.work/runs/`.

Pipeline state, checkpoints, and outputs live under `.runework/.work/<pipeline>/<run-id>/`.

## Detecting tools

```ts
import { detectTools } from 'runework'

const tools = await detectTools()
const available = tools.filter((tool) => tool.available)
```

CLI callers can also use `runework-detect --json` to inspect installed tools together with each adapter's declared capability surface.

## Updating runework

```bash
cd /path/to/runework && git pull
cd /path/to/your/repo/.runework && npm install
```

When scaffolded from a local checkout, `.runework/package.json` uses a local `file:` dependency. When scaffolded from an installed package, it uses a versioned dependency.
