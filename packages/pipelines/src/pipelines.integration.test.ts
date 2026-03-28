import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { runPipeline } from './runner.ts'

async function writePipeline(
  runeworkDir: string,
  name: string,
  source: string,
): Promise<void> {
  await linkRuneworkPackage(runeworkDir)
  await mkdir(join(runeworkDir, 'pipelines'), { recursive: true })
  await writeFile(join(runeworkDir, 'pipelines', `${name}.ts`), source, 'utf8')
}

async function linkRuneworkPackage(runeworkDir: string): Promise<void> {
  const nodeModulesDir = join(runeworkDir, 'node_modules')
  const packageLink = join(nodeModulesDir, 'runework')
  await mkdir(nodeModulesDir, { recursive: true })
  await symlink(process.cwd(), packageLink, 'dir').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })
}

test('runPipeline creates a unique output directory for each run', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-run-pipeline-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await mkdir(join(runeworkDir, 'pipelines'), { recursive: true })
  await writeFile(
    join(runeworkDir, 'pipelines', 'hello.ts'),
    [
      'export default async function pipeline(ctx) {',
      "  const file = await ctx.writeOutput('result.txt', String(ctx.options.label ?? ''))",
      "  return { ok: true, outputPath: file, summary: 'ok' }",
      '}',
      '',
    ].join('\n'),
    'utf8',
  )

  const first = await runPipeline('hello', runeworkDir, { options: { label: 'first' } })
  const second = await runPipeline('hello', runeworkDir, { options: { label: 'second' } })

  assert.ok(first.outputPath)
  assert.ok(second.outputPath)
  assert.notEqual(dirname(first.outputPath), dirname(second.outputPath))
  assert.equal(await readFile(first.outputPath, 'utf8'), 'first')
  assert.equal(await readFile(second.outputPath, 'utf8'), 'second')
})

test('runPipeline resumes cached step results without re-running side effects', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-resume-step-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
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
    () => runPipeline('resume-step', runeworkDir, { runId }),
    /fail once after step/,
  )

  const resumed = await runPipeline('resume-step', runeworkDir, { resumeRunId: runId })
  assert.equal(resumed.runId, runId)
  assert.equal(resumed.outputDir, join(runeworkDir, '.work', 'resume-step', runId))
  assert.equal(
    await readFile(join(tmpRoot, 'counter.txt'), 'utf8'),
    '1',
  )
})

test('runPipeline caches child pipeline results across resume', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-resume-child-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
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
    runeworkDir,
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
    () => runPipeline('parent', runeworkDir, { runId }),
    /fail once after child/,
  )

  const resumed = await runPipeline('parent', runeworkDir, { resumeRunId: runId })
  assert.equal(resumed.ok, true)
  assert.equal(await readFile(join(tmpRoot, 'child-count.txt'), 'utf8'), '1')

  const childRuns = await readdir(join(runeworkDir, '.work', 'child'))
  assert.equal(childRuns.length, 1)
})

test('runPipeline resumes failed child pipelines with the same child run ID', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-resume-failed-child-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
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
    runeworkDir,
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
    () => runPipeline('parent', runeworkDir, { runId }),
    /child fails once/,
  )

  const resumed = await runPipeline('parent', runeworkDir, { resumeRunId: runId })
  assert.equal(resumed.ok, true)
  assert.equal(await readFile(join(tmpRoot, 'child-count.txt'), 'utf8'), '1')

  const childRuns = await readdir(join(runeworkDir, '.work', 'child'))
  assert.equal(childRuns.length, 1)
})

test('repeatUntil checkpoints loop state for resumed runs', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-repeat-until-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
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
    () => runPipeline('repeat-loop', runeworkDir, { runId }),
    /fail during loop/,
  )

  const resumed = await runPipeline('repeat-loop', runeworkDir, { resumeRunId: runId })
  assert.equal(resumed.ok, true)
  assert.equal(
    await readFile(join(tmpRoot, 'loop.log'), 'utf8'),
    ['0', '1', '2', ''].join('\n'),
  )
  assert.equal(
    await readFile(join(runeworkDir, '.work', 'repeat-loop', runId, 'loop.json'), 'utf8'),
    JSON.stringify({ value: 3 }),
  )
})

