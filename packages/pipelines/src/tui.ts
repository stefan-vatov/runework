/**
 * Ink-based TUI for pipeline execution.
 * Uses React.createElement (no JSX) since Node 24 type stripping
 * doesn't handle JSX transforms.
 *
 * Supports both legacy review-specific events and generic stage/job events.
 */
import React, { useState } from 'react'
import { render, Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import type { PipelineProgressEvent, PipelineResult } from './types.ts'

type NodeState = 'pending' | 'running' | 'done' | 'error' | 'skipped'

type TuiNode = {
  id: string
  parentId?: string
  kind: 'stage' | 'job'
  label: string
  state: NodeState
  elapsed?: string
  error?: string
  iterationLabel?: string
}

type PipelineTuiState = {
  nodes: TuiNode[]
  result?: PipelineResult
  messages: string[]
}

const h = React.createElement

function StatusIcon({ state }: { state: NodeState }) {
  if (state === 'running') return h(Text, { color: 'cyan' }, h(Spinner, { type: 'dots' }))
  if (state === 'done') return h(Text, { color: 'green' }, '\u2713')
  if (state === 'error') return h(Text, { color: 'red' }, '\u2717')
  if (state === 'skipped') return h(Text, { color: 'gray' }, '\u2014')
  return h(Text, { color: 'gray' }, '\u25CB')
}

function NodeRow({ node, depth }: { node: TuiNode; depth: number }) {
  const label = node.iterationLabel
    ? `${node.label} ${node.iterationLabel}`
    : node.label
  const elapsed = node.elapsed ? h(Text, { color: 'gray' }, ` (${node.elapsed}s)`) : null
  const error = node.error ? h(Text, { color: 'red' }, ` ${node.error}`) : null

  return h(Box, { gap: 1, paddingLeft: depth * 2 },
    h(StatusIcon, { state: node.state }),
    h(Text, { bold: node.state === 'running' }, label),
    elapsed,
    error,
  )
}

function PipelineTui({ state }: { state: PipelineTuiState }) {
  // Build a tree: find roots (no parentId) and children
  const childrenOf = (parentId: string | undefined): TuiNode[] =>
    state.nodes.filter((n) => n.parentId === parentId)

  function renderNodes(parentId: string | undefined, depth: number): React.ReactNode[] {
    return childrenOf(parentId).flatMap((node) => [
      h(NodeRow, { key: node.id, node, depth }),
      ...renderNodes(node.id, depth + 1),
    ])
  }

  return h(Box, { flexDirection: 'column', paddingLeft: 1 },
    // Node tree
    ...renderNodes(undefined, 0),

    // Messages
    ...state.messages.map((msg, i) =>
      h(Text, { key: `msg-${i}`, color: 'gray' }, msg),
    ),

    // Result
    state.result
      ? h(Box, { flexDirection: 'column', marginTop: 1 },
          h(Text, { color: state.result.ok ? 'green' : 'red', bold: true },
            `${state.result.ok ? '\u2713' : '\u2717'} ${state.result.summary}`,
          ),
          state.result.runId
            ? h(Text, { color: 'gray' }, `  run: ${state.result.runId}`)
            : null,
          state.result.outputs
            ? h(Box, { flexDirection: 'column', marginTop: 1 },
                ...Object.entries(state.result.outputs).map(([label, path]) =>
                  h(Text, { key: label, color: 'gray' }, `  ${label}: ${path}`),
                ),
              )
            : null,
        )
      : null,
  )
}

/**
 * Create an Ink-based TUI for pipeline execution.
 * Supports generic stage/job progress events and legacy review events.
 */
export function createPipelineTui(pipelineName: string) {
  let currentState: PipelineTuiState = {
    nodes: [],
    messages: [],
  }

  let setState: ((s: PipelineTuiState) => void) | null = null

  function update(partial: Partial<PipelineTuiState>) {
    currentState = { ...currentState, ...partial }
    if (setState) setState({ ...currentState })
  }

  function upsertNode(id: string, patch: Partial<TuiNode>) {
    const existing = currentState.nodes.find((n) => n.id === id)
    if (existing) {
      const nodes = currentState.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n))
      update({ nodes })
    } else {
      if (!patch.kind || !patch.label) {
        throw new Error(`Cannot create TUI node "${id}" without kind and label`)
      }
      update({
        nodes: [
          ...currentState.nodes,
          {
            id,
            kind: patch.kind,
            label: patch.label,
            state: patch.state ?? 'pending',
            parentId: patch.parentId,
            elapsed: patch.elapsed,
            error: patch.error,
            iterationLabel: patch.iterationLabel,
          },
        ],
      })
    }
  }

  // Wrapper component that holds state
  function App() {
    const [state, setS] = useState(currentState)
    setState = setS
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: 'blue' }, `runework pipeline: ${pipelineName}`),
      h(PipelineTui, { state }),
    )
  }

  const instance = render(h(App), { stdout: process.stderr as NodeJS.WriteStream })

  return {
    /**
     * Handle any PipelineProgressEvent — both legacy and generic.
     * This is the primary entry point for progress updates.
     */
    applyProgress(event: PipelineProgressEvent) {
      switch (event.type) {
        // --- Legacy events (map into generic node model) ---
        case 'start-parallel':
          for (const name of event.names) {
            upsertNode(`legacy:job:${name}`, {
              kind: 'job',
              label: name,
              state: 'running',
            })
          }
          break
        case 'task-done':
          upsertNode(`legacy:job:${event.name}`, {
            state: event.ok ? 'done' : 'error',
            elapsed: event.elapsed,
          })
          break
        case 'task-error':
          upsertNode(`legacy:job:${event.name}`, {
            state: 'error',
            elapsed: event.elapsed,
            error: event.error,
          })
          break
        case 'start-phase':
          upsertNode(`legacy:stage:${event.label}`, {
            kind: 'stage',
            label: event.label,
            state: 'running',
          })
          break
        case 'phase-done':
          upsertNode(`legacy:stage:${event.label}`, {
            state: 'done',
            elapsed: event.elapsed,
          })
          break

        // --- Generic stage/job events (keyed by executionId for uniqueness) ---
        case 'stage-started': {
          const iterationLabel = event.iteration !== undefined && event.totalIterations !== undefined
            ? `(${event.iteration}/${event.totalIterations})`
            : undefined
          upsertNode(event.executionId, {
            kind: 'stage',
            label: event.label,
            state: 'running',
            parentId: event.parentExecutionId,
            iterationLabel,
          })
          break
        }
        case 'stage-completed':
          upsertNode(event.executionId, { state: 'done', elapsed: event.elapsed })
          break
        case 'stage-failed': {
          const iterationLabel = event.iteration !== undefined && event.totalIterations !== undefined
            ? `(${event.iteration}/${event.totalIterations})`
            : undefined
          upsertNode(event.executionId, {
            kind: 'stage',
            label: event.label,
            state: 'error',
            elapsed: event.elapsed,
            error: event.error,
            parentId: event.parentExecutionId,
            iterationLabel,
          })
          break
        }
        case 'stage-skipped':
          upsertNode(event.executionId, {
            kind: 'stage',
            label: event.label,
            state: 'skipped',
            parentId: event.parentExecutionId,
          })
          break
        case 'job-started':
          upsertNode(event.executionId, {
            kind: 'job',
            label: event.label,
            state: 'running',
            parentId: event.stageExecutionId,
          })
          break
        case 'job-completed':
          upsertNode(event.executionId, {
            state: 'done',
            elapsed: event.elapsed,
          })
          break
        case 'job-failed':
          upsertNode(event.executionId, {
            state: 'error',
            elapsed: event.elapsed,
            error: event.error,
          })
          break
        case 'job-skipped':
          upsertNode(event.executionId, {
            kind: 'job',
            label: event.label,
            state: 'skipped',
            parentId: event.stageExecutionId,
          })
          break
      }
    },

    // --- Legacy convenience methods (delegate to applyProgress) ---

    startReview(modelNames: string[]) {
      this.applyProgress({ type: 'start-parallel', names: modelNames })
    },

    modelDone(name: string, elapsed: string, ok: boolean) {
      this.applyProgress({ type: 'task-done', name, elapsed, ok })
    },

    modelError(name: string, elapsed: string, error: string) {
      this.applyProgress({ type: 'task-error', name, elapsed, error })
    },

    startSynthesis() {
      this.applyProgress({ type: 'start-phase', label: 'synthesis' })
    },

    synthesisDone(elapsed: string) {
      this.applyProgress({ type: 'phase-done', label: 'synthesis', elapsed })
    },

    /** Show final result and exit */
    async finish(result: PipelineResult) {
      update({ result })
      // Give ink a moment to render the final state
      await new Promise((r) => setTimeout(r, 100))
      instance.unmount()
    },

    /** Log a message */
    log(message: string) {
      update({ messages: [...currentState.messages, message] })
    },
  }
}
