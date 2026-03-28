import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
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

test('initCommand installs dependencies through the shared runner contract', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-cli-init-install-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const targetDir = join(tmpRoot, 'repo')
  await mkdir(targetDir, { recursive: true })

  const runeworkRoot = resolve('.')
  let installCall:
    | {
      bin: string
      args?: string[]
      cwd?: string
      onOutputChunk?: unknown
    }
    | undefined

  const code = await initCommand(
    [targetDir],
    {
      packageRoot: runeworkRoot,
      packageVersion: '0.1.0',
      templatesRuneworkDir: join(runeworkRoot, 'templates', 'runework'),
      currentDir: join(runeworkRoot, 'src', 'cli'),
      runCliFn: async (opts) => {
        installCall = opts
        opts.onOutputChunk?.({ stream: 'stdout', text: 'installing\n' })
        return {
          ok: true,
          exitCode: 0,
          stdout: '',
          stderr: '',
          combined: 'installing\n',
          bin: opts.bin,
          args: opts.args ?? [],
          cwd: opts.cwd ?? targetDir,
          durationMs: 1,
        }
      },
    },
  )

  assert.equal(code, 0)
  assert.deepEqual(installCall?.args, ['install'])
  assert.equal(installCall?.cwd, join(targetDir, '.runework'))
  assert.equal(installCall?.bin, process.platform === 'win32' ? 'npm.cmd' : 'npm')
  assert.equal(typeof installCall?.onOutputChunk, 'function')
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

test('initCommand surfaces install failures instead of silently continuing', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-cli-init-install-fail-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const targetDir = join(tmpRoot, 'repo')
  await mkdir(targetDir, { recursive: true })

  const runeworkRoot = resolve('.')
  await assert.rejects(
    () =>
      initCommand(
        [targetDir],
        {
          packageRoot: runeworkRoot,
          packageVersion: '0.1.0',
          templatesRuneworkDir: join(runeworkRoot, 'templates', 'runework'),
          currentDir: join(runeworkRoot, 'src', 'cli'),
          runCliFn: async (opts) => ({
            ok: false,
            exitCode: 2,
            stdout: '',
            stderr: `synthetic npm failure for ${opts.bin}`,
            combined: '',
            bin: opts.bin,
            args: opts.args ?? [],
            cwd: opts.cwd ?? targetDir,
            durationMs: 1,
          }),
        },
      ),
    /synthetic npm failure/,
  )
})

test('pipeline CLI streams structured progress events before the final summary', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-cli-pipeline-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const repoRoot = join(tmpRoot, 'repo')
  const pipelinesDir = join(repoRoot, '.runework', 'pipelines')
  await mkdir(pipelinesDir, { recursive: true })
  await writeFile(
    join(pipelinesDir, 'stream-progress.ts'),
    [
      'export default async function (ctx) {',
      "  ctx.log('setup')",
      "  ctx.progress({ type: 'progress', phase: 'start' })",
      '  await new Promise((resolve) => setTimeout(resolve, 20))',
      "  ctx.progress({ type: 'progress', phase: 'finish' })",
      "  return { ok: true, summary: 'stream pipeline complete' }",
      '}',
      '',
    ].join('\n'),
    'utf8',
  )

  const cliEntry = resolve('src/cli/pipeline.ts')
  const result = spawnSync(
    process.execPath,
    ['--conditions=source', cliEntry, 'stream-progress'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
    },
  )

  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || result.error?.message || 'pipeline CLI failed',
  )

  const lines = result.stderr
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const startIndex = lines.indexOf('{"type":"progress","phase":"start"}')
  const finishIndex = lines.indexOf('{"type":"progress","phase":"finish"}')
  const summaryIndex = lines.indexOf('stream pipeline complete')

  assert.ok(lines.includes('setup'))
  assert.ok(startIndex >= 0, `missing start progress event in stderr:\n${result.stderr}`)
  assert.ok(finishIndex > startIndex, `missing finish progress event in stderr:\n${result.stderr}`)
  assert.ok(summaryIndex > finishIndex, `summary should be printed after progress events:\n${result.stderr}`)
  assert.ok(lines.some((line) => line.startsWith('run: ')), `missing run ID in stderr:\n${result.stderr}`)
})
