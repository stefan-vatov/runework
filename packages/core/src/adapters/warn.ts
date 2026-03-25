import type { AgentRunRequest } from './types.ts'

/**
 * Emit a stderr warning when a caller passes request fields
 * that this adapter silently ignores. Warns once per field per call.
 */
export function warnUnsupported(
  adapter: string,
  req: AgentRunRequest,
  unsupported: (keyof AgentRunRequest)[],
): void {
  for (const field of unsupported) {
    const value = req[field]
    if (value !== undefined && value !== null) {
      console.error(`[hammerkit] ${adapter}: "${field}" is not supported by this adapter and will be ignored`)
    }
  }
}
