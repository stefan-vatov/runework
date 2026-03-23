import { randomUUID } from 'node:crypto'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseJsonLines, safeJsonParse } from '../core/json.ts'
import { runCli } from '../core/run-cli.ts'
import type {
  AgentAdapter,
  AgentAdapterCapabilities,
  AgentRunRequest,
  AgentRunResult,
} from './types.ts'
import { assertSupportedRequestOptions } from './types.ts'

function extractSessionId(events: unknown[]): string | undefined {
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const rec = event as Record<string, unknown>
    for (const candidate of [
      rec.session_id,
      rec.sessionId,
      rec.id,
      (rec.session as Record<string, unknown> | undefined)?.id,
      (rec.data as Record<string, unknown> | undefined)?.session_id,
      (rec.data as Record<string, unknown> | undefined)?.sessionId,
    ]) {
      if (typeof candidate === 'string' && candidate.length > 0) return candidate
    }
  }
  return undefined
}

export const CODEX_CAPABILITIES: AgentAdapterCapabilities = {
  approvalMode: false,
  files: false,
  sandbox: true,
  schema: true,
  sessionName: false,
}

type CodexArgFiles = {
  outputFile: string
  schemaFile?: string
}

export function buildCodexArgs(
  request: AgentRunRequest,
  files: CodexArgFiles,
): string[] {
  assertSupportedRequestOptions('codex', request, CODEX_CAPABILITIES)

  const args: string[] = []

  if (request.cwd) args.push('-C', request.cwd)
  if (request.sandbox) args.push('-s', request.sandbox)

  args.push('exec')

  if (files.schemaFile) {
    args.push('--output-schema', files.schemaFile)
  }

  if (request.resume?.sessionId || request.resume?.last) {
    args.push('resume')

    if (request.resume.sessionId) {
      args.push(request.resume.sessionId)
    } else {
      args.push('--last')
    }
  }

  if (request.model) args.push('-m', request.model)
  args.push('--json', '--output-last-message', files.outputFile)

  if (request.extraArgs?.length) args.push(...request.extraArgs)

  args.push('-')

  return args
}

/**
 * Adapter for OpenAI Codex CLI.
 *
 * Supports: --json events, --output-last-message, --output-schema,
 * sandbox, stdin prompt via `-`, resume.
 */
export class CodexAdapter implements AgentAdapter {
  readonly name = 'codex'
  readonly capabilities = CODEX_CAPABILITIES

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const outputFile = join(
      tmpdir(),
      `codex-last-message-${randomUUID().slice(0, 8)}.txt`,
    )
    const schemaFile = request.schema
      ? join(tmpdir(), `codex-schema-${randomUUID().slice(0, 8)}.json`)
      : undefined

    if (schemaFile && request.schema) {
      await writeFile(schemaFile, JSON.stringify(request.schema, null, 2), 'utf8')
    }
    const args = buildCodexArgs(request, { outputFile, schemaFile })

    const cli = await runCli({
      bin: 'codex',
      args,
      cwd: request.cwd,
      env: request.env,
      stdin: request.prompt,
      timeoutMs: request.timeoutMs,
    })

    try {
      const rawEvents = parseJsonLines(cli.stdout)
      const lastMessage = await readFile(outputFile, 'utf8').catch(() => '')
      const text = (lastMessage || cli.stdout).trim()
      const structured = request.schema ? safeJsonParse(text) : undefined

      return {
        provider: this.name,
        ok: cli.ok,
        exitCode: cli.exitCode,
        text,
        structured,
        sessionId: extractSessionId(rawEvents),
        stdout: cli.stdout,
        stderr: cli.stderr,
        rawEvents,
        durationMs: cli.durationMs,
        metadata: { promptSource: 'stdin' },
      }
    } finally {
      // Clean up temp files
      await unlink(outputFile).catch(() => {})
      if (schemaFile) await unlink(schemaFile).catch(() => {})
    }
  }
}
