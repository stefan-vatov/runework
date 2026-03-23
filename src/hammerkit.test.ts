import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import { buildClaudeArgs } from './adapters/claude.ts'
import { buildCodexArgs } from './adapters/codex.ts'
import { buildOpenCodeArgs } from './adapters/opencode.ts'
import type { AgentAdapter } from './adapters/types.ts'
import {
  compareResultsExitCode,
  defaultHammerkitDependency,
  resolveHammerkitDir,
  runResultExitCode,
} from './cli/helpers.ts'
import { runPipeline } from './pipelines/runner.ts'
import { parseJsonLines } from './core/json.ts'
import { renderTemplate } from './core/render-template.ts'
import { compareProviders } from './workflows/compare.ts'

async function writePipeline(
  hammerkitDir: string,
  name: string,
  source: string,
): Promise<void> {
  await mkdir(join(hammerkitDir, 'pipelines'), { recursive: true })
  await writeFile(join(hammerkitDir, 'pipelines', `${name}.ts`), source, 'utf8')
}

test('buildCodexArgs places root and exec flags where codex expects them', () => {
  const args = buildCodexArgs(
    {
      prompt: 'Summarize this repository',
      cwd: '/repo',
      model: 'gpt-5.4',
      sandbox: 'workspace-write',
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

test('providers reject unsupported request options instead of ignoring them', () => {
  assert.throws(
    () =>
      buildCodexArgs({
        prompt: 'Review this change',
        approvalMode: 'on-request',
      }, {
        outputFile: '/tmp/codex-last-message.txt',
      }),
    /codex does not support request option\(s\): approvalMode/,
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

test('CLI helper functions compute runtime paths and exit codes safely', () => {
  assert.equal(resolveHammerkitDir('/tmp/repo'), resolve('/tmp/repo', '.hammerkit'))
  assert.equal(resolveHammerkitDir('/tmp/repo/.hammerkit'), '/tmp/repo/.hammerkit')

  assert.equal(runResultExitCode({ ok: true, exitCode: 9 }), 0)
  assert.equal(runResultExitCode({ ok: false, exitCode: 17 }), 17)
  assert.equal(runResultExitCode({ ok: false, exitCode: null }), 1)

  assert.equal(compareResultsExitCode([{ ok: true }, { ok: true }]), 0)
  assert.equal(compareResultsExitCode([{ ok: true }, { ok: false }]), 1)

  assert.equal(
    defaultHammerkitDependency('0.1.0', '/pkg', '/pkg/src/cli'),
    'file:/pkg',
  )
  assert.equal(
    defaultHammerkitDependency('0.1.0', '/pkg', '/pkg/dist/cli'),
    '^0.1.0',
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

test('compareProviders rejects provider-specific common options', async () => {
  const adapter: AgentAdapter = {
    name: 'stub-claude',
    capabilities: {
      approvalMode: false,
      files: false,
      sandbox: false,
      schema: true,
      sessionName: true,
    },
    async run() {
      assert.fail('compareProviders should reject unsupported common options before running')
    },
  }

  await assert.rejects(
    () =>
      compareProviders({
        adapters: [adapter],
        promptTemplate: 'Hello',
        common: {
          sandbox: 'workspace-write',
        },
      }),
    /compareProviders common request contains provider-specific options: stub-claude: sandbox/,
  )
})

test('runPipeline creates a unique output directory for each run', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'hammerkit-run-pipeline-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const hammerkitDir = join(tmpRoot, '.hammerkit')
  await mkdir(join(hammerkitDir, 'pipelines'), { recursive: true })
  await writeFile(
    join(hammerkitDir, 'pipelines', 'hello.ts'),
    [
      'export default async function pipeline(ctx) {',
      "  const file = await ctx.writeOutput('result.txt', String(ctx.options.label ?? ''))",
      "  return { ok: true, outputPath: file, summary: 'ok' }",
      '}',
      '',
    ].join('\n'),
    'utf8',
  )

  const first = await runPipeline('hello', hammerkitDir, { options: { label: 'first' } })
  const second = await runPipeline('hello', hammerkitDir, { options: { label: 'second' } })

  assert.ok(first.outputPath)
  assert.ok(second.outputPath)
  assert.notEqual(dirname(first.outputPath), dirname(second.outputPath))
  assert.equal(await readFile(first.outputPath, 'utf8'), 'first')
  assert.equal(await readFile(second.outputPath, 'utf8'), 'second')
})

test('runPipeline rejects invalid review scopes instead of reporting a clean diff', async () => {
  await assert.rejects(
    () =>
      runPipeline('code-review', resolve('.hammerkit'), {
        options: { scope: '__hammerkit_missing_review_scope__' },
      }),
    /Invalid review scope "__hammerkit_missing_review_scope__"/,
  )
})

test('runPipeline resumes cached step results without re-running side effects', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'hammerkit-resume-step-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const hammerkitDir = join(tmpRoot, '.hammerkit')
  await writePipeline(
    hammerkitDir,
    'resume-step',
    [
      "import { readFile, writeFile } from 'node:fs/promises'",
      "import { join } from 'node:path'",
      '',
      'export default async function pipeline(ctx) {',
      "  const counterPath = join(ctx.repoRoot, 'counter.txt')",
      "  const value = await ctx.step('expensive', async () => {",
      "    const raw = await readFile(counterPath, 'utf8').catch(() => '0')",
      '    const next = Number(raw) + 1',
      "    await writeFile(counterPath, String(next), 'utf8')",
      '    return { next }',
      '  })',
      "  const failedOnce = await ctx.getCheckpoint('failed-once')",
      '  if (!failedOnce) {',
      "    await ctx.checkpoint('failed-once', true)",
      "    throw new Error('fail once after step')",
      '  }',
      "  const output = await ctx.writeOutput('result.json', JSON.stringify(value))",
      "  return { ok: true, outputPath: output, summary: 'done' }",
      '}',
      '',
    ].join('\n'),
  )

  const runId = 'resume-step-run'
  await assert.rejects(
    () => runPipeline('resume-step', hammerkitDir, { runId }),
    /fail once after step/,
  )

  const resumed = await runPipeline('resume-step', hammerkitDir, { resumeRunId: runId })
  assert.equal(resumed.runId, runId)
  assert.equal(resumed.outputDir, join(hammerkitDir, '.work', 'resume-step', runId))
  assert.equal(
    await readFile(join(tmpRoot, 'counter.txt'), 'utf8'),
    '1',
  )
})

test('runPipeline caches child pipeline results across resume', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'hammerkit-resume-child-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const hammerkitDir = join(tmpRoot, '.hammerkit')
  await writePipeline(
    hammerkitDir,
    'child',
    [
      "import { readFile, writeFile } from 'node:fs/promises'",
      "import { join } from 'node:path'",
      '',
      'export default async function pipeline(ctx) {',
      "  const counterPath = join(ctx.repoRoot, 'child-count.txt')",
      "  const raw = await readFile(counterPath, 'utf8').catch(() => '0')",
      '  const next = Number(raw) + 1',
      "  await writeFile(counterPath, String(next), 'utf8')",
      "  const output = await ctx.writeOutput('child.txt', String(next))",
      "  return { ok: true, outputPath: output, summary: `child ${next}` }",
      '}',
      '',
    ].join('\n'),
  )
  await writePipeline(
    hammerkitDir,
    'parent',
    [
      "export default async function pipeline(ctx) {",
      "  const child = await ctx.spawn({ id: 'child-one', pipelineName: 'child' })",
      "  const failedOnce = await ctx.getCheckpoint('failed-once')",
      '  if (!failedOnce) {',
      "    await ctx.checkpoint('failed-once', true)",
      "    throw new Error('fail once after child')",
      '  }',
      "  const output = await ctx.writeOutput('parent.json', JSON.stringify({ childRunId: child.runId }))",
      "  return { ok: true, outputPath: output, summary: 'parent done' }",
      '}',
      '',
    ].join('\n'),
  )

  const runId = 'parent-run'
  await assert.rejects(
    () => runPipeline('parent', hammerkitDir, { runId }),
    /fail once after child/,
  )

  const resumed = await runPipeline('parent', hammerkitDir, { resumeRunId: runId })
  assert.equal(resumed.ok, true)
  assert.equal(await readFile(join(tmpRoot, 'child-count.txt'), 'utf8'), '1')

  const childRuns = await readdir(join(hammerkitDir, '.work', 'child'))
  assert.equal(childRuns.length, 1)
})

test('runPipeline resumes failed child pipelines with the same child run ID', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'hammerkit-resume-failed-child-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const hammerkitDir = join(tmpRoot, '.hammerkit')
  await writePipeline(
    hammerkitDir,
    'child',
    [
      "import { readFile, writeFile } from 'node:fs/promises'",
      "import { join } from 'node:path'",
      '',
      'export default async function pipeline(ctx) {',
      "  const counterPath = join(ctx.repoRoot, 'child-count.txt')",
      "  const value = await ctx.step('expensive', async () => {",
      "    const raw = await readFile(counterPath, 'utf8').catch(() => '0')",
      '    const next = Number(raw) + 1',
      "    await writeFile(counterPath, String(next), 'utf8')",
      '    return next',
      '  })',
      "  const failedOnce = await ctx.getCheckpoint('failed-once')",
      '  if (!failedOnce) {',
      "    await ctx.checkpoint('failed-once', true)",
      "    throw new Error('child fails once')",
      '  }',
      "  const output = await ctx.writeOutput('child.json', JSON.stringify({ value }))",
      "  return { ok: true, outputPath: output, summary: 'child done' }",
      '}',
      '',
    ].join('\n'),
  )
  await writePipeline(
    hammerkitDir,
    'parent',
    [
      "export default async function pipeline(ctx) {",
      "  const child = await ctx.spawn({ id: 'child-one', pipelineName: 'child' })",
      "  const output = await ctx.writeOutput('parent.json', JSON.stringify({ childRunId: child.runId }))",
      "  return { ok: true, outputPath: output, summary: 'parent done' }",
      '}',
      '',
    ].join('\n'),
  )

  const runId = 'parent-run'
  await assert.rejects(
    () => runPipeline('parent', hammerkitDir, { runId }),
    /child fails once/,
  )

  const resumed = await runPipeline('parent', hammerkitDir, { resumeRunId: runId })
  assert.equal(resumed.ok, true)
  assert.equal(await readFile(join(tmpRoot, 'child-count.txt'), 'utf8'), '1')

  const childRuns = await readdir(join(hammerkitDir, '.work', 'child'))
  assert.equal(childRuns.length, 1)
})

test('repeatUntil checkpoints loop state for resumed runs', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'hammerkit-repeat-until-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const hammerkitDir = join(tmpRoot, '.hammerkit')
  await writePipeline(
    hammerkitDir,
    'repeat-loop',
    [
      "import { appendFile } from 'node:fs/promises'",
      "import { join } from 'node:path'",
      '',
      'export default async function pipeline(ctx) {',
      "  const logPath = join(ctx.repoRoot, 'loop.log')",
      "  const finalState = await ctx.repeatUntil({",
      "    id: 'counter',",
      '    initialState: { value: 0 },',
      '    async step(state, iteration) {',
      '      const nextState = await ctx.step(`count:${iteration}`, async () => {',
      "        await appendFile(logPath, `${iteration}\\n`, 'utf8')",
      '        return { value: state.value + 1 }',
      '      })',
      "      const failedOnce = await ctx.getCheckpoint('failed-once')",
      '      if (iteration === 1 && !failedOnce) {',
      "        await ctx.checkpoint('failed-once', true)",
      "        throw new Error('fail during loop')",
      '      }',
      '      return nextState',
      '    },',
      '    until(state) {',
      '      return state.value >= 3',
      '    },',
      '  })',
      "  const output = await ctx.writeOutput('loop.json', JSON.stringify(finalState))",
      "  return { ok: true, outputPath: output, summary: 'loop complete' }",
      '}',
      '',
    ].join('\n'),
  )

  const runId = 'loop-run'
  await assert.rejects(
    () => runPipeline('repeat-loop', hammerkitDir, { runId }),
    /fail during loop/,
  )

  const resumed = await runPipeline('repeat-loop', hammerkitDir, { resumeRunId: runId })
  assert.equal(resumed.ok, true)
  assert.equal(
    await readFile(join(tmpRoot, 'loop.log'), 'utf8'),
    ['0', '1', '2', ''].join('\n'),
  )
  assert.equal(
    await readFile(join(hammerkitDir, '.work', 'repeat-loop', runId, 'loop.json'), 'utf8'),
    JSON.stringify({ value: 3 }),
  )
})

test('hammerkit-init supports --force and scaffolds install-safe scripts plus pipeline-only tsconfig', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'hammerkit-init-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const targetDir = join(tmpRoot, 'repo')
  await mkdir(targetDir, { recursive: true })

  const initEntry = join(process.cwd(), 'src', 'cli', 'init.ts')
  const baseArgs = [
    '--conditions=source',
    initEntry,
    targetDir,
    '--no-install',
    '--no-ai-config',
  ]

  const first = spawnSync(process.execPath, baseArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  assert.equal(first.status, 0, first.stderr)

  const generatedPkg = JSON.parse(
    await readFile(join(targetDir, '.hammerkit', 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string>; scripts?: Record<string, string> }
  assert.equal(generatedPkg.dependencies?.hammerkit, `file:${process.cwd()}`)
  assert.equal(generatedPkg.scripts?.review, 'node scripts/review.ts')
  assert.equal(generatedPkg.scripts?.explain, 'node scripts/explain.ts')

  const generatedTsconfig = JSON.parse(
    await readFile(join(targetDir, '.hammerkit', 'tsconfig.json'), 'utf8'),
  ) as { include?: string[] }
  assert.deepEqual(generatedTsconfig.include, [
    'scripts/**/*.ts',
    'pipelines/**/*.ts',
  ])

  await writeFile(join(targetDir, '.hammerkit', 'marker.txt'), 'stale', 'utf8')

  const second = spawnSync(process.execPath, baseArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  assert.equal(second.status, 1)
  assert.match(second.stderr, /Use --force or delete it first\./)

  const forced = spawnSync(process.execPath, [...baseArgs, '--force'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  assert.equal(forced.status, 0, forced.stderr)
  await assert.rejects(() => readFile(join(targetDir, '.hammerkit', 'marker.txt'), 'utf8'))
})
