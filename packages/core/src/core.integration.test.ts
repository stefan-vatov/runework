import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ClaudeAdapter } from './adapters/claude.ts'
import { CodexAdapter } from './adapters/codex.ts'
import { OpenCodeAdapter } from './adapters/opencode.ts'
import type { AgentOutputChunk } from './adapters/types.ts'
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

test('runCli emits stdout/stderr chunks while preserving aggregated output', async (t) => {
  const fake = await createFakeCli(
    t,
    'stream-cli',
    [
      '#!/usr/bin/env node',
      "setTimeout(() => process.stdout.write('out-1\\n'), 5)",
      "setTimeout(() => process.stderr.write('err-1\\n'), 10)",
      "setTimeout(() => process.stdout.write('out-2\\n'), 15)",
      'setTimeout(() => process.exit(0), 25)',
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

  const startedAt = Date.now()
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
    Date.now() - startedAt < 500,
    `expected runCli to abort promptly, took ${Date.now() - startedAt}ms`,
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
    env: { PATH: fake.pathEnv },
    onOutputChunk: (chunk) => chunks.push(chunk),
  })

  assert.equal(result.ok, true)
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
    env: { PATH: fake.pathEnv },
    onOutputChunk: (chunk) => chunks.push(chunk),
  })

  assert.equal(result.ok, true)
  assert.equal(result.text, 'hello world')
  assert.deepEqual(result.rawEvents, [
    { type: 'text', part: { text: 'hello ' } },
    { type: 'text', part: { text: 'world' } },
  ])
  assert.ok(chunks.some((chunk) => chunk.provider === 'opencode' && chunk.stream === 'stdout' && chunk.text.includes('"type":"text"')))
  assert.ok(chunks.some((chunk) => chunk.provider === 'opencode' && chunk.stream === 'stderr' && chunk.text === 'opencode warning\n'))
})
