# Using hammerkit in your project

hammerkit lets you write AI automation scripts in any repo — Elixir, Rust, Go, Python, whatever. Scripts live in a `.hammerkit/` directory that's a self-contained Node package. Your project root stays clean.

## Prerequisites

- Node.js 24+ (native TypeScript support, no build step needed)
- At least one AI CLI tool installed: `codex`, `claude`, or `opencode`

## Setup

From a local checkout of hammerkit, run this in your project root:

```bash
node --conditions=source /path/to/hammerkit/src/cli/init.ts
```

This creates:

```
.hammerkit/
  package.json        hammerkit + zx dependencies
  tsconfig.json       IDE support (autocomplete, type checking)
  node_modules/       gitignored
  .work/              pipeline + journal output (gitignored)
  scripts/
    review.ts         example: review current diff
    explain.ts        example: explain a file
  prompts/
    pr-summary.md     prompt template
    explain-file.md   prompt template
  pipelines/
    code-review.ts    durable local workflow
```

It also copies AI tool configs to your repo root (AGENTS.md, .codex/, .claude/, opencode.jsonc) and updates your `.gitignore`.

### Flags

```bash
hammerkit-init [target-dir]     # defaults to current directory
  --no-install              # skip npm install
  --no-ai-config            # skip copying AI tool configs to repo root
  --hammerkit-url <url>     # override hammerkit dependency
```

## Writing scripts

Scripts are TypeScript files in `.hammerkit/scripts/`. They import from `hammerkit` and `zx`. Node 24 runs `.ts` files natively — no compilation, no tsx.

```ts
#!/usr/bin/env node
import { getAdapter, renderTemplate, writeJournal } from 'hammerkit'
import { $ } from 'zx'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve paths relative to the script
const hammerkitDir = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(hammerkitDir)

// Use zx for shell commands
const branch = (await $({ quiet: true })`git rev-parse --abbrev-ref HEAD`).stdout.trim()

// Use hammerkit adapters to call AI tools
const claude = getAdapter('claude')
const result = await claude.run({
  prompt: `Summarize what happened on branch ${branch}`,
  cwd: repoRoot,
})

// Journal the result
await writeJournal(
  { type: 'summary', provider: 'claude', branch, ok: result.ok },
  join(hammerkitDir, '.work', 'runs'),
)

console.log(result.text)
```

### Runtime note

Consumer `.hammerkit` scripts should run with plain `node`. `--conditions=source` is for hammerkit development itself, not for installed consumer dependencies inside `node_modules`.

### Key imports

```ts
// Everything from one import
import { getAdapter, getAdapters, renderTemplate, writeJournal, detectTools, compareProviders } from 'hammerkit'

// Or use subpath imports for targeted access
import { ClaudeAdapter, CodexAdapter } from 'hammerkit/adapters'
import { runCli, renderTemplate } from 'hammerkit/core'
import { compareProviders } from 'hammerkit/workflows'

// zx for shell operations
import { $ } from 'zx'
```

## Running scripts

Three ways, pick what you prefer:

### Option 1: node directly (recommended)

```bash
cd .hammerkit && node scripts/review.ts
cd .hammerkit && node scripts/explain.ts src/main.rs
```

Or use the npm scripts defined in `.hammerkit/package.json`:

```bash
cd .hammerkit && npm run review
cd .hammerkit && npm run explain -- src/main.rs
```

### Option 2: Shebang (most ergonomic)

Scripts have `#!/usr/bin/env node`. Make them executable:

```bash
chmod +x .hammerkit/scripts/*.ts
.hammerkit/scripts/review.ts
.hammerkit/scripts/explain.ts src/main.rs
```

### Option 3: Wrapper scripts (for teams)

Create thin shell wrappers in your project's `bin/` directory:

```bash
#!/usr/bin/env bash
cd "$(dirname "$0")/../.hammerkit" && node scripts/review.ts "$@"
```

## Writing pipelines

Pipelines are the primary local workflow unit. Put the actual workflow meat in `.hammerkit/pipelines/*.ts`, and use hammerkit's runtime helpers for checkpoints, child-pipeline calls, and loop control instead of rebuilding that machinery in every repo.

