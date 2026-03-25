#!/usr/bin/env node
import { getAdapter, renderTemplate } from 'runework'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/explain.ts <file-path>')
  process.exit(1)
}

const runeworkDir = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(runeworkDir)

const promptTemplate = await readFile(
  join(runeworkDir, 'prompts', 'explain-file.md'),
  'utf8',
)
const prompt = renderTemplate(promptTemplate, { path: file })

const adapter = getAdapter('claude')
const result = await adapter.run({ prompt, cwd: repoRoot })

console.log(result.text)
