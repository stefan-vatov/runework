import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { delimiter, extname, join } from 'node:path'

import { runCli } from './run-cli.ts'

export type ToolInfo = {
  name: string
  available: boolean
  path?: string
  version?: string
}

const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.cmd', '.bat', '.com']

function getWindowsExecutableExtensions(): string[] {
  return (process.env.PATHEXT ?? WINDOWS_EXECUTABLE_EXTENSIONS.join(';'))
    .split(';')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

function getPathEntries(): string[] {
  return (process.env.PATH ?? '')
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return false

    if (process.platform === 'win32') return true

    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveToolPath(name: string): Promise<string | undefined> {
  const pathEntries = getPathEntries()
  if (pathEntries.length === 0) return undefined

  const candidates: string[] = []

  if (process.platform === 'win32') {
    const extensions = getWindowsExecutableExtensions()
    const currentExtension = extname(name).toLowerCase()

    for (const entry of pathEntries) {
      if (currentExtension && extensions.includes(currentExtension)) {
        candidates.push(join(entry, name))
        continue
      }

      candidates.push(...extensions.map((extension) => join(entry, `${name}${extension}`)))
    }
  } else {
    candidates.push(...pathEntries.map((entry) => join(entry, name)))
  }

  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) return candidate
  }

  return undefined
}

/**
 * Check which AI CLI tools are available on this system.
 * Useful for picking adapters at runtime or for diagnostics.
 */
export async function detectTools(
  names = ['codex', 'claude', 'opencode'],
): Promise<ToolInfo[]> {
  return Promise.all(
    names.map(async (name): Promise<ToolInfo> => {
      try {
        const path = await resolveToolPath(name)
        if (!path) return { name, available: false }

        // Try --version, -V, version because provider CLIs are inconsistent here.
        for (const flag of ['--version', '-V', 'version']) {
          const ver = await runCli({
            bin: name,
            args: [flag],
            quiet: true,
            timeoutMs: 5_000,
          })
          if (ver.exitCode === 0 && ver.stdout.trim()) {
            return { name, available: true, path, version: ver.stdout.trim().split('\n')[0] }
          }
        }

        return { name, available: true, path }
      } catch {
        return { name, available: false }
      }
    }),
  )
}
