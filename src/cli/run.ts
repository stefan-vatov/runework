#!/usr/bin/env node
import { runCommand } from '@hammerkit/cli'

runCommand().then(
  (code) => process.exit(code),
  (err) => { console.error(err); process.exit(1) },
)
