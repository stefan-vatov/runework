import assert from 'node:assert/strict'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

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

test('npm pack dry-run succeeds without publish-time manifest corrections', async (t) => {
  const repoRoot = resolve('.')
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
  const result = runCommand(
    npmCommand,
    ['pack', '--dry-run', '--json'],
    repoRoot,
    { env: npmEnv },
  )

  const output = result.stdout || result.stderr || 'command failed without output'
  assert.equal(result.status, 0, output)
  const packed = JSON.parse(result.stdout) as Array<{ filename?: string }>
  assert.equal(Array.isArray(packed), true)
  assert.equal(packed.length > 0, true)
  assert.match(String(packed[0]?.filename), /\.tgz$/)
  assert.doesNotMatch(
    result.stderr,
    /npm warn publish\b/i,
    `pack dry-run reported publish warnings:\n${result.stderr}`,
  )
})
