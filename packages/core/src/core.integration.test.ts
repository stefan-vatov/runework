import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ClaudeAdapter } from './adapters/claude.ts'
import { CodexAdapter } from './adapters/codex.ts'
import { OpenCodeAdapter } from './adapters/opencode.ts'
import { getAdapters } from './adapters/registry.ts'
import type { AgentOutputChunk } from './adapters/types.ts'
import { detectTools } from './core/detect.ts'
import { runCli, type CliOutputChunk } from './core/run-cli.ts'

async function createFakeCli(
  t: { after: (cleanup: () => Promise<void> | void) => void },
  name: string,
  script: string,
): Promise<{ binDir: string; pathEnv: string }> {
  const tmpRoot = await mkdtemp(join(tmpdir(), `runework-${name}-`))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const binDir = join(tmpRoot, 'bin')
  await mkdir(binDir, { recursive: true })

  const scriptPath = join(binDir, name)
  await writeFile(scriptPath, script, 'utf8')
  await chmod(scriptPath, 0o755)

  return {
    binDir,
    pathEnv: `${binDir}:${process.env.PATH ?? ''}`,
  }
}

async function waitForFile(path: string, attempts = 40): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await readFile(path, 'utf8')
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  throw new Error(`Timed out waiting for file: ${path}`)
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('runCli emits stdout/stderr chunks while preserving aggregated output', async (t) => {
  const fake = await createFakeCli(
    t,
    'stream-cli',
    [
      '#!/usr/bin/env node',
      "setTimeout(() => process.stdout.write('out-1\\n'), 10)",
      "setTimeout(() => process.stderr.write('err-1\\n'), 100)",
      "setTimeout(() => process.stdout.write('out-2\\n'), 200)",
      'setTimeout(() => process.exit(0), 300)',
      '',
    ].join('\n'),
  )

  const chunks: CliOutputChunk[] = []
  const result = await runCli({
    bin: 'stream-cli',
    env: { PATH: fake.pathEnv },
    onOutputChunk: (chunk) => chunks.push(chunk),
  })

  assert.equal(result.ok, true)
  assert.equal(result.stdout, 'out-1\nout-2\n')
  assert.equal(result.stderr, 'err-1\n')
  assert.equal(result.combined, 'out-1\nerr-1\nout-2\n')
  assert.deepEqual(chunks, [
    { stream: 'stdout', text: 'out-1\n' },
    { stream: 'stderr', text: 'err-1\n' },
    { stream: 'stdout', text: 'out-2\n' },
  ])
})

test('runCli aborts promptly and preserves the callback error when streaming fails', async (t) => {
  const fake = await createFakeCli(
    t,
    'abort-cli',
    [
      '#!/usr/bin/env node',
      "process.on('SIGTERM', () => {})",
      "setTimeout(() => process.stdout.write('first\\n'), 5)",
      "setTimeout(() => process.stdout.write('late\\n'), 800)",
      'setTimeout(() => process.exit(0), 1200)',
      '',
    ].join('\n'),
  )

  const startedAt = performance.now()
  await assert.rejects(
    () =>
      runCli({
        bin: 'abort-cli',
        env: { PATH: fake.pathEnv },
        onOutputChunk: () => {
          throw new Error('stream sink failed')
        },
      }),
    /stream sink failed/,
  )

  assert.ok(
    performance.now() - startedAt < 2000,
    `expected runCli to abort promptly, took ${performance.now() - startedAt}ms`,
  )
})

test('runCli abort signal terminates the CLI promptly with an AbortError', async (t) => {
  const fake = await createFakeCli(
    t,
    'abort-signal-cli',
    [
      '#!/usr/bin/env node',
      "process.on('SIGTERM', () => {})",
      "setTimeout(() => process.stdout.write('still-running\\n'), 800)",
      'setTimeout(() => process.exit(0), 1200)',
      '',
    ].join('\n'),
  )

  const controller = new AbortController()
  const startedAt = performance.now()
  const run = runCli({
    bin: 'abort-signal-cli',
    env: { PATH: fake.pathEnv },
    signal: controller.signal,
  })

  setTimeout(() => {
    controller.abort()
  }, 25)

  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error
      && error.name === 'AbortError'
      && /aborted/i.test(error.message),
  )

  assert.ok(
    performance.now() - startedAt < 2000,
    `expected runCli to abort promptly, took ${performance.now() - startedAt}ms`,
  )
})

