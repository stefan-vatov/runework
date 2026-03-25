import { listPipelines, runPipeline, PipelineRunError, createPipelineTui } from '@runework/pipelines'
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
  const tui = createPipelineTui(pipelineName)

  try {
    const result = await runPipeline(pipelineName, runeworkDir, {
      options: pipelineOptions,
      resumeRunId,
      log: (msg) => tui.log(msg),
      onProgress: (event) => {
        switch (event.type) {
          case 'start-parallel':
            tui.startReview(event.names)
            break
          case 'task-done':
            tui.modelDone(event.name, event.elapsed, event.ok)
            break
          case 'task-error':
            tui.modelError(event.name, event.elapsed, event.error)
            break
          case 'start-phase':
            tui.startSynthesis()
            break
          case 'phase-done':
            tui.synthesisDone(event.elapsed)
            break
        }
      },
    })
    await tui.finish(result)
    return result.ok ? 0 : 1
  } catch (err) {
    const message = err instanceof PipelineRunError
      ? `${err.message} (${err.outputDir})`
      : err instanceof Error
        ? err.message
        : String(err)
    await tui.finish({ ok: false, summary: `Error: ${message}` })
    return 1
  }
}
