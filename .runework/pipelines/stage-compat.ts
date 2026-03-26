import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { defineWorkflowPipeline } from 'runework/pipelines'
import type {
  PipelineContext,
  PipelineFn,
  PipelineResult,
} from 'runework/pipelines'

export type StageVariables = Record<string, unknown>

export type StageScopeContext<TVars extends StageVariables = StageVariables> = PipelineContext & {
  readonly vars: Readonly<TVars>
}

export type StageJobContext<TVars extends StageVariables = StageVariables> = StageScopeContext<TVars> & {
  readonly stageId: string
  readonly stageExecutionId: string
  readonly stageOutputDir: string
  readonly jobId: string
  readonly jobExecutionId: string
  writeStageOutput(filename: string, content: string): Promise<string>
}

export type StageJobResult<TVars extends StageVariables = StageVariables> = {
  vars?: Partial<TVars>
}

export type StageJobDefinition<TVars extends StageVariables = StageVariables> = {
  id: string
  label?: string
  when?: (ctx: StageScopeContext<TVars>) => boolean | Promise<boolean>
  run: (ctx: StageJobContext<TVars>) => Promise<StageJobResult<TVars> | void>
}

export type StageParallelGroupDefinition<TVars extends StageVariables = StageVariables> = {
  parallel: StageJobDefinition<TVars>[]
}

export type StageDefinition<TVars extends StageVariables = StageVariables> = {
  id: string
  label?: string
  when?: (ctx: StageScopeContext<TVars>) => boolean | Promise<boolean>
  repeat?: {
    count: number | ((ctx: StageScopeContext<TVars>) => number | Promise<number>)
  }
  steps: Array<StageJobDefinition<TVars> | StageParallelGroupDefinition<TVars> | StageDefinition<TVars>>
}

export type StagePipelineDefinition<TVars extends StageVariables = StageVariables> = {
  version?: number
  variables?: TVars | ((ctx: PipelineContext) => TVars | Promise<TVars>)
  stages: StageDefinition<TVars>[]
  result: (ctx: StageScopeContext<TVars>) => PipelineResult | Promise<PipelineResult>
}

const SAFE_ID = /^[a-zA-Z0-9_-]+$/
const MAX_REPEAT_COUNT = 10_000

function quoteForError(value: string): string {
  return JSON.stringify(value)
}

function formatErrorLocation(path: string): string {
  return path ? quoteForError(path) : '"root"'
}

function assertSafeId(id: string, kind: string, parentPath: string): void {
  if (!id || !id.trim()) {
    throw new Error(`${kind} id must be non-empty (at ${formatErrorLocation(parentPath)})`)
  }
  if (!SAFE_ID.test(id)) {
    throw new Error(
      `${kind} id ${quoteForError(id)} contains invalid characters — use only alphanumeric, dash, underscore (at ${formatErrorLocation(parentPath)})`,
    )
  }
}

function isParallelGroup<TVars extends StageVariables>(
  step: StageJobDefinition<TVars> | StageParallelGroupDefinition<TVars> | StageDefinition<TVars>,
): step is StageParallelGroupDefinition<TVars> {
  return 'parallel' in step && Array.isArray((step as StageParallelGroupDefinition<TVars>).parallel)
}

function isStage<TVars extends StageVariables>(
  step: StageJobDefinition<TVars> | StageParallelGroupDefinition<TVars> | StageDefinition<TVars>,
): step is StageDefinition<TVars> {
  return 'steps' in step && !('run' in step)
}

function isJob<TVars extends StageVariables>(
  step: StageJobDefinition<TVars> | StageParallelGroupDefinition<TVars> | StageDefinition<TVars>,
): step is StageJobDefinition<TVars> {
  return 'run' in step && typeof (step as StageJobDefinition<TVars>).run === 'function'
}

function validateStage<TVars extends StageVariables>(stage: StageDefinition<TVars>, parentPath: string): void {
  assertSafeId(stage.id, 'Stage', parentPath)
  const path = parentPath ? `${parentPath}/${stage.id}` : stage.id

  if (!stage.steps || stage.steps.length === 0) {
    throw new Error(`Stage ${quoteForError(path)} must have at least one step`)
  }

  const siblingIds = new Set<string>()

  for (const step of stage.steps) {
    if (isParallelGroup(step)) {
      if (step.parallel.length === 0) {
        throw new Error(`Parallel group in stage ${quoteForError(path)} must have at least one job`)
      }
      for (const job of step.parallel) {
        assertSafeId(job.id, 'Job', path)
        if (siblingIds.has(job.id)) {
          throw new Error(`Duplicate step id ${quoteForError(job.id)} in stage ${quoteForError(path)}`)
        }
        siblingIds.add(job.id)
      }
    } else if (isStage(step)) {
      if (siblingIds.has(step.id)) {
        throw new Error(`Duplicate step id ${quoteForError(step.id)} in stage ${quoteForError(path)}`)
      }
      siblingIds.add(step.id)
      validateStage(step, path)
    } else if (isJob(step)) {
      assertSafeId(step.id, 'Job', path)
      if (siblingIds.has(step.id)) {
        throw new Error(`Duplicate step id ${quoteForError(step.id)} in stage ${quoteForError(path)}`)
      }
      siblingIds.add(step.id)
    }
  }
}

