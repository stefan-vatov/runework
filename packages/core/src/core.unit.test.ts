import assert from 'node:assert/strict'
import test from 'node:test'

import { buildClaudeArgs } from './adapters/claude.ts'
import { buildCodexArgs } from './adapters/codex.ts'
import { buildOpenCodeArgs } from './adapters/opencode.ts'
import { parseJsonLines } from './core/json.ts'
import { renderTemplate } from './core/render-template.ts'

test('buildCodexArgs places root and exec flags where codex expects them', () => {
  const args = buildCodexArgs(
    {
      prompt: 'Summarize this repository',
      cwd: '/repo',
      model: 'gpt-5.4',
      sandbox: 'workspace-write',
      approvalMode: 'never',
      schema: { type: 'object' },
      extraArgs: ['--skip-git-repo-check'],
    },
    {
      outputFile: '/tmp/codex-last-message.txt',
      schemaFile: '/tmp/codex-schema.json',
    },
  )

  assert.deepEqual(args, [
    '-C',
    '/repo',
    '-s',
    'workspace-write',
    '-a',
    'never',
    'exec',
    '--output-schema',
    '/tmp/codex-schema.json',
    '-m',
    'gpt-5.4',
    '--json',
    '--output-last-message',
    '/tmp/codex-last-message.txt',
    '--skip-git-repo-check',
    '-',
  ])
})

test('buildCodexArgs keeps resume argv valid', () => {
  const args = buildCodexArgs(
    {
      prompt: 'Continue from the previous run',
      cwd: '/repo',
      model: 'gpt-5.4',
      sandbox: 'workspace-write',
      schema: { type: 'object' },
      resume: { last: true },
    },
    {
      outputFile: '/tmp/codex-last-message.txt',
      schemaFile: '/tmp/codex-schema.json',
    },
  )

  assert.deepEqual(args, [
    '-C',
    '/repo',
    '-s',
    'workspace-write',
    'exec',
    '--output-schema',
    '/tmp/codex-schema.json',
    'resume',
    '--last',
    '-m',
    'gpt-5.4',
    '--json',
    '--output-last-message',
    '/tmp/codex-last-message.txt',
    '-',
  ])
})

test('buildClaudeArgs keeps large prompts off argv', () => {
  const prompt = 'Review this diff\n'.repeat(20_000)
  const args = buildClaudeArgs({
    prompt,
    model: 'sonnet',
    sessionName: 'review',
    schema: { type: 'object' },
    resume: { last: true },
    extraArgs: ['--verbose'],
  })

  assert.deepEqual(args, [
    '-p',
    '--input-format',
    'text',
    '--output-format',
    'json',
    '--model',
    'sonnet',
    '--continue',
    '-n',
    'review',
    '--json-schema',
    JSON.stringify({ type: 'object' }),
    '--verbose',
  ])
  assert.equal(args.includes(prompt), false)
  assert.ok(args.join(' ').length < 1024)
})

test('buildClaudeArgs switches to stream-json when realtime output streaming is requested', () => {
  const args = buildClaudeArgs({
    prompt: 'Stream the run',
    onOutputChunk: () => {},
  })

  assert.deepEqual(args, [
    '-p',
    '--input-format',
    'text',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
  ])
})

test('providers reject unsupported request options instead of ignoring them', () => {
  assert.throws(
    () =>
      buildCodexArgs({
        prompt: 'Review this change',
        sessionName: 'review',
      }, {
        outputFile: '/tmp/codex-last-message.txt',
      }),
    /codex does not support request option\(s\): sessionName/,
  )

  assert.throws(
    () =>
      buildClaudeArgs({
        prompt: 'Review this change',
        sandbox: 'workspace-write',
      }),
    /claude does not support request option\(s\): sandbox/,
  )

  assert.throws(
    () =>
      buildOpenCodeArgs({
        prompt: 'Review this change',
        schema: { type: 'object' },
      }),
    /opencode does not support request option\(s\): schema/,
  )
})

test('renderTemplate stringifies structured values', () => {
  const output = renderTemplate('Summary:\n{{result}}', {
    result: {
      changed: ['src/index.ts'],
      ok: true,
    },
  })

  assert.match(output, /"changed": \[/)
  assert.match(output, /"ok": true/)
})

test('parseJsonLines keeps valid JSON records and skips noise', () => {
  const records = parseJsonLines<{ ok?: boolean; value?: number } | number[]>([
    '{"ok":true}',
    'not json',
    '[1,2,3]',
    '',
    '{"value":3}',
  ].join('\n'))

  assert.deepEqual(records, [
    { ok: true },
    [1, 2, 3],
    { value: 3 },
  ])
})
