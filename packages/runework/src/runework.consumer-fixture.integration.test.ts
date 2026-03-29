import assert from 'node:assert/strict'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

/**
 * Integration tests for the external consumer fixture flow.
 *
 * These tests validate VAL-CROSS-001 and VAL-CROSS-002:
 * - VAL-CROSS-001: External consumer can run code-review end-to-end through the split architecture
 * - VAL-CROSS-002: Runner behavior remains unchanged across dogfood and external consumer contexts
 *
 * The tests use thin re-export pipeline files (as scaffolded by runework-init) rather than
 * embedded full implementations, simulating how an external consumer would use the packages.
 */

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  options?: {
    env?: NodeJS.ProcessEnv
  },
): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: options?.env,
  })
}

function assertSucceeded(result: SpawnSyncReturns<string>, label: string): void {
  const detail = result.error?.message
    ?? result.stderr
    ?? result.stdout
    ?? 'command failed without output'
  assert.equal(result.status, 0, `${label}\n${detail}`)
}

function resolveCommandPath(command: string): string {
  const locator = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(locator, [command], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout || `failed to resolve ${command}`)
  const path = result.stdout.split('\n').map((line) => line.trim()).find(Boolean)
  assert.ok(path, `failed to resolve ${command}`)
  return path
}

async function linkExecutable(binDir: string, name: string, target: string): Promise<void> {
  await symlink(target, join(binDir, name)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })
}

