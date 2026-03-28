# runework

Thin `zx` runtime for durable AI CLI execution. `runework` owns adapters, execution, journaling, templating, and a generic pipeline runtime. It does not ship prompts, review loops, agent rules, or starter workflows.

## Library Usage

```ts
import { getAdapter } from 'runework'

const codex = getAdapter('codex')

const result = await codex.run({
  prompt: 'Summarize this repository',
  cwd: process.cwd(),
})
```

If you only need a one-off prompt, call the provider CLI directly.

## Thin CLI Utilities

Single-provider run:

```bash
npx runework-run codex "Summarize this repository"
```

Availability check:

```bash
npx runework-detect
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

The repository workspace and dogfood tooling live above this package. This package is the public umbrella surface.
