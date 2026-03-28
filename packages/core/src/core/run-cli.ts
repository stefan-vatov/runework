import { StringDecoder } from 'node:string_decoder'

import { $ } from 'zx'

export type CliOutputStreamName = 'stdout' | 'stderr'

export type CliOutputChunk = {
  stream: CliOutputStreamName
  text: string
}

export type CliRunOptions = {
  bin: string
  args?: string[]
  cwd?: string
  env?: Record<string, string | undefined>
  stdin?: string
  quiet?: boolean
  onOutputChunk?: (chunk: CliOutputChunk) => void
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
  const combinedChunks: string[] = []
  const stdoutDecoder = new StringDecoder('utf8')
  const stderrDecoder = new StringDecoder('utf8')
  let streamError: unknown

  const proc = $({
    cwd,
    env: mergeEnv(opts.env),
    input: opts.stdin,
    quiet: opts.quiet ?? true,
    nothrow: true,
    timeout: opts.timeoutMs ? `${opts.timeoutMs}ms` : undefined,
  })

  // zx template: bin is a single string, args array gets properly escaped
  const processPromise = proc`${opts.bin} ${args}`
  let abortTimer: NodeJS.Timeout | undefined
  processPromise.child?.once('exit', () => {
    if (abortTimer) {
      clearTimeout(abortTimer)
      abortTimer = undefined
    }
  })

  const abortForStreamError = (): void => {
    try {
      processPromise.child?.kill('SIGTERM')
    } catch {
      // Preserve the original stream callback error even if process termination fails.
    }

    if (!abortTimer) {
      abortTimer = setTimeout(() => {
        try {
          processPromise.child?.kill('SIGKILL')
        } catch {
          // Ignore escalation failures and preserve the original callback error.
        }
      }, 100)
      abortTimer.unref?.()
    }
  }

  const emitChunk = (stream: CliOutputStreamName, text: string): void => {
    if (!text) return
    combinedChunks.push(text)
    if (!opts.onOutputChunk || streamError) return

    try {
      opts.onOutputChunk({ stream, text })
    } catch (error) {
      streamError = error
      abortForStreamError()
    }
  }

  processPromise.stdout.on('data', (chunk) => {
    emitChunk('stdout', stdoutDecoder.write(chunk))
  })
  processPromise.stderr.on('data', (chunk) => {
    emitChunk('stderr', stderrDecoder.write(chunk))
  })

  let output
  try {
    output = await processPromise
  } catch (error) {
    emitChunk('stdout', stdoutDecoder.end())
    emitChunk('stderr', stderrDecoder.end())
    if (streamError) throw streamError
    throw error
  }

  emitChunk('stdout', stdoutDecoder.end())
  emitChunk('stderr', stderrDecoder.end())

  if (streamError) throw streamError

  return {
    ok: output.exitCode === 0,
    exitCode: output.exitCode ?? null,
    stdout: output.stdout ?? '',
    stderr: output.stderr ?? '',
    combined: combinedChunks.length > 0
      ? combinedChunks.join('')
      : `${output.stdout ?? ''}${output.stderr ?? ''}`,
    bin: opts.bin,
    args,
    cwd,
    durationMs: Date.now() - start,
  }
}
