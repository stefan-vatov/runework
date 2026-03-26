import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { runPipeline } from './runner.ts'
import type { PipelineProgressEvent } from './types.ts'

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

type EncodedValue = { type: 'value'; value: unknown } | { type: 'undefined' }

type WorkflowState = {
  checkpoints: Record<string, EncodedValue | undefined>
}

async function readWorkflowState(
  runeworkDir: string,
  pipelineName: string,
  runId: string,
): Promise<WorkflowState> {
  const path = join(runeworkDir, '.work', pipelineName, runId, 'workflow-state.json')
  return JSON.parse(await readFile(path, 'utf8')) as WorkflowState
}

function readCheckpointValue<T>(state: WorkflowState, checkpointId: string): T | undefined {
  const stored = state.checkpoints[checkpointId]
  if (!stored || stored.type === 'undefined') return undefined
  return stored.value as T
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

// ===========================================================================
// Declarative stage pipeline tests
// ===========================================================================

test('defineStagePipeline: sequential jobs with vars and resume', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-stage-seq-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
    'stage-seq',
    [
      "import { readFile, writeFile } from 'node:fs/promises'",
      "import { join } from 'node:path'",
      "import { defineStagePipeline } from 'runework/pipelines'",
      '',
      'export default defineStagePipeline({',
      '  version: 1,',
      '  variables: { counter: 0 },',
      '  stages: [{',
      "    id: 'work',",
      "    label: 'Work',",
      '    steps: [',
      '      {',
      "        id: 'increment',",
      '        async run(ctx) {',
      "          const counterPath = join(ctx.repoRoot, 'counter.txt')",
      "          const raw = await readFile(counterPath, 'utf8').catch(() => '0')",
      '          const next = Number(raw) + 1',
      "          await writeFile(counterPath, String(next), 'utf8')",
      '          return { vars: { counter: next } }',
      '        },',
      '      },',
      '      {',
      "        id: 'fail-once',",
      '        async run(ctx) {',
      "          const failedOnce = await ctx.getCheckpoint('failed-once')",
      '          if (!failedOnce) {',
      "            await ctx.checkpoint('failed-once', true)",
      "            throw new Error('fail once')",
      '          }',
      '          return {}',
      '        },',
      '      },',
      '    ],',
      '  }],',
      '  result: (ctx) => ({',
      '    ok: true,',
      '    summary: `counter=${ctx.vars.counter}`,',
      '  }),',
      '})',
      '',
    ].join('\n'),
  )

  const runId = 'stage-seq-run'
  await assert.rejects(
    () => runPipeline('stage-seq', runeworkDir, { runId }),
    /fail once/,
  )

  const failedState = await readWorkflowState(runeworkDir, 'stage-seq', runId)
  assert.deepEqual(
    readCheckpointValue(failedState, 'stages:variables'),
    { counter: 0 },
  )

  const resumed = await runPipeline('stage-seq', runeworkDir, { resumeRunId: runId })
  assert.equal(resumed.ok, true)
  assert.equal(resumed.summary, 'counter=1')
  // The increment step should not have run again
  assert.equal(await readFile(join(tmpRoot, 'counter.txt'), 'utf8'), '1')
})

