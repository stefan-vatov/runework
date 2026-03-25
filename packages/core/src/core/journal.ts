import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type JournalEntry = {
  type: string
  [key: string]: unknown
}

/**
 * Writes a JSON journal entry to <root>/<date>/<timestamp>-<uuid>.json.
 * Default root is .hammerkit/.work/runs when called from .hammerkit scripts.
 * Returns the path to the written file.
 */
export async function writeJournal(
  entry: JournalEntry,
  root = '.hammerkit/.work/runs',
): Promise<string> {
  const now = new Date()
  const day = now.toISOString().slice(0, 10)
  const ts = now.toISOString().replace(/[:.]/g, '-')
  const dir = join(root, day)

  await mkdir(dir, { recursive: true })

  const file = join(dir, `${ts}-${randomUUID().slice(0, 8)}.json`)
  const payload = { ...entry, _ts: now.toISOString() }
  await writeFile(file, JSON.stringify(payload, null, 2), 'utf8')

  return file
}
