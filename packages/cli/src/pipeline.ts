import {
  listPipelines,
  runPipeline,
  PipelineRunError,
  type PipelineProgressEvent,
} from '@runework/pipelines'
import { consumeFlag, resolveRuneworkDir } from './helpers.ts'

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
  const { enabled: jsonMode, rest: args } = consumeFlag(argv, '--json')
  const [pipelineName, ...rest] = args
  const runeworkDir = resolveRuneworkDir()
  const usage = {
    command: 'runework-pipeline',
    usage: 'runework-pipeline [--json] <pipeline-name> [--resume-run <run-id>] [--key value...]',
  }

  if (!pipelineName) {
    const available = await listPipelines(runeworkDir)
    if (jsonMode) {
      console.log(JSON.stringify({
        ok: false,
        error: 'pipeline name is required',
        ...usage,
        availablePipelines: available,
      }, null, 2))
      return 1
    }

    console.error(`Usage: ${usage.usage}`)
    if (available.length > 0) {
      console.error(`\nAvailable pipelines: ${available.join(', ')}`)
    } else {
      console.error('\nNo pipelines found in .runework/pipelines/')
    }
    return 1
  }

  try {
    const { pipelineOptions, resumeRunId } = parseOptions(rest)
    const result = await runPipeline(pipelineName, runeworkDir, {
      options: pipelineOptions,
      resumeRunId,
      log: (message) => {
        if (jsonMode) {
          console.error(JSON.stringify({ type: 'log', message }))
          return
        }

        console.error(message)
      },
      onProgress: (event) => {
        console.error(formatProgressEvent(event))
      },
    })
    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2))
      return result.ok ? 0 : 1
    }

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
    if (jsonMode) {
      console.log(JSON.stringify(
        err instanceof PipelineRunError
          ? {
            ok: false,
            error: message,
            pipelineName: err.pipelineName,
            runId: err.runId,
            outputDir: err.outputDir,
            ...usage,
          }
          : {
            ok: false,
            error: message,
            pipelineName,
            ...usage,
          },
        null,
        2,
      ))
      return 1
    }

    console.error(`Error: ${message}`)
    return 1
  }
}
