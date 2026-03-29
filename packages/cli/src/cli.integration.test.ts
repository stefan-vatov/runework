import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, relative, resolve } from 'node:path'
import test from 'node:test'

import { detectCommand } from './detect.ts'
import { initCommand } from './init.ts'
import { pipelineCommand } from './pipeline.ts'
import { runCommand } from './run.ts'

async function captureConsole(
  method: 'log' | 'error',
  run: () => Promise<number>,
): Promise<{ code: number; output: string }> {
  const original = console[method]
  const chunks: string[] = []

  console[method] = ((...args: unknown[]) => {
    chunks.push(args.map((value) => String(value)).join(' '))
  }) as typeof console.log

  try {
    return {
      code: await run(),
      output: chunks.join('\n'),
    }
  } finally {
    console[method] = original
  }
}

async function createFakeCodexCli(t: test.TestContext): Promise<string> {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-cli-fake-codex-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const binDir = join(tmpRoot, 'bin')
  const scriptPath = join(binDir, 'codex')
  await mkdir(binDir, { recursive: true })
  await writeFile(
    scriptPath,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      'const args = process.argv.slice(2)',
      "if (args.includes('--version') || args.includes('-V') || args.includes('version')) {",
      "  process.stdout.write('codex fake 1.0.0\\n')",
      '  process.exit(0)',
      '}',
      "const outputIndex = args.indexOf('--output-last-message')",
      'const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined',
      "const stdin = fs.readFileSync(0, 'utf8').trim()",
      "if (outputPath) fs.writeFileSync(outputPath, `fake reply: ${stdin}`, 'utf8')",
      "process.stdout.write(JSON.stringify({ type: 'message', session_id: 'fake-session' }) + '\\n')",
      '',
    ].join('\n'),
    'utf8',
  )
  await chmod(scriptPath, 0o755)

  return binDir
}

test('detectCommand returns a valid exit code', async () => {
  const code = await detectCommand()
  assert.ok(code === 0 || code === 1)
})

test('detectCommand emits structured JSON with provider capability surfaces', async () => {
  const { code, output } = await captureConsole('log', () => detectCommand(['--json']))
  assert.ok(code === 0 || code === 1)

  const report = JSON.parse(output) as Array<{
    name: string
    available: boolean
    capabilities?: Record<string, boolean>
  }>
  const codex = report.find((entry) => entry.name === 'codex')

  assert.ok(codex)
  assert.equal(typeof codex.available, 'boolean')
  assert.deepEqual(codex.capabilities, {
    approvalMode: true,
    files: false,
    sandbox: true,
    schema: true,
    sessionName: false,
  })
})

test('detectCommand keeps provider capability differences visible in human-readable output', async () => {
  const { code, output } = await captureConsole('log', () => detectCommand())
  assert.ok(code === 0 || code === 1)

  assert.match(output, /capabilities: /)
  assert.match(
    output,
    /capabilities: approvalMode=yes files=no sandbox=yes schema=yes sessionName=no/,
  )
  assert.match(
    output,
    /capabilities: approvalMode=no files=no sandbox=no schema=yes sessionName=yes/,
  )
  assert.match(
    output,
    /capabilities: approvalMode=no files=yes sandbox=no schema=no sessionName=yes/,
  )
})

test('runCommand keeps --json output structured when adapter resolution fails', async () => {
  const { code, output } = await captureConsole('log', () =>
    runCommand(['--json', 'unknown-provider', 'hello']),
  )

  assert.equal(code, 1)

  const payload = JSON.parse(output) as {
    ok: boolean
    error: string
    provider: string
    command: string
    usage: string
  }

  assert.equal(payload.ok, false)
  assert.equal(payload.provider, 'unknown-provider')
  assert.equal(payload.command, 'runework-run')
  assert.equal(payload.usage, 'runework-run [--json] <provider> "<prompt>"')
  assert.match(payload.error, /Unknown adapter "unknown-provider"/)
})

