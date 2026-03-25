import assert from 'node:assert/strict'
import test from 'node:test'

import type { AgentAdapter } from '@runework/core'
import { compareProviders } from './compare.ts'

test('compareProviders rejects provider-specific common options', async () => {
  const adapter: AgentAdapter = {
    name: 'stub-claude',
    capabilities: {
      approvalMode: false,
      files: false,
      sandbox: false,
      schema: true,
      sessionName: true,
    },
    async run() {
      assert.fail('compareProviders should reject unsupported common options before running')
    },
  }

  await assert.rejects(
    () =>
      compareProviders({
        adapters: [adapter],
        promptTemplate: 'Hello',
        common: {
          sandbox: 'workspace-write',
        },
      }),
    /compareProviders common request contains provider-specific options: stub-claude: sandbox/,
  )
})
