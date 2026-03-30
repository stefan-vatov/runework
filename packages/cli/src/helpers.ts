import { basename, dirname, resolve } from 'node:path'

import type { AgentRunResult } from '@runework/core'

const GITHUB_OWNER = 'stefan-vatov'

function taggedGitHubDependency(repo: string, version: string): string {
  return `github:${GITHUB_OWNER}/${repo}#v${version}`
}

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
    : taggedGitHubDependency('runework', packageVersion)
}
