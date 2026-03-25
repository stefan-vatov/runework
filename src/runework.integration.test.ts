import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

test('runework-init supports --force and scaffolds install-safe scripts plus pipeline-only tsconfig', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-init-'))
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
    await readFile(join(targetDir, '.runework', 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string>; scripts?: Record<string, string> }
  assert.equal(generatedPkg.dependencies?.runework, `file:${process.cwd()}`)
  assert.equal(generatedPkg.scripts?.review, 'node scripts/review.ts')
  assert.equal(generatedPkg.scripts?.explain, 'node scripts/explain.ts')

  const generatedTsconfig = JSON.parse(
    await readFile(join(targetDir, '.runework', 'tsconfig.json'), 'utf8'),
  ) as { include?: string[] }
  assert.deepEqual(generatedTsconfig.include, [
    'scripts/**/*.ts',
    'pipelines/**/*.ts',
  ])

  await writeFile(join(targetDir, '.runework', 'marker.txt'), 'stale', 'utf8')

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
  await assert.rejects(() => readFile(join(targetDir, '.runework', 'marker.txt'), 'utf8'))
})

test('runPipeline rejects invalid review scopes instead of reporting a clean diff', async () => {
  const { runPipeline } = await import('./pipelines/index.ts')
  await assert.rejects(
    () =>
      runPipeline('code-review', resolve('.runework'), {
        options: { scope: '__runework_missing_review_scope__' },
      }),
    /Invalid review scope "__runework_missing_review_scope__"/,
  )
})
