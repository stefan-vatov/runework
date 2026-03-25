#!/usr/bin/env node
import { compareCommand } from '@hammerkit/cli'

compareCommand().then(
  (code) => process.exit(code),
  (err) => { console.error(err); process.exit(1) },
)
