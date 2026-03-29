import { cp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { renderTemplate, runCli } from '@runework/core'
import { ensureGitignoreEntries } from '@runework/pipelines'

export type InitDeps = {
  packageRoot: string
  packageVersion: string
  runeworkPipelinesVersion: string
  templatesRuneworkDir: string
  currentDir: string
  runCliFn?: typeof runCli
}

function parseArgs(argv: string[]) {
  let targetDir = '.'
  let noInstall = false
  let force = false
  let runeworkUrl: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--no-install') {
      noInstall = true
    } else if (arg === '--force') {
      force = true
    } else if (arg === '--runework-url' && argv[i + 1]) {
      runeworkUrl = argv[++i]
    } else if (!arg.startsWith('-')) {
      targetDir = arg
    }
  }

  return { targetDir: resolve(targetDir), noInstall, force, runeworkUrl }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function installRuneworkDependencies(
  runeworkDir: string,
  runCliFn: typeof runCli,
): Promise<void> {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = await runCliFn({
    bin: npmCommand,
    args: ['install'],
    cwd: runeworkDir,
    onOutputChunk: ({ stream, text }) => {
      if (stream === 'stdout') process.stdout.write(text)
      else process.stderr.write(text)
    },
  })

  if (result.ok) return

  const detail = result.stderr.trim() || result.stdout.trim() || 'npm install failed'
  throw new Error(detail)
}

export async function initCommand(argv: string[], deps: InitDeps): Promise<number> {
  const flags = parseArgs(argv)
  const runeworkDir = join(flags.targetDir, '.runework')

  // Compute URL for runework dependency
  let runeworkUrl: string
  if (flags.runeworkUrl) {
    runeworkUrl = flags.runeworkUrl
  } else if (basename(dirname(deps.currentDir)) === 'src') {
    // Use relative path from .runework/ to packages/runework for copied context compatibility
    runeworkUrl = `file:${relative(runeworkDir, deps.packageRoot)}`
  } else {
    runeworkUrl = `^${deps.packageVersion}`
  }

  // Compute URL for runework-pipelines dependency
  let runeworkPipelinesUrl: string
  if (process.env.RUNEWORK_PIPELINES_VERSION) {
    runeworkPipelinesUrl = `^${process.env.RUNEWORK_PIPELINES_VERSION}`
  } else if (basename(dirname(deps.currentDir)) === 'src') {
    // Use git URL for runework-pipelines in dogfood/src context
    // file: paths break when repo is copied to temp locations
    runeworkPipelinesUrl = `github:stefan-vatov/runework-pipelines`
  } else {
    runeworkPipelinesUrl = `^${deps.runeworkPipelinesVersion}`
  }

  if (await exists(runeworkDir)) {
    if (!flags.force) {
      console.error('runework: .runework/ already exists. Use --force or delete it first.')
      return 1
    }

    await rm(runeworkDir, { recursive: true, force: true })
  }

  console.error(`runework: initializing .runework/ in ${flags.targetDir}`)

  // 1. Create blank user-owned directory structure.
  await mkdir(join(runeworkDir, 'scripts'), { recursive: true })
  await mkdir(join(runeworkDir, 'pipelines'), { recursive: true })

  // 2. Write package.json from template.
  const pkgTemplate = await readFile(join(deps.templatesRuneworkDir, 'package.json.tmpl'), 'utf8')
  const pkgContent = renderTemplate(pkgTemplate, { runeworkUrl, runeworkPipelinesUrl })
  await writeFile(join(runeworkDir, 'package.json'), pkgContent, 'utf8')

  // 3. Copy tsconfig.json.
  await cp(join(deps.templatesRuneworkDir, 'tsconfig.json'), join(runeworkDir, 'tsconfig.json'))

  // 4. Write thin re-export pipeline stubs for ready-made pipelines.
  const pipelinesDir = join(runeworkDir, 'pipelines')
  await writeFile(
    join(pipelinesDir, 'code-review.ts'),
    [
      '// Thin re-export — pipeline source of truth lives in runework-pipelines',
      "export { default } from 'runework-pipelines/code-review'",
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    join(pipelinesDir, 'constitutional-alignment.ts'),
    [
      '// Thin re-export — pipeline source of truth lives in runework-pipelines',
      "export { default } from 'runework-pipelines/constitutional-alignment'",
      '',
    ].join('\n'),
    'utf8',
  )

  // 5. Update .gitignore.
  await ensureGitignoreEntries(flags.targetDir, [
    '.runework/node_modules',
    '.runework/.work',
  ])

  // 6. Install dependencies.
  if (!flags.noInstall) {
    console.error('runework: installing dependencies...')
    await installRuneworkDependencies(runeworkDir, deps.runCliFn ?? runCli)
  }

  // 7. Summary.
  console.error('')
  console.error('runework: initialized .runework/ directory')
  console.error('')
  console.error('  .runework/')
  console.error('    package.json        deps (runework + runework-pipelines)')
  console.error('    tsconfig.json       IDE support')
  console.error('    scripts/            user-authored scripts')
  console.error('    pipelines/          user-authored durable pipelines + ready-made re-exports')
  console.error('    .work/              created lazily on first run (gitignored)')
  console.error('')
  console.error('Author your own scripts and pipelines inside .runework/.')

  return 0
}
