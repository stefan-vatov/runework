import { ClaudeAdapter } from './claude.ts'
import { CodexAdapter } from './codex.ts'
import { OpenCodeAdapter } from './opencode.ts'
import type { AgentAdapter } from './types.ts'

const builtins: AgentAdapter[] = [
  new CodexAdapter(),
  new ClaudeAdapter(),
  new OpenCodeAdapter(),
]

export function getAdapters(): AgentAdapter[] {
  return [...builtins]
}

export function getAdapter(name: string): AgentAdapter {
  const adapter = builtins.find((a) => a.name === name)
  if (!adapter) {
    const available = builtins.map((a) => a.name).join(', ')
    throw new Error(`Unknown adapter "${name}". Available: ${available}`)
  }
  return adapter
}
