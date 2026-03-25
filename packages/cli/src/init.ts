import { cp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { $ } from 'zx'
import { renderTemplate } from '@runework/core'
import { ensureGitignoreEntries } from '@runework/pipelines'
import { defaultRuneworkDependency } from './helpers.ts'

export type InitDeps = {
  packageRoot: string
  packageVersion: string
  templatesRuneworkDir: string
  templatesRepoLocalDir: string
  currentDir: string
}

function parseArgs(argv: string[]) {
  let targetDir = '.'
  let noInstall = false
  let noAiConfig = false
  let force = false
  let runeworkUrl: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--no-install') {
      noInstall = true
    } else if (arg === '--no-ai-config') {
      noAiConfig = true
    } else if (arg === '--force') {
      force = true
    } else if (arg === '--runework-url' && argv[i + 1]) {
      runeworkUrl = argv[++i]
    } else if (!arg.startsWith('-')) {
      targetDir = arg
    }
  }

  return { targetDir: resolve(targetDir), noInstall, noAiConfig, force, runeworkUrl }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function copyIfMissing(src: string, dest: string, recursive = false) {
  if (await exists(dest)) return false
  await cp(src, dest, { recursive })
  return true
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

  // 1. Create directory structure
  await mkdir(join(runeworkDir, 'scripts'), { recursive: true })
  await mkdir(join(runeworkDir, 'prompts'), { recursive: true })

  // 2. Write package.json from template
  const pkgTemplate = await readFile(join(deps.templatesRuneworkDir, 'package.json.tmpl'), 'utf8')
  const pkgContent = renderTemplate(pkgTemplate, { runeworkUrl })
  await writeFile(join(runeworkDir, 'package.json'), pkgContent, 'utf8')

  // 3. Copy tsconfig.json
  await cp(join(deps.templatesRuneworkDir, 'tsconfig.json'), join(runeworkDir, 'tsconfig.json'))

  // 4. Copy example scripts
  await cp(join(deps.templatesRuneworkDir, 'scripts'), join(runeworkDir, 'scripts'), { recursive: true })
  // Make scripts executable
  await $({ quiet: true, nothrow: true })`chmod +x ${join(runeworkDir, 'scripts')}/*.ts`

  // 5. Copy prompt templates
  await cp(join(deps.templatesRuneworkDir, 'prompts'), join(runeworkDir, 'prompts'), { recursive: true })

  // 6. Copy AI tool configs to repo root (unless --no-ai-config)
  if (!flags.noAiConfig) {
    const configs = ['AGENTS.md', '.codex', '.claude', 'opencode.jsonc']
    for (const item of configs) {
      const src = join(deps.templatesRepoLocalDir, item)
      if (await exists(src)) {
        await copyIfMissing(src, join(flags.targetDir, item), true)
      }
    }
  }

  // 7. Copy example pipelines
  const pipelinesSrc = join(deps.templatesRuneworkDir, 'pipelines')
  if (await exists(pipelinesSrc)) {
    await mkdir(join(runeworkDir, 'pipelines'), { recursive: true })
    await cp(pipelinesSrc, join(runeworkDir, 'pipelines'), { recursive: true })
  }

  // 8. Update .gitignore
  await ensureGitignoreEntries(flags.targetDir, [
    '.runework/node_modules',
    '.runework/.work',
  ])

  // 9. Install dependencies
  if (!flags.noInstall) {
    console.error('runework: installing dependencies...')
    await $({ cwd: runeworkDir, quiet: false })`npm install`
  }

  // 10. Summary
  console.error('')
  console.error('runework: initialized .runework/ directory')
  console.error('')
  console.error('  .runework/')
  console.error('    package.json        deps (runework + zx)')
  console.error('    tsconfig.json       IDE support')
  console.error('    scripts/            standalone scripts')
  console.error('    pipelines/          modular AI workflows')
  console.error('    prompts/            prompt templates')
  console.error('    .work/              all output (gitignored)')
  console.error('')
  console.error('Run scripts (requires Node 24+):')
  console.error('  cd .runework && npm run review')
  console.error('  cd .runework && npm run explain -- src/main.rs')

  return 0
}