test('defineStagePipeline: parallel group with atomic var merge', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-stage-parallel-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
    'stage-par',
    [
      "import { readFile, writeFile } from 'node:fs/promises'",
      "import { join } from 'node:path'",
      "import { defineStagePipeline } from 'runework/pipelines'",
      '',
      'export default defineStagePipeline({',
      '  version: 1,',
      '  variables: { a: 0, b: 0 },',
      '  stages: [{',
      "    id: 'work',",
      '    steps: [{',
      '      parallel: [',
      '        {',
      "          id: 'job-a',",
      '          async run(ctx) {',
      "            const path = join(ctx.repoRoot, 'a.txt')",
      "            const raw = await readFile(path, 'utf8').catch(() => '0')",
      '            const next = Number(raw) + 1',
      "            await writeFile(path, String(next), 'utf8')",
      '            return { vars: { a: next } }',
      '          },',
      '        },',
      '        {',
      "          id: 'job-b',",
      '          async run(ctx) {',
      "            const failedOnce = await ctx.getCheckpoint('b-failed')",
      '            if (!failedOnce) {',
      "              await ctx.checkpoint('b-failed', true)",
      "              throw new Error('b fails once')",
      '            }',
      '            return { vars: { b: 42 } }',
      '          },',
      '        },',
      '      ],',
      '    }],',
      '  }],',
      '  result: (ctx) => ({',
      '    ok: true,',
      '    summary: `a=${ctx.vars.a},b=${ctx.vars.b}`,',
      '  }),',
      '})',
      '',
    ].join('\n'),
  )

  const runId = 'stage-par-run'
  await assert.rejects(
    () => runPipeline('stage-par', runeworkDir, { runId }),
    /b fails once/,
  )

  const failedState = await readWorkflowState(runeworkDir, 'stage-par', runId)
  assert.deepEqual(
    readCheckpointValue(failedState, 'stages:variables'),
    { a: 0, b: 0 },
  )

  const resumed = await runPipeline('stage-par', runeworkDir, { resumeRunId: runId })
  assert.equal(resumed.ok, true)
  assert.equal(resumed.summary, 'a=1,b=42')
  // job-a should not have run again (cached)
  assert.equal(await readFile(join(tmpRoot, 'a.txt'), 'utf8'), '1')
})

test('defineStagePipeline: ctx.vars is deeply immutable across parallel jobs', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-stage-vars-immutable-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
    'stage-vars-immutable',
    [
      "import { defineStagePipeline } from 'runework/pipelines'",
      '',
      'export default defineStagePipeline({',
      '  version: 1,',
      '  variables: { box: { count: 0 } },',
      '  stages: [{',
      "    id: 'parallel',",
      '    steps: [{',
      '      parallel: [',
      '        {',
      "          id: 'first',",
      '          async run(ctx) {',
      '            try {',
      '              (ctx.vars.box as { count: number }).count += 1',
      '            } catch {}',
      '          },',
      '        },',
      '        {',
      "          id: 'second',",
      '          async run(ctx) {',
      '            try {',
      '              (ctx.vars.box as { count: number }).count += 1',
      '            } catch {}',
      '          },',
      '        },',
      '      ],',
      '    }],',
      '  }],',
      '  result: (ctx) => ({',
      '    ok: true,',
      '    summary: `count=${(ctx.vars.box as { count: number }).count}`,',
      '  }),',
      '})',
      '',
    ].join('\n'),
  )

  const result = await runPipeline('stage-vars-immutable', runeworkDir)
  assert.equal(result.ok, true)
  assert.equal(result.summary, 'count=0')
})

test('defineStagePipeline: ctx.vars blocks Map, Set, and Date mutation across parallel jobs', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-stage-vars-builtins-immutable-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
    'stage-vars-builtins-immutable',
    [
      "import { defineStagePipeline } from 'runework/pipelines'",
      '',
      'export default defineStagePipeline({',
      '  version: 1,',
      "  variables: { counts: new Map([['count', 0]]), flags: new Set(['ready']), dueAt: new Date('2024-01-01T00:00:00.000Z') },",
      '  stages: [{',
      "    id: 'parallel',",
      '    steps: [{',
      '      parallel: [',
      '        {',
      "          id: 'map-job',",
      '          async run(ctx) {',
      '            try {',
      "              (ctx.vars.counts as Map<string, number>).set('count', 1)",
      '            } catch {}',
      '          },',
      '        },',
      '        {',
      "          id: 'set-job',",
      '          async run(ctx) {',
      '            try {',
      "              (ctx.vars.flags as Set<string>).add('mutated')",
      '            } catch {}',
      '          },',
      '        },',
      '        {',
      "          id: 'date-job',",
      '          async run(ctx) {',
      '            try {',
      '              (ctx.vars.dueAt as Date).setUTCFullYear(2030)',
      '            } catch {}',
      '          },',
      '        },',
      '      ],',
      '    }],',
      '  }],',
      '  result: (ctx) => ({',
      '    ok: true,',
      "    summary: `count=${(ctx.vars.counts as Map<string, number>).get('count')},flags=${Array.from(ctx.vars.flags as Set<string>).join(',')},year=${(ctx.vars.dueAt as Date).getUTCFullYear()}`,",
      '  }),',
      '})',
      '',
    ].join('\n'),
  )

  const result = await runPipeline('stage-vars-builtins-immutable', runeworkDir)
  assert.equal(result.ok, true)
  assert.equal(result.summary, 'count=0,flags=ready,year=2024')
})

