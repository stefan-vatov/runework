import assert from 'node:assert/strict'
import test from 'node:test'

test('root facade re-exports core types and functions', async () => {
  const mod = await import('./index.ts')
  assert.equal(typeof mod.getAdapter, 'function')
  assert.equal(typeof mod.getAdapters, 'function')
  assert.equal(typeof mod.runCli, 'function')
  assert.equal(typeof mod.safeJsonParse, 'function')
  assert.equal(typeof mod.renderTemplate, 'function')
  assert.equal(typeof mod.detectTools, 'function')
  assert.equal(typeof mod.codex, 'function')
  assert.equal(typeof mod.claude, 'function')
  assert.equal(typeof mod.opencode, 'function')
  assert.equal(typeof mod.compareProviders, 'function')
  assert.equal(typeof mod.runPipeline, 'function')
})

test('subpath exports resolve correctly', async () => {
  const adapters = await import('./adapters/index.ts')
  assert.equal(typeof adapters.getAdapter, 'function')

  const core = await import('./core/index.ts')
  assert.equal(typeof core.runCli, 'function')

  const workflows = await import('./workflows/index.ts')
  assert.equal(typeof workflows.compareProviders, 'function')

  const pipelines = await import('./pipelines/index.ts')
  assert.equal(typeof pipelines.runPipeline, 'function')

  const zx = await import('./zx.ts')
  assert.equal(typeof zx.$, 'function')

  const ink = await import('./ink.ts')
  assert.equal(typeof ink.render, 'function')
})

test('CLI helpers re-export from @runework/cli', async () => {
  const helpers = await import('./cli/helpers.ts')
  assert.equal(typeof helpers.resolveRuneworkDir, 'function')
  assert.equal(typeof helpers.runResultExitCode, 'function')
  assert.equal(typeof helpers.compareResultsExitCode, 'function')
  assert.equal(typeof helpers.defaultRuneworkDependency, 'function')
})
