import type { ProviderOutputDecoder } from '../types.ts'
import { makeRawLine } from './shared.ts'
import { claudeOutputDecoder } from './claude.ts'
import { codexOutputDecoder } from './codex.ts'
import { opencodeOutputDecoder } from './opencode.ts'

const passthroughOutputDecoder: ProviderOutputDecoder = {
  decodeStdoutLine(line) {
    return makeRawLine(line)
  },
}

export function getProviderOutputDecoder(provider: string): ProviderOutputDecoder {
  switch (provider) {
    case 'claude':
      return claudeOutputDecoder
    case 'codex':
      return codexOutputDecoder
    case 'opencode':
      return opencodeOutputDecoder
    default:
      return passthroughOutputDecoder
  }
}
