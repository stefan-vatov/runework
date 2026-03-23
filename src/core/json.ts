export function safeJsonParse<T = unknown>(input: string): T | undefined {
  try {
    return JSON.parse(input) as T
  } catch {
    return undefined
  }
}

export function parseJsonLines<T = unknown>(input: string): T[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const value = safeJsonParse<T>(line)
      return value === undefined ? [] : [value]
    })
}

export function toText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return JSON.stringify(value, null, 2)
}
