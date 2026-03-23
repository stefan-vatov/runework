import { CodexAdapter } from './adapters/codex.ts'
import { ClaudeAdapter } from './adapters/claude.ts'
import { OpenCodeAdapter } from './adapters/opencode.ts'
import type { AgentAdapter, AgentRunRequest, AgentRunResult } from './adapters/types.ts'

function withModel(adapter: AgentAdapter, defaultModel?: string): AgentAdapter {
  return {
    name: adapter.name,
    capabilities: adapter.capabilities,
    run(request: AgentRunRequest): Promise<AgentRunResult> {
      return adapter.run({
        ...request,
        model: request.model ?? defaultModel,
      })
    },
  }
}

export function codex(model?: string): AgentAdapter {
  return withModel(new CodexAdapter(), model)
}

export function claude(model?: string): AgentAdapter {
  return withModel(new ClaudeAdapter(), model)
}

export function opencode(model: string): AgentAdapter {
  return withModel(new OpenCodeAdapter(), model)
}
