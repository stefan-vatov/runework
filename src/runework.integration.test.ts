import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

function runCommand(command: string, args: string[], cwd: string) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  })
}

test('runework-init supports --force and scaffolds a blank .runework package', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-init-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const targetDir = join(tmpRoot, 'repo')
  await mkdir(targetDir, { recursive: true })

  const initEntry = join(process.cwd(), 'src', 'cli', 'init.ts')
  const baseArgs = [
    '--conditions=source',
    initEntry,
    targetDir,
    '--no-install',
  ]

  const first = runCommand(process.execPath, baseArgs, process.cwd())
  assert.equal(first.status, 0, first.stderr)

  const runeworkDir = join(targetDir, '.runework')
  const generatedPkg = JSON.parse(
    await readFile(join(runeworkDir, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string>; scripts?: Record<string, string> }
  assert.equal(generatedPkg.dependencies?.runework, `file:${process.cwd()}`)
  assert.equal(generatedPkg.scripts, undefined)

  const generatedTsconfig = JSON.parse(
    await readFile(join(runeworkDir, 'tsconfig.json'), 'utf8'),
  ) as { include?: string[] }
  assert.deepEqual(generatedTsconfig.include, [
    'scripts/**/*.ts',
    'pipelines/**/*.ts',
  ])

  const scriptsDir = join(runeworkDir, 'scripts')
  const pipelinesDir = join(runeworkDir, 'pipelines')
  assert.equal((await stat(scriptsDir)).isDirectory(), true)
  assert.equal((await stat(pipelinesDir)).isDirectory(), true)
  assert.deepEqual(await readdir(scriptsDir), [])
  assert.deepEqual(await readdir(pipelinesDir), [])

  const gitignore = await readFile(join(targetDir, '.gitignore'), 'utf8')
  assert.match(gitignore, /\.runework\/node_modules/)
  assert.match(gitignore, /\.runework\/\.work/)

  for (const forbidden of ['AGENTS.md', '.claude', '.codex', 'opencode.jsonc']) {
    await assert.rejects(() => stat(join(targetDir, forbidden)))
  }

  await writeFile(join(runeworkDir, 'marker.txt'), 'stale', 'utf8')

  const second = runCommand(process.execPath, baseArgs, process.cwd())
  assert.equal(second.status, 1)
  assert.match(second.stderr, /Use --force or delete it first\./)

  const forced = runCommand(process.execPath, [...baseArgs, '--force'], process.cwd())
  assert.equal(forced.status, 0, forced.stderr)
  await assert.rejects(() => readFile(join(runeworkDir, 'marker.txt'), 'utf8'))
})

test('runPipeline executes a user-authored pipeline inside a scaffolded repo', async (t) => {
  const tmpRoot = await mkdtemp(join(tmpdir(), 'runework-pipeline-'))
  t.after(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  const targetDir = join(tmpRoot, 'repo')
  await mkdir(targetDir, { recursive: true })

  const initEntry = join(process.cwd(), 'src', 'cli', 'init.ts')
  const init = runCommand(
    process.execPath,
    ['--conditions=source', initEntry, targetDir, '--no-install'],
    process.cwd(),
  )
  assert.equal(init.status, 0, init.stderr)

  const runeworkDir = join(targetDir, '.runework')
  await mkdir(join(runeworkDir, 'node_modules'), { recursive: true })
  await symlink(process.cwd(), join(runeworkDir, 'node_modules', 'runework'), 'dir')

  await writeFile(
    join(runeworkDir, 'pipelines', 'hello.ts'),
    [
      "import { defineWorkflowPipeline } from 'runework/pipelines'",
      '',
      'export default defineWorkflowPipeline({',
      '  version: 1,',
      '  async run(ctx) {',
      "    const value = await ctx.step('value', async () => 'hello from runework')",
      "    const outputPath = await ctx.writeOutput('hello.txt', value)",
      "    return { ok: true, outputPath, summary: 'pipeline complete' }",
      '  },',
      '})',
      '',
    ].join('\n'),
    'utf8',
  )

  const { runPipeline } = await import('./pipelines/index.ts')
  const result = await runPipeline('hello', runeworkDir)

  assert.equal(result.ok, true)
  assert.equal(result.summary, 'pipeline complete')
  assert.ok(result.outputPath)
  assert.equal(await readFile(result.outputPath!, 'utf8'), 'hello from runework')
})
