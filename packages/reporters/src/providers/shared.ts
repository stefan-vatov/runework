import { safeJsonParse } from '@runework/core'

import type {
  HumanReadableAgentLineFragment,
  HumanReadableAgentLineKind,
} from '../types.ts'

export type JsonRecord = Record<string, unknown>

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

export function parseJsonRecord(line: string): JsonRecord | undefined {
  const parsed = safeJsonParse(line)
  return isRecord(parsed) ? parsed : undefined
}

export function normalizeText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function dedupeTexts(texts: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const text of texts) {
    const normalized = text.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

export function makeLine(
  kind: HumanReadableAgentLineKind,
  text: string,
  rawEvent?: unknown,
): HumanReadableAgentLineFragment {
  return { kind, text, rawEvent }
}

export function makeTextLines(
  texts: Array<string | undefined>,
  kind: HumanReadableAgentLineKind,
  rawEvent?: unknown,
): HumanReadableAgentLineFragment[] {
  return dedupeTexts(texts.flatMap((text) => text ? [text] : []))
    .map((text) => makeLine(kind, text, rawEvent))
}

export function makeRawLine(text: string): HumanReadableAgentLineFragment[] {
  const normalized = text.trim()
  return normalized ? [makeLine('raw', normalized, text)] : []
}
