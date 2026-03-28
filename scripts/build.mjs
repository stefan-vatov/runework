#!/usr/bin/env node
/**
 * Top-level workspace build entry point.
 * Uses direct package builds so publish/prepare does not depend on Nx workers.
 */
import { spawnSync } from 'node:child_process'

const commands = [
  ['scripts/build-package.mjs', 'packages/core/tsconfig.build.json'],
  ['scripts/build-package.mjs', 'packages/reporters/tsconfig.build.json'],
  ['scripts/build-package.mjs', 'packages/pipelines/tsconfig.build.json'],
  ['scripts/build-package.mjs', 'packages/cli/tsconfig.build.json'],
  ['scripts/build-package.mjs', 'packages/runework/tsconfig.build.json', '--chmod', 'packages/runework/bin', '--bundle-deps'],
]

for (const args of commands) {
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
