#!/usr/bin/env node
/**
 * Shared build helper for workspace packages.
 * Usage: node scripts/build-package.mjs <tsconfig> [--chmod <dir>]
 */
import { chmodSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const tsconfigPath = args[0]

if (!tsconfigPath) {
  console.error('Usage: node scripts/build-package.mjs <tsconfig.build.json> [--chmod <dir>]')
  process.exit(1)
}

// Parse --chmod flag
let chmodDir = null
const chmodIdx = args.indexOf('--chmod')
if (chmodIdx !== -1 && args[chmodIdx + 1]) {
  chmodDir = args[chmodIdx + 1]
}

// Determine output dir from tsconfig location
const packageDir = dirname(tsconfigPath)
const distDir = join(packageDir, 'dist')

// Clean
rmSync(distDir, { recursive: true, force: true })

// Cleaning dist without forcing a rebuild can leave stale tsbuildinfo behind,
// which makes `tsc -b` skip emit and produces empty publish artifacts.
const tsc = spawnSync('tsc', ['-b', tsconfigPath, '--force'], { stdio: 'inherit', shell: true })
if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1)
}

// Chmod executables if requested
if (chmodDir && existsSync(chmodDir)) {
  for (const file of readdirSync(chmodDir)) {
    if (file.endsWith('.js')) {
      chmodSync(join(chmodDir, file), 0o755)
    }
  }
}