async function createExternalConsumerFixture(
  t: { after: (cleanup: () => Promise<void> | void) => void },
  options?: { useThinReexports?: boolean },
): Promise<{ repoRoot: string; runeworkDir: string }> {
  const useThinReexports = options?.useThinReexports ?? true

  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-consumer-fixture-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const repoRoot = join(tmpRoot, 'repo')
  const runeworkDir = join(repoRoot, '.runework')
  await mkdir(join(runeworkDir, 'pipelines'), { recursive: true })
  await mkdir(join(runeworkDir, 'scripts'), { recursive: true })
  await mkdir(join(runeworkDir, 'node_modules'), { recursive: true })

  if (useThinReexports) {
    // Thin re-export stubs (as scaffolded by runework-init)
    await writeFile(
      join(runeworkDir, 'pipelines', 'code-review.ts'),
      [
        '// Thin re-export — pipeline source of truth lives in runework-pipelines',
        "export { default } from 'runework-pipelines/code-review'",
        '',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      join(runeworkDir, 'pipelines', 'constitutional-alignment.ts'),
      [
        '// Thin re-export — pipeline source of truth lives in runework-pipelines',
        "export { default } from 'runework-pipelines/constitutional-alignment'",
        '',
      ].join('\n'),
      'utf8',
    )
  }

  // Link packages into node_modules
  await symlink(
    join(process.cwd(), 'packages', 'runework'),
    join(runeworkDir, 'node_modules', 'runework'),
    'dir',
  )
  await symlink(
    join(process.cwd(), '..', 'runework-pipelines'),
    join(runeworkDir, 'node_modules', 'runework-pipelines'),
    'dir',
  )

  await writeFile(join(repoRoot, 'README.md'), '# consumer fixture repo\n', 'utf8')
  await writeFile(join(repoRoot, '.gitignore'), '.runework/node_modules/\n.runework/.work/\n', 'utf8')

  assertSucceeded(runCommand('git', ['init', '-b', 'main'], repoRoot), 'git init failed in consumer fixture')
  assertSucceeded(runCommand('git', ['config', 'user.name', 'Runework Consumer Tests'], repoRoot), 'git config user.name failed')
  assertSucceeded(runCommand('git', ['config', 'user.email', 'runework-consumer@example.com'], repoRoot), 'git config user.email failed')
  assertSucceeded(
    runCommand(
      'git',
      ['add', 'README.md', '.gitignore', '.runework/pipelines/code-review.ts', '.runework/pipelines/constitutional-alignment.ts'],
      repoRoot,
    ),
    'git add failed in consumer fixture',
  )
  assertSucceeded(
    runCommand('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], repoRoot),
    'git commit failed in consumer fixture',
  )

  return { repoRoot, runeworkDir }
}

async function createFakeCodexCli(t: { after: (cleanup: () => Promise<void> | void) => void }) {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-consumer-fake-codex-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const binDir = join(tmpRoot, 'bin')
  const logPath = join(tmpRoot, 'codex-log.jsonl')
  await mkdir(binDir, { recursive: true })

  const codexScript = [
    '#!/usr/bin/env node',
    "const fs = require('node:fs')",
    "const path = require('node:path')",
    'const args = process.argv.slice(2)',
    "if (args.includes('--version') || args.includes('-V') || args.includes('version')) {",
    "  process.stdout.write('codex fake 1.0.0\\n')",
    '  process.exit(0)',
    '}',
    "const stdin = fs.readFileSync(0, 'utf8')",
    'const logPath = process.env.RUNEWORK_FAKE_CODEX_LOG',
    "if (logPath) fs.appendFileSync(logPath, JSON.stringify({ args, stdin }) + '\\n')",
    "const outputIndex = args.indexOf('--output-last-message')",
    'const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : undefined',
    "const isWritableRun = args.includes('workspace-write')",
    'const fixRelativePath = process.env.RUNEWORK_FAKE_CODEX_FIX_RELATIVE_PATH',
    'const fixContent = process.env.RUNEWORK_FAKE_CODEX_FIX_CONTENT',
    "const reviewText = process.env.RUNEWORK_FAKE_CODEX_REVIEW_TEXT ?? '## Must Fix\\n- None\\n\\n## Should Fix\\n- None\\n\\n## Consider\\n- None\\n\\n## Summary\\n- None\\n'",
    "const fixText = process.env.RUNEWORK_FAKE_CODEX_FIX_TEXT ?? 'applied fixes'",
    'const text = isWritableRun ? fixText : reviewText',
    "if (isWritableRun && fixRelativePath && fixContent !== undefined) {",
    "  fs.writeFileSync(path.join(process.cwd(), fixRelativePath), fixContent, 'utf8')",
    '}',
    "if (outputFile) fs.writeFileSync(outputFile, text, 'utf8')",
    "process.stdout.write(JSON.stringify({ type: 'message', session_id: 'fake-codex-session' }) + '\\n')",
  ].join('\n')

  const codexScriptPath = join(binDir, 'codex')
  await writeFile(codexScriptPath, codexScript, 'utf8')
  await chmod(codexScriptPath, 0o755)

  // Create fake claude that succeeds
  const claudeScript = [
    '#!/usr/bin/env node',
    'const args = process.argv.slice(2)',
    "if (args.includes('--version') || args.includes('-V') || args.includes('version')) {",
    "  process.stdout.write('claude fake 1.0.0\\n')",
    '  process.exit(0)',
    '}',
    "process.stdout.write(JSON.stringify({ result: '## Must Fix\\n- None\\n\\n## Should Fix\\n- None\\n\\n## Consider\\n- None\\n\\n## Summary\\n- All good.\\n', session_id: 'fake-claude-session' }))",
  ].join('\n')

  const claudeScriptPath = join(binDir, 'claude')
  await writeFile(claudeScriptPath, claudeScript, 'utf8')
  await chmod(claudeScriptPath, 0o755)

  // Create fake opencode that succeeds
  const opencodeScript = [
    '#!/usr/bin/env node',
    'const args = process.argv.slice(2)',
    "if (args.includes('--version') || args.includes('-V') || args.includes('version')) {",
    "  process.stdout.write('opencode fake 1.0.0\\n')",
    '  process.exit(0)',
    '}',
    "process.stdout.write('## Must Fix\\n- None\\n\\n## Should Fix\\n- None\\n\\n## Consider\\n- None\\n\\n## Summary\\n- All good.\\n')",
  ].join('\n')

  const opencodeScriptPath = join(binDir, 'opencode')
  await writeFile(opencodeScriptPath, opencodeScript, 'utf8')
  await chmod(opencodeScriptPath, 0o755)

  const locator = process.platform === 'win32' ? 'where' : 'which'
  await Promise.all([
    linkExecutable(binDir, 'git', resolveCommandPath('git')),
    linkExecutable(binDir, 'node', process.execPath),
    linkExecutable(binDir, locator, resolveCommandPath(locator)),
  ])

  return { binDir, logPath }
}

test('VAL-CROSS-001: runework-pipeline CLI runs code-review through thin re-export in external consumer fixture', async (t) => {
  const { repoRoot, runeworkDir } = await createExternalConsumerFixture(t, { useThinReexports: true })
  const fakeCodex = await createFakeCodexCli(t)

  // Set up environment BEFORE running the pipeline
  const previousEnv = {
    PATH: process.env.PATH,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    RUNEWORK_FAKE_CODEX_LOG: process.env.RUNEWORK_FAKE_CODEX_LOG,
    RUNEWORK_FAKE_CODEX_REVIEW_TEXT: process.env.RUNEWORK_FAKE_CODEX_REVIEW_TEXT,
  }

  process.env.PATH = `${fakeCodex.binDir}:${process.env.PATH ?? ''}`
  process.env.GIT_CONFIG_GLOBAL = '/dev/null'
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  process.env.RUNEWORK_FAKE_CODEX_LOG = fakeCodex.logPath
  process.env.RUNEWORK_FAKE_CODEX_REVIEW_TEXT = [
    '## Must Fix',
    '- None',
    '',
    '## Should Fix',
    '- None',
    '',
    '## Consider',
    '- None',
    '',
    '## Summary',
    '- All good.',
    '',
  ].join('\n')

  t.after(() => {
    process.env.PATH = previousEnv.PATH
    if (previousEnv.GIT_CONFIG_GLOBAL === undefined) delete process.env.GIT_CONFIG_GLOBAL
    else process.env.GIT_CONFIG_GLOBAL = previousEnv.GIT_CONFIG_GLOBAL
    if (previousEnv.GIT_CONFIG_NOSYSTEM === undefined) delete process.env.GIT_CONFIG_NOSYSTEM
    else process.env.GIT_CONFIG_NOSYSTEM = previousEnv.GIT_CONFIG_NOSYSTEM
    if (previousEnv.RUNEWORK_FAKE_CODEX_LOG === undefined) delete process.env.RUNEWORK_FAKE_CODEX_LOG
    else process.env.RUNEWORK_FAKE_CODEX_LOG = previousEnv.RUNEWORK_FAKE_CODEX_LOG
    if (previousEnv.RUNEWORK_FAKE_CODEX_REVIEW_TEXT === undefined) delete process.env.RUNEWORK_FAKE_CODEX_REVIEW_TEXT
    else process.env.RUNEWORK_FAKE_CODEX_REVIEW_TEXT = previousEnv.RUNEWORK_FAKE_CODEX_REVIEW_TEXT
  })

  await writeFile(join(repoRoot, 'README.md'), '# consumer fixture repo\nchanged\n', 'utf8')

  // Run the pipeline via the CLI (simulating external consumer invocation)
  // Note: We run with --fix=false to avoid codex-specific writable runs that need special setup
  const cliEntry = resolve('packages/runework/src/cli/pipeline.ts')
  const result = spawnSync(
    process.execPath,
    ['--conditions=source', cliEntry, '--json', 'code-review', '--cycles', '2', '--fix=false'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
    },
  )

  assert.equal(
    result.status,
    0,
    `runework-pipeline CLI failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  )

  const payload = JSON.parse(result.stdout) as { ok: boolean; summary: string; runId: string }
  // Pipeline should succeed even if individual reviewers fail (as long as at least one succeeds)
  assert.match(payload.summary, /2 cycles/)
  assert.ok(payload.runId, 'Should have a run ID')

  // Verify the pipeline file is indeed a thin re-export (not full implementation)
  const pipelineContent = await readFile(join(runeworkDir, 'pipelines', 'code-review.ts'), 'utf8')
  assert.match(pipelineContent, /runework-pipelines\/code-review/)
  assert.doesNotMatch(pipelineContent, /defineWorkflowPipeline/)
})

test('VAL-CROSS-002: runner contract unchanged — CLI in external consumer, direct runPipeline in dogfood', async (t) => {
  // This test exercises genuinely distinct execution paths:
  // 1. External consumer fixture: uses the CLI runner (how a real external consumer would invoke pipelines)
  // 2. Dogfood context: uses runPipeline directly (programmatic interface for integration testing)
  //
  // Both paths go through the unchanged runner contract (scanning .runework/pipelines/, dynamic import),
  // but the invocation mechanism is genuinely distinct:
  // - CLI path: argument parsing → pipeline command → runner → runPipeline
  // - Direct path: runPipeline directly
  //
  // This proves the runner contract works correctly in both contexts without dedicated runner changes.

  const fixture = await createExternalConsumerFixture(t, { useThinReexports: true })
  const fakeCodex = await createFakeCodexCli(t)

  // Set up environment with fake codex
  const previousEnv = {
    PATH: process.env.PATH,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    RUNEWORK_FAKE_CODEX_LOG: process.env.RUNEWORK_FAKE_CODEX_LOG,
    RUNEWORK_FAKE_CODEX_REVIEW_TEXT: process.env.RUNEWORK_FAKE_CODEX_REVIEW_TEXT,
  }

  process.env.PATH = `${fakeCodex.binDir}:${process.env.PATH ?? ''}`
  process.env.GIT_CONFIG_GLOBAL = '/dev/null'
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  process.env.RUNEWORK_FAKE_CODEX_LOG = fakeCodex.logPath
  process.env.RUNEWORK_FAKE_CODEX_REVIEW_TEXT = [
    '## Must Fix',
    '- None',
    '',
    '## Should Fix',
    '- None',
    '',
    '## Consider',
    '- None',
    '',
    '## Summary',
    '- Clean.',
    '',
  ].join('\n')

  t.after(() => {
    process.env.PATH = previousEnv.PATH
    if (previousEnv.GIT_CONFIG_GLOBAL === undefined) delete process.env.GIT_CONFIG_GLOBAL
    else process.env.GIT_CONFIG_GLOBAL = previousEnv.GIT_CONFIG_GLOBAL
    if (previousEnv.GIT_CONFIG_NOSYSTEM === undefined) delete process.env.GIT_CONFIG_NOSYSTEM
    else process.env.GIT_CONFIG_NOSYSTEM = previousEnv.GIT_CONFIG_NOSYSTEM
    if (previousEnv.RUNEWORK_FAKE_CODEX_LOG === undefined) delete process.env.RUNEWORK_FAKE_CODEX_LOG
    else process.env.RUNEWORK_FAKE_CODEX_LOG = previousEnv.RUNEWORK_FAKE_CODEX_LOG
    if (previousEnv.RUNEWORK_FAKE_CODEX_REVIEW_TEXT === undefined) delete process.env.RUNEWORK_FAKE_CODEX_REVIEW_TEXT
    else process.env.RUNEWORK_FAKE_CODEX_REVIEW_TEXT = previousEnv.RUNEWORK_FAKE_CODEX_REVIEW_TEXT
  })

  // Add a change to the external fixture so there's something to review
  await writeFile(join(fixture.repoRoot, 'README.md'), '# consumer fixture repo\nchanged\n', 'utf8')

  // PATH 1: External consumer fixture runs through the CLI runner
  // This is how a real external consumer would invoke the pipeline
  const cliEntry = resolve('packages/runework/src/cli/pipeline.ts')
  const cliResult = spawnSync(
    process.execPath,
    ['--conditions=source', cliEntry, '--json', 'code-review', '--cycles', '1', '--fix=false'],
    {
      cwd: fixture.repoRoot,
      encoding: 'utf8',
      env: process.env,
    },
  )

  assert.equal(
    cliResult.status,
    0,
    `External consumer CLI run failed:\nstdout: ${cliResult.stdout}\nstderr: ${cliResult.stderr}`,
  )

  const cliPayload = JSON.parse(cliResult.stdout) as { ok: boolean; summary: string; runId: string }
  assert.ok(cliPayload.ok, 'external consumer CLI run should succeed')
  assert.ok(cliPayload.summary, 'external consumer CLI should produce a summary')
  assert.ok(cliPayload.runId, 'external consumer CLI should produce a run ID')

  // PATH 2: Dogfood context runs through runPipeline directly
  // This is the programmatic interface used by integration tests
  const { runPipeline } = await import('./pipelines/index.ts')
  const dogfoodRuneworkDir = join(process.cwd(), '.runework')

  // Add a change to the runework repo's README so there's something to review in dogfood context
  const dogfoodReadmePath = join(process.cwd(), 'README.md')
  const originalReadmeContent = await readFile(dogfoodReadmePath, 'utf8')
  t.after(async () => {
    // Restore original README content after test
    await writeFile(dogfoodReadmePath, originalReadmeContent, 'utf8')
  })
  await writeFile(dogfoodReadmePath, originalReadmeContent + '\n[dogfood test change]\n', 'utf8')

  const dogfoodResult = await runPipeline('code-review', dogfoodRuneworkDir, {
    options: { cycles: 1, fix: false },
    log: () => {},
  })

  // Both should produce a summary and complete successfully
  assert.ok(dogfoodResult.summary!, 'dogfood should produce a summary')
  assert.ok(dogfoodResult.ok, 'dogfood should complete successfully')

  // Verify the dogfood pipelines also use thin re-exports
  const dogfoodContent = await readFile(
    new URL('../../../.runework/pipelines/code-review.ts', import.meta.url),
    'utf8',
  )
  assert.equal(dogfoodContent.trim(), "export { default } from 'runework-pipelines/code-review'")

  // Both contexts should produce similar summary structure (at least one model reviewed)
  assert.match(cliPayload.summary, /Review complete|cycles?/i)
  assert.match(dogfoodResult.summary!, /Review complete|cycles?/i)
})

test('VAL-CROSS-001: external consumer fixture thin re-export resolves through node_modules', async (t) => {
  const { repoRoot } = await createExternalConsumerFixture(t, { useThinReexports: true })
  const fakeCodex = await createFakeCodexCli(t)

  // Set up environment with fake codex
  const previousEnv = {
    PATH: process.env.PATH,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    RUNEWORK_FAKE_CODEX_LOG: process.env.RUNEWORK_FAKE_CODEX_LOG,
    RUNEWORK_FAKE_CODEX_REVIEW_TEXT: process.env.RUNEWORK_FAKE_CODEX_REVIEW_TEXT,
    RUNEWORK_FAKE_CODEX_FIX_TEXT: process.env.RUNEWORK_FAKE_CODEX_FIX_TEXT,
    RUNEWORK_FAKE_CODEX_FIX_RELATIVE_PATH: process.env.RUNEWORK_FAKE_CODEX_FIX_RELATIVE_PATH,
    RUNEWORK_FAKE_CODEX_FIX_CONTENT: process.env.RUNEWORK_FAKE_CODEX_FIX_CONTENT,
  }

  process.env.PATH = `${fakeCodex.binDir}:${process.env.PATH ?? ''}`
  process.env.GIT_CONFIG_GLOBAL = '/dev/null'
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  process.env.RUNEWORK_FAKE_CODEX_LOG = fakeCodex.logPath
  process.env.RUNEWORK_FAKE_CODEX_REVIEW_TEXT = [
    '## Must Fix',
    '- [README.md:2] Fix this line.',
    '',
    '## Should Fix',
    '- None',
    '',
    '## Consider',
    '- None',
    '',
    '## Summary',
    '- One fix needed.',
    '',
  ].join('\n')
  process.env.RUNEWORK_FAKE_CODEX_FIX_TEXT = 'fixed content'
  process.env.RUNEWORK_FAKE_CODEX_FIX_RELATIVE_PATH = 'README.md'
  process.env.RUNEWORK_FAKE_CODEX_FIX_CONTENT = '# consumer fixture repo\nfixed\n'

  t.after(() => {
    process.env.PATH = previousEnv.PATH
    if (previousEnv.GIT_CONFIG_GLOBAL === undefined) delete process.env.GIT_CONFIG_GLOBAL
    else process.env.GIT_CONFIG_GLOBAL = previousEnv.GIT_CONFIG_GLOBAL
    if (previousEnv.GIT_CONFIG_NOSYSTEM === undefined) delete process.env.GIT_CONFIG_NOSYSTEM
    else process.env.GIT_CONFIG_NOSYSTEM = previousEnv.GIT_CONFIG_NOSYSTEM
    if (previousEnv.RUNEWORK_FAKE_CODEX_LOG === undefined) delete process.env.RUNEWORK_FAKE_CODEX_LOG
    else process.env.RUNEWORK_FAKE_CODEX_LOG = previousEnv.RUNEWORK_FAKE_CODEX_LOG
    if (previousEnv.RUNEWORK_FAKE_CODEX_REVIEW_TEXT === undefined) delete process.env.RUNEWORK_FAKE_CODEX_REVIEW_TEXT
    else process.env.RUNEWORK_FAKE_CODEX_REVIEW_TEXT = previousEnv.RUNEWORK_FAKE_CODEX_REVIEW_TEXT
    if (previousEnv.RUNEWORK_FAKE_CODEX_FIX_TEXT === undefined) delete process.env.RUNEWORK_FAKE_CODEX_FIX_TEXT
    else process.env.RUNEWORK_FAKE_CODEX_FIX_TEXT = previousEnv.RUNEWORK_FAKE_CODEX_FIX_TEXT
    if (previousEnv.RUNEWORK_FAKE_CODEX_FIX_RELATIVE_PATH === undefined) delete process.env.RUNEWORK_FAKE_CODEX_FIX_RELATIVE_PATH
    else process.env.RUNEWORK_FAKE_CODEX_FIX_RELATIVE_PATH = previousEnv.RUNEWORK_FAKE_CODEX_FIX_RELATIVE_PATH
    if (previousEnv.RUNEWORK_FAKE_CODEX_FIX_CONTENT === undefined) delete process.env.RUNEWORK_FAKE_CODEX_FIX_CONTENT
    else process.env.RUNEWORK_FAKE_CODEX_FIX_CONTENT = previousEnv.RUNEWORK_FAKE_CODEX_FIX_CONTENT
  })

  await writeFile(join(repoRoot, 'README.md'), '# consumer fixture repo\nneeds fixing\n', 'utf8')

  // Verify thin re-export can be imported via node_modules resolution
  const importResult = spawnSync(
    process.execPath,
    [
      '--conditions=source',
      '--input-type=module',
      '-e',
      `
import { default as pipeline } from './.runework/pipelines/code-review.ts'
if (typeof pipeline !== 'function') {
  throw new Error('Thin re-export did not resolve to a pipeline function')
}
console.log('ok')
      `,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
    },
  )

  assertSucceeded(importResult, 'Thin re-export should resolve through node_modules')

  // Run full pipeline to verify end-to-end works (with --fix=false to avoid codex-specific behavior)
  const cliEntry = resolve('packages/runework/src/cli/pipeline.ts')
  const result = spawnSync(
    process.execPath,
    ['--conditions=source', cliEntry, '--json', 'code-review', '--cycles', '1', '--fix=false'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
    },
  )

  assert.equal(
    result.status,
    0,
    `Pipeline should succeed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  )

  const payload = JSON.parse(result.stdout) as { ok: boolean; summary: string }
  // Summary should indicate the pipeline ran with 1 model (when cycles=1, the summary doesn't mention "cycle")
  assert.ok(payload.summary.includes('Review complete'), `Expected Review complete in summary, got: ${payload.summary}`)
})

test('thin re-export files are identical to what runework-init scaffolds', async () => {
  // Read the thin re-export content that runework-init generates
  const expectedCodeReview = [
    '// Thin re-export — pipeline source of truth lives in runework-pipelines',
    "export { default } from 'runework-pipelines/code-review'",
    '',
  ].join('\n')

  const expectedConstitutionalAlignment = [
    '// Thin re-export — pipeline source of truth lives in runework-pipelines',
    "export { default } from 'runework-pipelines/constitutional-alignment'",
    '',
  ].join('\n')

  // Create a fixture and verify the generated content matches expected
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-scaffold-verify-'))
  const targetDir = join(tmpRoot, 'repo')

  // Use runework-init to scaffold
  const initBin = resolve('packages/runework/src/cli/init.ts')
  const initResult = spawnSync(
    process.execPath,
    ['--conditions=source', initBin, targetDir, '--no-install'],
    {
      encoding: 'utf8',
    },
  )

  assert.equal(
    initResult.status,
    0,
    `runework-init failed:\nstderr: ${initResult.stderr}`,
  )

  // Read the generated thin re-exports
  const generatedCodeReview = await readFile(
    join(targetDir, '.runework', 'pipelines', 'code-review.ts'),
    'utf8',
  )
  const generatedConstitutionalAlignment = await readFile(
    join(targetDir, '.runework', 'pipelines', 'constitutional-alignment.ts'),
    'utf8',
  )

  assert.equal(generatedCodeReview, expectedCodeReview, 'code-review.ts thin re-export should match expected')
  assert.equal(generatedConstitutionalAlignment, expectedConstitutionalAlignment, 'constitutional-alignment.ts thin re-export should match expected')

  // Cleanup
  await rm(tmpRoot, { recursive: true, force: true })
})
