import type { AgentOutputChunk, AgentOutputStreamName } from '@runework/core'

export type HumanReadableAgentLineKind =
  | 'message'
  | 'command'
  | 'error'
  | 'raw'

export type HumanReadableAgentLine = {
  provider: string
  stream: AgentOutputStreamName
  kind: HumanReadableAgentLineKind
  text: string
  rawEvent?: unknown
}

export type HumanReadableAgentLineFragment = Omit<
  HumanReadableAgentLine,
  'provider' | 'stream'
>

export type CreateHumanReadableAgentReporterOptions = {
  onLine: (line: HumanReadableAgentLine) => void
}

export type HumanReadableAgentReporter = {
  onOutputChunk(chunk: AgentOutputChunk): void
  flush(): void
}

export type ProviderOutputDecoder = {
  decodeStdoutLine(line: string): HumanReadableAgentLineFragment[]
}

export type { AgentOutputChunk, AgentOutputStreamName } from '@runework/core'