test('defineStagePipeline: parallel group surfaces every failure', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-stage-parallel-errors-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
    'stage-par-errors',
    [
      "import { defineStagePipeline } from 'runework/pipelines'",
      '',
      'export default defineStagePipeline({',
      '  version: 1,',
      '  variables: {},',
      '  stages: [{',
      "    id: 'work',",
      '    steps: [{',
      '      parallel: [',
      '        {',
      "          id: 'job-a',",
      "          async run() { throw new Error('parallel failure A') },",
      '        },',
      '        {',
      "          id: 'job-b',",
      "          async run() { throw new Error('parallel failure B') },",
      '        },',
      '      ],',
      '    }],',
      '  }],',
      '  result: () => ({ ok: true, summary: "done" }),',
      '})',
      '',
    ].join('\n'),
  )

  await assert.rejects(
    () => runPipeline('stage-par-errors', runeworkDir),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /parallel failure A/)
      assert.match(error.message, /parallel failure B/)

      const cause = (error as Error & { cause?: unknown }).cause
      assert.ok(cause instanceof AggregateError)
      assert.equal(cause.errors.length, 2)
      assert.match(String(cause.errors[0]), /parallel failure A/)
      assert.match(String(cause.errors[1]), /parallel failure B/)
      return true
    },
  )
})

test('defineStagePipeline: repeated stage with iteration-scoped durability', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-stage-repeat-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
    'stage-repeat',
    [
      "import { appendFile } from 'node:fs/promises'",
      "import { join } from 'node:path'",
      "import { defineStagePipeline } from 'runework/pipelines'",
      '',
      'export default defineStagePipeline({',
      '  version: 1,',
      '  variables: { total: 0 },',
      '  stages: [{',
      "    id: 'cycle',",
      '    repeat: { count: 3 },',
      '    steps: [{',
      "      id: 'work',",
      '      async run(ctx) {',
      "        const logPath = join(ctx.repoRoot, 'iterations.log')",
      '        const prev = ctx.vars.total as number',
      '        const next = prev + 1',
      "        await appendFile(logPath, `${next}\\n`, 'utf8')",
      "        const failedOnce = await ctx.getCheckpoint('failed-iter')",
      '        if (next === 2 && !failedOnce) {',
      "          await ctx.checkpoint('failed-iter', true)",
      "          throw new Error('fail on iteration 2')",
      '        }',
      '        return { vars: { total: next } }',
      '      },',
      '    }],',
      '  }],',
      '  result: (ctx) => ({',
      '    ok: true,',
      '    summary: `total=${ctx.vars.total}`,',
      '  }),',
      '})',
      '',
    ].join('\n'),
  )

  const runId = 'stage-repeat-run'
  await assert.rejects(
    () => runPipeline('stage-repeat', runeworkDir, { runId }),
    /fail on iteration 2/,
  )

  const resumed = await runPipeline('stage-repeat', runeworkDir, { resumeRunId: runId })
  assert.equal(resumed.ok, true)
  assert.equal(resumed.summary, 'total=3')
  // Iteration 1 should not re-run; iteration 2 retries, iteration 3 is new
  const log = await readFile(join(tmpRoot, 'iterations.log'), 'utf8')
  assert.equal(log, '1\n2\n2\n3\n')
})

