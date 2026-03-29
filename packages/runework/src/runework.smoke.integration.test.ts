import assert from 'node:assert/strict'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const initBinName = process.platform === 'win32' ? 'runework-init.cmd' : 'runework-init'
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(packageRoot, '..', '..')

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  options?: {
    env?: NodeJS.ProcessEnv
  },
): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: options?.env,
  })
}

function assertSucceeded(
  result: SpawnSyncReturns<string>,
  label: string,
) {
  const detail = result.error?.message
    ?? result.stderr
    ?? result.stdout
    ?? 'command failed without output'
  assert.equal(result.status, 0, `${label}\n${detail}`)
}

function buildWorkspace(repoRoot: string) {
  const commands: Array<{ args: string[]; label: string }> = [
    {
      args: ['scripts/build-package.mjs', 'packages/core/tsconfig.build.json'],
      label: 'building @runework/core failed',
    },
    {
      args: ['scripts/build-package.mjs', 'packages/reporters/tsconfig.build.json'],
      label: 'building @runework/reporters failed',
    },
    {
      args: ['scripts/build-package.mjs', 'packages/pipelines/tsconfig.build.json'],
      label: 'building @runework/pipelines failed',
    },
    {
      args: ['scripts/build-package.mjs', 'packages/cli/tsconfig.build.json'],
      label: 'building @runework/cli failed',
    },
    {
      args: ['scripts/build-package.mjs', 'packages/runework/tsconfig.build.json', '--chmod', 'packages/runework/bin', '--bundle-deps'],
      label: 'building runework package failed',
    },
  ]

  for (const command of commands) {
    assertSucceeded(
      runCommand(process.execPath, command.args, repoRoot),
      command.label,
    )
  }
}

test('packed artifact installs and scaffolds a blank consumer runtime', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-pack-smoke-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const manifest = JSON.parse(
    await readFile(join(packageRoot, 'package.json'), 'utf8'),
  ) as { version: string }

  const packDir = join(tmpRoot, 'pack')
  const consumerDir = join(tmpRoot, 'consumer')
  const targetDir = join(consumerDir, 'repo')
  const npmCacheDir = join(tmpRoot, 'npm-cache')
  const npmEnv: NodeJS.ProcessEnv = {
    ...process.env,
    // Keep npm cache writes inside the test sandbox instead of the caller's global cache.
    npm_config_cache: npmCacheDir,
  }
  await mkdir(packDir, { recursive: true })
  await mkdir(consumerDir, { recursive: true })
  await mkdir(npmCacheDir, { recursive: true })

  buildWorkspace(workspaceRoot)

  assertSucceeded(
    runCommand(
      npmCommand,
      ['pack', '--ignore-scripts', '--pack-destination', packDir],
      packageRoot,
      { env: npmEnv },
    ),
    'npm pack failed for smoke test',
  )

  const tarballs = (await readdir(packDir))
    .filter((entry) => entry.endsWith('.tgz'))
    .sort()
  assert.equal(tarballs.length, 1, `expected one tarball, found: ${tarballs.join(', ')}`)

  const tarballPath = join(packDir, tarballs[0])

  assertSucceeded(
    runCommand(npmCommand, ['init', '-y'], consumerDir, { env: npmEnv }),
    'npm init failed in smoke test consumer',
  )

  assertSucceeded(
    runCommand(npmCommand, ['install', '--ignore-scripts', tarballPath], consumerDir, { env: npmEnv }),
    'installing the packed tarball failed',
  )

  const initBin = join(consumerDir, 'node_modules', '.bin', initBinName)
  assertSucceeded(
    runCommand(
      initBin,
      [targetDir, '--no-install'],
      consumerDir,
    ),
    'installed runework-init failed',
  )

  const generatedPkg = JSON.parse(
    await readFile(join(targetDir, '.runework', 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> }
  assert.equal(generatedPkg.dependencies?.runework, `^${manifest.version}`)
  // runework-pipelines uses a versioned release contract (^0.1.0) for packaged installs
  assert.equal(
    generatedPkg.dependencies?.['runework-pipelines'],
    '^0.1.0',
    'runework-pipelines should use a versioned release contract',
  )

  const runeworkDir = join(targetDir, '.runework')
  const scriptsDir = join(runeworkDir, 'scripts')
  const pipelinesDir = join(runeworkDir, 'pipelines')
  assert.equal((await stat(scriptsDir)).isDirectory(), true)
  assert.equal((await stat(pipelinesDir)).isDirectory(), true)
  assert.deepEqual(await readdir(scriptsDir), [])

  // Pipelines dir should contain thin re-export stubs for ready-made pipelines
  const pipelineFiles = await readdir(pipelinesDir)
  assert.ok(pipelineFiles.includes('code-review.ts'), 'should contain code-review.ts re-export')
  assert.ok(pipelineFiles.includes('constitutional-alignment.ts'), 'should contain constitutional-alignment.ts re-export')

  await writeFile(
    join(pipelinesDir, 'hello.ts'),
    [
      "import { defineWorkflowPipeline } from 'runework/pipelines'",
      '',
      'export default defineWorkflowPipeline({',
      '  version: 1,',
      '  async run(ctx) {',
      "    return { ok: true, summary: `hello ${ctx.runId}` }",
      '  },',
      '})',
      '',
    ].join('\n'),
    'utf8',
  )

  const pipelineImport = runCommand(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const mod = await import('./pipelines/hello.ts'); if (typeof mod.default !== 'function') throw new Error('user-authored pipeline did not export a runnable default')",
    ],
    runeworkDir,
  )
  assertSucceeded(
    pipelineImport,
    'generated pipeline failed to import against the packed artifact',
  )

  const reportersImport = runCommand(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "await import('runework/reporters')",
    ],
    consumerDir,
  )
  assert.notEqual(
    reportersImport.status,
    0,
    'packed runtime unexpectedly exported runework/reporters',
  )
  assert.match(
    [reportersImport.stdout, reportersImport.stderr, reportersImport.error?.message]
      .filter(Boolean)
      .join('\n'),
    /runework\/reporters|ERR_PACKAGE_PATH_NOT_EXPORTED|Cannot find module/,
  )
})
