import type { ProviderOutputDecoder } from '../types.ts'
import {
  isRecord,
  makeRawLine,
  makeTextLines,
  normalizeText,
  parseJsonRecord,
} from './shared.ts'

export const claudeOutputDecoder: ProviderOutputDecoder = {
  decodeStdoutLine(line) {
    const record = parseJsonRecord(line)
    if (!record) return makeRawLine(line)

    const delta = isRecord(record.delta) ? record.delta : undefined
    const part = isRecord(record.part) ? record.part : undefined
    const item = isRecord(record.item) ? record.item : undefined
    const message = isRecord(record.message) ? record.message : undefined

    return makeTextLines([
      normalizeText(record.delta),
      normalizeText(delta?.text),
      normalizeText(delta?.partial_json),
      normalizeText(part?.text),
      normalizeText(record.text),
      normalizeText(record.result),
      normalizeText(message?.text),
      item?.type === 'agent_message' ? normalizeText(item.text) : undefined,
    ], 'message', record)
  },
}