test('defineStagePipeline: nested output paths via writeStageOutput', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-stage-nested-out-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
    'stage-nested',
    [
      "import { defineStagePipeline } from 'runework/pipelines'",
      '',
      'export default defineStagePipeline({',
      '  version: 1,',
      '  variables: {},',
      '  stages: [{',
      "    id: 'output-test',",
      '    steps: [{',
      "      id: 'write-nested',",
      '      async run(ctx) {',
      "        await ctx.writeStageOutput('deep/nested/result.txt', 'hello from nested')",
      '        return {}',
      '      },',
      '    }],',
      '  }],',
      '  result: () => ({ ok: true, summary: "done" }),',
      '})',
      '',
    ].join('\n'),
  )

  const result = await runPipeline('stage-nested', runeworkDir)
  assert.equal(result.ok, true)
  assert.ok(result.outputDir)
  const nestedFile = join(result.outputDir!, 'output-test', 'deep', 'nested', 'result.txt')
  const content = await readFile(nestedFile, 'utf8')
  assert.equal(content, 'hello from nested')
})

test('defineStagePipeline: stage with when condition skips', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-stage-skip-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  const events: PipelineProgressEvent[] = []

  await writePipeline(
    runeworkDir,
    'stage-skip',
    [
      "import { defineStagePipeline } from 'runework/pipelines'",
      '',
      'export default defineStagePipeline({',
      '  version: 1,',
      '  variables: { skip: true },',
      '  stages: [',
      '    {',
      "      id: 'always-run',",
      '      steps: [{',
      "        id: 'noop',",
      '        async run() { return {} },',
      '      }],',
      '    },',
      '    {',
      "      id: 'conditional',",
      '      when: (ctx) => !ctx.vars.skip,',
      '      steps: [{',
      "        id: 'should-not-run',",
      '        async run() {',
      "          throw new Error('should not reach here')",
      '        },',
      '      }],',
      '    },',
      '  ],',
      '  result: () => ({ ok: true, summary: "skipped" }),',
      '})',
      '',
    ].join('\n'),
  )

  const result = await runPipeline('stage-skip', runeworkDir, {
    onProgress: (e) => events.push(e),
  })
  assert.equal(result.ok, true)
  assert.ok(events.some((e) => e.type === 'stage-skipped' && e.id === 'conditional'))
})

test('defineStagePipeline: emits progress events for stages and jobs', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-stage-progress-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  const events: PipelineProgressEvent[] = []

  await writePipeline(
    runeworkDir,
    'stage-progress',
    [
      "import { defineStagePipeline } from 'runework/pipelines'",
      '',
      'export default defineStagePipeline({',
      '  version: 1,',
      '  variables: {},',
      '  stages: [{',
      "    id: 'build',",
      "    label: 'Build phase',",
      '    steps: [{',
      "      id: 'compile',",
      "      label: 'Compile sources',",
      '      async run() { return {} },',
      '    }],',
      '  }],',
      '  result: () => ({ ok: true, summary: "built" }),',
      '})',
      '',
    ].join('\n'),
  )

  await runPipeline('stage-progress', runeworkDir, {
    onProgress: (e) => events.push(e),
  })

  const types = events.map((e) => e.type)
  assert.ok(types.includes('stage-started'))
  assert.ok(types.includes('job-started'))
  assert.ok(types.includes('job-completed'))
  assert.ok(types.includes('stage-completed'))

  const stageStart = events.find((e) => e.type === 'stage-started')
  assert.ok(stageStart && 'label' in stageStart && stageStart.label === 'Build phase')

  const jobStart = events.find((e) => e.type === 'job-started')
  assert.ok(jobStart && 'label' in jobStart && jobStart.label === 'Compile sources')
})

