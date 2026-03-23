import { $ } from 'zx'

export type ToolInfo = {
  name: string
  available: boolean
  path?: string
  version?: string
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
        const which = await $({ quiet: true, nothrow: true })`which ${name}`
        if (which.exitCode !== 0) return { name, available: false }

        const path = which.stdout.trim()

        // Try --version, -V, version — different tools use different flags
        for (const flag of ['--version', '-V', 'version']) {
          const ver = await $({ quiet: true, nothrow: true, timeout: '5s' })`${name} ${flag}`
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
