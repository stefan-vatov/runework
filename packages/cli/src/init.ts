import { cp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { $ } from 'zx'
import { renderTemplate } from '@hammerkit/core'
import { ensureGitignoreEntries } from '@hammerkit/pipelines'
import { defaultHammerkitDependency } from './helpers.ts'

export type InitDeps = {
  packageRoot: string
  packageVersion: string
  templatesHammerkitDir: string
  templatesRepoLocalDir: string
  currentDir: string
}

function parseArgs(argv: string[]) {
  let targetDir = '.'
  let noInstall = false
  let noAiConfig = false
  let force = false
  let hammerkitUrl: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--no-install') {
      noInstall = true
    } else if (arg === '--no-ai-config') {
      noAiConfig = true
    } else if (arg === '--force') {
      force = true
    } else if (arg === '--hammerkit-url' && argv[i + 1]) {
      hammerkitUrl = argv[++i]
    } else if (!arg.startsWith('-')) {
      targetDir = arg
    }
  }

  return { targetDir: resolve(targetDir), noInstall, noAiConfig, force, hammerkitUrl }
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
  const hammerkitDir = join(flags.targetDir, '.hammerkit')
  const hammerkitUrl = flags.hammerkitUrl ?? defaultHammerkitDependency(
    deps.packageVersion,
    deps.packageRoot,
    deps.currentDir,
  )

  if (await exists(hammerkitDir)) {
    if (!flags.force) {
      console.error('hammerkit: .hammerkit/ already exists. Use --force or delete it first.')
      return 1
    }

    await rm(hammerkitDir, { recursive: true, force: true })
  }

  console.error(`hammerkit: initializing .hammerkit/ in ${flags.targetDir}`)

  // 1. Create directory structure
  await mkdir(join(hammerkitDir, 'scripts'), { recursive: true })
  await mkdir(join(hammerkitDir, 'prompts'), { recursive: true })

  // 2. Write package.json from template
  const pkgTemplate = await readFile(join(deps.templatesHammerkitDir, 'package.json.tmpl'), 'utf8')
  const pkgContent = renderTemplate(pkgTemplate, { hammerkitUrl })
  await writeFile(join(hammerkitDir, 'package.json'), pkgContent, 'utf8')

  // 3. Copy tsconfig.json
  await cp(join(deps.templatesHammerkitDir, 'tsconfig.json'), join(hammerkitDir, 'tsconfig.json'))

  // 4. Copy example scripts
  await cp(join(deps.templatesHammerkitDir, 'scripts'), join(hammerkitDir, 'scripts'), { recursive: true })
  // Make scripts executable
  await $({ quiet: true, nothrow: true })`chmod +x ${join(hammerkitDir, 'scripts')}/*.ts`

  // 5. Copy prompt templates
  await cp(join(deps.templatesHammerkitDir, 'prompts'), join(hammerkitDir, 'prompts'), { recursive: true })

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
  const pipelinesSrc = join(deps.templatesHammerkitDir, 'pipelines')
  if (await exists(pipelinesSrc)) {
    await mkdir(join(hammerkitDir, 'pipelines'), { recursive: true })
    await cp(pipelinesSrc, join(hammerkitDir, 'pipelines'), { recursive: true })
  }

  // 8. Update .gitignore
  await ensureGitignoreEntries(flags.targetDir, [
    '.hammerkit/node_modules',
    '.hammerkit/.work',
  ])

  // 9. Install dependencies
  if (!flags.noInstall) {
    console.error('hammerkit: installing dependencies...')
    await $({ cwd: hammerkitDir, quiet: false })`npm install`
  }

  // 10. Summary
  console.error('')
  console.error('hammerkit: initialized .hammerkit/ directory')
  console.error('')
  console.error('  .hammerkit/')
  console.error('    package.json        deps (hammerkit + zx)')
  console.error('    tsconfig.json       IDE support')
  console.error('    scripts/            standalone scripts')
  console.error('    pipelines/          modular AI workflows')
  console.error('    prompts/            prompt templates')
  console.error('    .work/              all output (gitignored)')
  console.error('')
  console.error('Run scripts (requires Node 24+):')
  console.error('  cd .hammerkit && npm run review')
  console.error('  cd .hammerkit && npm run explain -- src/main.rs')

  return 0
}
