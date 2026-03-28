import { detectTools, getAdapters } from '@runework/core'
import { consumeFlag } from './helpers.ts'

function formatCapabilities(capabilities: Record<string, boolean> | undefined): string {
  if (!capabilities) return 'unknown'

  return Object.entries(capabilities)
    .map(([name, supported]) => `${name}=${supported ? 'yes' : 'no'}`)
    .join(' ')
}

export async function detectCommand(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { enabled: jsonMode } = consumeFlag(argv, '--json')
  const tools = await detectTools()
  const capabilitiesByName = new Map(
    getAdapters().map((adapter) => [adapter.name, adapter.capabilities]),
  )
  const report = tools.map((tool) => ({
    ...tool,
    capabilities: capabilitiesByName.get(tool.name),
  }))

  const available = tools.filter((t) => t.available)

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2))
    return available.length === 0 ? 1 : 0
  }

  console.log('runework: detected tools\n')
  for (const tool of report) {
    const status = tool.available ? '✓' : '✗'
    const version = tool.version ? ` (${tool.version})` : ''
    const path = tool.path ? ` → ${tool.path}` : ''
    console.log(`  ${status} ${tool.name}${version}${path}`)
    console.log(`    capabilities: ${formatCapabilities(tool.capabilities)}`)
  }

  if (available.length === 0) {
    console.log('\n  No AI CLI tools found. Install codex, claude, or opencode.')
    return 1
  }

  return 0
}
