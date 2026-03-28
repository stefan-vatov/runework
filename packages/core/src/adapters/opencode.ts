import { parseJsonLines } from '../core/json.ts'
import { runCli } from '../core/run-cli.ts'
import type {
  AgentAdapter,
  AgentAdapterCapabilities,
  AgentRunRequest,
  AgentRunResult,
} from './types.ts'
import { assertSupportedRequestOptions } from './types.ts'

export const OPENCODE_CAPABILITIES: AgentAdapterCapabilities = {
  approvalMode: false,
  files: true,
  sandbox: false,
  schema: false,
  sessionName: true,
}

export function buildOpenCodeArgs(request: AgentRunRequest): string[] {
  assertSupportedRequestOptions('opencode', request, OPENCODE_CAPABILITIES)

  const args: string[] = ['run', '--format', 'json']

  if (request.resume?.sessionId) {
    args.push('--session', request.resume.sessionId)
  } else if (request.resume?.last) {
    args.push('--continue')
  }

  if (request.model) args.push('-m', request.model)
  if (request.cwd) args.push('--dir', request.cwd)
  if (request.sessionName) args.push('--title', request.sessionName)

  for (const file of request.files ?? []) {
    args.push('-f', file)
  }

  if (request.extraArgs?.length) args.push(...request.extraArgs)

  // Prompt goes via stdin to avoid ARG_MAX limits and re-quoting issues.
  // opencode reads stdin when !process.stdin.isTTY.

  return args
}

function extractTextFromEvents(events: unknown[]): string {
  const parts: string[] = []
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const rec = event as Record<string, unknown>
    if (rec.type === 'text') {
      const part = rec.part as Record<string, unknown> | undefined
      if (part?.text && typeof part.text === 'string') {
        parts.push(part.text)
      }
    }
  }
  return parts.join('')
}

/**
 * Adapter for OpenCode CLI.
 *
 * Uses `opencode run --format json` with prompt piped via stdin.
 * Model must be in provider/model format (e.g., "zai/glm-5").
 */
export class OpenCodeAdapter implements AgentAdapter {
  readonly name = 'opencode'
  readonly capabilities = OPENCODE_CAPABILITIES

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const args = buildOpenCodeArgs(request)

    const cli = await runCli({
      bin: 'opencode',
      args,
      cwd: request.cwd,
      env: request.env,
      stdin: request.prompt,
      onOutputChunk: request.onOutputChunk
        ? (chunk) => request.onOutputChunk?.({ provider: this.name, ...chunk })
        : undefined,
      timeoutMs: request.timeoutMs,
    })

    const rawEvents = parseJsonLines(cli.stdout)
    const text = extractTextFromEvents(rawEvents) || cli.stdout.trim()

    return {
      provider: this.name,
      ok: cli.ok,
      exitCode: cli.exitCode,
      text,
      stdout: cli.stdout,
      stderr: cli.stderr,
      rawEvents,
      durationMs: cli.durationMs,
      metadata: { outputFormat: 'json' },
    }
  }
}
