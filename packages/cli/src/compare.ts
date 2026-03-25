import { getAdapters } from '@runework/core'
import { compareProviders } from '@runework/workflows'
import { compareResultsExitCode } from './helpers.ts'

export async function compareCommand(argv: string[] = process.argv.slice(2)): Promise<number> {
  const prompt = argv.join(' ').trim()

  if (!prompt) {
    console.error('Usage: npm run compare -- "<prompt>"')
    console.error('       npm run compare -- "summarize this repo in 3 bullets"')
    return 1
  }

  const cwd = process.cwd()
  const adapters = getAdapters()

  console.error(`runework: comparing ${adapters.map((a) => a.name).join(', ')} in ${cwd}`)

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

  return compareResultsExitCode(results)
}
