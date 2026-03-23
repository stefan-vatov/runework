#!/usr/bin/env -S node --conditions=source
import { getAdapters } from '../adapters/registry.ts'
import { compareProviders } from '../workflows/compare.ts'
import { compareResultsExitCode } from './helpers.ts'

async function main() {
  const prompt = process.argv.slice(2).join(' ').trim()

  if (!prompt) {
    console.error('Usage: npm run compare -- "<prompt>"')
    console.error('       npm run compare -- "summarize this repo in 3 bullets"')
    process.exit(1)
  }

  const cwd = process.cwd()
  const adapters = getAdapters()

  console.error(`hammerkit: comparing ${adapters.map((a) => a.name).join(', ')} in ${cwd}`)

  const results = await compareProviders({
    adapters,
    promptTemplate: prompt,
    common: { cwd },
  })

  for (const result of results) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`  ${result.provider}  |  ${result.ok ? 'ok' : 'failed'}  |  ${result.durationMs}ms`)
    console.log(`${'='.repeat(60)}`)
    console.log(result.text || '<no output>')
  }

  process.exit(compareResultsExitCode(results))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
