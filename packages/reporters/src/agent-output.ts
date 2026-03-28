import type {
  CreateHumanReadableAgentReporterOptions,
  HumanReadableAgentLineFragment,
  HumanReadableAgentReporter,
  AgentOutputStreamName,
} from './types.ts'
import { getProviderOutputDecoder } from './providers/index.ts'

type BufferState = {
  stdout: string
  stderr: string
}

function createInitialBufferState(): BufferState {
  return { stdout: '', stderr: '' }
}

function emitLineFragments(
  provider: string,
  stream: AgentOutputStreamName,
  fragments: HumanReadableAgentLineFragment[],
  onLine: CreateHumanReadableAgentReporterOptions['onLine'],
): void {
  for (const fragment of fragments) {
    for (const rawLine of fragment.text.replace(/\r\n/g, '\n').split('\n')) {
      const text = rawLine.trim()
      if (!text) continue
      onLine({
        provider,
        stream,
        kind: fragment.kind,
        text,
        rawEvent: fragment.rawEvent,
      })
    }
  }
}

function processStdoutLine(
  provider: string,
  rawLine: string,
  onLine: CreateHumanReadableAgentReporterOptions['onLine'],
): void {
  const text = rawLine.replace(/\r$/, '')
  if (!text.trim()) return

  emitLineFragments(
    provider,
    'stdout',
    getProviderOutputDecoder(provider).decodeStdoutLine(text),
    onLine,
  )
}

function processStderrLine(
  provider: string,
  rawLine: string,
  onLine: CreateHumanReadableAgentReporterOptions['onLine'],
): void {
  const text = rawLine.replace(/\r$/, '').trim()
  if (!text) return

  onLine({
    provider,
    stream: 'stderr',
    kind: 'error',
    text,
    rawEvent: rawLine,
  })
}

function drainBuffer(
  provider: string,
  stream: AgentOutputStreamName,
  buffer: string,
  onLine: CreateHumanReadableAgentReporterOptions['onLine'],
  final = false,
): string {
  let remaining = buffer
  let newlineIndex = remaining.indexOf('\n')

  while (newlineIndex >= 0) {
    const rawLine = remaining.slice(0, newlineIndex)
    remaining = remaining.slice(newlineIndex + 1)

    if (stream === 'stdout') processStdoutLine(provider, rawLine, onLine)
    else processStderrLine(provider, rawLine, onLine)

    newlineIndex = remaining.indexOf('\n')
  }

  if (final) {
    if (stream === 'stdout') processStdoutLine(provider, remaining, onLine)
    else processStderrLine(provider, remaining, onLine)
    return ''
  }

  return remaining
}

export function createHumanReadableAgentReporter(
  options: CreateHumanReadableAgentReporterOptions,
): HumanReadableAgentReporter {
  const buffers = new Map<string, BufferState>()

  function getBufferState(provider: string): BufferState {
    let state = buffers.get(provider)
    if (!state) {
      state = createInitialBufferState()
      buffers.set(provider, state)
    }
    return state
  }

  return {
    onOutputChunk(chunk) {
      const state = getBufferState(chunk.provider)

      if (chunk.stream === 'stdout') {
        state.stdout = drainBuffer(
          chunk.provider,
          'stdout',
          state.stdout + chunk.text,
          options.onLine,
        )
        return
      }

      state.stderr = drainBuffer(
        chunk.provider,
        'stderr',
        state.stderr + chunk.text,
        options.onLine,
      )
    },
    flush() {
      for (const [provider, state] of buffers.entries()) {
        state.stdout = drainBuffer(provider, 'stdout', state.stdout, options.onLine, true)
        state.stderr = drainBuffer(provider, 'stderr', state.stderr, options.onLine, true)
      }
    },
  }
}
