import { basename, dirname, resolve } from 'node:path'

import type { AgentRunResult } from '@runework/core'

export function consumeFlag(argv: string[], flag: string): { enabled: boolean; rest: string[] } {
  let enabled = false
  const rest: string[] = []

  for (const arg of argv) {
    if (arg === flag) {
      enabled = true
      continue
    }

    rest.push(arg)
  }

  return { enabled, rest }
}

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

export function defaultRuneworkPipelinesDependency(
  runeworkRoot: string,
  currentDir: string,
): string {
  // runework-pipelines is not yet published to npm, so we use github reference
  // When it is published, this should return `^${packageVersion}` like the above
  return basename(dirname(currentDir)) === 'src'
    ? `file:${resolve(runeworkRoot, '..', '..', 'runework-pipelines')}`
    : `github:stefan-vatov/runework-pipelines`
}
