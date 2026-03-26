#!/usr/bin/env node
/**
 * Prepare script: build workspace + conditionally install Husky hooks.
 * Guards Husky install so it only runs when developing in this repo,
 * not when installed as a dependency via `file:..`.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Always build
const build = spawnSync('node', ['scripts/build.mjs'], { stdio: 'inherit' })
if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

// Only install Husky when running in the repo itself (not as a dependency)
const repoRoot = resolve('.')
const isRepoInstall = existsSync(resolve(repoRoot, '.git'))
const isCI = process.env.CI === 'true' || process.env.CI === '1'
const isDryRun = process.env.npm_config_dry_run === 'true'

if (isRepoInstall && !isCI && !isDryRun) {
  const husky = spawnSync('npx', ['husky'], { stdio: 'inherit', shell: true })
  if (husky.status !== 0) {
    console.error('[runework] warning: Husky hook installation failed (exit %d)', husky.status)
  }
}
