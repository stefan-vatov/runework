#!/usr/bin/env node
import { detectCommand } from '@runework/cli'

detectCommand().then(
  (code) => process.exit(code),
  (err) => { console.error(err); process.exit(1) },
)