function validateDefinition<TVars extends StageVariables>(definition: StagePipelineDefinition<TVars>): void {
  if (!definition.stages || definition.stages.length === 0) {
    throw new Error('StagePipelineDefinition must have at least one stage')
  }

  const topIds = new Set<string>()
  for (const stage of definition.stages) {
    if (topIds.has(stage.id)) {
      throw new Error(`Duplicate top-level stage id ${quoteForError(stage.id)}`)
    }
    topIds.add(stage.id)
    validateStage(stage, '')
  }
}

function elapsed(start: number): string {
  return ((Date.now() - start) / 1000).toFixed(1)
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const MAP_MUTATOR_METHODS = new Set<PropertyKey>(['clear', 'delete', 'set'])
const SET_MUTATOR_METHODS = new Set<PropertyKey>(['add', 'clear', 'delete'])
const DATE_MUTATOR_METHODS = new Set<PropertyKey>([
  'setDate',
  'setFullYear',
  'setHours',
  'setMilliseconds',
  'setMinutes',
  'setMonth',
  'setSeconds',
  'setTime',
  'setUTCDate',
  'setUTCFullYear',
  'setUTCHours',
  'setUTCMilliseconds',
  'setUTCMinutes',
  'setUTCMonth',
  'setUTCSeconds',
  'setYear',
])

function immutableSnapshotMutationError(kind: string): TypeError {
  return new TypeError(`Cannot mutate immutable stage variable snapshot (${kind})`)
}

function makeReadOnlyProxy<T extends object>(
  kind: string,
  target: T,
  mutatorMethods: ReadonlySet<PropertyKey>,
): T {
  return new Proxy(target, {
    defineProperty() {
      throw immutableSnapshotMutationError(kind)
    },
    deleteProperty() {
      throw immutableSnapshotMutationError(kind)
    },
    get(snapshotTarget, property) {
      if (mutatorMethods.has(property)) {
        return () => {
          throw immutableSnapshotMutationError(kind)
        }
      }
      const value = Reflect.get(snapshotTarget, property, snapshotTarget)
      return typeof value === 'function' ? value.bind(snapshotTarget) : value
    },
    set() {
      throw immutableSnapshotMutationError(kind)
    },
    setPrototypeOf() {
      throw immutableSnapshotMutationError(kind)
    },
  })
}

function makeImmutableSnapshot<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (!value || typeof value !== 'object') {
    return value
  }

  const source = value as object
  const cached = seen.get(source)
  if (cached !== undefined) {
    return cached as T
  }

  if (value instanceof Map) {
    const target = new Map<unknown, unknown>()
    const proxy = makeReadOnlyProxy('Map', target, MAP_MUTATOR_METHODS)
    seen.set(source, proxy)
    for (const [key, nested] of value) {
      Map.prototype.set.call(
        target,
        makeImmutableSnapshot(key, seen),
        makeImmutableSnapshot(nested, seen),
      )
    }
    Object.freeze(target)
    return proxy as T
  }

  if (value instanceof Set) {
    const target = new Set<unknown>()
    const proxy = makeReadOnlyProxy('Set', target, SET_MUTATOR_METHODS)
    seen.set(source, proxy)
    for (const nested of value) {
      Set.prototype.add.call(target, makeImmutableSnapshot(nested, seen))
    }
    Object.freeze(target)
    return proxy as T
  }

  if (value instanceof Date) {
    const target = new Date(value.getTime())
    const proxy = makeReadOnlyProxy('Date', target, DATE_MUTATOR_METHODS)
    seen.set(source, proxy)
    Object.freeze(target)
    return proxy as T
  }

  const target = value as Record<PropertyKey, unknown>
  seen.set(source, target)

  for (const key of Reflect.ownKeys(target)) {
    target[key] = makeImmutableSnapshot(target[key], seen)
  }

  return Object.freeze(value)
}

