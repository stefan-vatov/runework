import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

function runCommand(cwd: string, command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

async function createDogfoodRepo(t: { after: (cleanup: () => Promise<void>) => void }) {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-pipeline-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const repoRoot = join(tmpRoot, 'repo')
  const runeworkDir = join(repoRoot, '.runework')
  await mkdir(join(runeworkDir, 'pipelines'), { recursive: true })
  await mkdir(join(runeworkDir, 'node_modules'), { recursive: true })

  const reviewPipeline = await readFile(
    join(process.cwd(), '.runework', 'pipelines', 'code-review.ts'),
    'utf8',
  )
  await writeFile(join(runeworkDir, 'pipelines', 'code-review.ts'), reviewPipeline, 'utf8')
  await symlink(process.cwd(), join(runeworkDir, 'node_modules', 'runework'), 'dir')
  await writeFile(join(repoRoot, 'README.md'), '# temp repo\n', 'utf8')

  runCommand(repoRoot, 'git', ['init', '-b', 'main'])
  runCommand(repoRoot, 'git', ['config', 'user.name', 'Runework Tests'])
  runCommand(repoRoot, 'git', ['config', 'user.email', 'runework@example.com'])
  runCommand(repoRoot, 'git', ['add', 'README.md'])
  runCommand(repoRoot, 'git', ['commit', '-m', 'init'])

  return { repoRoot, runeworkDir }
}

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

test('runPipeline rejects invalid review scopes instead of reporting a clean diff', async (t) => {
  const { runPipeline } = await import('./pipelines/index.ts')
  const { runeworkDir } = await createDogfoodRepo(t)

  await assert.rejects(
    () =>
      runPipeline('code-review', runeworkDir, {
        options: { scope: '__runework_missing_review_scope__' },
        log: () => {},
      }),
    /Invalid review scope "__runework_missing_review_scope__"/,
  )
})
