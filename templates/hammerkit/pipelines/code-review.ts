import { codex, claude, detectTools, opencode } from 'hammerkit'
import { defineWorkflowPipeline } from 'hammerkit/pipelines'
import { $ } from 'hammerkit/zx'

const REVIEW_PROMPT = `You are a senior code reviewer. Review the following diff for:
- Correctness: logic errors, off-by-ones, null handling
- Safety: injection, secrets, missing auth checks
- Tests: coverage gaps for changed behavior
- Clarity: naming, structure, unnecessary complexity

Be specific. Reference file:line where possible. Skip praise.

Diff:
`

const SYNTHESIS_PROMPT = `You are a principal engineer synthesizing independent code reviews into one final review.

For each finding, judge whether it's a real issue or a false positive. Deduplicate overlapping findings. Rank by severity.

Output a clean markdown review with sections:
## Must Fix (blocking)
## Should Fix (important)
## Consider (suggestions)
## Summary

If reviewers disagree, note the disagreement and give your verdict.

---

`

/**
 * Get a diff that captures everything: tracked changes, staged changes,
 * and untracked files.
 */
async function getFullDiff(repoRoot: string): Promise<string> {
  const tracked = await gitStdout(repoRoot, ['diff', 'HEAD'], 'Failed to gather tracked changes')

  const untrackedList = await gitStdout(
    repoRoot,
    ['ls-files', '--others', '--exclude-standard'],
    'Failed to list untracked files',
  )
  let untrackedDiff = ''
  if (untrackedList) {
    const files = untrackedList.split('\n').filter(Boolean)
    const diffs = await Promise.all(
      files.map(async (file) => {
        return gitStdout(
          repoRoot,
          ['diff', '--no-index', '--', '/dev/null', file],
          `Failed to diff untracked file "${file}"`,
          [0, 1],
        )
      }),
    )
    untrackedDiff = diffs.filter(Boolean).join('\n')
  }

  return [tracked, untrackedDiff].filter(Boolean).join('\n')
}

async function gitStdout(
  repoRoot: string,
  args: string[],
  errorPrefix: string,
  okExitCodes: number[] = [0],
): Promise<string> {
  const result = await $({ cwd: repoRoot, nothrow: true, quiet: true })`git ${args}`
  const exitCode = result.exitCode ?? 0

  if (!okExitCodes.includes(exitCode)) {
    const detail = result.stderr.trim() || result.stdout.trim() || `git ${args.join(' ')} exited with code ${exitCode}`
    throw new Error(`${errorPrefix}: ${detail}`)
  }

  return result.stdout.trim()
}

function makeReviewer(name: string, opencodeModel: string) {
  switch (name) {
    case 'codex':
      return { name, adapter: codex() }
    case 'claude':
      return { name, adapter: claude() }
    case 'opencode':
      return { name, adapter: opencode(opencodeModel) }
    default:
      return undefined
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

const pipeline = defineWorkflowPipeline({
  version: 1,
  async run(ctx) {
    const rawScope = ctx.options.scope
    if (rawScope !== undefined && typeof rawScope !== 'string') {
      throw new Error('--scope must be a string')
    }
    const scope = rawScope?.trim() || 'all'

    ctx.log(`${ctx.isResume ? 'resuming' : 'starting'} review run ${ctx.runId}`)
    ctx.log('gathering diff...')

    const diff = await ctx.step(`diff:${scope}`, async () => {
      if (scope === 'all') {
        return getFullDiff(ctx.repoRoot)
      }
      if (scope === 'uncommitted') {
        return gitStdout(ctx.repoRoot, ['diff'], 'Failed to gather uncommitted changes')
      }
      if (scope === 'staged') {
        return gitStdout(ctx.repoRoot, ['diff', '--cached'], 'Failed to gather staged changes')
      }
      return gitStdout(
        ctx.repoRoot,
        ['diff', `${scope}...HEAD`],
        `Invalid review scope "${scope}"`,
      )
    })

    if (!diff) {
      return { ok: true, summary: 'No changes to review.' }
    }

    const prompt = REVIEW_PROMPT + diff
    const opencodeModel = (ctx.options.opencodeModel as string) ?? 'zai/glm-5'
    const availableTools = await ctx.step('available-tools', async () => detectTools())
    const reviewers = availableTools
      .filter((tool) => tool.available)
      .map((tool) => makeReviewer(tool.name, opencodeModel))
      .filter(isDefined)

    if (reviewers.length === 0) {
      throw new Error('No supported AI CLI tools found. Install codex, claude, or opencode.')
    }

    ctx.progress({ type: 'start-parallel', names: reviewers.map((r) => r.name) })

    const reviews = await ctx.step(`reviews:${opencodeModel}`, async () => {
      const settled = await Promise.allSettled(
        reviewers.map(async ({ name, adapter }) => {
          const start = Date.now()
          try {
            const result = await adapter.run({ prompt, cwd: ctx.repoRoot })
            const elapsed = ((Date.now() - start) / 1000).toFixed(1)
            ctx.progress({ type: 'task-done', name, elapsed, ok: result.ok })
            return { name, text: result.text, ok: result.ok }
          } catch (err) {
            const elapsed = ((Date.now() - start) / 1000).toFixed(1)
            const message = err instanceof Error ? err.message : String(err)
            ctx.progress({ type: 'task-error', name, elapsed, error: message })
            return { name, text: `[error] ${message}`, ok: false }
          }
        }),
      )

      return settled.flatMap((outcome) =>
        outcome.status === 'fulfilled' ? [outcome.value] : [],
      )
    })

    for (const review of reviews) {
      await ctx.writeOutput(`${review.name}-review.md`, review.text)
    }

    const synthesisResult = reviews.length === 1
      ? {
          ok: reviews[0].ok,
          text: reviews[0].text,
        }
      : await ctx.step('synthesis', async () => {
          ctx.progress({ type: 'start-phase', label: 'synthesis' })
          const synthStart = Date.now()
          const synthesizer = reviewers.find((reviewer) => reviewer.name === 'codex') ?? reviewers[0]
          const reviewBlock = reviews
            .map((r) => `### Review by ${r.name}\n\n${r.text}`)
            .join('\n\n---\n\n')

          const result = await synthesizer.adapter.run({
            prompt: SYNTHESIS_PROMPT + reviewBlock,
            cwd: ctx.repoRoot,
          })

          const synthElapsed = ((Date.now() - synthStart) / 1000).toFixed(1)
          ctx.progress({ type: 'phase-done', label: 'synthesis', elapsed: synthElapsed })
          return result
        })

    const finalPath = await ctx.writeOutput('final-review.md', synthesisResult.text)

    return {
      ok: synthesisResult.ok,
      outputPath: finalPath,
      summary: `Review complete (${reviews.length} models)`,
    }
  },
})

export default pipeline