function cloneVars(vars: StageVariables): StageVariables {
  return structuredClone(vars)
}

function describeChangedVarKeys(previous: StageVariables, current: StageVariables): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)])
  return [...keys]
    .filter((key) => !isDeepStrictEqual(previous[key], current[key]))
    .sort()
}

async function resolveInitialVars<TVars extends StageVariables>(
  definition: StagePipelineDefinition<TVars>,
  ctx: PipelineContext,
): Promise<StageVariables> {
  const raw = typeof definition.variables === 'function'
    ? await definition.variables(ctx)
    : (definition.variables ?? {})

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Pipeline variables must resolve to a plain object')
  }

  return cloneVars(raw as StageVariables)
}

function commitVars(target: StageVariables, next: StageVariables): void {
  for (const key of Object.keys(target)) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      delete target[key]
    }
  }
  Object.assign(target, next)
}

function resolveStageOutputDir(
  parentOutputDir: string,
  stageId: string,
  iteration: number,
  totalIterations: number,
): string {
  return join(
    parentOutputDir,
    totalIterations > 1 ? `${stageId}[${iteration}]` : stageId,
  )
}

function assertValidRepeatCount(stagePathId: string, raw: number): number {
  if (!Number.isInteger(raw) || raw < 1 || raw > MAX_REPEAT_COUNT) {
    throw new Error(
      `Stage ${quoteForError(stagePathId)} repeat.count must be an integer between 1 and ${MAX_REPEAT_COUNT}, got ${raw}`,
    )
  }
  return raw
}

function makeScopeContext<TVars extends StageVariables>(
  ctx: PipelineContext,
  vars: TVars,
): StageScopeContext<TVars> {
  const frozenVars = makeImmutableSnapshot(cloneVars(vars))
  return Object.create(ctx, {
    vars: { value: frozenVars, writable: false, enumerable: true, configurable: false },
  }) as StageScopeContext<TVars>
}

function makeJobContext<TVars extends StageVariables>(
  scopeCtx: StageScopeContext<TVars>,
  opts: {
    stageId: string
    stageExecutionId: string
    stageOutputDir: string
    jobId: string
    jobExecutionId: string
  },
): StageJobContext<TVars> {
  return Object.create(scopeCtx, {
    stageId: { value: opts.stageId, writable: false, enumerable: true },
    stageExecutionId: { value: opts.stageExecutionId, writable: false, enumerable: true },
    stageOutputDir: { value: opts.stageOutputDir, writable: false, enumerable: true },
    jobId: { value: opts.jobId, writable: false, enumerable: true },
    jobExecutionId: { value: opts.jobExecutionId, writable: false, enumerable: true },
    writeStageOutput: {
      value: async (filename: string, content: string): Promise<string> => {
        const relativePath = join(opts.stageOutputDir, filename)
        return scopeCtx.writeOutput(relativePath, content)
      },
      writable: false,
      enumerable: true,
    },
  }) as StageJobContext<TVars>
}

type ExecutorOpts<TVars extends StageVariables> = {
  ctx: PipelineContext
  vars: TVars
  persistVars: (vars: TVars) => Promise<void>
}

async function executeJob<TVars extends StageVariables>(
  job: StageJobDefinition<TVars>,
  stageId: string,
  stageExecutionId: string,
  stageOutputDir: string,
  executionPathPrefix: string,
  opts: ExecutorOpts<TVars>,
): Promise<StageJobResult<TVars> | void> {
  const { ctx, vars } = opts
  const scopeCtx = makeScopeContext(ctx, vars)
  const jobExecutionId = `${executionPathPrefix}/${job.id}`

  if (job.when) {
    const shouldRun = await job.when(scopeCtx)
    if (!shouldRun) {
      ctx.progress({
        type: 'job-skipped',
        executionId: jobExecutionId,
        id: job.id,
        stageExecutionId,
        label: job.label ?? job.id,
      })
      return undefined
    }
  }

  const jobStepId = `job:${jobExecutionId}`

  ctx.progress({
    type: 'job-started',
    executionId: jobExecutionId,
    id: job.id,
    stageExecutionId,
    label: job.label ?? job.id,
  })
  const start = Date.now()

  try {
    const jobCtx = makeJobContext(scopeCtx, {
      stageId,
      stageExecutionId,
      stageOutputDir,
      jobId: job.id,
      jobExecutionId,
    })

    const result = await ctx.step(jobStepId, () => job.run(jobCtx))

    ctx.progress({
      type: 'job-completed',
      executionId: jobExecutionId,
      id: job.id,
      stageExecutionId,
      label: job.label ?? job.id,
      elapsed: elapsed(start),
    })

    return result
  } catch (error) {
    ctx.progress({
      type: 'job-failed',
      executionId: jobExecutionId,
      id: job.id,
      stageExecutionId,
      label: job.label ?? job.id,
      elapsed: elapsed(start),
      error: toErrorMessage(error),
    })
    throw error
  }
}

