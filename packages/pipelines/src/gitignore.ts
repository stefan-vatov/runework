import { readFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Append entries to a repo's .gitignore if they're not already present.
 * Idempotent — safe to call multiple times with the same entries.
 */
export async function ensureGitignoreEntries(
  repoRoot: string,
  entries: string[],
): Promise<void> {
  const gitignorePath = join(repoRoot, '.gitignore')
  let content = ''
  try {
    content = await readFile(gitignorePath, 'utf8')
  } catch {
    // .gitignore doesn't exist yet — that's fine
  }

  const missing = entries.filter((entry) => !content.includes(entry))
  if (missing.length === 0) return

  const block = '\n# hammerkit\n' + missing.join('\n') + '\n'
  await appendFile(gitignorePath, block, 'utf8')
}
