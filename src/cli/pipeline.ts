#!/usr/bin/env node
import { pipelineCommand } from '@hammerkit/cli'

pipelineCommand().then(
  (code) => process.exit(code),
  (err) => { console.error(err); process.exit(1) },
)