test('runCli abort signal terminates descendant tool processes too', async (t) => {
  const fake = await createFakeCli(
    t,
    'abort-tree-cli',
    [
      '#!/usr/bin/env node',
      "const { spawn } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      "const childPidFile = process.argv[2]",
      "const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"])",
      "writeFileSync(childPidFile, String(child.pid), 'utf8')",
      "process.on('SIGTERM', () => {})",
      'setInterval(() => {}, 1000)',
      '',
    ].join('\n'),
  )

  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-abort-tree-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const childPidFile = join(tmpRoot, 'child.pid')
  const controller = new AbortController()
  const run = runCli({
    bin: 'abort-tree-cli',
    args: [childPidFile],
    env: { PATH: fake.pathEnv },
    signal: controller.signal,
  })

  const childPid = Number((await waitForFile(childPidFile)).trim())
  t.after(() => {
    if (Number.isInteger(childPid) && processExists(childPid)) {
      try {
        process.kill(childPid, 'SIGKILL')
      } catch {}
    }
  })

  controller.abort()

  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error
      && error.name === 'AbortError'
      && /aborted/i.test(error.message),
  )

  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(processExists(childPid), false)
})

test('runCli preserves spawn failures when the process never starts', async () => {
  const result = await runCli({
    bin: 'runework-missing-bin-for-test',
    env: { PATH: '' },
  })

  assert.equal(result.ok, false)
  assert.notEqual(result.exitCode, 0)
  assert.doesNotMatch(result.stderr, /Cannot read properties of undefined/)
  assert.match(result.stderr, /runework-missing-bin-for-test|ENOENT|spawn|not found/i)
})

test('detectTools resolves executables from PATH without relying on locator binaries', async (t) => {
  const fake = await createFakeCli(
    t,
    'codex',
    [
      '#!/usr/bin/env node',
      'const args = process.argv.slice(2)',
      "if (args.includes('--version')) {",
      "  process.stdout.write('codex fake 1.0.0\\n')",
      '  process.exit(0)',
      '}',
      'process.exit(0)',
      '',
    ].join('\n'),
  )

  await writeFile(join(fake.binDir, 'node'), [
    '#!/bin/sh',
    `exec "${process.execPath}" "$@"`,
    '',
  ].join('\n'), 'utf8')
  await chmod(join(fake.binDir, 'node'), 0o755)

  const previousPath = process.env.PATH
  process.env.PATH = fake.binDir
  t.after(() => {
    process.env.PATH = previousPath
  })

  const [tool] = await detectTools(['codex'])

  assert.deepEqual(tool, {
    name: 'codex',
    available: true,
    path: join(fake.binDir, 'codex'),
    version: 'codex fake 1.0.0',
  })
})

test('detectTools defaults stay aligned with the adapter registry', async (t) => {
  const previousPath = process.env.PATH
  process.env.PATH = ''
  t.after(() => {
    process.env.PATH = previousPath
  })

  const detected = await detectTools()

  assert.deepEqual(
    detected.map((tool) => tool.name).sort(),
    getAdapters().map((adapter) => adapter.name).sort(),
  )
})

