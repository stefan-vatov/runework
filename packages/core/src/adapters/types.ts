export type ApprovalMode = 'never' | 'on-failure' | 'on-request' | 'untrusted'

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export type JsonSchema = Record<string, unknown>

export type AgentOutputStreamName = 'stdout' | 'stderr'

export type AgentOutputChunk = {
  provider: string
  stream: AgentOutputStreamName
  text: string
}

export type AgentCommandInvocation = {
  bin: string
  args: string[]
  cwd: string
}

export type AgentRequestOption =
  | 'approvalMode'
  | 'files'
  | 'sandbox'
  | 'schema'
  | 'sessionName'

export type AgentAdapterCapabilities = Record<AgentRequestOption, boolean>

export type AgentRunRequest = {
  /** The prompt to send to the agent */
  prompt: string
  /** Working directory for the agent */
  cwd?: string
  /** Model name/id — provider-specific */
  model?: string
  /** Files to attach or reference */
  files?: string[]
  /** JSON Schema for structured output */
  schema?: JsonSchema
  /** Extra env vars merged into the process */
  env?: Record<string, string | undefined>
  /** Codex sandbox mode */
  sandbox?: SandboxMode
  /** Codex approval mode */
  approvalMode?: ApprovalMode
  /** Resume a previous session */
  resume?: { last?: boolean; sessionId?: string }
  /** Name/title for the session */
  sessionName?: string
  /** Provider-specific extra CLI args — the escape hatch */
  extraArgs?: string[]
  /** Realtime stdout/stderr chunks emitted by the underlying CLI process */
  onOutputChunk?: (chunk: AgentOutputChunk) => void
  /** Timeout in ms for the entire run */
  timeoutMs?: number
}

export type AgentRunResult = {
  provider: string
  ok: boolean
  exitCode: number | null
  /** Exact CLI invocation executed by the adapter */
  command: AgentCommandInvocation
  /** The main text output (final message, result, etc.) */
  text: string
  /** Parsed structured output if schema was provided */
  structured?: unknown
  /** Session ID for resume support */
  sessionId?: string
  stdout: string
  stderr: string
  /** Raw JSON events (codex --json, claude stream-json, etc.) */
  rawEvents?: unknown[]
  durationMs: number
  metadata?: Record<string, unknown>
}

const REQUEST_OPTION_LABELS: Record<AgentRequestOption, string> = {
  approvalMode: 'approvalMode',
  files: 'files',
  sandbox: 'sandbox',
  schema: 'schema',
  sessionName: 'sessionName',
}

function hasRequestedOption(
  request: AgentRunRequest,
  option: AgentRequestOption,
): boolean {
  switch (option) {
    case 'approvalMode':
      return Boolean(request.approvalMode)
    case 'files':
      return Boolean(request.files?.length)
    case 'sandbox':
      return Boolean(request.sandbox)
    case 'schema':
      return Boolean(request.schema)
    case 'sessionName':
      return Boolean(request.sessionName)
  }
}

export function getUnsupportedRequestOptions(
  request: AgentRunRequest,
  capabilities: AgentAdapterCapabilities,
): AgentRequestOption[] {
  const unsupported: AgentRequestOption[] = []

  for (const option of Object.keys(capabilities) as AgentRequestOption[]) {
    if (hasRequestedOption(request, option) && !capabilities[option]) {
      unsupported.push(option)
    }
  }

  return unsupported
}

export function assertSupportedRequestOptions(
  provider: string,
  request: AgentRunRequest,
  capabilities: AgentAdapterCapabilities,
): void {
  const unsupported = getUnsupportedRequestOptions(request, capabilities)

  if (unsupported.length === 0) return

  const detail = unsupported
    .map((option) => REQUEST_OPTION_LABELS[option])
    .join(', ')

  throw new Error(
    `${provider} does not support request option(s): ${detail}. Pass provider-specific CLI flags via extraArgs instead.`,
  )
}

export interface AgentAdapter {
  readonly name: string
  readonly capabilities: AgentAdapterCapabilities
  run(request: AgentRunRequest): Promise<AgentRunResult>
}
