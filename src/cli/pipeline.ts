#!/usr/bin/env -S node --conditions=source
import { listPipelines, runPipeline } from '../pipelines/runner.ts'
import { PipelineRunError } from '../pipelines/runtime.ts'
import { createPipelineTui } from '../pipelines/tui.ts'
import { resolveHammerkitDir } from './helpers.ts'

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

async function main() {
  const [pipelineName, ...rest] = process.argv.slice(2)
  const hammerkitDir = resolveHammerkitDir()

  if (!pipelineName) {
    const available = await listPipelines(hammerkitDir)
    console.error('Usage: hammerkit-pipeline <pipeline-name> [--resume-run <run-id>] [--key value...]')
    if (available.length > 0) {
      console.error(`\nAvailable pipelines: ${available.join(', ')}`)
    } else {
      console.error('\nNo pipelines found in .hammerkit/pipelines/')
    }
    process.exit(1)
  }

  const { pipelineOptions, resumeRunId } = parseOptions(rest)
  const tui = createPipelineTui(pipelineName)

  try {
    const result = await runPipeline(pipelineName, hammerkitDir, {
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
    process.exit(result.ok ? 0 : 1)
  } catch (err) {
    const message = err instanceof PipelineRunError
      ? `${err.message} (${err.outputDir})`
      : err instanceof Error
        ? err.message
        : String(err)
    await tui.finish({ ok: false, summary: `Error: ${message}` })
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
