#!/usr/bin/env node
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runPipelineCli } from 'runework-pipelines/runner'

const runeworkDir = dirname(dirname(fileURLToPath(import.meta.url)))

runPipelineCli(process.argv.slice(2), runeworkDir).then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  },
)
