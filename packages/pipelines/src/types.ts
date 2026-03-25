import type { AgentAdapter } from '@runework/core'

export type PipelineProgressEvent =
  | { type: 'start-parallel'; names: string[] }
  | { type: 'task-done'; name: string; elapsed: string; ok: boolean }
  | { type: 'task-error'; name: string; elapsed: string; error: string }
  | { type: 'start-phase'; label: string }
  | { type: 'phase-done'; label: string; elapsed: string }

export type WorkflowEvent =
  | { type: 'run-started'; pipelineName: string; runId: string; resumed: boolean; at: string; parentRunId?: string; version?: number }
  | { type: 'run-completed'; pipelineName: string; runId: string; ok: boolean; summary: string; at: string }
  | { type: 'run-failed'; pipelineName: string; runId: string; error: string; at: string }
  | { type: 'step-started'; pipelineName: string; runId: string; stepId: string; at: string }
  | { type: 'step-completed'; pipelineName: string; runId: string; stepId: string; at: string }
  | { type: 'step-cached'; pipelineName: string; runId: string; stepId: string; at: string }
  | { type: 'step-failed'; pipelineName: string; runId: string; stepId: string; error: string; at: string }
  | { type: 'checkpoint-saved'; pipelineName: string; runId: string; checkpointId: string; at: string }
  | { type: 'child-started'; pipelineName: string; runId: string; childId: string; childPipelineName: string; childRunId: string; at: string }
  | { type: 'child-completed'; pipelineName: string; runId: string; childId: string; childPipelineName: string; childRunId: string; ok: boolean; at: string }
  | { type: 'child-cached'; pipelineName: string; runId: string; childId: string; childPipelineName: string; childRunId: string; at: string }
  | { type: 'child-failed'; pipelineName: string; runId: string; childId: string; childPipelineName: string; childRunId: string; error: string; at: string }
  | { type: 'loop-iteration-started'; pipelineName: string; runId: string; loopId: string; iteration: number; at: string }
  | { type: 'loop-iteration-completed'; pipelineName: string; runId: string; loopId: string; iteration: number; at: string }

export type PipelineSpawnRequest = {
  id: string
  pipelineName: string
  options?: Record<string, unknown>
  /** Internal resume support for durable child pipelines. */
  runId?: string
  /** Internal resume support for durable child pipelines. */
  resumeRunId?: string
}

export type RepeatUntilOptions<State> = {
  id: string
  initialState: State
  step: (state: State, iteration: number) => Promise<State>
  until: (state: State, iteration: number) => boolean
  maxIterations?: number
}

export type PipelineContext = {
  /** Resolved absolute path to the .runework/ directory */
  runeworkDir: string
  /** Resolved absolute path to the repo root (parent of .runework/) */
  repoRoot: string
  /** Stable ID for this pipeline run. */
  runId: string
  /** Absolute path to this pipeline run's working directory. */
  outputDir: string
  /** Whether this pipeline run resumed from previously saved state. */
  isResume: boolean
  /** Available adapters keyed by name */
  adapters: Record<string, AgentAdapter>
  /** Write a file into this pipeline run's output directory. Returns the absolute path. */
  writeOutput(filename: string, content: string): Promise<string>
  /** Read a file from this pipeline run's output directory. */
  readOutput(filename: string): Promise<string>
  /** Run a durable step once per run ID + step ID. */
  step<T>(id: string, run: () => Promise<T>): Promise<T>
  /** Persist arbitrary state for later iterations or resumed runs. */
  checkpoint<T>(id: string, value: T): Promise<T>
  /** Read a previously persisted checkpoint value. */
  getCheckpoint<T>(id: string): Promise<T | undefined>
  /** Run a child pipeline once and reuse its result on resume. */
  spawn(request: PipelineSpawnRequest): Promise<PipelineSpawnResult>
  /** Re-run step logic until the provided condition is satisfied. */
  repeatUntil<State>(options: RepeatUntilOptions<State>): Promise<State>
  /** Add entries to the repo's .gitignore (idempotent). */
  addGitignoreEntries(entries: string[]): Promise<void>
  /** Report plain text progress. */
  log(message: string): void
  /** Emit structured progress events — the TUI uses these for rich display. */
  progress(event: PipelineProgressEvent): void
  /** Arbitrary options passed by the caller */
  options: Record<string, unknown>
}

export type PipelineResult = {
  ok: boolean
  /** Stable ID for this pipeline run */
  runId?: string
  /** Absolute path to this pipeline run's working directory */
  outputDir?: string
  /** Absolute path to the primary output file */
  outputPath?: string
  /** All output files written by this pipeline run */
  outputs?: Record<string, string>
  /** Short summary for CLI display */
  summary: string
}

export type PipelineSpawnResult = PipelineResult & {
  runId: string
  outputDir: string
}

export type PipelineFn = (ctx: PipelineContext) => Promise<PipelineResult>
