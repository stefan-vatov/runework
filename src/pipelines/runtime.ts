import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import type {
  PipelineContext,
  PipelineFn,
  PipelineResult,
  PipelineSpawnRequest,
  PipelineSpawnResult,
  RepeatUntilOptions,
  WorkflowEvent,
} from './types.ts'

const WORKFLOW_META = Symbol.for('hammerkit.workflow.meta')

type StoredValue =
  | { type: 'value'; value: unknown }
  | { type: 'undefined' }

type PersistedChildRun = {
  pipelineName: string
  runId: string
  status: 'running' | 'completed' | 'failed'
  result?: PipelineSpawnResult
}

type PersistedPipelineRunState = {
  pipelineName: string
  runId: string
  version?: number
  parentRunId?: string
  status: 'running' | 'completed' | 'failed'
  startedAt: string
  updatedAt: string
  completedAt?: string
  error?: string
  stepResults: Record<string, StoredValue>
  checkpoints: Record<string, StoredValue>
  childRuns: Record<string, PersistedChildRun>
  outputs: Record<string, string>
  result?: PipelineSpawnResult
}

type WorkflowMeta = {
  version?: number
}

type CreatePipelineWorkflowRuntimeOptions = {
  pipelineName: string
  runId: string
  outputDir: string
  isResume: boolean
  version?: number
  parentRunId?: string
  spawnPipeline: (request: PipelineSpawnRequest) => Promise<PipelineSpawnResult>
}

type WorkflowContextMethods = Pick<
  PipelineContext,
  'step' | 'checkpoint' | 'getCheckpoint' | 'spawn' | 'repeatUntil' | 'writeOutput'
>

export type PipelineWorkflowRuntime = {
  readonly runId: string
  readonly outputDir: string
  readonly isResume: boolean
  readonly storedResult?: PipelineSpawnResult
  readonly methods: WorkflowContextMethods
  complete(result: PipelineResult): Promise<PipelineSpawnResult>
  fail(error: unknown): Promise<void>
}

export class PipelineRunError extends Error {
  readonly pipelineName: string
  readonly runId: string
  readonly outputDir: string

  constructor(
    pipelineName: string,
    runId: string,
    outputDir: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'PipelineRunError'
    this.pipelineName = pipelineName
    this.runId = runId
    this.outputDir = outputDir
  }
}

