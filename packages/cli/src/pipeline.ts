import {
  listPipelines,
  runPipeline,
  PipelineRunError,
  type PipelineProgressEvent,
} from '@runework/pipelines'
import { resolveRuneworkDir } from './helpers.ts'

function parseOptions(args: string[]): {
  pipelineOptions: Record<string, unknown>
  resumeRunId?: string
} {
  const pipelineOptions: Record<string, unknown> = {}
  let resumeRunId: string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2)
      const next = args[i + 1]
      if (key === 'resume-run') {
        if (!next || next.startsWith('--')) {
          throw new Error('--resume-run requires a run ID')
        }
        resumeRunId = next
        i++
        continue
      }
      if (next && !next.startsWith('--')) {
        pipelineOptions[key] = next
        i++
      } else {
        pipelineOptions[key] = true
      }
    }
  }
  return { pipelineOptions, resumeRunId }
}

function formatProgressEvent(event: PipelineProgressEvent): string {
  try {
    const text = JSON.stringify(event)
    if (text) return text
  } catch {
    // Fall back to a coarse string so progress is never silently dropped.
  }

  return String(event.type ?? '[progress]')
}

export async function pipelineCommand(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [pipelineName, ...rest] = argv
  const runeworkDir = resolveRuneworkDir()

  if (!pipelineName) {
    const available = await listPipelines(runeworkDir)
    console.error('Usage: runework-pipeline <pipeline-name> [--resume-run <run-id>] [--key value...]')
    if (available.length > 0) {
      console.error(`\nAvailable pipelines: ${available.join(', ')}`)
    } else {
      console.error('\nNo pipelines found in .runework/pipelines/')
    }
    return 1
  }

  const { pipelineOptions, resumeRunId } = parseOptions(rest)

  try {
    const result = await runPipeline(pipelineName, runeworkDir, {
      options: pipelineOptions,
      resumeRunId,
      log: (message) => {
        console.error(message)
      },
      onProgress: (event) => {
        console.error(formatProgressEvent(event))
      },
    })
    console.error(result.summary)
    if (result.runId) {
      console.error(`run: ${result.runId}`)
    }
    if (result.outputs) {
      for (const [label, path] of Object.entries(result.outputs)) {
        console.error(`${label}: ${path}`)
      }
    }
    return result.ok ? 0 : 1
  } catch (err) {
    const message = err instanceof PipelineRunError
      ? `${err.message} (${err.outputDir})`
      : err instanceof Error
        ? err.message
        : String(err)
    console.error(`Error: ${message}`)
    return 1
  }
}
