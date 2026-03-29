#!/usr/bin/env node
import { dirname, join } from 'node:path'
import { readFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { initCommand } from '@runework/cli'

const __dirname = dirname(fileURLToPath(import.meta.url))
// In dist/cli/init.js → package root is ../../../
// In src/cli/init.ts via tsx → package root is also ../../../
const RUNEWORK_ROOT = join(__dirname, '..', '..')

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function getRuneworkPipelinesVersion(): Promise<string> {
  // Derive runework-pipelines version from the package's own metadata
  // to avoid drift between releases and scaffolded consumer contracts
  
  // Try sibling directory first (local development: runework-pipelines is a sibling at workspace root)
  const siblingPath = join(RUNEWORK_ROOT, '..', '..', '..', 'runework-pipelines', 'package.json')
  if (await fileExists(siblingPath)) {
    const pipelinesManifest = JSON.parse(
      await readFile(siblingPath, 'utf8'),
    ) as { version?: string }
    if (pipelinesManifest.version) {
      return pipelinesManifest.version
    }
  }

  // Fall back to node_modules (packaged install: runework-pipelines is a regular dependency)
  const nodeModulesPath = join(RUNEWORK_ROOT, '..', '..', 'node_modules', 'runework-pipelines', 'package.json')
  if (await fileExists(nodeModulesPath)) {
    const pipelinesManifest = JSON.parse(
      await readFile(nodeModulesPath, 'utf8'),
    ) as { version?: string }
    if (pipelinesManifest.version) {
      return pipelinesManifest.version
    }
  }

  throw new Error(
    'runework-pipelines version could not be resolved. ' +
    'Ensure runework-pipelines is available either as a sibling directory ' +
    'or as an installed dependency in node_modules.',
  )
}

async function main() {
  const manifest = JSON.parse(
    await readFile(join(RUNEWORK_ROOT, 'package.json'), 'utf8'),
  ) as { version?: string }

  const runeworkPipelinesVersion = await getRuneworkPipelinesVersion()

  const code = await initCommand(process.argv.slice(2), {
    packageRoot: RUNEWORK_ROOT,
    packageVersion: manifest.version ?? '0.1.0',
    runeworkPipelinesVersion,
    templatesRuneworkDir: join(RUNEWORK_ROOT, 'templates', 'runework'),
    currentDir: __dirname,
  })
  process.exit(code)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
