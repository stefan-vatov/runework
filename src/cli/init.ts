#!/usr/bin/env -S node --conditions=source
import { cp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $ } from 'zx'
import { renderTemplate } from '../core/render-template.ts'
import { ensureGitignoreEntries } from '../pipelines/gitignore.ts'
import { defaultHammerkitDependency } from './helpers.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
// In dist/cli/init.js → package root is ../../
// In src/cli/init.ts via tsx → package root is also ../../
const HAMMERKIT_ROOT = join(__dirname, '..', '..')
const TEMPLATES_HAMMERKIT = join(HAMMERKIT_ROOT, 'templates', 'hammerkit')
const TEMPLATES_REPO_LOCAL = join(HAMMERKIT_ROOT, 'templates', 'repo-local')

type PackageManifest = {
  version?: string
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2)
  let targetDir = '.'
  let noInstall = false
  let noAiConfig = false
  let force = false
  let hammerkitUrl: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--no-install') {
      noInstall = true
    } else if (arg === '--no-ai-config') {
      noAiConfig = true
    } else if (arg === '--force') {
      force = true
    } else if (arg === '--hammerkit-url' && args[i + 1]) {
      hammerkitUrl = args[++i]
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

async function main() {
  const flags = parseArgs(process.argv)
  const hammerkitDir = join(flags.targetDir, '.hammerkit')
  const manifest = JSON.parse(
    await readFile(join(HAMMERKIT_ROOT, 'package.json'), 'utf8'),
  ) as PackageManifest
  const hammerkitUrl = flags.hammerkitUrl ?? defaultHammerkitDependency(
    manifest.version ?? '0.1.0',
    HAMMERKIT_ROOT,
    __dirname,
  )

  if (await exists(hammerkitDir)) {
    if (!flags.force) {
      console.error('hammerkit: .hammerkit/ already exists. Use --force or delete it first.')
      process.exit(1)
    }

    await rm(hammerkitDir, { recursive: true, force: true })
  }

  console.error(`hammerkit: initializing .hammerkit/ in ${flags.targetDir}`)

  // 1. Create directory structure
  await mkdir(join(hammerkitDir, 'scripts'), { recursive: true })
  await mkdir(join(hammerkitDir, 'prompts'), { recursive: true })

  // 2. Write package.json from template
  const pkgTemplate = await readFile(join(TEMPLATES_HAMMERKIT, 'package.json.tmpl'), 'utf8')
  const pkgContent = renderTemplate(pkgTemplate, { hammerkitUrl })
  await writeFile(join(hammerkitDir, 'package.json'), pkgContent, 'utf8')

  // 3. Copy tsconfig.json
  await cp(join(TEMPLATES_HAMMERKIT, 'tsconfig.json'), join(hammerkitDir, 'tsconfig.json'))

  // 4. Copy example scripts
  await cp(join(TEMPLATES_HAMMERKIT, 'scripts'), join(hammerkitDir, 'scripts'), { recursive: true })
  // Make scripts executable
  await $({ quiet: true, nothrow: true })`chmod +x ${join(hammerkitDir, 'scripts')}/*.ts`

  // 5. Copy prompt templates
  await cp(join(TEMPLATES_HAMMERKIT, 'prompts'), join(hammerkitDir, 'prompts'), { recursive: true })

  // 6. Copy AI tool configs to repo root (unless --no-ai-config)
  if (!flags.noAiConfig) {
    const configs = ['AGENTS.md', '.codex', '.claude', 'opencode.jsonc']
    for (const item of configs) {
      const src = join(TEMPLATES_REPO_LOCAL, item)
      if (await exists(src)) {
        await copyIfMissing(src, join(flags.targetDir, item), true)
      }
    }
  }

  // 7. Copy example pipelines
  const pipelinesSrc = join(TEMPLATES_HAMMERKIT, 'pipelines')
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
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
