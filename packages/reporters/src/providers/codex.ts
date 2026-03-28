import type { ProviderOutputDecoder, HumanReadableAgentLineFragment } from '../types.ts'
import {
  isRecord,
  makeLine,
  makeRawLine,
  makeTextLines,
  normalizeText,
  parseJsonRecord,
  type JsonRecord,
} from './shared.ts'

function formatShellCommand(command: string): string {
  const trimmed = command.trim()
  const shellMatch = trimmed.match(/^\/bin\/(?:zsh|bash|sh) -lc (["'])([\s\S]*)\1$/)
  if (!shellMatch) return trimmed

  return shellMatch[2]
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .trim()
}

function summarizeCommandExecution(
  record: JsonRecord,
  item: JsonRecord,
): HumanReadableAgentLineFragment[] {
  if (item.type !== 'command_execution') return []

  const command = normalizeText(item.command)
  if (!command) return []

  const exitCode = typeof item.exit_code === 'number' ? item.exit_code : undefined
  const status = normalizeText(item.status)
  const commandLine = makeLine('command', `command: ${formatShellCommand(command)}`, record)
  const lines: HumanReadableAgentLineFragment[] = []

  if (record.type === 'item.started' || status === 'in_progress') {
    lines.push(commandLine)
  }

  if (exitCode !== undefined && exitCode !== 0) {
    if (lines.length === 0) lines.push(commandLine)
    lines.push(makeLine('error', `command failed (${exitCode})`, record))
  } else if (status === 'failed') {
    if (lines.length === 0) lines.push(commandLine)
    lines.push(makeLine('error', 'command failed', record))
  }

  return lines
}

function summarizeLifecycleEvent(
  record: JsonRecord,
): HumanReadableAgentLineFragment[] {
  switch (record.type) {
    case 'thread.started':
      return [makeLine('message', 'session started', record)]
    case 'turn.started':
      return [makeLine('message', 'thinking...', record)]
    default:
      return []
  }
}

export const codexOutputDecoder: ProviderOutputDecoder = {
  decodeStdoutLine(line) {
    const record = parseJsonRecord(line)
    if (!record) return makeRawLine(line)

    const lifecycleLines = summarizeLifecycleEvent(record)
    if (lifecycleLines.length > 0) return lifecycleLines

    const item = isRecord(record.item) ? record.item : undefined
    const messageLines = item?.type === 'agent_message'
      ? makeTextLines([normalizeText(item.text)], 'message', record)
      : []
    if (messageLines.length > 0) return messageLines

    if (item) {
      const commandLines = summarizeCommandExecution(record, item)
      if (commandLines.length > 0) return commandLines
    }

    return []
  },
}
