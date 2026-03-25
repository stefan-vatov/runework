import { $ } from 'zx'

export type CliRunOptions = {
  bin: string
  args?: string[]
  cwd?: string
  env?: Record<string, string | undefined>
  stdin?: string
  quiet?: boolean
  timeoutMs?: number
}

export type CliRunResult = {
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  combined: string
  bin: string
  args: string[]
  cwd: string
  durationMs: number
}

function mergeEnv(
  extra: Record<string, string | undefined> | undefined,
): NodeJS.ProcessEnv {
  if (!extra) return process.env
  const merged: NodeJS.ProcessEnv = { ...process.env }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) merged[key] = value
  }
  return merged
}

/**
 * Single place for all CLI execution. Sets quiet, nothrow, cwd, env,
 * stdin, and timeout policy. Every adapter goes through here.
 */
export async function runCli(opts: CliRunOptions): Promise<CliRunResult> {
  const args = opts.args ?? []
  const cwd = opts.cwd ?? process.cwd()
  const start = Date.now()

  const proc = $({
    cwd,
    env: mergeEnv(opts.env),
    input: opts.stdin,
    quiet: opts.quiet ?? true,
    nothrow: true,
    timeout: opts.timeoutMs ? `${opts.timeoutMs}ms` : undefined,
  })

  // zx template: bin is a single string, args array gets properly escaped
  const output = await proc`${opts.bin} ${args}`

  return {
    ok: output.exitCode === 0,
    exitCode: output.exitCode ?? null,
    stdout: output.stdout ?? '',
    stderr: output.stderr ?? '',
    combined: `${output.stdout ?? ''}${output.stderr ?? ''}`,
    bin: opts.bin,
    args,
    cwd,
    durationMs: Date.now() - start,
  }
}