test('ClaudeAdapter streams realtime CLI output through the shared adapter contract', async (t) => {
  const fake = await createFakeCli(
    t,
    'claude',
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      'const args = process.argv.slice(2)',
      "if (args.includes('--version') || args.includes('-V') || args.includes('version')) {",
      "  process.stdout.write('claude fake 1.0.0\\n')",
      '  process.exit(0)',
      '}',
      "const stdin = fs.readFileSync(0, 'utf8')",
      "if (!stdin.includes('Stream claude')) process.exit(2)",
      "setTimeout(() => process.stdout.write(JSON.stringify({ type: 'assistant', delta: 'partial-1' }) + '\\n'), 5)",
      "setTimeout(() => process.stderr.write('claude warning\\n'), 10)",
      "setTimeout(() => process.stdout.write(JSON.stringify({ type: 'result', result: 'streamed claude result', session_id: 'claude-session', structured_output: { ok: true } }) + '\\n'), 15)",
      'setTimeout(() => process.exit(0), 25)',
      '',
    ].join('\n'),
  )

  const chunks: AgentOutputChunk[] = []
  const result = await new ClaudeAdapter().run({
    prompt: 'Stream claude',
    schema: { type: 'object' },
    env: { PATH: fake.pathEnv },
    onOutputChunk: (chunk) => chunks.push(chunk),
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.command, {
    bin: 'claude',
    args: [
      '-p',
      '--input-format',
      'text',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--json-schema',
      JSON.stringify({ type: 'object' }),
    ],
    cwd: process.cwd(),
  })
  assert.equal(result.text, 'streamed claude result')
  assert.deepEqual(result.structured, { ok: true })
  assert.equal(result.sessionId, 'claude-session')
  assert.deepEqual(result.rawEvents, [
    { type: 'assistant', delta: 'partial-1' },
    {
      type: 'result',
      result: 'streamed claude result',
      session_id: 'claude-session',
      structured_output: { ok: true },
    },
  ])
  assert.ok(chunks.some((chunk) => chunk.provider === 'claude' && chunk.stream === 'stdout' && chunk.text.includes('"type":"assistant"')))
  assert.ok(chunks.some((chunk) => chunk.provider === 'claude' && chunk.stream === 'stdout' && chunk.text.includes('"type":"result"')))
  assert.ok(chunks.some((chunk) => chunk.provider === 'claude' && chunk.stream === 'stderr' && chunk.text === 'claude warning\n'))
})

test('ClaudeAdapter preserves streamed partial text when the run exits before a final result', async (t) => {
  const fake = await createFakeCli(
    t,
    'claude',
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      'const args = process.argv.slice(2)',
      "if (args.includes('--version') || args.includes('-V') || args.includes('version')) {",
      "  process.stdout.write('claude fake 1.0.0\\n')",
      '  process.exit(0)',
      '}',
      "fs.readFileSync(0, 'utf8')",
      "setTimeout(() => process.stdout.write(JSON.stringify({ type: 'assistant', delta: 'partial-' }) + '\\n'), 5)",
      "setTimeout(() => process.stdout.write(JSON.stringify({ type: 'assistant', delta: 'result' }) + '\\n'), 10)",
      "setTimeout(() => process.exit(1), 20)",
      '',
    ].join('\n'),
  )

  const result = await new ClaudeAdapter().run({
    prompt: 'Stream partial claude',
    env: { PATH: fake.pathEnv },
    onOutputChunk: () => {},
  })

  assert.equal(result.ok, false)
  assert.equal(result.command.bin, 'claude')
  assert.equal(result.command.cwd, process.cwd())
  assert.deepEqual(result.command.args, [
    '-p',
    '--input-format',
    'text',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
  ])
  assert.equal(result.text, 'partial-result')
  assert.deepEqual(result.rawEvents, [
    { type: 'assistant', delta: 'partial-' },
    { type: 'assistant', delta: 'result' },
  ])
})