```ts
import { defineWorkflowPipeline } from 'hammerkit/pipelines'

export default defineWorkflowPipeline({
  version: 1,
  async run(ctx) {
    const plan = await ctx.step('plan', async () => {
      return { attempts: 0 }
    })

    const finalState = await ctx.repeatUntil({
      id: 'fix-loop',
      initialState: plan,
      async step(state, iteration) {
        const review = await ctx.spawn({
          id: `review-${iteration}`,
          pipelineName: 'code-review',
          options: { scope: 'uncommitted' },
        })

        return {
          attempts: state.attempts + 1,
          done: review.ok,
        }
      },
      until(state) {
        return Boolean(state.done) || state.attempts >= 3
      },
    })

    const output = await ctx.writeOutput('state.json', JSON.stringify(finalState, null, 2))
    return { ok: true, outputPath: output, summary: 'workflow complete' }
  },
})
```

Pipeline runtime helpers available on `ctx`:

- `ctx.step(id, fn)` runs a durable step once per pipeline run and reuses the saved result on resume.
- `ctx.checkpoint(id, value)` and `ctx.getCheckpoint(id)` persist arbitrary loop state.
- `ctx.spawn({ id, pipelineName, options })` runs a child pipeline once and caches its result for the parent run.
- `ctx.repeatUntil({ id, initialState, step, until, maxIterations })` provides reusable loop control.
- `ctx.runId`, `ctx.outputDir`, and `ctx.isResume` let a pipeline reason about its current durable run.

Run a pipeline with:

```bash
cd .hammerkit && npx hammerkit-pipeline code-review
```

Resume a failed or interrupted run with:

```bash
cd .hammerkit && npx hammerkit-pipeline code-review --resume-run <run-id>
```

## Prompt templates

Put reusable prompts in `.hammerkit/prompts/` with `{{variable}}` placeholders:

```markdown
<!-- .hammerkit/prompts/review-file.md -->
Review {{path}} for:
- Logic errors
- Missing error handling
- Security issues
```

Load and render in scripts:

```ts
import { renderTemplate } from 'hammerkit'
import { readFile } from 'node:fs/promises'

const template = await readFile('.hammerkit/prompts/review-file.md', 'utf8')
const prompt = renderTemplate(template, { path: 'src/auth.rs' })
```

## Journal

Every adapter run can be logged to `.hammerkit/.work/runs/`. Pass the path when calling `writeJournal`:

```ts
import { writeJournal } from 'hammerkit'

await writeJournal(
  { type: 'review', provider: 'claude', ok: true },
  '.hammerkit/.work/runs',
)
// Writes: .hammerkit/.work/runs/2026-03-22/2026-03-22T10-30-00-000Z-a1b2c3d4.json
```

The `.work/` directory is gitignored by default.

## Updating hammerkit

```bash
cd /path/to/hammerkit && git pull
cd /path/to/your/repo/.hammerkit && npm install
```

The default scaffold uses a local `file:` dependency while hammerkit is private. When you publish it later, switch `.hammerkit/package.json` to a versioned dependency:

```json
{
  "dependencies": {
    "hammerkit": "^0.2.0"
  }
}
```

## Detecting available tools

Check which AI CLIs are installed:

```ts
import { detectTools } from 'hammerkit'

const tools = await detectTools()
const available = tools.filter(t => t.available)
console.log(available.map(t => `${t.name} ${t.version}`))
```

Or from the command line:

```bash
cd .hammerkit && npx hammerkit-detect
```

## Comparing providers

Run the same prompt across multiple providers in parallel:

```ts
import { getAdapters, compareProviders } from 'hammerkit'

const results = await compareProviders({
  adapters: getAdapters(),
  promptTemplate: 'Explain {{path}} in one paragraph',
  variables: { path: 'src/main.rs' },
  common: { cwd: '/path/to/repo' },
})

for (const r of results) {
  console.log(`${r.provider}: ${r.text.slice(0, 200)}...`)
}
```
