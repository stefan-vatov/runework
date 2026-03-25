#!/usr/bin/env node
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { initCommand } from '@hammerkit/cli'

const __dirname = dirname(fileURLToPath(import.meta.url))
// In dist/cli/init.js → package root is ../../
// In src/cli/init.ts via tsx → package root is also ../../
const HAMMERKIT_ROOT = join(__dirname, '..', '..')

async function main() {
  const manifest = JSON.parse(
    await readFile(join(HAMMERKIT_ROOT, 'package.json'), 'utf8'),
  ) as { version?: string }

  const code = await initCommand(process.argv.slice(2), {
    packageRoot: HAMMERKIT_ROOT,
    packageVersion: manifest.version ?? '0.1.0',
    templatesHammerkitDir: join(HAMMERKIT_ROOT, 'templates', 'hammerkit'),
    templatesRepoLocalDir: join(HAMMERKIT_ROOT, 'templates', 'repo-local'),
    currentDir: __dirname,
  })
  process.exit(code)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
