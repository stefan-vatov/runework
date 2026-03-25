import { readdir, mkdir, readFile, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getAdapters } from '@hammerkit/core'
import { ensureGitignoreEntries } from './gitignore.ts'
import {
  PipelineRunError,
  createPipelineWorkflowRuntime,
  getWorkflowPipelineMeta,
  makePipelineRunId,
} from './runtime.ts'
import type {
  PipelineContext,
  PipelineResult,
  PipelineFn,
  PipelineProgressEvent,
  PipelineSpawnResult,
} from './types.ts'

function isRunPipelineOptions(
  runOptions: RunPipelineOptions | Record<string, unknown>,
): runOptions is RunPipelineOptions {
  if (!runOptions || Array.isArray(runOptions)) return false
  return (
    'options' in runOptions ||
    'runId' in runOptions ||
    'resumeRunId' in runOptions ||
    'parentRunId' in runOptions ||
    typeof runOptions.log === 'function' ||
    typeof runOptions.onProgress === 'function'
  )
}

/**
 * List available pipeline names from .hammerkit/pipelines/.
 * Discovers both single-file pipelines (name.ts) and
 * directory pipelines (name/index.ts).
 */
export async function listPipelines(hammerkitDir: string): Promise<string[]> {
  const pipelinesDir = join(hammerkitDir, 'pipelines')
  try {
    const entries = await readdir(pipelinesDir)
    const pipelines: string[] = []

    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const entryPath = join(pipelinesDir, entry)
      const info = await stat(entryPath)

      if (info.isFile() && entry.endsWith('.ts')) {
        pipelines.push(entry.replace(/\.ts$/, ''))
      } else if (info.isDirectory()) {
        // Check for index.ts inside the directory
        try {
          const indexStat = await stat(join(entryPath, 'index.ts'))
          if (indexStat.isFile()) pipelines.push(entry)
        } catch {}
      }
    }

    return pipelines
  } catch {
    return []
  }
}

/**
 * Run a pipeline by name.
 *
 * 1. Dynamic imports .hammerkit/pipelines/<pipelineName>.ts
 * 2. Creates output dir: .hammerkit/.work/<pipelineName>/<timestamp>/
 * 3. Builds PipelineContext with writeOutput, readOutput, addGitignoreEntries
 * 4. Calls the pipeline function
 */
export type RunPipelineOptions = {
  options?: Record<string, unknown>
  log?: (message: string) => void
  onProgress?: (event: PipelineProgressEvent) => void
  runId?: string
  resumeRunId?: string
  parentRunId?: string
}

export async function runPipeline(
  pipelineName: string,
  hammerkitDir: string,
  runOptions: RunPipelineOptions | Record<string, unknown> = {},
): Promise<PipelineResult> {
  // Support both old (plain options object) and new (RunPipelineOptions) signatures
  const options = isRunPipelineOptions(runOptions)
    ? runOptions.options ?? {}
    : runOptions as Record<string, unknown>
  const logFn = isRunPipelineOptions(runOptions) ? runOptions.log : undefined
  const progressFn = isRunPipelineOptions(runOptions) ? runOptions.onProgress : undefined
  const explicitRunId = isRunPipelineOptions(runOptions) ? runOptions.runId : undefined
  const resumeRunId = isRunPipelineOptions(runOptions) ? runOptions.resumeRunId : undefined
  const parentRunId = isRunPipelineOptions(runOptions) ? runOptions.parentRunId : undefined
  const absHammerkitDir = resolve(hammerkitDir)
  const repoRoot = dirname(absHammerkitDir)

  // Resolve pipeline path: name.ts or name/index.ts
  let pipelinePath = join(absHammerkitDir, 'pipelines', `${pipelineName}.ts`)
  try {
    const info = await stat(pipelinePath)
    if (!info.isFile()) throw new Error()
  } catch {
    pipelinePath = join(absHammerkitDir, 'pipelines', pipelineName, 'index.ts')
  }

  const pipelineUrl = pathToFileURL(pipelinePath).href
  const mod = await import(pipelineUrl) as { default: PipelineFn }
  const pipelineFn = mod.default

  if (typeof pipelineFn !== 'function') {
    throw new Error(`Pipeline "${pipelineName}" does not export a default function`)
  }

  const runId = resumeRunId ?? explicitRunId ?? makePipelineRunId()
  const outputDir = join(absHammerkitDir, '.work', pipelineName, runId)

  // Create output directory for this run under .hammerkit/.work/
  if (!resumeRunId && !explicitRunId) {
    const outputRoot = join(absHammerkitDir, '.work', pipelineName)
    await mkdir(outputRoot, { recursive: true })
  }
  if (!resumeRunId) {
    await mkdir(outputDir, { recursive: true })
  }

  // Build adapter map
  const adapterMap: Record<string, ReturnType<typeof getAdapters>[number]> = {}
  for (const adapter of getAdapters()) {
    adapterMap[adapter.name] = adapter
  }

  const runtime = await createPipelineWorkflowRuntime({
    pipelineName,
    runId,
    outputDir,
    isResume: Boolean(resumeRunId),
    version: getWorkflowPipelineMeta(pipelineFn).version,
    parentRunId,
    async spawnPipeline(request) {
      return runPipeline(request.pipelineName, absHammerkitDir, {
        options: request.options ?? {},
        runId: request.runId,
        resumeRunId: request.resumeRunId,
        parentRunId: runId,
      }) as Promise<PipelineSpawnResult>
    },
  })

  if (runtime.storedResult) {
    return runtime.storedResult
  }

  // Build context
  const ctx: PipelineContext = {
    hammerkitDir: absHammerkitDir,
    repoRoot,
    runId,
    outputDir,
    isResume: Boolean(resumeRunId),
    adapters: adapterMap,
    options,

    writeOutput: runtime.methods.writeOutput,

    async readOutput(filename: string): Promise<string> {
      const filePath = join(outputDir, filename)
      return readFile(filePath, 'utf8')
    },

    step: runtime.methods.step,
    checkpoint: runtime.methods.checkpoint,
    getCheckpoint: runtime.methods.getCheckpoint,
    spawn: runtime.methods.spawn,
    repeatUntil: runtime.methods.repeatUntil,

    async addGitignoreEntries(entries: string[]): Promise<void> {
      await ensureGitignoreEntries(repoRoot, entries)
    },

    log(message: string): void {
      if (logFn) logFn(message)
      else console.error(`  ${message}`)
    },

    progress(event: PipelineProgressEvent): void {
      if (progressFn) progressFn(event)
    },
  }

  try {
    const result = await pipelineFn(ctx)
    return runtime.complete(result)
  } catch (error) {
    await runtime.fail(error)
    throw new PipelineRunError(
      pipelineName,
      runId,
      outputDir,
      `Pipeline "${pipelineName}" failed for run ${runId}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}
