import { basename, dirname, resolve } from 'node:path'

import type { AgentRunResult } from '../adapters/types.ts'

export function resolveHammerkitDir(cwd = process.cwd()): string {
  return basename(cwd) === '.hammerkit'
    ? cwd
    : resolve(cwd, '.hammerkit')
}

export function runResultExitCode(result: Pick<AgentRunResult, 'ok' | 'exitCode'>): number {
  return result.ok
    ? 0
    : result.exitCode ?? 1
}

export function compareResultsExitCode(
  results: Array<Pick<AgentRunResult, 'ok'>>,
): number {
  return results.every((result) => result.ok) ? 0 : 1
}

export function defaultHammerkitDependency(
  packageVersion: string,
  hammerkitRoot: string,
  currentDir: string,
): string {
  return basename(dirname(currentDir)) === 'src'
    ? `file:${hammerkitRoot}`
    : `^${packageVersion}`
}
