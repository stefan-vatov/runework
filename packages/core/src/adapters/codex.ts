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

function extractLastAgentMessage(events: unknown[]): string | undefined {
  let last: string | undefined
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const rec = event as Record<string, unknown>
    if (rec.type !== 'item.completed') continue
    const item = rec.item as Record<string, unknown> | undefined
    if (item?.type === 'agent_message' && typeof item.text === 'string') {
      last = item.text
    }
  }
  return last
}

export const CODEX_CAPABILITIES: AgentAdapterCapabilities = {
  approvalMode: true,
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
  if (request.schema && request.resume) {
    throw new Error(
      'codex does not support request option(s): schema when resuming exec sessions. Pass provider-specific CLI flags via extraArgs instead.',
    )
  }

  const args: string[] = []

  // Codex keeps approval policy on the top-level parser even for `exec`.
  if (request.approvalMode) args.push('-a', request.approvalMode)

  const execArgs: string[] = ['exec']

  if (request.cwd) execArgs.push('-C', request.cwd)
  if (request.sandbox) execArgs.push('-s', request.sandbox)

  if (files.schemaFile) {
    execArgs.push('--output-schema', files.schemaFile)
  }

  if (request.model) execArgs.push('-m', request.model)
  execArgs.push('--json', '--output-last-message', files.outputFile)
  if (request.extraArgs?.length) execArgs.push(...request.extraArgs)

  if (request.resume?.sessionId || request.resume?.last) {
    execArgs.push('resume')

    if (request.resume.sessionId) {
      execArgs.push(request.resume.sessionId)
    } else {
      execArgs.push('--last')
    }
  }

  execArgs.push('-')

  return args.concat(execArgs)
}

/**
 * Adapter for OpenAI Codex CLI.
 *
 * Supports: --json events, --output-last-message, --output-schema,
 * sandbox, approval mode, stdin prompt via `-`, resume.
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
      onOutputChunk: request.onOutputChunk
        ? (chunk) => request.onOutputChunk?.({ provider: this.name, ...chunk })
        : undefined,
      timeoutMs: request.timeoutMs,
    })

    try {
      const rawEvents = parseJsonLines(cli.stdout)
      const lastMessage = await readFile(outputFile, 'utf8').catch(() => '')
      const text = (lastMessage || extractLastAgentMessage(rawEvents) || cli.stdout).trim()
      const structured = request.schema ? safeJsonParse(text) : undefined

      return {
        provider: this.name,
        ok: cli.ok,
        exitCode: cli.exitCode,
        command: {
          bin: cli.bin,
          args: cli.args,
          cwd: cli.cwd,
        },
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
