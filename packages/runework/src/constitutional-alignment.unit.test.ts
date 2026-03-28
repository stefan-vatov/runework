import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('release automation excludes adjacent reporter tooling from versioned runtime packages', async () => {
  const nxJson = JSON.parse(
    await readFile(new URL('../../../nx.json', import.meta.url), 'utf8'),
  ) as {
    release?: { projects?: string[] }
  }

  const releaseProjects = new Set(nxJson.release?.projects ?? [])

  assert.ok(releaseProjects.has('runework'))
  assert.ok(releaseProjects.has('runework-core'))
  assert.ok(releaseProjects.has('runework-pipelines'))
  assert.ok(releaseProjects.has('runework-cli'))
  assert.equal(releaseProjects.has('runework-reporters'), false)
})

test('runCli shell policy stays environment-agnostic and does not depend on interactive shell features', async () => {
  const source = await readFile(
    new URL('../../core/src/core/run-cli.ts', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(source, /process\.env\.SHELL/)
  assert.doesNotMatch(source, /pipefail/)
  assert.match(source, /prefix:\s*'set -eu;'/)
})

test('detectTools versions the exact resolved executable path instead of re-resolving through PATH', async () => {
  const source = await readFile(
    new URL('../../core/src/core/detect.ts', import.meta.url),
    'utf8',
  )

  assert.match(source, /bin:\s*path,/)
  assert.doesNotMatch(source, /bin:\s*name,/)
})
