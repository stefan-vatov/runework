import assert from 'node:assert/strict'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
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

test('npm publish dry-run succeeds without publish-time manifest corrections', async (t) => {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), 'runework-publish-test-'))
  const npmCacheDir = resolve(tmpRoot, 'npm-cache')
  const npmEnv: NodeJS.ProcessEnv = {
    ...process.env,
    npm_config_cache: npmCacheDir,
  }

  await mkdir(npmCacheDir, { recursive: true })
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const buildResult = runCommand(
    process.execPath,
    [
      'scripts/build-package.mjs',
      'packages/runework/tsconfig.build.json',
      '--chmod',
      'packages/runework/bin',
      '--bundle-deps',
    ],
    workspaceRoot,
    { env: npmEnv },
  )
  const buildOutput = [buildResult.stdout, buildResult.stderr].filter(Boolean).join('\n')
  assert.equal(buildResult.status, 0, buildOutput)

  const result = runCommand(
    npmCommand,
    ['publish', '--dry-run', '--tag', 'next'],
    packageRoot,
    { env: npmEnv },
  )

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
  assert.equal(result.status, 0, output)
  assert.doesNotMatch(
    output,
    /npm warn publish\b/i,
    `publish dry-run reported publish warnings:\n${output}`,
  )
})
