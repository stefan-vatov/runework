import { writeJournal, renderTemplate } from '@hammerkit/core'
import type {
  AgentAdapter,
  AgentRunRequest,
  AgentRunResult,
} from '@hammerkit/core'
import { getUnsupportedRequestOptions } from '@hammerkit/core'

export type CompareRequest = {
  adapters: AgentAdapter[]
  promptTemplate: string
  variables?: Record<string, unknown>
  common?: Omit<AgentRunRequest, 'prompt'>
}

function makeFailedResult(provider: string, error: unknown): AgentRunResult {
  const message = error instanceof Error ? error.message : String(error)
  return {
    provider,
    ok: false,
    exitCode: null,
    text: `[hammerkit] adapter error: ${message}`,
    stdout: '',
    stderr: message,
    durationMs: 0,
  }
}

/**
 * Run the same prompt across multiple providers in parallel.
 * Uses allSettled so one failing provider doesn't kill the rest.
 * Results are journaled best-effort.
 */
export async function compareProviders(
  request: CompareRequest,
): Promise<AgentRunResult[]> {
  const prompt = renderTemplate(
    request.promptTemplate,
    request.variables ?? {},
  )
  const common = request.common ?? {}
  const runRequest: AgentRunRequest = { ...common, prompt }

  const unsupported = request.adapters.flatMap((adapter) => {
    const options = getUnsupportedRequestOptions(runRequest, adapter.capabilities)

    if (options.length === 0) return []
    return [`${adapter.name}: ${options.join(', ')}`]
  })

  if (unsupported.length > 0) {
    throw new Error(
      `compareProviders common request contains provider-specific options: ${unsupported.join('; ')}`,
    )
  }

  const settled = await Promise.allSettled(
    request.adapters.map((adapter) =>
      adapter.run(runRequest),
    ),
  )

  const results = settled.map((outcome, i) =>
    outcome.status === 'fulfilled'
      ? outcome.value
      : makeFailedResult(request.adapters[i].name, outcome.reason),
  )

  try {
    await writeJournal({
      type: 'compare',
      request: {
        adapters: request.adapters.map((a) => a.name),
        common,
        prompt,
        variables: request.variables ?? {},
      },
      results,
    })
  } catch (err) {
    console.error(`[hammerkit] journal write failed: ${err instanceof Error ? err.message : err}`)
  }

  return results
}
