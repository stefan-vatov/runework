import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'

import {
  resolveRuneworkDir,
  runResultExitCode,
  defaultRuneworkDependency,
} from './helpers.ts'
import { runCommand } from './run.ts'

test('CLI helper functions compute runtime paths and exit codes safely', () => {
  assert.equal(resolveRuneworkDir('/tmp/repo'), resolve('/tmp/repo', '.runework'))
  assert.equal(resolveRuneworkDir('/tmp/repo/.runework'), '/tmp/repo/.runework')

  assert.equal(runResultExitCode({ ok: true, exitCode: 9 }), 0)
  assert.equal(runResultExitCode({ ok: false, exitCode: 17 }), 17)
  assert.equal(runResultExitCode({ ok: false, exitCode: null }), 1)

  assert.equal(
    defaultRuneworkDependency('0.1.0', '/pkg', '/pkg/src/cli'),
    'file:/pkg',
  )
  assert.equal(
    defaultRuneworkDependency('0.1.0', '/pkg', '/pkg/dist/cli'),
    '^0.1.0',
  )
})

test('runCommand returns 1 when no arguments provided', async () => {
  const code = await runCommand([])
  assert.equal(code, 1)
})

test('runCommand returns 1 when only provider is given (no prompt)', async () => {
  const code = await runCommand(['claude'])
  assert.equal(code, 1)
})
