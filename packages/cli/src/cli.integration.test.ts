import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { detectCommand } from './detect.ts'
import { initCommand } from './init.ts'

test('detectCommand returns a valid exit code', async () => {
  const code = await detectCommand()
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
    [targetDir, '--no-install'],
    {
      packageRoot: runeworkRoot,
      packageVersion: '0.1.0',
      templatesRuneworkDir: join(runeworkRoot, 'templates', 'runework'),
      currentDir: join(runeworkRoot, 'src', 'cli'),
    },
  )
  assert.equal(code, 0)

  const pkg = JSON.parse(
    await readFile(join(targetDir, '.runework', 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> }
  assert.equal(pkg.dependencies?.runework, `file:${runeworkRoot}`)

  const scriptsDir = join(targetDir, '.runework', 'scripts')
  const pipelinesDir = join(targetDir, '.runework', 'pipelines')
  assert.equal((await stat(scriptsDir)).isDirectory(), true)
  assert.equal((await stat(pipelinesDir)).isDirectory(), true)
  assert.deepEqual(await readdir(scriptsDir), [])
  assert.deepEqual(await readdir(pipelinesDir), [])
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
    [targetDir, '--no-install'],
    {
      packageRoot: runeworkRoot,
      packageVersion: '0.1.0',
      templatesRuneworkDir: join(runeworkRoot, 'templates', 'runework'),
      currentDir: join(runeworkRoot, 'src', 'cli'),
    },
  )
  assert.equal(code, 1)
})