test('runPipeline preserves parallel step results and outputs across resume', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-parallel-steps-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
    'parallel-steps',
    [
      "import { readFile, writeFile } from 'node:fs/promises'",
      "import { join } from 'node:path'",
      '',
      'function wait(ms) {',
      '  return new Promise((resolve) => setTimeout(resolve, ms))',
      '}',
      '',
      'async function bump(path) {',
      "  const raw = await readFile(path, 'utf8').catch(() => '0')",
      '  const next = Number(raw) + 1',
      "  await writeFile(path, String(next), 'utf8')",
      '  return next',
      '}',
      '',
      'export default async function pipeline(ctx) {',
      "  const leftCountPath = join(ctx.repoRoot, 'left-count.txt')",
      "  const rightCountPath = join(ctx.repoRoot, 'right-count.txt')",
      '  const [left, right] = await Promise.all([',
      "    ctx.step('left', async () => {",
      '      await wait(10)',
      '      const count = await bump(leftCountPath)',
      "      const output = await ctx.writeOutput('left.txt', `left-${count}`)",
      '      return { count, output }',
      '    }),',
      "    ctx.step('right', async () => {",
      '      await wait(5)',
      '      const count = await bump(rightCountPath)',
      "      const output = await ctx.writeOutput('right.txt', `right-${count}`)",
      '      return { count, output }',
      '    }),',
      '  ])',
      "  const failedOnce = await ctx.getCheckpoint('failed-once')",
      '  if (!failedOnce) {',
      "    await ctx.checkpoint('failed-once', true)",
      "    throw new Error('fail once after parallel steps')",
      '  }',
      "  return { ok: true, outputPath: left.output, outputs: { left: left.output, right: right.output }, summary: 'parallel done' }",
      '}',
      '',
    ].join('\n'),
  )

  const runId = 'parallel-run'
  await assert.rejects(
    () => runPipeline('parallel-steps', runeworkDir, { runId }),
    /fail once after parallel steps/,
  )

  const state = JSON.parse(
    await readFile(join(runeworkDir, '.work', 'parallel-steps', runId, 'workflow-state.json'), 'utf8'),
  ) as {
    outputs: Record<string, string>
    stepResults: Record<string, unknown>
  }
  assert.deepEqual(Object.keys(state.stepResults).sort(), ['left', 'right'])
  assert.ok(state.outputs['left.txt']?.endsWith('/left.txt'))
  assert.ok(state.outputs['right.txt']?.endsWith('/right.txt'))

  const resumed = await runPipeline('parallel-steps', runeworkDir, { resumeRunId: runId })
  assert.equal(resumed.ok, true)
  assert.equal(await readFile(join(tmpRoot, 'left-count.txt'), 'utf8'), '1')
  assert.equal(await readFile(join(tmpRoot, 'right-count.txt'), 'utf8'), '1')
})

test('runPipeline de-duplicates concurrent step calls with the same step ID', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-duplicate-step-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
    'duplicate-step',
    [
      "import { appendFile } from 'node:fs/promises'",
      "import { join } from 'node:path'",
      '',
      'export default async function pipeline(ctx) {',
      "  const logPath = join(ctx.repoRoot, 'step.log')",
      '  const run = async () => {',
      "    await appendFile(logPath, 'same\\n', 'utf8')",
      '    return 1',
      '  }',
      "  const [left, right] = await Promise.all([ctx.step('same', run), ctx.step('same', run)])",
      "  return { ok: true, summary: `${left}:${right}` }",
      '}',
      '',
    ].join('\n'),
  )

  const result = await runPipeline('duplicate-step', runeworkDir, { log: () => {} })
  assert.equal(result.ok, true)
  assert.equal(result.summary, '1:1')
  assert.equal(await readFile(join(tmpRoot, 'step.log'), 'utf8'), 'same\n')
})
