# Architecture

`runework` is a thin TypeScript runtime for AI CLI execution. The repo stays on primitives: adapters, command execution, journaling, templating, and a durable local pipeline runtime. Prompts, review policies, and workflow methodology belong in consumer repos.

## Repo structure

```text
runework/
  scripts/
    build.mjs          # workspace build entrypoint
  src/
    core/
      run-cli.ts       # shared zx-backed CLI execution
      journal.ts       # write run logs under .runework/.work/
      json.ts          # safeJsonParse, parseJsonLines, toText
      render-template.ts
      detect.ts        # installed tool detection
    adapters/
      types.ts
      codex.ts
      claude.ts
      opencode.ts
      registry.ts
    pipelines/
      runtime.ts       # durable steps, checkpoints, child runs, resume
      runner.ts        # load user-authored pipelines from .runework/pipelines/
    cli/
      run.ts
      detect.ts
      init.ts
      pipeline.ts
  templates/
    runework/
      package.json.tmpl
      tsconfig.json
```

## TypeScript execution model

The package uses conditional exports:

```json
"exports": {
  ".": {
    "source": "./src/index.ts",
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  }
}
```

- `node --conditions=source` resolves to `src/*.ts` for repository development.
- TypeScript and editors resolve to `dist/*.d.ts`.
- Standard Node resolution uses `dist/*.js` for installed consumers.

Source imports use `.ts` extensions so Node 24 can execute the source tree directly, while TypeScript rewrites those imports to `.js` in `dist/`.

## Adapter design

Each adapter implements a shared `AgentAdapter` contract:

```ts
interface AgentAdapter {
  readonly name: string
  readonly capabilities: AgentAdapterCapabilities
  run(request: AgentRunRequest): Promise<AgentRunResult>
}
```

The contract is intentionally narrow:

- `capabilities` declares which request features a provider actually supports.
- `extraArgs` remains the escape hatch for provider-specific flags.
- adapters build honest argv and pass execution through `runCli()`.

`runCli()` is the single place where zx command execution policy lives.

## Pipeline runtime

The pipeline runtime is generic and durable. It loads user-authored files from `.runework/pipelines/` and persists state under `.runework/.work/`.

Core helpers:

- `step()` for cached steps
- `checkpoint()` and `getCheckpoint()` for persistent state
- `spawn()` for child pipelines
- `repeatUntil()` for resumable loops
- `writeOutput()` for run artifacts

`defineWorkflowPipeline()` is a light helper over that same runtime. Higher-order workflow shapes belong in consumer packages, not in the runtime itself.

## CLI surface

The CLI remains thin:

- `runework-run` executes a single adapter call.
- `runework-detect` reports installed tools.
- `runework-init` creates a blank `.runework/` package.
- `runework-pipeline` runs a user-authored pipeline by name.

There is no built-in workflow catalog, review loop, prompt library, or rich TUI. Consumer packages can build those on top of the runtime if they want them.

## Scaffold contract

`runework-init` writes a blank user-owned runtime package:

```text
.runework/
  package.json
  tsconfig.json
  scripts/
  pipelines/
```

That scaffold is intentionally empty. The consuming repo authors its own prompts, scripts, policies, and pipeline definitions.
