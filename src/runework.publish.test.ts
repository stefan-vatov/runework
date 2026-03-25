import assert from 'node:assert/strict'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { resolve } from 'node:path'
import test from 'node:test'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  })
}

test('npm publish dry-run succeeds without publish-time manifest corrections', () => {
  const repoRoot = resolve('.')
  const result = runCommand(
    npmCommand,
    ['publish', '--dry-run', '--tag', 'next'],
    repoRoot,
  )

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
  assert.equal(result.status, 0, output)
  assert.doesNotMatch(
    output,
    /npm warn publish\b/i,
    `publish dry-run reported publish warnings:\n${output}`,
  )
})