async function executeParallelGroup<TVars extends StageVariables>(
  group: StageParallelGroupDefinition<TVars>,
  stageId: string,
  stageExecutionId: string,
  stageOutputDir: string,
  executionPathPrefix: string,
  opts: ExecutorOpts<TVars>,
): Promise<void> {
  const { ctx, vars } = opts
  const scopeCtx = makeScopeContext(ctx, vars)
  const enabled: StageJobDefinition<TVars>[] = []

  for (const job of group.parallel) {
    const jobExecutionId = `${executionPathPrefix}/${job.id}`
    if (job.when) {
      const shouldRun = await job.when(scopeCtx)
      if (!shouldRun) {
        ctx.progress({
          type: 'job-skipped',
          executionId: jobExecutionId,
          id: job.id,
          stageExecutionId,
          label: job.label ?? job.id,
        })
        continue
      }
    }
    enabled.push(job)
  }

  if (enabled.length === 0) return

  const settled = await Promise.allSettled(
    enabled.map(async (job) => {
      const jobExecutionId = `${executionPathPrefix}/${job.id}`
      const jobStepId = `job:${jobExecutionId}`
      const start = Date.now()

      ctx.progress({
        type: 'job-started',
        executionId: jobExecutionId,
        id: job.id,
        stageExecutionId,
        label: job.label ?? job.id,
      })

      try {
        const jobCtx = makeJobContext(scopeCtx, {
          stageId,
          stageExecutionId,
          stageOutputDir,
          jobId: job.id,
          jobExecutionId,
        })

        const result = await ctx.step(jobStepId, () => job.run(jobCtx))

        ctx.progress({
          type: 'job-completed',
          executionId: jobExecutionId,
          id: job.id,
          stageExecutionId,
          label: job.label ?? job.id,
          elapsed: elapsed(start),
        })

        return { job, result }
      } catch (error) {
        ctx.progress({
          type: 'job-failed',
          executionId: jobExecutionId,
          id: job.id,
          stageExecutionId,
          label: job.label ?? job.id,
          elapsed: elapsed(start),
          error: toErrorMessage(error),
        })
        throw error
      }
    }),
  )

  const failures = settled.flatMap((outcome) =>
    outcome.status === 'rejected' ? [outcome.reason] : [],
  )
  if (failures.length > 0) {
    const detail = failures
      .map((reason, index) => `[${index + 1}] ${toErrorMessage(reason)}`)
      .join('\n')
    throw new AggregateError(
      failures,
      `Parallel group ${quoteForError(stageExecutionId)} failed with ${failures.length} error${failures.length === 1 ? '' : 's'}:\n${detail}`,
    )
  }

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled' && outcome.value?.result?.vars) {
      Object.assign(opts.vars, outcome.value.result.vars)
    }
  }
}

