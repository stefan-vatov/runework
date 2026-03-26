import { codex, detectTools } from 'runework'
import { defineStagePipeline } from 'runework/pipelines'
import type { StageScopeContext, StageJobContext, StageJobResult } from 'runework/pipelines'
import { $ } from 'runework/zx'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// ===========================================================================
// Model selection
// ===========================================================================
//
// Default: Codex with GPT 5.4 at xhigh reasoning effort.
// Codex is required because the alignment and commit passes need workspace-write.
//
// To use a different Codex model:
//   const aligner = codex('o3-pro')
//
// For read-only experimentation (no fix/commit capability):
//   import { claude, opencode } from 'runework'
//   const reviewer = claude('claude-sonnet-4-6')
//   const reviewer = opencode('zai/glm-5')
//
// Note: only Codex supports sandbox: 'workspace-write' in the current adapter
// contract. Claude and OpenCode adapters cannot apply fixes or run git commits.

const CODEX_MODEL = 'gpt-5.4'
const CODEX_EXTRA_ARGS = ['--full-auto', '--config', 'model_reasoning_effort=xhigh']
const COMMIT_MAX_ATTEMPTS = 2

// ===========================================================================
// Typed pipeline variables
// ===========================================================================

type AlignmentConfig = {
  constitutionPath: string
  constitutionText: string
  availableTools: string[]
}

type AlignmentRuntimeState = {
  codexAvailable: boolean
  alignmentText: string
  alignmentPath: string
  alignmentOk: boolean
  commitText: string
  commitPath: string
  commitOk: boolean
  commitSkipped: boolean
  commitMessage: string
  commitCount: number
  skippedCommitCount: number
}

type AlignmentVars = AlignmentConfig & AlignmentRuntimeState

// ===========================================================================
// Pipeline composition
// ===========================================================================
//
//  prepare
//  └─ detect-tools         (ensure codex is available)
//
//  constitutional-cycle    (repeat = 2)
//  ├─ align
//  │  └─ review-and-fix    (codex gpt-5.4 xhigh, workspace-write)
//  └─ commit
//     └─ commit-changes    (git add -A, codex conventional commit, retry once)
//
//  Usage: runework-pipeline constitutional-alignment

const pipeline = defineStagePipeline<AlignmentVars>({
  version: 1,

  variables: async (ctx) => ({
    ...await buildConfig(ctx.repoRoot),
    ...buildInitialState(),
  }),

  stages: [
    // ── Stage 1: Prepare ────────────────────────────────────────────────
    {
      id: 'prepare',
      label: 'Prepare',
      steps: [
        { id: 'detect-tools', label: 'Detect tools', run: detectAvailableToolsJob },
      ],
    },

    // ── Stage 2: Constitutional cycle (repeats 2 times) ─────────────────
    {
      id: 'constitutional-cycle',
      label: 'Constitutional alignment cycle',
      repeat: { count: 2 },
      steps: [
        {
          id: 'align',
          label: 'Align codebase to constitution',
          steps: [
            { id: 'review-and-fix', label: 'Review & fix deviations', run: reviewAndFix },
          ],
        },
        {
          id: 'commit',
          label: 'Commit changes',
          steps: [
            { id: 'commit-changes', label: 'Stage & commit', run: commitChanges },
          ],
        },
      ],
    },
  ],

  result: buildResult,
})

export default pipeline

// ===========================================================================
// Config helpers
// ===========================================================================

async function buildConfig(repoRoot: string): Promise<AlignmentConfig> {
  const constitutionPath = resolve(repoRoot, 'CONSTITUTION.md')
  let constitutionText: string
  try {
    constitutionText = await readFile(constitutionPath, 'utf-8')
  } catch {
    throw new Error(`Constitution file not found at ${constitutionPath}`)
  }

  const tools = (await detectTools())
    .filter((t) => t.available)
    .map((t) => t.name)
    .sort()

  return { constitutionPath, constitutionText, availableTools: tools }
}

function buildInitialState(): AlignmentRuntimeState {
  return {
    codexAvailable: false,
    alignmentText: '',
    alignmentPath: '',
    alignmentOk: false,
    commitText: '',
    commitPath: '',
    commitOk: false,
    commitSkipped: false,
    commitMessage: '',
    commitCount: 0,
    skippedCommitCount: 0,
  }
}

// ===========================================================================
// Prompts
// ===========================================================================

function buildAlignmentPrompt(constitutionText: string): string {
  return `You are a senior engineer performing a constitutional alignment review.

Below is the project's CONSTITUTION.md — the source of truth for this codebase's founding principles, boundaries, growth directives, and tension pairs.

<constitution>
${constitutionText}
</constitution>

Your task:
1. Read and internalize every principle, boundary, directive, and tension pair in the constitution.
2. Inspect the repository's source code, configuration, documentation, and tests.
3. Identify any deviations — places where the implementation contradicts, ignores, or undermines a constitutional principle.
4. Fix every deviation you find directly in the codebase.

Rules:
- Do NOT edit files under .runework/.work/ or any generated pipeline artifacts.
- Do NOT add features, abstractions, or code beyond what is needed to resolve deviations.
- Stay idiomatic to the existing codebase style.
- If a deviation is ambiguous, favor the constitutional principle over current implementation.

After making changes, write a brief summary of what you changed and which constitutional principle each change serves.`
}