test('pipelineCommand keeps --json output structured when option parsing fails', async () => {
  const { code, output } = await captureConsole('log', () =>
    pipelineCommand(['--json', 'stream-progress', '--resume-run']),
  )

  assert.equal(code, 1)

  const payload = JSON.parse(output) as {
    ok: boolean
    error: string
    pipelineName: string
    command: string
    usage: string
  }

  assert.equal(payload.ok, false)
  assert.equal(payload.pipelineName, 'stream-progress')
  assert.equal(payload.command, 'runework-pipeline')
  assert.equal(
    payload.usage,
    'runework-pipeline [--json] <pipeline-name> [--resume-run <run-id>] [--key value...]',
  )
  assert.match(payload.error, /--resume-run requires a run ID/)
})

test('initCommand scaffolds .runework/ with injected deps', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-cli-init-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const targetDir = join(tmpRoot, 'repo')
  await mkdir(targetDir, { recursive: true })

  const runeworkRoot = resolve('packages/runework')
  const { code, output } = await captureConsole('error', () =>
    initCommand(
      [targetDir, '--no-install'],
      {
        packageRoot: runeworkRoot,
        packageVersion: '0.1.0',
        runeworkPipelinesVersion: '0.1.0',
        templatesRuneworkDir: join(runeworkRoot, 'templates', 'runework'),
        currentDir: join(runeworkRoot, 'src', 'cli'),
      },
    ),
  )
  assert.equal(code, 0)
  assert.match(output, /\.work\/\s+created lazily on first run \(gitignored\)/)

  const pkg = JSON.parse(
    await readFile(join(targetDir, '.runework', 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> }
  // runeworkRoot is targetDir/packages/runework
  // .runework is at targetDir/.runework
  const runeworkDir = join(targetDir, '.runework')
  assert.equal(pkg.dependencies?.runework, `file:${relative(runeworkDir, runeworkRoot)}`)
  assert.equal(pkg.dependencies?.['runework-pipelines'], `github:stefan-vatov/runework-pipelines`)

  const scriptsDir = join(targetDir, '.runework', 'scripts')
  const pipelinesDir = join(targetDir, '.runework', 'pipelines')
  assert.equal((await stat(scriptsDir)).isDirectory(), true)
  assert.equal((await stat(pipelinesDir)).isDirectory(), true)
  assert.deepEqual(await readdir(scriptsDir), [])

  // Pipelines dir should contain thin re-export stubs for ready-made pipelines
  const pipelineFiles = await readdir(pipelinesDir)
  assert.ok(pipelineFiles.includes('code-review.ts'), 'should contain code-review.ts re-export')
  assert.ok(pipelineFiles.includes('constitutional-alignment.ts'), 'should contain constitutional-alignment.ts re-export')

  const codeReviewContent = await readFile(join(pipelinesDir, 'code-review.ts'), 'utf8')
  assert.match(codeReviewContent, /runework-pipelines\/code-review/)

  const constitutionalContent = await readFile(join(pipelinesDir, 'constitutional-alignment.ts'), 'utf8')
  assert.match(constitutionalContent, /runework-pipelines\/constitutional-alignment/)
})

test('initCommand installs dependencies through the shared runner contract', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-cli-init-install-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const targetDir = join(tmpRoot, 'repo')
  await mkdir(targetDir, { recursive: true })

  const runeworkRoot = resolve('packages/runework')
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
      runeworkPipelinesVersion: '0.1.0',
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

  const runeworkRoot = resolve('packages/runework')
  const code = await initCommand(
    [targetDir, '--no-install'],
    {
      packageRoot: runeworkRoot,
      packageVersion: '0.1.0',
      runeworkPipelinesVersion: '0.1.0',
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

  const runeworkRoot = resolve('packages/runework')
  await assert.rejects(
    () =>
      initCommand(
        [targetDir],
        {
          packageRoot: runeworkRoot,
          packageVersion: '0.1.0',
          runeworkPipelinesVersion: '0.1.0',
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

  const cliEntry = resolve('packages/runework/src/cli/pipeline.ts')
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

test('pipeline CLI emits the final result as JSON when --json is requested', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-cli-pipeline-json-'))
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
      "  return { ok: true, summary: 'stream pipeline complete' }",
      '}',
      '',
    ].join('\n'),
    'utf8',
  )

  const cliEntry = resolve('packages/runework/src/cli/pipeline.ts')
  const result = spawnSync(
    process.execPath,
    ['--conditions=source', cliEntry, '--json', 'stream-progress'],
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

  const payload = JSON.parse(result.stdout) as {
    ok: boolean
    summary: string
    runId: string
    outputDir: string
  }

  assert.equal(payload.ok, true)
  assert.equal(payload.summary, 'stream pipeline complete')
  assert.equal(typeof payload.runId, 'string')
  assert.equal(typeof payload.outputDir, 'string')

  const lines = result.stderr
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  assert.ok(lines.includes('{"type":"log","message":"setup"}'))
  assert.ok(lines.includes('{"type":"progress","phase":"start"}'))
})

test('run CLI emits structured JSON when --json is requested', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-cli-run-json-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const repoRoot = join(tmpRoot, 'repo')
  await mkdir(repoRoot, { recursive: true })
  const fakeCodexBinDir = await createFakeCodexCli(t)

  const cliEntry = resolve('packages/runework/src/cli/run.ts')
  const result = spawnSync(
    process.execPath,
    ['--conditions=source', cliEntry, '--json', 'codex', 'hello from cli'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeCodexBinDir}${delimiter}${process.env.PATH ?? ''}`,
      },
    },
  )

  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || result.error?.message || 'run CLI failed',
  )

  const payload = JSON.parse(result.stdout) as {
    provider: string
    ok: boolean
    text: string
    sessionId?: string
    journalPath?: string
  }

  assert.equal(payload.provider, 'codex')
  assert.equal(payload.ok, true)
  assert.equal(payload.text, 'fake reply: hello from cli')
  assert.equal(payload.sessionId, 'fake-session')
  assert.equal(typeof payload.journalPath, 'string')
  assert.equal(result.stderr.trim(), '')
})

test('run CLI keeps --json output structured when the provider binary is unavailable', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-cli-run-json-error-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const repoRoot = join(tmpRoot, 'repo')
  await mkdir(repoRoot, { recursive: true })
  const fakeBinDir = join(tmpRoot, 'bin')
  const fakeCodexPath = join(fakeBinDir, 'codex')
  await mkdir(fakeBinDir, { recursive: true })
  await writeFile(
    fakeCodexPath,
    [
      '#!/bin/sh',
      'echo "codex unavailable" >&2',
      'exit 127',
      '',
    ].join('\n'),
    'utf8',
  )
  await chmod(fakeCodexPath, 0o755)

  const cliEntry = resolve('packages/runework/src/cli/run.ts')
  const result = spawnSync(
    process.execPath,
    ['--conditions=source', cliEntry, '--json', 'codex', 'hello from cli'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ''}`,
      },
    },
  )

  assert.notEqual(
    result.status,
    0,
    result.stderr || result.stdout || result.error?.message || 'run CLI unexpectedly succeeded',
  )

  const payload = JSON.parse(result.stdout) as {
    ok: boolean
    provider: string
    exitCode: number | null
    stderr: string
    text: string
    command: {
      bin: string
      cwd: string
    }
    journalPath?: string
  }

  assert.equal(payload.ok, false)
  assert.equal(payload.provider, 'codex')
  assert.notEqual(payload.exitCode, 0)
  assert.equal(payload.command.bin, 'codex')
  assert.equal(await realpath(payload.command.cwd), await realpath(repoRoot))
  assert.equal(payload.text, '')
  assert.match(payload.stderr, /codex unavailable/i)
  assert.equal(typeof payload.journalPath, 'string')
  assert.equal(result.stderr.trim(), '')
})

test('run CLI emits structured JSON errors when --json is requested and adapter selection fails', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-cli-run-json-error-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const repoRoot = join(tmpRoot, 'repo')
  await mkdir(repoRoot, { recursive: true })

  const cliEntry = resolve('packages/runework/src/cli/run.ts')
  const result = spawnSync(
    process.execPath,
    ['--conditions=source', cliEntry, '--json', 'bogus', 'hello from cli'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
    },
  )

  assert.equal(result.status, 1, result.stderr || result.stdout || result.error?.message || 'run CLI error path failed')

  const payload = JSON.parse(result.stdout) as {
    ok: boolean
    provider: string
    error: string
  }

  assert.equal(payload.ok, false)
  assert.equal(payload.provider, 'bogus')
  assert.match(payload.error, /Unknown adapter "bogus"/)
  assert.equal(result.stderr.trim(), '')
})
