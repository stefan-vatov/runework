#!/usr/bin/env node
import { detectCommand } from '@hammerkit/cli'

detectCommand().then(
  (code) => process.exit(code),
  (err) => { console.error(err); process.exit(1) },
)