test('defineStagePipeline: emits failed terminal progress for stages', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-stage-progress-failed-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  const events: PipelineProgressEvent[] = []

  await writePipeline(
    runeworkDir,
    'stage-progress-failed',
    [
      "import { defineStagePipeline } from 'runework/pipelines'",
      '',
      'export default defineStagePipeline({',
      '  version: 1,',
      '  variables: {},',
      '  stages: [{',
      "    id: 'build',",
      "    label: 'Build phase',",
      '    steps: [{',
      "      id: 'compile',",
      "      label: 'Compile sources',",
      "      async run() { throw new Error('compile exploded') },",
      '    }],',
      '  }],',
      '  result: () => ({ ok: true, summary: "built" }),',
      '})',
      '',
    ].join('\n'),
  )

  await assert.rejects(
    () => runPipeline('stage-progress-failed', runeworkDir, {
      onProgress: (e) => events.push(e),
    }),
    /compile exploded/,
  )

  const types = events.map((e) => e.type)
  assert.ok(types.includes('stage-started'))
  assert.ok(types.includes('job-started'))
  assert.ok(types.includes('job-failed'))
  assert.ok(types.includes('stage-failed'))
  assert.ok(!types.includes('stage-completed'))

  const stageFailed = events.find((e) => e.type === 'stage-failed')
  assert.ok(stageFailed && stageFailed.id === 'build' && stageFailed.label === 'Build phase')
  if (stageFailed?.type === 'stage-failed') {
    assert.match(stageFailed.error, /compile exploded/)
  }
})

test('defineStagePipeline: parallel group resolves conflicting vars in declaration order', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-stage-parallel-conflict-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
    'stage-par-conflict',
    [
      "import { defineStagePipeline } from 'runework/pipelines'",
      '',
      'export default defineStagePipeline({',
      '  version: 1,',
      "  variables: { winner: 'none' },",
      '  stages: [{',
      "    id: 'parallel',",
      '    steps: [{',
      '      parallel: [',
      '        {',
      "          id: 'first',",
      "          async run() { return { vars: { winner: 'first' } } },",
      '        },',
      '        {',
      "          id: 'second',",
      "          async run() { return { vars: { winner: 'second' } } },",
      '        },',
      '      ],',
      '    }],',
      '  }],',
      '  result: (ctx) => ({ ok: true, summary: `winner=${ctx.vars.winner}` }),',
      '})',
      '',
    ].join('\n'),
  )

  const result = await runPipeline('stage-par-conflict', runeworkDir)
  assert.equal(result.ok, true)
  assert.equal(result.summary, 'winner=second')
})

test('defineStagePipeline: repeat.count validates bounds and count=1 executes once', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-stage-repeat-bounds-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')

  await writePipeline(
    runeworkDir,
    'stage-repeat-one',
    [
      "import { defineStagePipeline } from 'runework/pipelines'",
      '',
      'export default defineStagePipeline({',
      '  version: 1,',
      '  variables: { hits: 0 },',
      '  stages: [{',
      "    id: 'once',",
      '    repeat: { count: 1 },',
      '    steps: [{',
      "      id: 'tick',",
      '      async run(ctx) {',
      '        return { vars: { hits: Number(ctx.vars.hits) + 1 } }',
      '      },',
      '    }],',
      '  }],',
      '  result: (ctx) => ({ ok: true, summary: `hits=${ctx.vars.hits}` }),',
      '})',
      '',
    ].join('\n'),
  )

  const onceResult = await runPipeline('stage-repeat-one', runeworkDir)
  assert.equal(onceResult.ok, true)
  assert.equal(onceResult.summary, 'hits=1')

  const invalidCases = [
    { name: 'stage-repeat-zero', count: '0' },
    { name: 'stage-repeat-negative', count: '-1' },
    { name: 'stage-repeat-fractional', count: '1.5' },
    { name: 'stage-repeat-max-safe', count: 'Number.MAX_SAFE_INTEGER' },
  ]

  for (const testCase of invalidCases) {
    await writePipeline(
      runeworkDir,
      testCase.name,
      [
        "import { defineStagePipeline } from 'runework/pipelines'",
        '',
        'export default defineStagePipeline({',
        '  version: 1,',
        '  variables: {},',
        '  stages: [{',
        "    id: 'repeat-me',",
        `    repeat: { count: ${testCase.count} },`,
        '    steps: [{',
        "      id: 'noop',",
        '      async run() { return {} },',
        '    }],',
        '  }],',
        '  result: () => ({ ok: true, summary: "done" }),',
        '})',
        '',
      ].join('\n'),
    )

    await assert.rejects(
      () => runPipeline(testCase.name, runeworkDir),
      /repeat\.count must be an integer between 1 and 10000/,
    )
  }
})

