import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('root facade re-exports core types and functions', async () => {
  const mod = await import('./index.ts')
  assert.equal(typeof mod.getAdapter, 'function')
  assert.equal(typeof mod.getAdapters, 'function')
  assert.equal(typeof mod.runCli, 'function')
  assert.equal(typeof mod.safeJsonParse, 'function')
  assert.equal(typeof mod.renderTemplate, 'function')
  assert.equal(typeof mod.detectTools, 'function')
  assert.equal(typeof mod.codex, 'function')
  assert.equal(typeof mod.claude, 'function')
  assert.equal(typeof mod.opencode, 'function')
  assert.equal(typeof mod.runPipeline, 'function')
  assert.equal('compareProviders' in mod, false)
})

test('subpath exports resolve correctly', async () => {
  const adapters = await import('./adapters/index.ts')
  assert.equal(typeof adapters.getAdapter, 'function')

  const core = await import('./core/index.ts')
  assert.equal(typeof core.runCli, 'function')

  const pipelines = await import('./pipelines/index.ts')
  assert.equal(typeof pipelines.runPipeline, 'function')

  const zx = await import('./zx.ts')
  assert.equal(typeof zx.$, 'function')
})

test('package manifest keeps the published runtime on primitives', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    bundleDependencies?: string[]
    dependencies?: Record<string, string>
    exports?: Record<string, unknown>
  }

  assert.equal('./reporters' in (packageJson.exports ?? {}), false)
  assert.equal('@runework/reporters' in (packageJson.dependencies ?? {}), false)
  assert.equal(
    packageJson.bundleDependencies?.includes('@runework/reporters') ?? false,
    false,
  )
})

test('workspace build graph validates adjacent reporter tooling without exporting it from the root runtime', async () => {
  const buildTsconfig = JSON.parse(
    await readFile(new URL('../tsconfig.build.json', import.meta.url), 'utf8'),
  ) as {
    references?: Array<{ path?: string }>
  }
  const workspaceTsconfig = JSON.parse(
    await readFile(new URL('../tsconfig.json', import.meta.url), 'utf8'),
  ) as {
    references?: Array<{ path?: string }>
  }

  const buildRefs = buildTsconfig.references?.map((ref) => ref.path) ?? []
  const workspaceRefs = workspaceTsconfig.references?.map((ref) => ref.path) ?? []

  assert.ok(buildRefs.includes('packages/reporters/tsconfig.build.json'))
  assert.ok(workspaceRefs.includes('packages/reporters/tsconfig.build.json'))
})

test('CLI helpers re-export from @runework/cli', async () => {
  const helpers = await import('./cli/helpers.ts')
  assert.equal(typeof helpers.resolveRuneworkDir, 'function')
  assert.equal(typeof helpers.runResultExitCode, 'function')
  assert.equal(typeof helpers.defaultRuneworkDependency, 'function')
})

test('dogfood stream reporter emits an immediate startup line and readable provider output', async () => {
  const { createAgentStreamReporter } = await import('../.runework/scripts/pipeline-ui-contract.ts')
  const events: Array<Record<string, unknown>> = []
  const reporter = createAgentStreamReporter(
    {
      progress(event) {
        events.push(event as Record<string, unknown>)
      },
    },
    {
      id: 'cycle:1:align:review-and-fix',
      label: 'constitutional alignment',
      group: 'cycle 1 / align',
      order: 10,
      provider: 'codex',
      cycle: 1,
    },
  )

  reporter.onOutputChunk({
    provider: 'codex',
    stream: 'stdout',
    text: `${JSON.stringify({ type: 'turn.started' })}\n`,
  })
  reporter.flush()

  assert.deepEqual(
    events.filter((event) => event.type === 'dogfood:output'),
    [
      {
        type: 'dogfood:output',
        jobId: 'cycle:1:align:review-and-fix',
        provider: 'codex',
        stream: 'stdout',
        text: 'launching codex...',
      },
      {
        type: 'dogfood:output',
        jobId: 'cycle:1:align:review-and-fix',
        provider: 'codex',
        stream: 'stdout',
        text: 'thinking...',
      },
    ],
  )
})

test('repo-local pipeline script uses source exports during development', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    scripts?: Record<string, unknown>
  }

  assert.equal(
    packageJson.scripts?.pipeline,
    'node --conditions=source .runework/scripts/pipeline.ts',
  )
})
