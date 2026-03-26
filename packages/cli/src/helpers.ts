import { basename, dirname, resolve } from 'node:path'

import type { AgentRunResult } from '@runework/core'

export function resolveRuneworkDir(cwd = process.cwd()): string {
  return basename(cwd) === '.runework'
    ? cwd
    : resolve(cwd, '.runework')
}

export function runResultExitCode(result: Pick<AgentRunResult, 'ok' | 'exitCode'>): number {
  return result.ok
    ? 0
    : result.exitCode ?? 1
}

export function defaultRuneworkDependency(
  packageVersion: string,
  runeworkRoot: string,
  currentDir: string,
): string {
  return basename(dirname(currentDir)) === 'src'
    ? `file:${runeworkRoot}`
    : `^${packageVersion}`
}