const COMMIT_PROMPT = `You are a developer committing code changes.

Inspect the currently staged changes with git diff --cached.

Create exactly ONE conventional commit. Requirements:
- One line only, no body
- All lowercase
- Format: type: subject  OR  type(scope): subject
- Valid types: feat, fix, refactor, docs, chore, test, style, perf, ci, build
- Keep the subject concise and descriptive

Run: git commit -m "<your message>"

If the commit fails for any reason (hooks, lint, tests, formatting):
1. Read the error output carefully
2. Fix the issue in the affected files
3. Run git add -A to restage
4. Retry the commit

Do NOT push, tag, or create branches.`

function buildRetryCommitPrompt(previousFailure: string, previousCreatedCommit: boolean): string {
  const amendNote = previousCreatedCommit
    ? `A commit was created but the message was invalid. Use git commit --amend -m "<new message>" to fix it.`
    : `No commit was created. Fix the issue, run git add -A, then git commit -m "<your message>".`

  return `You are a developer fixing a failed commit attempt.

Previous failure reason:
${previousFailure}

${amendNote}

Requirements for the commit message:
- One line only, no body
- All lowercase
- Format: type: subject  OR  type(scope): subject
- Valid types: feat, fix, refactor, docs, chore, test, style, perf, ci, build

If any pre-commit hooks or checks fail, fix the issues first, restage with git add -A, then commit.
Do NOT push, tag, or create branches.`
}

// ===========================================================================
// Git helpers
// ===========================================================================

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

async function gitExitCode(repoRoot: string, args: string[]): Promise<number> {
  const result = await $({ cwd: repoRoot, nothrow: true, quiet: true })`git ${args}`
  return result.exitCode ?? 0
}

async function getHead(repoRoot: string): Promise<string | undefined> {
  try {
    return await gitStdout(repoRoot, ['rev-parse', '--verify', 'HEAD'], '')
  } catch {
    return undefined
  }
}

async function hasStagedChanges(repoRoot: string): Promise<boolean> {
  const code = await gitExitCode(repoRoot, ['diff', '--cached', '--quiet'])
  return code !== 0
}

async function getLatestCommitMessage(repoRoot: string): Promise<string> {
  return gitStdout(repoRoot, ['log', '-1', '--pretty=%B'], 'Failed to read commit message')
}

const CONVENTIONAL_COMMIT_RE = /^[a-z]+(\([a-z0-9_/-]+\))?!?:\s.+$/

function validateConventionalCommit(message: string): string | undefined {
  const lines = message.trim().split('\n').filter(Boolean)
  if (lines.length !== 1) return `expected one line, got ${lines.length}`
  const subject = lines[0]
  if (subject !== subject.toLowerCase()) return `not all lowercase: "${subject}"`
  if (!CONVENTIONAL_COMMIT_RE.test(subject)) return `does not match conventional commit format: "${subject}"`
  return undefined
}

// ===========================================================================
// Job implementations
// ===========================================================================

async function detectAvailableToolsJob(ctx: StageJobContext<AlignmentVars>): Promise<StageJobResult<AlignmentVars>> {
  const codexAvailable = ctx.vars.availableTools.includes('codex')

  if (!codexAvailable) {
    throw new Error(
      'constitutional-alignment requires Codex CLI because fix and commit passes need workspace-write access. ' +
      'Install codex and try again.',
    )
  }

  ctx.log(`tools: ${ctx.vars.availableTools.join(', ')}`)
  ctx.log(`model: ${CODEX_MODEL} (xhigh reasoning)`)
  ctx.log(`cycles: 2`)

  // Log dirty status for visibility
  const status = await gitStdout(ctx.repoRoot, ['status', '--short'], 'Failed to get git status')
  if (status) {
    const fileCount = status.split('\n').filter(Boolean).length
    ctx.log(`working tree has ${fileCount} dirty file(s) — these will be included in commits`)
  }

  return { vars: { codexAvailable } }
}

async function reviewAndFix(ctx: StageJobContext<AlignmentVars>): Promise<StageJobResult<AlignmentVars>> {
  const aligner = codex(CODEX_MODEL)
  const prompt = buildAlignmentPrompt(ctx.vars.constitutionText)

  let text: string
  let ok: boolean
  try {
    const result = await aligner.run({
      prompt,
      cwd: ctx.repoRoot,
      sandbox: 'workspace-write',
      extraArgs: CODEX_EXTRA_ARGS,
      timeoutMs: 60 * 60 * 1000,
    })
    text = result.text
    ok = result.ok
  } catch (err) {
    text = `[error] ${err instanceof Error ? err.message : String(err)}`
    ok = false
  }

  await ctx.writeStageOutput('constitutional-alignment.md', text)
  const path = await ctx.writeOutput('constitutional-alignment.md', text)

  const lines = text.split('\n').length
  ctx.log(`alignment: ${ok ? 'done' : 'failed'} (${lines} lines) → ${path}`)

  if (!ok) throw new Error(`Alignment pass failed — see ${path}`)

  return {
    vars: {
      alignmentText: text,
      alignmentPath: path,
      alignmentOk: ok,
    },
  }
}

