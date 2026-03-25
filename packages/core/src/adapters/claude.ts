import { safeJsonParse } from '../core/json.ts'
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

export const CLAUDE_CAPABILITIES: AgentAdapterCapabilities = {
  approvalMode: false,
  files: false,
  sandbox: false,
  schema: true,
  sessionName: true,
}

export function buildClaudeArgs(request: AgentRunRequest): string[] {
  assertSupportedRequestOptions('claude', request, CLAUDE_CAPABILITIES)

  const args: string[] = ['-p', '--input-format', 'text', '--output-format', 'json']

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
      timeoutMs: request.timeoutMs,
    })

    const parsed = safeJsonParse<ClaudeJsonOutput>(cli.stdout)

    return {
      provider: this.name,
      ok: cli.ok,
      exitCode: cli.exitCode,
      text: String(parsed?.result ?? cli.stdout).trim(),
      structured: parsed?.structured_output,
      sessionId: parsed?.session_id,
      stdout: cli.stdout,
      stderr: cli.stderr,
      durationMs: cli.durationMs,
      metadata: { outputFormat: 'json', promptSource: 'stdin' },
    }
  }
}
