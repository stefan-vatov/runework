import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createHumanReadableAgentReporter,
  type HumanReadableAgentLine,
} from './index.ts'

function collectLines(
  chunks: Array<{
    provider: string
    stream: 'stdout' | 'stderr'
    text: string
  }>,
): HumanReadableAgentLine[] {
  const lines: HumanReadableAgentLine[] = []
  const reporter = createHumanReadableAgentReporter({
    onLine(line) {
      lines.push(line)
    },
  })

  for (const chunk of chunks) {
    reporter.onOutputChunk(chunk)
  }

  reporter.flush()
  return lines
}

test('codex reporter renders agent messages and command execution events as readable lines', () => {
  const lines = collectLines([
    {
      provider: 'codex',
      stream: 'stdout',
      text: `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-123' })}\n`,
    },
    {
      provider: 'codex',
      stream: 'stdout',
      text: `${JSON.stringify({ type: 'turn.started' })}\n`,
    },
    {
      provider: 'codex',
      stream: 'stdout',
      text: `${JSON.stringify({
        type: 'item.started',
        item: {
          type: 'command_execution',
          command: `/bin/zsh -lc "git status --short"`,
          status: 'in_progress',
        },
      })}\n`,
    },
    {
      provider: 'codex',
      stream: 'stdout',
      text: `${JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: 'Reviewing the repository now.',
        },
      })}\n`,
    },
    {
      provider: 'codex',
      stream: 'stdout',
      text: `${JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: `/bin/zsh -lc 'git commit -m \\'bad\\''`,
          status: 'failed',
          exit_code: 1,
        },
      })}\n`,
    },
  ])

  assert.deepEqual(
    lines.map(({ provider, stream, kind, text }) => ({ provider, stream, kind, text })),
    [
      {
        provider: 'codex',
        stream: 'stdout',
        kind: 'message',
        text: 'session started',
      },
      {
        provider: 'codex',
        stream: 'stdout',
        kind: 'message',
        text: 'thinking...',
      },
      {
        provider: 'codex',
        stream: 'stdout',
        kind: 'command',
        text: 'command: git status --short',
      },
      {
        provider: 'codex',
        stream: 'stdout',
        kind: 'message',
        text: 'Reviewing the repository now.',
      },
      {
        provider: 'codex',
        stream: 'stdout',
        kind: 'command',
        text: "command: git commit -m 'bad'",
      },
      {
        provider: 'codex',
        stream: 'stdout',
        kind: 'error',
        text: 'command failed (1)',
      },
    ],
  )
})

test('claude reporter extracts readable text from stream-json stdout', () => {
  const lines = collectLines([
    {
      provider: 'claude',
      stream: 'stdout',
      text: `${JSON.stringify({ type: 'assistant', delta: 'partial-1' })}\n`,
    },
    {
      provider: 'claude',
      stream: 'stdout',
      text: `${JSON.stringify({
        type: 'result',
        result: 'streamed claude result',
        structured_output: { ok: true },
      })}\n`,
    },
  ])

  assert.deepEqual(
    lines.map(({ provider, kind, text }) => ({ provider, kind, text })),
    [
      { provider: 'claude', kind: 'message', text: 'partial-1' },
      { provider: 'claude', kind: 'message', text: 'streamed claude result' },
    ],
  )
})

test('opencode reporter extracts readable text and stderr passthrough', () => {
  const lines = collectLines([
    {
      provider: 'opencode',
      stream: 'stdout',
      text: `${JSON.stringify({ type: 'text', part: { text: 'hello world' } })}\n`,
    },
    {
      provider: 'opencode',
      stream: 'stderr',
      text: 'opencode warning\n',
    },
  ])

  assert.deepEqual(
    lines.map(({ provider, stream, kind, text }) => ({ provider, stream, kind, text })),
    [
      {
        provider: 'opencode',
        stream: 'stdout',
        kind: 'message',
        text: 'hello world',
      },
      {
        provider: 'opencode',
        stream: 'stderr',
        kind: 'error',
        text: 'opencode warning',
      },
    ],
  )
})

test('single reporter instance can decode chunks from multiple providers', () => {
  const lines = collectLines([
    {
      provider: 'codex',
      stream: 'stdout',
      text: `${JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: 'codex line' },
      })}\n`,
    },
    {
      provider: 'claude',
      stream: 'stdout',
      text: `${JSON.stringify({ type: 'assistant', delta: 'claude line' })}\n`,
    },
    {
      provider: 'opencode',
      stream: 'stdout',
      text: `${JSON.stringify({ type: 'text', part: { text: 'opencode line' } })}\n`,
    },
  ])

  assert.deepEqual(
    lines.map(({ provider, text }) => ({ provider, text })),
    [
      { provider: 'codex', text: 'codex line' },
      { provider: 'claude', text: 'claude line' },
      { provider: 'opencode', text: 'opencode line' },
    ],
  )
})
