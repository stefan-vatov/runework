import { getAdapter, writeJournal } from '@runework/core'
import { consumeFlag, runResultExitCode } from './helpers.ts'

export async function runCommand(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { enabled: jsonMode, rest: args } = consumeFlag(argv, '--json')
  const [provider, ...rest] = args
  const usage = {
    command: 'runework-run',
    usage: 'runework-run [--json] <provider> "<prompt>"',
    note: 'For one-off prompts, call the provider CLI directly. Use runework when you need journaling or a stable adapter contract.',
    examples: [
      'runework-run claude "explain this repo"',
      'runework-run codex "add error handling to src/index.ts"',
    ],
  }

  if (!provider || rest.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify({
        ok: false,
        error: 'provider and prompt are required',
        ...usage,
      }, null, 2))
      return 1
    }

    console.error(`Usage: ${usage.usage}`)
    console.error(usage.note)
    for (const example of usage.examples) {
      console.error(`       ${example}`)
    }
    return 1
  }

  try {
    const adapter = getAdapter(provider)
    const prompt = rest.join(' ')
    const cwd = process.cwd()

    if (!jsonMode) {
      console.error(`runework: running ${provider} in ${cwd}`)
    }

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
      if (!jsonMode) {
        console.error(`[runework] journal write failed: ${err instanceof Error ? err.message : err}`)
      }
    }

    if (jsonMode) {
      console.log(JSON.stringify(
        journalPath
          ? { ...result, journalPath }
          : result,
        null,
        2,
      ))
      return runResultExitCode(result)
    }

    const suffix = journalPath ? ` → ${journalPath}` : ''
    console.error(`runework: ${result.ok ? 'ok' : 'failed'} (${result.durationMs}ms)${suffix}`)
    console.log(result.text)
    return runResultExitCode(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    if (jsonMode) {
      console.log(JSON.stringify({
        ok: false,
        provider,
        error: message,
        ...usage,
      }, null, 2))
      return 1
    }

    console.error(`Error: ${message}`)
    return 1
  }
}
