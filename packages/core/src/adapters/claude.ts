import { parseJsonLines, safeJsonParse, toText } from '../core/json.ts'
import { runCli } from '../core/run-cli.ts'
import type {
  AgentAdapter,
  AgentAdapterCapabilities,
  AgentRunRequest,
  AgentRunResult,
} from './types.ts'
import { assertSupportedRequestOptions } from './types.ts'

type ClaudeJsonOutput = {
  result?: unknown
  session_id?: string
  structured_output?: unknown
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function extractClaudePartialText(events: unknown[] | undefined): string {
  if (!events?.length) return ''

  const deltas: string[] = []
  let latestSnapshot = ''

  for (const event of events) {
    if (!isRecord(event)) continue

    const delta = isRecord(event.delta) ? event.delta : undefined
    const part = isRecord(event.part) ? event.part : undefined
    const message = isRecord(event.message) ? event.message : undefined
    const item = isRecord(event.item) ? event.item : undefined

    const deltaTexts = [
      normalizeText(event.delta),
      normalizeText(delta?.text),
      normalizeText(delta?.partial_json),
    ].flatMap((text) => text ? [text] : [])
    if (deltaTexts.length > 0) {
      deltas.push(...deltaTexts)
    }

    const snapshotTexts = [
      normalizeText(part?.text),
      normalizeText(event.text),
      normalizeText(message?.text),
      item?.type === 'agent_message' ? normalizeText(item.text) : undefined,
    ].flatMap((text) => text ? [text] : [])
    if (snapshotTexts.length > 0) {
      latestSnapshot = snapshotTexts[snapshotTexts.length - 1]
    }
  }

  return deltas.join('').trim() || latestSnapshot.trim()
}

function parseClaudeOutput(
  stdout: string,
): { parsed?: ClaudeJsonOutput; rawEvents?: unknown[] } {
  const parsed = safeJsonParse<ClaudeJsonOutput>(stdout)
  if (parsed) return { parsed }

  const rawEvents = parseJsonLines(stdout)

  for (let index = rawEvents.length - 1; index >= 0; index -= 1) {
    const event = rawEvents[index]
    if (!event || typeof event !== 'object') continue

    const record = event as Record<string, unknown>
    if (
      !Object.prototype.hasOwnProperty.call(record, 'result')
      && !Object.prototype.hasOwnProperty.call(record, 'structured_output')
      && typeof record.session_id !== 'string'
    ) {
      continue
    }

    return {
      parsed: {
        result: record.result,
        session_id: typeof record.session_id === 'string' ? record.session_id : undefined,
        structured_output: record.structured_output,
      },
      rawEvents,
    }
  }

  return rawEvents.length > 0 ? { rawEvents } : {}
}

export const CLAUDE_CAPABILITIES: AgentAdapterCapabilities = {
  approvalMode: false,
  files: false,
  sandbox: false,
  schema: true,
  sessionName: true,
}

export function buildClaudeArgs(request: AgentRunRequest): string[] {
  assertSupportedRequestOptions('claude', request, CLAUDE_CAPABILITIES)

  const streamOutput = Boolean(request.onOutputChunk)
  const args: string[] = [
    '-p',
    '--input-format',
    'text',
    '--output-format',
    streamOutput ? 'stream-json' : 'json',
  ]

  if (streamOutput) args.push('--include-partial-messages')

  if (request.model) args.push('--model', request.model)

  if (request.resume?.sessionId) {
    args.push('--resume', request.resume.sessionId)
  } else if (request.resume?.last) {
    args.push('--continue')
  }

  if (request.sessionName) args.push('-n', request.sessionName)
  if (request.schema) args.push('--json-schema', JSON.stringify(request.schema))
  if (request.extraArgs?.length) args.push(...request.extraArgs)

  return args
}

/**
 * Adapter for Claude Code CLI.
 *
 * Supports: -p (non-interactive), stdin prompts via --input-format text,
 * --output-format json, --json-schema, --resume/--continue, --model,
 * session naming.
 */
export class ClaudeAdapter implements AgentAdapter {
  readonly name = 'claude'
  readonly capabilities = CLAUDE_CAPABILITIES

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const args = buildClaudeArgs(request)

    const cli = await runCli({
      bin: 'claude',
      args,
      cwd: request.cwd,
      env: request.env,
      stdin: request.prompt,
      onOutputChunk: request.onOutputChunk
        ? (chunk) => request.onOutputChunk?.({ provider: this.name, ...chunk })
        : undefined,
      timeoutMs: request.timeoutMs,
    })

    const { parsed, rawEvents } = parseClaudeOutput(cli.stdout)
    const partialText = extractClaudePartialText(rawEvents)

    return {
      provider: this.name,
      ok: cli.ok,
      exitCode: cli.exitCode,
      text: (toText(parsed?.result).trim() || partialText || cli.stdout.trim()),
      structured: parsed?.structured_output,
      sessionId: parsed?.session_id,
      stdout: cli.stdout,
      stderr: cli.stderr,
      rawEvents,
      durationMs: cli.durationMs,
      metadata: {
        outputFormat: request.onOutputChunk ? 'stream-json' : 'json',
        promptSource: 'stdin',
      },
    }
  }
}
