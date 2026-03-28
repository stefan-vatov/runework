import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { promisify } from 'node:util'

import { $, quote } from 'zx'

const execFileAsync = promisify(execFile)

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
  signal?: AbortSignal
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

function resolveShellPath(): string | true {
  if (process.platform === 'win32') return true

  const candidates = [
    '/opt/homebrew/bin/bash',
    '/bin/bash',
    '/usr/bin/bash',
    '/bin/sh',
    '/usr/bin/sh',
  ]

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }

  return true
}

function resolveShellOptions(): {
  shell: string | true
  prefix?: string
  postfix?: string
  quote?: typeof quote
} {
  const shell = resolveShellPath()

  if (typeof shell !== 'string') {
    return { shell }
  }

  return {
    shell,
    // runCli only emits a single CLI command, so a POSIX-safe `set -eu` keeps
    // execution deterministic across bash/sh environments without depending on
    // the caller's interactive shell features.
    prefix: 'set -eu;',
    postfix: '',
    quote,
  }
}

function createAbortError(message = 'CLI run aborted'): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

async function listDescendantProcessIds(rootPid: number): Promise<number[]> {
  if (process.platform === 'win32') return []

  let stdout = ''
  try {
    ({ stdout } = await execFileAsync('ps', ['-Ao', 'pid=,ppid='], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }))
  } catch {
    return []
  }

  const childrenByParent = new Map<number, number[]>()
  for (const line of stdout.split('\n')) {
    const [pidText, parentPidText] = line.trim().split(/\s+/, 2)
    const pid = Number(pidText)
    const parentPid = Number(parentPidText)
    if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) continue

    const siblings = childrenByParent.get(parentPid) ?? []
    siblings.push(pid)
    childrenByParent.set(parentPid, siblings)
  }

  const descendants: number[] = []
  const stack = [...(childrenByParent.get(rootPid) ?? [])]
  const seen = new Set<number>()

  while (stack.length > 0) {
    const pid = stack.pop()
    if (!pid || seen.has(pid)) continue

    seen.add(pid)
    descendants.push(pid)
    stack.push(...(childrenByParent.get(pid) ?? []))
  }

  return descendants
}

function signalProcess(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return

  try {
    process.kill(pid, signal)
  } catch {
    // Ignore ESRCH/EPERM and let the main process result decide the outcome.
  }
}

async function signalProcessTree(
  rootPid: number | undefined,
  signal: NodeJS.Signals,
): Promise<void> {
  if (!rootPid) return

  const descendants = await listDescendantProcessIds(rootPid)
  for (const pid of descendants.reverse()) {
    signalProcess(pid, signal)
  }
  signalProcess(rootPid, signal)
}

/**
 * Single place for all CLI execution. Sets quiet, nothrow, cwd, env,
 * stdin, and timeout policy. Every adapter goes through here.
 */
export async function runCli(opts: CliRunOptions): Promise<CliRunResult> {
  if (opts.signal?.aborted) {
    throw createAbortError()
  }

  const args = opts.args ?? []
  const cwd = opts.cwd ?? process.cwd()
  const start = Date.now()
  const combinedChunks: string[] = []
  const stdoutDecoder = new StringDecoder('utf8')
  const stderrDecoder = new StringDecoder('utf8')
  let streamError: unknown
  let childError: NodeJS.ErrnoException | undefined
  let abortError: Error | undefined

  const proc = $({
    cwd,
    env: mergeEnv(opts.env),
    input: opts.stdin,
    quiet: opts.quiet ?? true,
    nothrow: true,
    ...resolveShellOptions(),
    timeout: opts.timeoutMs ? `${opts.timeoutMs}ms` : undefined,
  })

  // zx template: bin is a single string, args array gets properly escaped
  const processPromise = proc`${opts.bin} ${args}`
  let abortTimer: NodeJS.Timeout | undefined
  let removeAbortListener: (() => void) | undefined
  processPromise.child?.once('error', (error) => {
    childError = error instanceof Error
      ? error as NodeJS.ErrnoException
      : new Error(String(error)) as NodeJS.ErrnoException
  })
  processPromise.child?.once('exit', () => {
    if (abortTimer) {
      clearTimeout(abortTimer)
      abortTimer = undefined
    }

    removeAbortListener?.()
    removeAbortListener = undefined
  })

  const abortProcess = (error: Error): void => {
    if (!abortError) {
      abortError = error
    }

    void signalProcessTree(processPromise.child?.pid, 'SIGTERM')

    if (!abortTimer) {
      abortTimer = setTimeout(() => {
        void signalProcessTree(processPromise.child?.pid, 'SIGKILL')
      }, 100)
      abortTimer.unref?.()
    }
  }

  if (opts.signal) {
    const onAbort = () => {
      abortProcess(createAbortError())
    }

    opts.signal.addEventListener('abort', onAbort, { once: true })
    removeAbortListener = () => {
      opts.signal?.removeEventListener('abort', onAbort)
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
      abortProcess(
        error instanceof Error
          ? error
          : new Error(String(error)),
      )
    }
  }

  processPromise.stdout?.on('data', (chunk) => {
    emitChunk('stdout', stdoutDecoder.write(chunk))
  })
  processPromise.stderr?.on('data', (chunk) => {
    emitChunk('stderr', stderrDecoder.write(chunk))
  })

  let output
  try {
    output = await processPromise
  } catch (error) {
    emitChunk('stdout', stdoutDecoder.end())
    emitChunk('stderr', stderrDecoder.end())
    removeAbortListener?.()
    removeAbortListener = undefined
    if (streamError) throw streamError
    if (abortError) throw abortError
    throw error
  }

  emitChunk('stdout', stdoutDecoder.end())
  emitChunk('stderr', stderrDecoder.end())
  removeAbortListener?.()
  removeAbortListener = undefined

  if (streamError) throw streamError
  if (abortError) throw abortError

  const exitCode = output.exitCode ?? (childError?.code === 'ENOENT' ? 127 : null)
  const stdout = output.stdout ?? ''
  const stderr = (output.stderr ?? '') || childError?.message || ''

  return {
    ok: exitCode === 0,
    exitCode,
    stdout,
    stderr,
    combined: combinedChunks.length > 0
      ? combinedChunks.join('')
      : `${stdout}${stderr}`,
    bin: opts.bin,
    args,
    cwd,
    durationMs: Date.now() - start,
  }
}
