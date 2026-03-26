#!/usr/bin/env node
/**
 * Top-level workspace build entry point.
 * Delegates to Nx for dependency-aware build ordering.
 */
import { spawnSync } from 'node:child_process'

const result = spawnSync('npx', ['nx', 'run-many', '-t', 'build', '--all'], {
  env: {
    ...process.env,
    NX_DAEMON: 'false',
  },
  stdio: 'inherit',
  shell: true,
})

process.exit(result.status ?? 1)
