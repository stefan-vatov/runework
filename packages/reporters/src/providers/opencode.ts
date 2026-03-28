import type { ProviderOutputDecoder } from '../types.ts'
import {
  isRecord,
  makeRawLine,
  makeTextLines,
  normalizeText,
  parseJsonRecord,
} from './shared.ts'

export const opencodeOutputDecoder: ProviderOutputDecoder = {
  decodeStdoutLine(line) {
    const record = parseJsonRecord(line)
    if (!record) return makeRawLine(line)

    const part = isRecord(record.part) ? record.part : undefined

    return makeTextLines([
      record.type === 'text' ? normalizeText(part?.text) : undefined,
      normalizeText(record.text),
      normalizeText(record.result),
    ], 'message', record)
  },
}
