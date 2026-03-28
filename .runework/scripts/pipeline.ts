#!/usr/bin/env node
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { listPipelines } from 'runework/pipelines'

import { runDogfoodPipelinePlain, runDogfoodPipelineWithInk } from './pipeline-ui.ts'

type ParsedArgs = {
  pipelineName?: string
  resumeRunId?: string
  pipelineOptions: Record<string, unknown>
  plain: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const [pipelineName, ...rest] = argv
  const pipelineOptions: Record<string, unknown> = {}
  let resumeRunId: string | undefined
  let plain = false

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (!arg.startsWith('--')) continue

    const key = arg.slice(2)
    const next = rest[index + 1]

    if (key === 'resume-run') {
      if (!next || next.startsWith('--')) {
        throw new Error('--resume-run requires a run ID')
      }

      resumeRunId = next
      index += 1
      continue
    }

    if (key === 'plain') {
      plain = true
      continue
    }

    if (next && !next.startsWith('--')) {
      pipelineOptions[key] = next
      index += 1
    } else {
      pipelineOptions[key] = true
    }
  }

  return { pipelineName, resumeRunId, pipelineOptions, plain }
}

async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv)
  const runeworkDir = dirname(dirname(fileURLToPath(import.meta.url)))

  if (!parsed.pipelineName) {
    const available = await listPipelines(runeworkDir)
    console.error('Usage: node scripts/pipeline.ts <pipeline-name> [--resume-run <run-id>] [--key value...]')
    if (available.length > 0) {
      console.error(`\nAvailable pipelines: ${available.join(', ')}`)
    }
    return 1
  }

  const runner = parsed.plain || !process.stdout.isTTY
    ? runDogfoodPipelinePlain
    : runDogfoodPipelineWithInk

  return runner({
    pipelineName: parsed.pipelineName,
    runeworkDir,
    pipelineOptions: parsed.pipelineOptions,
    resumeRunId: parsed.resumeRunId,
  })
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  },
)