test('defineStagePipeline: repeated stage output dirs do not collide with sibling stage ids', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-stage-output-collision-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
    'stage-output-collision',
    [
      "import { defineStagePipeline } from 'runework/pipelines'",
      '',
      'export default defineStagePipeline({',
      '  version: 1,',
      '  variables: {},',
      '  stages: [',
      '    {',
      "      id: 'foo',",
      '      repeat: { count: 2 },',
      '      steps: [{',
      "        id: 'write-repeat',",
      '        async run(ctx) {',
      '          await ctx.writeStageOutput("result.txt", ctx.stageExecutionId)',
      '          return {}',
      '        },',
      '      }],',
      '    },',
      '    {',
      "      id: 'foo-1',",
      '      steps: [{',
      "        id: 'write-single',",
      '        async run(ctx) {',
      '          await ctx.writeStageOutput("result.txt", ctx.stageExecutionId)',
      '          return {}',
      '        },',
      '      }],',
      '    },',
      '  ],',
      '  result: () => ({ ok: true, summary: "done" }),',
      '})',
      '',
    ].join('\n'),
  )

  const result = await runPipeline('stage-output-collision', runeworkDir)
  assert.equal(result.ok, true)
  assert.ok(result.outputDir)

  const repeatFirst = await readFile(join(result.outputDir!, 'foo[1]', 'result.txt'), 'utf8')
  const repeatSecond = await readFile(join(result.outputDir!, 'foo[2]', 'result.txt'), 'utf8')
  const sibling = await readFile(join(result.outputDir!, 'foo-1', 'result.txt'), 'utf8')

  assert.equal(repeatFirst, 'foo[1]')
  assert.equal(repeatSecond, 'foo[2]')
  assert.equal(sibling, 'foo-1')
})

test('defineStagePipeline: nested stages under repeated parent get isolated output paths', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-stage-nested-repeat-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const runeworkDir = join(tmpRoot, '.runework')
  await writePipeline(
    runeworkDir,
    'stage-nested-repeat',
    [
      "import { defineStagePipeline } from 'runework/pipelines'",
      '',
      'export default defineStagePipeline({',
      '  version: 1,',
      '  variables: {},',
      '  stages: [{',
      "    id: 'outer',",
      '    repeat: { count: 2 },',
      '    steps: [{',
      "      id: 'inner',",
      '      steps: [{',
      "        id: 'write-file',",
      '        async run(ctx) {',
      '          await ctx.writeStageOutput("result.txt", `iteration ${ctx.stageExecutionId}`)',
      '          return {}',
      '        },',
      '      }],',
      '    }],',
      '  }],',
      '  result: () => ({ ok: true, summary: "done" }),',
      '})',
      '',
    ].join('\n'),
  )

  const result = await runPipeline('stage-nested-repeat', runeworkDir)
  assert.equal(result.ok, true)
  assert.ok(result.outputDir)

  // Each iteration should write to a unique path under full ancestry
  const iter1File = join(result.outputDir!, 'outer[1]', 'inner', 'result.txt')
  const iter2File = join(result.outputDir!, 'outer[2]', 'inner', 'result.txt')
  const content1 = await readFile(iter1File, 'utf8')
  const content2 = await readFile(iter2File, 'utf8')
  assert.ok(content1.includes('outer[1]'))
  assert.ok(content2.includes('outer[2]'))
  // Confirm they are different files with different content
  assert.notEqual(content1, content2)
})
