import { chmod, cp, mkdir, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { renderTemplate, runCli } from '@runework/core'
import { ensureGitignoreEntries } from '@runework/pipelines'
import { defaultRuneworkDependency } from './helpers.ts'

export type InitDeps = {
  packageRoot: string
  packageVersion: string
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

async function chmodTemplateScripts(runeworkDir: string): Promise<void> {
  if (process.platform === 'win32') return

  const scriptsDir = join(runeworkDir, 'scripts')
  const entries = await readdir(scriptsDir).catch(() => [])

  await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => chmod(join(scriptsDir, entry), 0o755)),
  )
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
  const runeworkUrl = flags.runeworkUrl ?? defaultRuneworkDependency(
    deps.packageVersion,
    deps.packageRoot,
    deps.currentDir,
  )

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
  const pkgContent = renderTemplate(pkgTemplate, { runeworkUrl })
  await writeFile(join(runeworkDir, 'package.json'), pkgContent, 'utf8')

  // 3. Copy tsconfig.json.
  await cp(join(deps.templatesRuneworkDir, 'tsconfig.json'), join(runeworkDir, 'tsconfig.json'))
  await chmodTemplateScripts(runeworkDir)

  // 4. Update .gitignore.
  await ensureGitignoreEntries(flags.targetDir, [
    '.runework/node_modules',
    '.runework/.work',
  ])

  // 5. Install dependencies.
  if (!flags.noInstall) {
    console.error('runework: installing dependencies...')
    await installRuneworkDependencies(runeworkDir, deps.runCliFn ?? runCli)
  }

  // 6. Summary.
  console.error('')
  console.error('runework: initialized .runework/ directory')
  console.error('')
  console.error('  .runework/')
  console.error('    package.json        deps (runework + zx)')
  console.error('    tsconfig.json       IDE support')
  console.error('    scripts/            user-authored scripts')
  console.error('    pipelines/          user-authored durable pipelines')
  console.error('    .work/              all output (gitignored)')
  console.error('')
  console.error('Author your own scripts and pipelines inside .runework/.')

  return 0
}