async function executeStage<TVars extends StageVariables>(
  stage: StageDefinition<TVars>,
  executionPathPrefix: string,
  parentOutputDir: string,
  parentExecutionId: string | undefined,
  opts: ExecutorOpts<TVars>,
  persistOnSuccess = true,
): Promise<void> {
  const { ctx } = opts
  const scopeCtx = makeScopeContext(ctx, opts.vars)
  const stagePathId = executionPathPrefix ? `${executionPathPrefix}/${stage.id}` : stage.id

  if (stage.when) {
    const shouldRun = await stage.when(scopeCtx)
    if (!shouldRun) {
      ctx.progress({
        type: 'stage-skipped',
        executionId: stagePathId,
        id: stage.id,
        label: stage.label ?? stage.id,
        parentExecutionId,
      })
      return
    }
  }

  let totalIterations = 1
  if (stage.repeat) {
    const repeatCheckpointId = `stages:repeat:${stagePathId}`
    const cached = await ctx.getCheckpoint<number>(repeatCheckpointId)
    if (cached !== undefined) {
      totalIterations = assertValidRepeatCount(stagePathId, cached)
    } else {
      const raw = typeof stage.repeat.count === 'function'
        ? await stage.repeat.count(scopeCtx)
        : stage.repeat.count
      totalIterations = assertValidRepeatCount(stagePathId, raw)
      await ctx.checkpoint(repeatCheckpointId, totalIterations)
    }
  }

  for (let iteration = 1; iteration <= totalIterations; iteration++) {
    const iterationVars = cloneVars(opts.vars) as TVars
    const iterationOpts: ExecutorOpts<TVars> = { ...opts, vars: iterationVars }
    const stageExecutionId = totalIterations > 1
      ? `${stagePathId}[${iteration}]`
      : stagePathId
    const stageOutputDir = resolveStageOutputDir(parentOutputDir, stage.id, iteration, totalIterations)

    ctx.progress({
      type: 'stage-started',
      executionId: stageExecutionId,
      id: stage.id,
      label: stage.label ?? stage.id,
      iteration: totalIterations > 1 ? iteration : undefined,
      totalIterations: totalIterations > 1 ? totalIterations : undefined,
      parentExecutionId,
    })

    const stageStart = Date.now()

    try {
      for (const step of stage.steps) {
        if (isParallelGroup(step)) {
          await executeParallelGroup(
            step,
            stage.id,
            stageExecutionId,
            stageOutputDir,
            stageExecutionId,
            iterationOpts,
          )
        } else if (isStage(step)) {
          await executeStage(
            step,
            stageExecutionId,
            stageOutputDir,
            stageExecutionId,
            iterationOpts,
            false,
          )
        } else if (isJob(step)) {
          const result = await executeJob(
            step,
            stage.id,
            stageExecutionId,
            stageOutputDir,
            stageExecutionId,
            iterationOpts,
          )
          if (result?.vars) {
            Object.assign(iterationOpts.vars, result.vars)
          }
        }
      }

      commitVars(opts.vars, iterationVars)
      if (persistOnSuccess) {
        await opts.persistVars(opts.vars)
      }

      ctx.progress({
        type: 'stage-completed',
        executionId: stageExecutionId,
        id: stage.id,
        label: stage.label ?? stage.id,
        elapsed: elapsed(stageStart),
        iteration: totalIterations > 1 ? iteration : undefined,
        totalIterations: totalIterations > 1 ? totalIterations : undefined,
      })
    } catch (error) {
      ctx.progress({
        type: 'stage-failed',
        executionId: stageExecutionId,
        id: stage.id,
        label: stage.label ?? stage.id,
        elapsed: elapsed(stageStart),
        error: toErrorMessage(error),
        iteration: totalIterations > 1 ? iteration : undefined,
        totalIterations: totalIterations > 1 ? totalIterations : undefined,
        parentExecutionId,
      })
      throw error
    }
  }
}

export function defineStagePipeline<TVars extends StageVariables = StageVariables>(
  definition: StagePipelineDefinition<TVars>,
): PipelineFn {
  validateDefinition(definition)

  return defineWorkflowPipeline({
    version: definition.version,
    async run(ctx: PipelineContext): Promise<PipelineResult> {
      const varsCheckpoint = 'stages:variables'
      const initialVarsCheckpoint = 'stages:initial-variables'

      const initialVars = await resolveInitialVars(definition, ctx)
      const cachedInitialVars = await ctx.getCheckpoint<StageVariables>(initialVarsCheckpoint)

      if (ctx.isResume) {
        if (cachedInitialVars === undefined) {
          throw new Error(
            `Cannot resume run ${ctx.runId}: the original run did not checkpoint its initial stage variables. Start a new run instead.`,
          )
        }

        const changedKeys = describeChangedVarKeys(cachedInitialVars, initialVars)
        if (changedKeys.length > 0) {
          throw new Error(
            `Cannot resume run ${ctx.runId}: initial stage variables changed for ${changedKeys.map(quoteForError).join(', ')}. Start a new run instead.`,
          )
        }
      } else {
        await ctx.checkpoint(initialVarsCheckpoint, cloneVars(initialVars))
      }

      let vars: TVars
      const cached = await ctx.getCheckpoint<TVars>(varsCheckpoint)
      if (cached !== undefined) {
        vars = cloneVars(cached) as TVars
      } else {
        vars = cloneVars(initialVars) as TVars
        await ctx.checkpoint(varsCheckpoint, cloneVars(vars))
      }

      async function persistVars(nextVars: TVars): Promise<void> {
        await ctx.checkpoint(varsCheckpoint, cloneVars(nextVars))
      }

      const executorOpts: ExecutorOpts<TVars> = { ctx, vars, persistVars }

      for (const stage of definition.stages) {
        await executeStage(stage, '', '', undefined, executorOpts)
      }

      const scopeCtx = makeScopeContext(ctx, vars)
      return definition.result(scopeCtx)
    },
  })
}
