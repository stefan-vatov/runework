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

test('root facade stays on public package surfaces instead of redundant internal re-exports', async () => {
  const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8')

  assert.deepEqual(
    source
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('export *')),
    [
      "export * from '@runework/core'",
      "export * from '@runework/pipelines'",
    ],
  )
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
    description?: string
    exports?: Record<string, unknown>
  }

  assert.equal('./reporters' in (packageJson.exports ?? {}), false)
  assert.equal('@runework/reporters' in (packageJson.dependencies ?? {}), false)
  assert.equal(
    packageJson.bundleDependencies?.includes('@runework/reporters') ?? false,
    false,
  )
  assert.match(packageJson.description ?? '', /\bthin\b/i)
  assert.match(packageJson.description ?? '', /\bruntime\b/i)
  assert.doesNotMatch(packageJson.description ?? '', /\bautomation toolkit\b/i)
  assert.doesNotMatch(packageJson.description ?? '', /\bcodex\b|\bclaude\b|\bopencode\b/i)
})

test('README keeps the public positioning library-first and direct-CLI friendly', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')

  assert.match(
    readme,
    /If you only need a one-off prompt, call the provider CLI directly\./,
  )
  assert.match(readme, /## Thin CLI Utilities/)

  const libraryUsageIndex = readme.indexOf('## Library Usage')
  const thinCliIndex = readme.indexOf('## Thin CLI Utilities')

  assert.ok(libraryUsageIndex >= 0, 'README should document library usage')
  assert.ok(thinCliIndex >= 0, 'README should document the thin CLI utilities')
  assert.ok(
    libraryUsageIndex < thinCliIndex,
    'README should present library usage before thin CLI utilities',
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

test('release config only targets real Nx projects', async () => {
  const nxJson = JSON.parse(
    await readFile(new URL('../nx.json', import.meta.url), 'utf8'),
  ) as {
    release?: { projects?: string[] }
  }

  const knownProjects = new Set(
    (await Promise.all([
      '../project.json',
      '../packages/core/project.json',
      '../packages/pipelines/project.json',
      '../packages/cli/project.json',
      '../packages/reporters/project.json',
    ].map(async (path) => {
      const projectJson = JSON.parse(
        await readFile(new URL(path, import.meta.url), 'utf8'),
      ) as { name?: string }
      return projectJson.name
    }))).filter((name): name is string => Boolean(name)),
  )

  const unknownReleaseProjects = (nxJson.release?.projects ?? [])
    .filter((name) => !knownProjects.has(name))

  assert.deepEqual(unknownReleaseProjects, [])
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

test('stream viewport wraps commentary and collapses repeated stderr noise', async () => {
  const { buildStreamViewportLines } = await import('../.runework/scripts/pipeline-ui.ts')

  const lines = buildStreamViewportLines(
    [
      {
        stream: 'stderr',
        text: '2026-03-28T14:05:21.647492Z ERROR loader failed',
      },
      {
        stream: 'stderr',
        text: '2026-03-28T14:05:21.647908Z ERROR loader failed',
      },
      {
        stream: 'stderr',
        text: '2026-03-28T14:05:21.648068Z ERROR loader failed',
      },
      {
        stream: 'stdout',
        text: 'This commentary should wrap across multiple viewport rows cleanly.',
      },
    ],
    26,
    10,
  ).map((line) => line.text).filter((line) => line.trim())

  assert.deepEqual(lines, [
    '! ERROR loader failed [x3]',
    '› This commentary should',
    '  wrap across multiple',
    '  viewport rows cleanly.',
  ])
})

test('stream viewport supports scrolling back through prior output', async () => {
  const { buildStreamViewportLines } = await import('../.runework/scripts/pipeline-ui.ts')

  const lines = buildStreamViewportLines(
    [
      { stream: 'stdout', text: 'alpha' },
      { stream: 'stdout', text: 'beta' },
      { stream: 'stdout', text: 'gamma' },
      { stream: 'stdout', text: 'delta' },
    ],
    24,
    2,
    1,
  ).map((line) => line.text)

  assert.deepEqual(lines, [
    '› beta',
    '› gamma',
  ])
})

test('mouse wheel parser converts sgr mouse scroll sequences into viewport deltas', async () => {
  const { extractMouseWheelDelta } = await import('../.runework/scripts/pipeline-ui.ts')

  assert.equal(
    extractMouseWheelDelta('\u001B[<64;30;12M\u001B[<65;30;12M\u001B[<64;30;12M'),
    1,
  )
  assert.equal(
    extractMouseWheelDelta('\u001B[<0;30;12M'),
    0,
  )
})

test('ink exit input mapper treats q and both Ctrl+C encodings as clean exits', async () => {
  const { getExitRequestCode } = await import('../.runework/scripts/pipeline-ui.ts')

  assert.equal(getExitRequestCode('q', {}), 0)
  assert.equal(getExitRequestCode('c', { ctrl: true }), 0)
  assert.equal(getExitRequestCode('\u0003', {}), 0)
  assert.equal(getExitRequestCode('q', { meta: true }), undefined)
  assert.equal(getExitRequestCode('x', {}), undefined)
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

test('constitutional alignment dogfood pipeline uses pipeline-managed adapters', async () => {
  const source = await readFile(
    new URL('../.runework/pipelines/constitutional-alignment.ts', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(source, /import\s*{\s*codex\b/)
  assert.match(source, /ctx\.adapters\.codex/)
  assert.match(source, /ctx\.codexAdapter\.run\(/)
})

test('constitutional alignment dogfood pipeline preserves AbortError from codex runs', async () => {
  const source = await readFile(
    new URL('../.runework/pipelines/constitutional-alignment.ts', import.meta.url),
    'utf8',
  )

  assert.match(source, /function isAbortError\(error: unknown\)/)
  assert.ok(
    (source.match(/if \(isAbortError\(error\)\) throw error/g) ?? []).length >= 2,
  )
})
