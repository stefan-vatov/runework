#!/usr/bin/env -S node --conditions=source
import { detectTools } from '../core/detect.ts'

async function main() {
  const tools = await detectTools()

  console.log('hammerkit: detected tools\n')
  for (const tool of tools) {
    const status = tool.available ? '✓' : '✗'
    const version = tool.version ? ` (${tool.version})` : ''
    const path = tool.path ? ` → ${tool.path}` : ''
    console.log(`  ${status} ${tool.name}${version}${path}`)
  }

  const available = tools.filter((t) => t.available)
  if (available.length === 0) {
    console.log('\n  No AI CLI tools found. Install codex, claude, or opencode.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
