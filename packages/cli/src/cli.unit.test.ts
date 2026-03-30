import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'

import {
  consumeFlag,
  resolveRuneworkDir,
  runResultExitCode,
  defaultRuneworkDependency,
  defaultRuneworkPipelinesDependency,
} from './helpers.ts'
import { runCommand } from './run.ts'

test('CLI helper functions compute runtime paths and exit codes safely', () => {
  assert.deepEqual(
    consumeFlag(['--json', 'codex', 'hello'], '--json'),
    { enabled: true, rest: ['codex', 'hello'] },
  )
  assert.deepEqual(
    consumeFlag(['codex', 'hello'], '--json'),
    { enabled: false, rest: ['codex', 'hello'] },
  )

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
    'github:stefan-vatov/runework#v0.1.0',
  )
  assert.equal(
    defaultRuneworkDependency('0.1.0', '/pkg', '/pkg/dist/cli'),
    'github:stefan-vatov/runework#v0.1.0',
  )
  assert.equal(
    defaultRuneworkPipelinesDependency('0.1.0', '/pkg', '/pkg/src/cli'),
    'file:/runework-pipelines',
  )
  assert.equal(
    defaultRuneworkPipelinesDependency('0.1.0', '/pkg', '/pkg/dist/cli'),
    'github:stefan-vatov/runework-pipelines#main',
  )
})

test('runCommand returns 1 when no arguments provided', async () => {
  const errors: string[] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => {
    errors.push(args.join(' '))
  }

  try {
    const code = await runCommand([])
    assert.equal(code, 1)
    const output = errors.join('\n')
    assert.match(output, /Usage: runework-run \[--json\] <provider> "<prompt>"/)
    assert.match(
      output,
      /For one-off prompts, call the provider CLI directly\. Use runework when you need journaling or a stable adapter contract\./,
    )
  } finally {
    console.error = originalError
  }
})

test('runCommand returns 1 when only provider is given (no prompt)', async () => {
  const code = await runCommand(['claude'])
  assert.equal(code, 1)
})

test('runCommand emits structured JSON errors when --json is requested and adapter lookup fails', async () => {
  const logs: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => {
    logs.push(args.join(' '))
  }

  try {
    const code = await runCommand(['--json', 'bogus', 'hello'])
    assert.equal(code, 1)

    const payload = JSON.parse(logs.join('\n')) as {
      ok: boolean
      provider: string
      error: string
    }

    assert.equal(payload.ok, false)
    assert.equal(payload.provider, 'bogus')
    assert.match(payload.error, /Unknown adapter "bogus"/)
  } finally {
    console.log = originalLog
  }
})

test('runCommand prints concise human-readable adapter errors without a stack trace', async () => {
  const errors: string[] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => {
    errors.push(args.join(' '))
  }

  try {
    const code = await runCommand(['bogus', 'hello'])
    assert.equal(code, 1)

    const output = errors.join('\n')
    assert.match(output, /^Error: Unknown adapter "bogus"/)
    assert.doesNotMatch(output, /\n\s+at /)
  } finally {
    console.error = originalError
  }
})
