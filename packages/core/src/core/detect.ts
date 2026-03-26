import { runCli } from './run-cli.ts'

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
        const which = await runCli({
          bin: 'which',
          args: [name],
          quiet: true,
        })
        if (which.exitCode !== 0) return { name, available: false }

        const path = which.stdout.trim()

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
