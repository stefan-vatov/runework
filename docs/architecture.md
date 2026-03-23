# Architecture

hammerkit is a thin zx-powered TypeScript toolkit for automating AI CLI tools (codex, claude, opencode). It provides shared primitives — adapters, execution, templating, journaling — that you use from `.hammerkit/` directories in your code repos.

## Repo structure

```
hammerkit/
  scripts/
    build.mjs          # clean dist/, run tsc, chmod CLI entrypoints
  src/
    core/               # shared primitives
      run-cli.ts        # single place for all CLI execution (zx $)
      journal.ts        # write run logs to .hammerkit/.work/runs/
      json.ts           # safeJsonParse, parseJsonLines, toText
      render-template.ts# {{var}} substitution in prompt files
      detect.ts         # check which AI CLIs are installed
    adapters/           # one per provider
      types.ts          # AgentRunRequest, AgentRunResult, AgentAdapter interface
      codex.ts          # OpenAI Codex CLI adapter
      claude.ts         # Claude Code CLI adapter
      opencode.ts       # OpenCode CLI adapter
      registry.ts       # getAdapter('claude'), getAdapters()
      warn.ts           # unsupported field warnings
    workflows/
      compare.ts        # run same prompt across N providers in parallel
    pipelines/
      runtime.ts        # durable pipeline runtime: steps, checkpoints, child pipelines, loops
    cli/
      run.ts            # hammerkit-run: single provider run
      compare.ts        # hammerkit-compare: multi-provider comparison
      detect.ts         # hammerkit-detect: show installed tools
      init.ts           # hammerkit-init: scaffold .hammerkit/ in a target repo
  templates/
    hammerkit/          # scaffolding for .hammerkit/ directories
      package.json.tmpl
      tsconfig.json
      scripts/          # example scripts
      prompts/          # prompt templates
    repo-local/         # AI tool configs for target repos
      AGENTS.md
      .codex/config.toml
      .claude/skills/
      opencode.jsonc
  .hammerkit/           # local testing — dogfoods the library
    package.json        # "hammerkit": "file:.." (symlink to parent)
    tsconfig.json
    scripts/
    prompts/
```

## TypeScript execution model

hammerkit runs TypeScript natively on Node 24 with zero build step for development. The key mechanism is **conditional exports**.

### How it works

The `package.json` exports map has three conditions per entry:

```json
"exports": {
  ".": {
    "source": "./src/index.ts",
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  }
}
```

| Condition | When it matches | What it resolves to |
|---|---|---|
| `source` | `node --conditions=source` | `src/*.ts` — raw TypeScript, type-stripped at runtime by Node 24 |
| `types` | TypeScript compiler / IDE | `dist/*.d.ts` — type declarations |
| `default` | Normal `node` (no flag) | `dist/*.js` — compiled JavaScript |

**For development:** `node --conditions=source src/cli/detect.ts` runs entirely from TypeScript source. No build needed.

**For installed consumers:** plain `node` resolves `dist/*.js`. Their `.hammerkit` scripts should run with plain `node`, not `--conditions=source`.

### Import extensions

Source files use `.ts` extensions in imports:

```ts
import { runCli } from '../core/run-cli.ts'
```

The `rewriteRelativeImportExtensions: true` option in `tsconfig.json` makes `tsc` emit `.js` extensions in dist:

```js
// dist/adapters/codex.js
import { runCli } from "../core/run-cli.js";
```

Both paths resolve correctly — `.ts` in source for Node 24 type stripping, `.js` in dist for standard Node ESM.

### IDE support

The `.hammerkit/tsconfig.json` (and `templates/hammerkit/tsconfig.json`) includes:

```json
"customConditions": ["source"]
```

This tells the TypeScript language server to resolve `import from 'hammerkit'` using the `"source"` condition, so go-to-definition lands in `src/*.ts` instead of `dist/*.d.ts`.

## Adapter design

Each adapter implements `AgentAdapter`:

```ts
interface AgentAdapter {
  readonly name: string
  readonly capabilities: AgentAdapterCapabilities
  run(request: AgentRunRequest): Promise<AgentRunResult>
}
```

The `AgentRunRequest` is a shared contract with fields like `prompt`, `cwd`, `model`, `schema`, `resume`, and `extraArgs`. Not every adapter supports every field — `capabilities` declares what each one handles, and `assertSupportedRequestOptions` throws if you pass unsupported fields.

Every adapter calls `runCli()` for shell execution. This is the single place where zx `$` is used for adapter runs — it sets `quiet`, `nothrow`, `cwd`, `env`, `stdin`, and `timeout` policy.

### Provider-specific notes

**Codex:** Uses `codex exec` with `--json` for event streaming, `--output-last-message` for the final message file, `--output-schema` for structured output. Prompt goes via stdin (`-`). Temp files are cleaned up in a `finally` block.

**Claude:** Uses `claude -p` for non-interactive mode, `--input-format text` for stdin-backed prompts, `--output-format json` for structured output, and `--json-schema` for schema validation.

**OpenCode:** Uses `opencode run` with text output. This is deliberately conservative — the upgrade path is a second adapter using `opencode serve` + the JS SDK when structured JSON output is needed.

## Pipeline runtime

Pipelines are the main repo-local workflow abstraction. The runtime now lives in `src/pipelines/runtime.ts` and is exposed through `hammerkit/pipelines`.

The core split is:

- hammerkit owns generic mechanics: run IDs, persisted step results, checkpoints, child-pipeline invocation, and loop helpers.
- local pipelines own policy: prompts, stopping conditions, branch logic, and repo-specific actions.

`PipelineContext` includes durable helpers such as `step()`, `checkpoint()`, `getCheckpoint()`, `spawn()`, and `repeatUntil()`. `runPipeline()` persists run state under `.hammerkit/.work/<pipeline>/<run-id>/`, and `hammerkit-pipeline --resume-run <run-id>` resumes the same pipeline run from that saved state.

`defineWorkflowPipeline()` is the ergonomic wrapper for versioned durable pipelines:

```ts
import { defineWorkflowPipeline } from 'hammerkit/pipelines'

export default defineWorkflowPipeline({
  version: 1,
  async run(ctx) {
    const diff = await ctx.step('diff', async () => getDiff())
    const result = await ctx.spawn({
      id: 'review',
      pipelineName: 'code-review',
      options: { scope: 'uncommitted' },
    })

    return { ok: result.ok, summary: 'done' }
  },
})
```

## Running the hammerkit repo

```bash
# Typecheck
npm run typecheck

# Run CLI from source (no build)
npm run detect
npm run run -- claude "explain this repo"
npm run compare -- "summarize in 3 bullets"

# Build for publishing
npm run build

# Run tests from source
npm test
```

The source-running dev scripts use `node --conditions=source`. Build and prepare use plain `node`.

## The .hammerkit/ testing directory

The `.hammerkit/` directory at the repo root is for dogfooding. Its `package.json` has `"hammerkit": "file:.."` which creates a symlink at `.hammerkit/node_modules/hammerkit` → `../..` (the hammerkit repo root). Consumer scripts still run with plain `node`; local source resolution is only for hammerkit’s own development workflows.

```bash
cd .hammerkit
npm run review          # runs scripts/review.ts against hammerkit's own source
npm run explain -- src/core/run-cli.ts
```

Changes to `src/` are picked up immediately — no rebuild, no restart.
