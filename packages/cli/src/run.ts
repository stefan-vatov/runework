import { getAdapter, writeJournal } from '@runework/core'
import { runResultExitCode } from './helpers.ts'

export async function runCommand(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [provider, ...rest] = argv

  if (!provider || rest.length === 0) {
    console.error('Usage: npm run run -- <provider> "<prompt>"')
    console.error('       npm run run -- claude "explain this repo"')
    console.error('       npm run run -- codex "add error handling to src/index.ts"')
    return 1
  }

  const adapter = getAdapter(provider)
  const prompt = rest.join(' ')
  const cwd = process.cwd()

  console.error(`runework: running ${provider} in ${cwd}`)

  const result = await adapter.run({ prompt, cwd })

  let journalPath: string | undefined
  try {
    journalPath = await writeJournal({
      type: 'run',
      request: {
        cwd,
        prompt,
        provider,
      },
      result,
    })
  } catch (err) {
    console.error(`[runework] journal write failed: ${err instanceof Error ? err.message : err}`)
  }

  const suffix = journalPath ? ` → ${journalPath}` : ''
  console.error(`runework: ${result.ok ? 'ok' : 'failed'} (${result.durationMs}ms)${suffix}`)
  console.log(result.text)
  return runResultExitCode(result)
}
