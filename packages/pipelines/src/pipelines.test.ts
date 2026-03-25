import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { runPipeline } from './runner.ts'

async function writePipeline(
  hammerkitDir: string,
  name: string,
  source: string,
): Promise<void> {
  await mkdir(join(hammerkitDir, 'pipelines'), { recursive: true })
  await writeFile(join(hammerkitDir, 'pipelines', `${name}.ts`), source, 'utf8')
}

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