test('CodexAdapter streams JSONL output and still returns the parsed final message', async (t) => {
  const fake = await createFakeCli(
    t,
    'codex',
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      'const args = process.argv.slice(2)',
      "if (args.includes('--version') || args.includes('-V') || args.includes('version')) {",
      "  process.stdout.write('codex fake 1.0.0\\n')",
      '  process.exit(0)',
      '}',
      "const outputIndex = args.indexOf('--output-last-message')",
      'const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : undefined',
      "fs.readFileSync(0, 'utf8')",
      "setTimeout(() => process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'intermediate codex message' } }) + '\\n'), 5)",
      "setTimeout(() => process.stderr.write('codex warning\\n'), 10)",
      "setTimeout(() => { if (outputFile) fs.writeFileSync(outputFile, 'final codex message', 'utf8'); process.stdout.write(JSON.stringify({ type: 'message', session_id: 'codex-session' }) + '\\n') }, 15)",
      'setTimeout(() => process.exit(0), 25)',
      '',
    ].join('\n'),
  )

  const chunks: AgentOutputChunk[] = []
  const result = await new CodexAdapter().run({
    prompt: 'Stream codex',
    approvalMode: 'never',
    sandbox: 'workspace-write',
    cwd: process.cwd(),
    env: { PATH: fake.pathEnv },
    onOutputChunk: (chunk) => chunks.push(chunk),
  })

  assert.equal(result.ok, true)
  assert.equal(result.command.bin, 'codex')
  assert.equal(result.command.cwd, process.cwd())
  assert.deepEqual(result.command.args.slice(0, 7), [
    '-a',
    'never',
    'exec',
    '-C',
    process.cwd(),
    '-s',
    'workspace-write',
  ])
  assert.ok(result.command.args.includes('--json'))
  assert.ok(result.command.args.includes('--output-last-message'))
  assert.equal(result.command.args.at(-1), '-')
  assert.equal(result.text, 'final codex message')
  assert.equal(result.sessionId, 'codex-session')
  assert.deepEqual(result.rawEvents, [
    {
      type: 'item.completed',
      item: { type: 'agent_message', text: 'intermediate codex message' },
    },
    { type: 'message', session_id: 'codex-session' },
  ])
  assert.ok(chunks.some((chunk) => chunk.provider === 'codex' && chunk.stream === 'stdout' && chunk.text.includes('"type":"item.completed"')))
  assert.ok(chunks.some((chunk) => chunk.provider === 'codex' && chunk.stream === 'stderr' && chunk.text === 'codex warning\n'))
})

test('OpenCodeAdapter streams JSON output and still extracts the assistant text', async (t) => {
  const fake = await createFakeCli(
    t,
    'opencode',
    [
      '#!/usr/bin/env node',
      'const args = process.argv.slice(2)',
      "if (args.includes('--version') || args.includes('-V') || args.includes('version')) {",
      "  process.stdout.write('opencode fake 1.0.0\\n')",
      '  process.exit(0)',
      '}',
      "setTimeout(() => process.stdout.write(JSON.stringify({ type: 'text', part: { text: 'hello ' } }) + '\\n'), 5)",
      "setTimeout(() => process.stderr.write('opencode warning\\n'), 10)",
      "setTimeout(() => process.stdout.write(JSON.stringify({ type: 'text', part: { text: 'world' } }) + '\\n'), 15)",
      'setTimeout(() => process.exit(0), 25)',
      '',
    ].join('\n'),
  )

  const chunks: AgentOutputChunk[] = []
  const result = await new OpenCodeAdapter().run({
    prompt: 'Stream opencode',
    cwd: process.cwd(),
    env: { PATH: fake.pathEnv },
    onOutputChunk: (chunk) => chunks.push(chunk),
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.command, {
    bin: 'opencode',
    args: ['run', '--format', 'json', '--dir', process.cwd()],
    cwd: process.cwd(),
  })
  assert.equal(result.text, 'hello world')
  assert.deepEqual(result.rawEvents, [
    { type: 'text', part: { text: 'hello ' } },
    { type: 'text', part: { text: 'world' } },
  ])
  assert.ok(chunks.some((chunk) => chunk.provider === 'opencode' && chunk.stream === 'stdout' && chunk.text.includes('"type":"text"')))
  assert.ok(chunks.some((chunk) => chunk.provider === 'opencode' && chunk.stream === 'stderr' && chunk.text === 'opencode warning\n'))
})
