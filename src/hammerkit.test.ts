import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

// Root compatibility smoke tests — verify facade re-exports resolve correctly
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
  assert.equal(typeof mod.compareProviders, 'function')
  assert.equal(typeof mod.runPipeline, 'function')
})

test('subpath exports resolve correctly', async () => {
  const adapters = await import('./adapters/index.ts')
  assert.equal(typeof adapters.getAdapter, 'function')

  const core = await import('./core/index.ts')
  assert.equal(typeof core.runCli, 'function')

  const workflows = await import('./workflows/index.ts')
  assert.equal(typeof workflows.compareProviders, 'function')

  const pipelines = await import('./pipelines/index.ts')
  assert.equal(typeof pipelines.runPipeline, 'function')

  const zx = await import('./zx.ts')
  assert.equal(typeof zx.$, 'function')

  const ink = await import('./ink.ts')
  assert.equal(typeof ink.render, 'function')
})

test('CLI helpers re-export from @hammerkit/cli', async () => {
  const helpers = await import('./cli/helpers.ts')
  assert.equal(typeof helpers.resolveHammerkitDir, 'function')
  assert.equal(typeof helpers.runResultExitCode, 'function')
  assert.equal(typeof helpers.compareResultsExitCode, 'function')
  assert.equal(typeof helpers.defaultHammerkitDependency, 'function')
})

test('hammerkit-init supports --force and scaffolds install-safe scripts plus pipeline-only tsconfig', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'hammerkit-init-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const targetDir = join(tmpRoot, 'repo')
  await mkdir(targetDir, { recursive: true })

  const initEntry = join(process.cwd(), 'src', 'cli', 'init.ts')
  const baseArgs = [
    '--conditions=source',
    initEntry,
    targetDir,
    '--no-install',
    '--no-ai-config',
  ]

  const first = spawnSync(process.execPath, baseArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  assert.equal(first.status, 0, first.stderr)

  const generatedPkg = JSON.parse(
    await readFile(join(targetDir, '.hammerkit', 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string>; scripts?: Record<string, string> }
  assert.equal(generatedPkg.dependencies?.hammerkit, `file:${process.cwd()}`)
  assert.equal(generatedPkg.scripts?.review, 'node scripts/review.ts')
  assert.equal(generatedPkg.scripts?.explain, 'node scripts/explain.ts')

  const generatedTsconfig = JSON.parse(
    await readFile(join(targetDir, '.hammerkit', 'tsconfig.json'), 'utf8'),
  ) as { include?: string[] }
  assert.deepEqual(generatedTsconfig.include, [
    'scripts/**/*.ts',
    'pipelines/**/*.ts',
  ])

  await writeFile(join(targetDir, '.hammerkit', 'marker.txt'), 'stale', 'utf8')

  const second = spawnSync(process.execPath, baseArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  assert.equal(second.status, 1)
  assert.match(second.stderr, /Use --force or delete it first\./)

  const forced = spawnSync(process.execPath, [...baseArgs, '--force'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  assert.equal(forced.status, 0, forced.stderr)
  await assert.rejects(() => readFile(join(targetDir, '.hammerkit', 'marker.txt'), 'utf8'))
})

test('runPipeline rejects invalid review scopes instead of reporting a clean diff', async () => {
  const { runPipeline } = await import('./pipelines/index.ts')
  await assert.rejects(
    () =>
      runPipeline('code-review', resolve('.hammerkit'), {
        options: { scope: '__hammerkit_missing_review_scope__' },
      }),
    /Invalid review scope "__hammerkit_missing_review_scope__"/,
  )
})
