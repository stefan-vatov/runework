import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  resolveRuneworkDir,
  runResultExitCode,
  compareResultsExitCode,
  defaultRuneworkDependency,
} from './helpers.ts'
import { runCommand } from './run.ts'
import { compareCommand } from './compare.ts'
import { detectCommand } from './detect.ts'
import { initCommand } from './init.ts'

test('CLI helper functions compute runtime paths and exit codes safely', () => {
  assert.equal(resolveRuneworkDir('/tmp/repo'), resolve('/tmp/repo', '.runework'))
  assert.equal(resolveRuneworkDir('/tmp/repo/.runework'), '/tmp/repo/.runework')

  assert.equal(runResultExitCode({ ok: true, exitCode: 9 }), 0)
  assert.equal(runResultExitCode({ ok: false, exitCode: 17 }), 17)
  assert.equal(runResultExitCode({ ok: false, exitCode: null }), 1)

  assert.equal(compareResultsExitCode([{ ok: true }, { ok: true }]), 0)
  assert.equal(compareResultsExitCode([{ ok: true }, { ok: false }]), 1)

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

test('compareCommand returns 1 when no prompt provided', async () => {
  const code = await compareCommand([])
  assert.equal(code, 1)
})

test('detectCommand returns a valid exit code', async () => {
  const code = await detectCommand()
  // Returns 0 if any tools found, 1 if none — both are valid
  assert.ok(code === 0 || code === 1)
})

test('initCommand scaffolds .runework/ with injected deps', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-cli-init-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const targetDir = join(tmpRoot, 'repo')
  await mkdir(targetDir, { recursive: true })

  const runeworkRoot = resolve('.')
  const code = await initCommand(
    [targetDir, '--no-install', '--no-ai-config'],
    {
      packageRoot: runeworkRoot,
      packageVersion: '0.1.0',
      templatesRuneworkDir: join(runeworkRoot, 'templates', 'runework'),
      templatesRepoLocalDir: join(runeworkRoot, 'templates', 'repo-local'),
      currentDir: join(runeworkRoot, 'src', 'cli'),
    },
  )
  assert.equal(code, 0)

  const pkg = JSON.parse(
    await readFile(join(targetDir, '.runework', 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> }
  assert.equal(pkg.dependencies?.runework, `file:${runeworkRoot}`)
})

test('initCommand returns 1 when .runework/ exists without --force', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-cli-init-exists-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const targetDir = join(tmpRoot, 'repo')
  await mkdir(join(targetDir, '.runework'), { recursive: true })

  const runeworkRoot = resolve('.')
  const code = await initCommand(
    [targetDir, '--no-install', '--no-ai-config'],
    {
      packageRoot: runeworkRoot,
      packageVersion: '0.1.0',
      templatesRuneworkDir: join(runeworkRoot, 'templates', 'runework'),
      templatesRepoLocalDir: join(runeworkRoot, 'templates', 'repo-local'),
      currentDir: join(runeworkRoot, 'src', 'cli'),
    },
  )
  assert.equal(code, 1)
})
