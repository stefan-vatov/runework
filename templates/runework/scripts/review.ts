#!/usr/bin/env node
import { getAdapter, writeJournal } from 'runework'
import { $ } from 'zx'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const runeworkDir = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(runeworkDir)

const diff = (await $({ cwd: repoRoot, nothrow: true, quiet: true })`git diff`).stdout.trim()

if (!diff) {
  console.log('No uncommitted changes to review.')
  process.exit(0)
}

const adapter = getAdapter('claude')
const result = await adapter.run({
  prompt: `Review this diff for correctness, safety, and missing tests:\n\n${diff}`,
  cwd: repoRoot,
})

try {
  await writeJournal(
    { type: 'review', provider: adapter.name, ok: result.ok, durationMs: result.durationMs },
    join(runeworkDir, '.work', 'runs'),
  )
} catch {}

console.log(result.text)
process.exit(result.ok ? 0 : 1)
