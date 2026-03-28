#!/usr/bin/env node
/**
 * Shared build helper for workspace packages.
 * Usage: node scripts/build-package.mjs <tsconfig> [--chmod <dir>] [--bundle-deps]
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const tsconfigPath = args[0]
const scriptDir = dirname(fileURLToPath(import.meta.url))
const tscEntrypoint = join(scriptDir, '..', 'node_modules', 'typescript', 'bin', 'tsc')

if (!tsconfigPath) {
  console.error('Usage: node scripts/build-package.mjs <tsconfig.build.json> [--chmod <dir>] [--bundle-deps]')
  process.exit(1)
}

// Parse --chmod flag
let chmodDir = null
const chmodIdx = args.indexOf('--chmod')
if (chmodIdx !== -1 && args[chmodIdx + 1]) {
  chmodDir = args[chmodIdx + 1]
}

const shouldBundleDeps = args.includes('--bundle-deps')

// Determine output dir from tsconfig location
const packageDir = dirname(tsconfigPath)
const distDir = join(packageDir, 'dist')

// Clean
rmSync(distDir, { recursive: true, force: true })

// Cleaning dist without forcing a rebuild can leave stale tsbuildinfo behind,
// which makes `tsc -b` skip emit and produces empty publish artifacts.
const tsc = spawnSync(process.execPath, [tscEntrypoint, '-b', tsconfigPath, '--force'], { stdio: 'inherit' })
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

if (shouldBundleDeps) {
  const packageJson = JSON.parse(
    readFileSync(join(packageDir, 'package.json'), 'utf8'),
  )
  const bundleDependencies = Array.isArray(packageJson.bundleDependencies)
    ? packageJson.bundleDependencies
    : []

  const packageNodeModulesDir = join(packageDir, 'node_modules')
  const workspaceRoot = join(scriptDir, '..')

  rmSync(packageNodeModulesDir, { recursive: true, force: true })

  for (const dependency of bundleDependencies) {
    const dependencyPathParts = dependency.split('/')
    const dependencyDest = join(packageNodeModulesDir, ...dependencyPathParts)
    const dependencyParent = dirname(dependencyDest)

    let dependencySource
    if (dependency.startsWith('@runework/')) {
      dependencySource = join(
        workspaceRoot,
        'packages',
        dependency.slice('@runework/'.length),
      )
    } else {
      dependencySource = join(workspaceRoot, 'node_modules', ...dependencyPathParts)
    }

    if (!existsSync(dependencySource)) {
      console.error(`Bundled dependency not found: ${dependency} (${dependencySource})`)
      process.exit(1)
    }

    mkdirSync(dependencyParent, { recursive: true })
    symlinkSync(
      relative(dependencyParent, dependencySource),
      dependencyDest,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  }
}