async function commitChanges(ctx: StageJobContext<AlignmentVars>): Promise<StageJobResult<AlignmentVars>> {
  // Stage everything
  await $({ cwd: ctx.repoRoot, quiet: true })`git add -A`

  // Check if there's anything to commit
  if (!await hasStagedChanges(ctx.repoRoot)) {
    const skipText = 'No staged changes after alignment — nothing to commit.'
    await ctx.writeStageOutput('commit-result.md', skipText)
    await ctx.writeOutput('commit-result.md', skipText)
    ctx.log('no changes to commit — skipping')
    return {
      vars: {
        commitOk: true,
        commitSkipped: true,
        skippedCommitCount: ctx.vars.skippedCommitCount + 1,
      },
    }
  }

  const committer = codex(CODEX_MODEL)
  let lastFailure: string | undefined
  let lastCreatedCommit = false

  for (let attempt = 1; attempt <= COMMIT_MAX_ATTEMPTS; attempt++) {
    const headBefore = await getHead(ctx.repoRoot)

    const prompt = attempt === 1
      ? COMMIT_PROMPT
      : buildRetryCommitPrompt(lastFailure!, lastCreatedCommit)

    let text: string
    let ok: boolean
    try {
      const result = await committer.run({
        prompt,
        cwd: ctx.repoRoot,
        sandbox: 'workspace-write',
        extraArgs: CODEX_EXTRA_ARGS,
        timeoutMs: 30 * 60 * 1000,
      })
      text = result.text
      ok = result.ok
    } catch (err) {
      text = `[error] ${err instanceof Error ? err.message : String(err)}`
      ok = false
    }

    await ctx.writeStageOutput(`commit-attempt-${attempt}.md`, text)

    // Check if a commit was actually created
    const headAfter = await getHead(ctx.repoRoot)
    const commitCreated = Boolean(headAfter && headBefore !== headAfter)

    if (commitCreated) {
      const message = await getLatestCommitMessage(ctx.repoRoot)
      const validationError = validateConventionalCommit(message)

      if (!validationError) {
        // Success
        const resultText = `Commit created (attempt ${attempt}):\n${message.trim()}`
        await ctx.writeStageOutput('commit-result.md', resultText)
        const path = await ctx.writeOutput('commit-result.md', resultText)
        ctx.log(`committed: ${message.trim()} → ${path}`)
        return {
          vars: {
            commitText: text,
            commitPath: path,
            commitOk: true,
            commitSkipped: false,
            commitMessage: message.trim(),
            commitCount: ctx.vars.commitCount + 1,
          },
        }
      }

      // Commit exists but message is bad — retry will amend
      lastFailure = `commit message validation failed: ${validationError}`
      lastCreatedCommit = true
    } else {
      lastFailure = ok
        ? 'model reported success but no new commit was created'
        : `model failed (attempt ${attempt}): see transcript`
      lastCreatedCommit = false

      // Restage for retry — model may have changed files trying to fix hooks
      if (attempt < COMMIT_MAX_ATTEMPTS) {
        await $({ cwd: ctx.repoRoot, quiet: true })`git add -A`
      }
    }

    if (attempt < COMMIT_MAX_ATTEMPTS) {
      ctx.log(`commit attempt ${attempt} failed: ${lastFailure} — retrying`)
    }
  }

  // Exhausted attempts
  const failText = `Commit failed after ${COMMIT_MAX_ATTEMPTS} attempts.\nLast failure: ${lastFailure}`
  await ctx.writeStageOutput('commit-result.md', failText)
  const failPath = await ctx.writeOutput('commit-result.md', failText)
  throw new Error(`Commit failed after ${COMMIT_MAX_ATTEMPTS} attempts: ${lastFailure} — see ${failPath}`)
}

// ===========================================================================
// Result builder
// ===========================================================================

function buildResult(ctx: StageScopeContext<AlignmentVars>) {
  const totalCycles = 2
  const commits = ctx.vars.commitCount
  const skipped = ctx.vars.skippedCommitCount

  const parts = [`${totalCycles} cycles`]
  if (commits > 0) parts.push(`${commits} commit${commits !== 1 ? 's' : ''}`)
  if (skipped > 0) parts.push(`${skipped} no-op${skipped !== 1 ? 's' : ''}`)

  return {
    ok: ctx.vars.alignmentOk && ctx.vars.commitOk,
    outputPath: ctx.vars.commitPath || ctx.vars.alignmentPath,
    summary: `Constitutional alignment complete (${parts.join(', ')})`,
  }
}