export function defineWorkflowPipeline(
  definition: { version?: number; run: PipelineFn } | PipelineFn,
): PipelineFn {
  if (typeof definition === 'function') return definition

  const pipeline = definition.run
  Object.defineProperty(pipeline, WORKFLOW_META, {
    value: { version: definition.version },
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return pipeline
}

export function getWorkflowPipelineMeta(pipeline: PipelineFn): WorkflowMeta {
  const meta = (pipeline as PipelineFn & { [WORKFLOW_META]?: WorkflowMeta })[WORKFLOW_META]
  return meta ?? {}
}

export function makePipelineRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
}

export async function createPipelineWorkflowRuntime(
  opts: CreatePipelineWorkflowRuntimeOptions,
): Promise<PipelineWorkflowRuntime> {
  const statePath = join(opts.outputDir, 'workflow-state.json')
  const eventsPath = join(opts.outputDir, 'workflow-events.jsonl')

  let state = opts.isResume
    ? await loadState(statePath, opts.pipelineName, opts.runId)
    : createInitialState(opts)

  if (opts.isResume) {
    if (opts.version !== undefined && state.version !== undefined && state.version !== opts.version) {
      throw new Error(
        `Pipeline "${opts.pipelineName}" run ${opts.runId} was created with workflow version ${state.version}, but the current pipeline exports version ${opts.version}.`,
      )
    }

    state = {
      ...state,
      status: state.status === 'completed' ? state.status : 'running',
      updatedAt: new Date().toISOString(),
      error: state.status === 'completed' ? state.error : undefined,
      version: opts.version ?? state.version,
    }
  }

  if (!opts.isResume) {
    await saveState(statePath, state)
  }

  await appendEvent(eventsPath, {
    type: 'run-started',
    pipelineName: opts.pipelineName,
    runId: opts.runId,
    resumed: opts.isResume,
    parentRunId: opts.parentRunId,
    version: opts.version,
    at: new Date().toISOString(),
  })

  async function persist(): Promise<void> {
    state = { ...state, updatedAt: new Date().toISOString() }
    await saveState(statePath, state)
  }

  async function writeOutput(filename: string, content: string): Promise<string> {
    const filePath = join(opts.outputDir, filename)
    await writeFile(filePath, content, 'utf8')
    state.outputs[filename] = filePath
    await persist()
    return filePath
  }

  async function step<T>(id: string, run: () => Promise<T>): Promise<T> {
    if (!id.trim()) throw new Error('step() requires a non-empty step ID')

    if (Object.prototype.hasOwnProperty.call(state.stepResults, id)) {
      await appendEvent(eventsPath, {
        type: 'step-cached',
        pipelineName: opts.pipelineName,
        runId: opts.runId,
        stepId: id,
        at: new Date().toISOString(),
      })
      return decodeStoredValue<T>(state.stepResults[id])
    }

    await appendEvent(eventsPath, {
      type: 'step-started',
      pipelineName: opts.pipelineName,
      runId: opts.runId,
      stepId: id,
      at: new Date().toISOString(),
    })

    try {
      const value = await run()
      state.stepResults[id] = encodeStoredValue(value)
      await persist()
      await appendEvent(eventsPath, {
        type: 'step-completed',
        pipelineName: opts.pipelineName,
        runId: opts.runId,
        stepId: id,
        at: new Date().toISOString(),
      })
      return value
    } catch (error) {
      await appendEvent(eventsPath, {
        type: 'step-failed',
        pipelineName: opts.pipelineName,
        runId: opts.runId,
        stepId: id,
        error: toErrorMessage(error),
        at: new Date().toISOString(),
      })
      throw error
    }
  }

  async function checkpoint<T>(id: string, value: T): Promise<T> {
    if (!id.trim()) throw new Error('checkpoint() requires a non-empty checkpoint ID')

    state.checkpoints[id] = encodeStoredValue(value)
    await persist()
    await appendEvent(eventsPath, {
      type: 'checkpoint-saved',
      pipelineName: opts.pipelineName,
      runId: opts.runId,
      checkpointId: id,
      at: new Date().toISOString(),
    })
    return value
  }

  async function getCheckpoint<T>(id: string): Promise<T | undefined> {
    const stored = state.checkpoints[id]
    if (!stored) return undefined
    return decodeStoredValue<T>(stored)
  }

  async function spawn(request: PipelineSpawnRequest): Promise<PipelineSpawnResult> {
    if (!request.id.trim()) throw new Error('spawn() requires a non-empty child ID')

    const cached = state.childRuns[request.id]
    if (cached && cached.pipelineName !== request.pipelineName) {
      throw new Error(
        `spawn() child ID "${request.id}" was previously used for pipeline "${cached.pipelineName}", not "${request.pipelineName}"`,
      )
    }

    if (cached?.status === 'completed' && cached.result) {
      await appendEvent(eventsPath, {
        type: 'child-cached',
        pipelineName: opts.pipelineName,
        runId: opts.runId,
        childId: request.id,
        childPipelineName: request.pipelineName,
        childRunId: cached.result.runId,
        at: new Date().toISOString(),
      })
      return cached.result
    }

    const childRunId = cached?.runId ?? makePipelineRunId()
    state.childRuns[request.id] = {
      pipelineName: request.pipelineName,
      runId: childRunId,
      status: 'running',
      result: cached?.result,
    }
    await persist()

    await appendEvent(eventsPath, {
      type: 'child-started',
      pipelineName: opts.pipelineName,
      runId: opts.runId,
      childId: request.id,
      childPipelineName: request.pipelineName,
      childRunId,
      at: new Date().toISOString(),
    })

    try {
      const result = await opts.spawnPipeline({
        ...request,
        runId: childRunId,
        resumeRunId: cached ? childRunId : undefined,
      })
      state.childRuns[request.id] = {
        pipelineName: request.pipelineName,
        runId: result.runId,
        status: 'completed',
        result,
      }
      await persist()
      await appendEvent(eventsPath, {
        type: 'child-completed',
        pipelineName: opts.pipelineName,
        runId: opts.runId,
        childId: request.id,
        childPipelineName: request.pipelineName,
        childRunId: result.runId,
        ok: result.ok,
        at: new Date().toISOString(),
      })
      return result
    } catch (error) {
      state.childRuns[request.id] = {
        pipelineName: request.pipelineName,
        runId: childRunId,
        status: 'failed',
      }
      await persist()
      await appendEvent(eventsPath, {
        type: 'child-failed',
        pipelineName: opts.pipelineName,
        runId: opts.runId,
        childId: request.id,
        childPipelineName: request.pipelineName,
        childRunId,
        error: toErrorMessage(error),
        at: new Date().toISOString(),
      })
      throw error
    }
  }

  async function repeatUntil<State>(options: RepeatUntilOptions<State>): Promise<State> {
    if (!options.id.trim()) throw new Error('repeatUntil() requires a non-empty loop ID')

    const stateKey = `loop:${options.id}:state`
    const iterationKey = `loop:${options.id}:iteration`
    let loopState = await getCheckpoint<State>(stateKey) ?? options.initialState
    let iteration = await getCheckpoint<number>(iterationKey) ?? 0

    while (!options.until(loopState, iteration)) {
      if (options.maxIterations !== undefined && iteration >= options.maxIterations) {
        throw new Error(
          `Loop "${options.id}" exceeded maxIterations (${options.maxIterations})`,
        )
      }

      await appendEvent(eventsPath, {
        type: 'loop-iteration-started',
        pipelineName: opts.pipelineName,
        runId: opts.runId,
        loopId: options.id,
        iteration,
        at: new Date().toISOString(),
      })

      const nextState = await options.step(loopState, iteration)
      loopState = await checkpoint(stateKey, nextState)
      iteration = await checkpoint(iterationKey, iteration + 1)

      await appendEvent(eventsPath, {
        type: 'loop-iteration-completed',
        pipelineName: opts.pipelineName,
        runId: opts.runId,
        loopId: options.id,
        iteration: iteration - 1,
        at: new Date().toISOString(),
      })
    }

    return loopState
  }

  async function complete(result: PipelineResult): Promise<PipelineSpawnResult> {
    state = {
      ...state,
      status: 'completed',
      completedAt: new Date().toISOString(),
      error: undefined,
    }
    await persist()

    const finalResult: PipelineSpawnResult = {
      ...result,
      runId: opts.runId,
      outputDir: opts.outputDir,
      outputs: { ...state.outputs, ...(result.outputs ?? {}) },
    }

    state.result = finalResult
    await persist()

    await appendEvent(eventsPath, {
      type: 'run-completed',
      pipelineName: opts.pipelineName,
      runId: opts.runId,
      ok: finalResult.ok,
      summary: finalResult.summary,
      at: new Date().toISOString(),
    })

    return finalResult
  }

  async function fail(error: unknown): Promise<void> {
    state = {
      ...state,
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: toErrorMessage(error),
    }
    await persist()

    await appendEvent(eventsPath, {
      type: 'run-failed',
      pipelineName: opts.pipelineName,
      runId: opts.runId,
      error: toErrorMessage(error),
      at: new Date().toISOString(),
    })
  }

  return {
    runId: opts.runId,
    outputDir: opts.outputDir,
    isResume: opts.isResume,
    storedResult: state.status === 'completed' ? state.result : undefined,
    methods: {
      writeOutput,
      step,
      checkpoint,
      getCheckpoint,
      spawn,
      repeatUntil,
    },
    complete,
    fail,
  }
}

function createInitialState(
  opts: Pick<CreatePipelineWorkflowRuntimeOptions, 'pipelineName' | 'runId' | 'version' | 'parentRunId'>,
): PersistedPipelineRunState {
  const now = new Date().toISOString()
  return {
    pipelineName: opts.pipelineName,
    runId: opts.runId,
    version: opts.version,
    parentRunId: opts.parentRunId,
    status: 'running',
    startedAt: now,
    updatedAt: now,
    stepResults: {},
    checkpoints: {},
    childRuns: {},
    outputs: {},
  }
}

async function loadState(
  path: string,
  pipelineName: string,
  runId: string,
): Promise<PersistedPipelineRunState> {
  const content = await readFile(path, 'utf8').catch(() => '')
  if (!content) {
    throw new Error(`Cannot resume pipeline "${pipelineName}": run state not found for ${runId}`)
  }
  return JSON.parse(content) as PersistedPipelineRunState
}

async function saveState(
  path: string,
  state: PersistedPipelineRunState,
): Promise<void> {
  await writeFile(path, JSON.stringify(state, null, 2), 'utf8')
}

async function appendEvent(
  path: string,
  event: WorkflowEvent,
): Promise<void> {
  await appendFile(path, `${JSON.stringify(event)}\n`, 'utf8')
}

function encodeStoredValue(value: unknown): StoredValue {
  return value === undefined
    ? { type: 'undefined' }
    : { type: 'value', value }
}

function decodeStoredValue<T>(value: StoredValue): T {
  return (value.type === 'undefined' ? undefined : value.value) as T
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
