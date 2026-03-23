#!/usr/bin/env node
import { chmodSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

rmSync('dist', { recursive: true, force: true })

const tsc = spawnSync('tsc', { stdio: 'inherit', shell: true })
if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1)
}

const cliDir = 'dist/cli'
if (!existsSync(cliDir)) {
  process.exit(0)
}

for (const file of readdirSync(cliDir)) {
  if (file.endsWith('.js')) {
    chmodSync(join(cliDir, file), 0o755)
  }
}
