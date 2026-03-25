/**
 * Ink-based TUI for pipeline execution.
 * Uses React.createElement (no JSX) since Node 24 type stripping
 * doesn't handle JSX transforms.
 */
import React, { useState } from 'react'
import { render, Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import type { PipelineResult } from './types.ts'

type ModelStatus = {
  name: string
  state: 'pending' | 'running' | 'done' | 'error'
  elapsed?: string
  error?: string
}

type PipelineTuiState = {
  phase: 'init' | 'reviewing' | 'synthesizing' | 'done'
  models: ModelStatus[]
  synthesis?: { state: 'running' | 'done' | 'error'; elapsed?: string }
  result?: PipelineResult
  messages: string[]
}

const h = React.createElement

function StatusIcon({ state }: { state: string }) {
  if (state === 'running') return h(Text, { color: 'cyan' }, h(Spinner, { type: 'dots' }))
  if (state === 'done') return h(Text, { color: 'green' }, '✓')
  if (state === 'error') return h(Text, { color: 'red' }, '✗')
  return h(Text, { color: 'gray' }, '○')
}

function ModelRow({ model }: { model: ModelStatus }) {
  const elapsed = model.elapsed ? h(Text, { color: 'gray' }, ` (${model.elapsed}s)`) : null
  const error = model.error ? h(Text, { color: 'red' }, ` ${model.error}`) : null

  return h(Box, { gap: 1 },
    h(StatusIcon, { state: model.state }),
    h(Text, { bold: model.state === 'running' }, model.name),
    elapsed,
    error,
  )
}

function PipelineTui({ state }: { state: PipelineTuiState }) {
  return h(Box, { flexDirection: 'column', paddingLeft: 1 },
    // Phase header
    state.phase === 'init'
      ? h(Text, { color: 'gray' }, 'preparing...')
      : null,

    // Model statuses
    state.models.length > 0
      ? h(Box, { flexDirection: 'column', marginTop: 1 },
          ...state.models.map((m) => h(ModelRow, { key: m.name, model: m })),
        )
      : null,

    // Synthesis
    state.synthesis
      ? h(Box, { marginTop: 1, gap: 1 },
          h(StatusIcon, { state: state.synthesis.state }),
          h(Text, { bold: state.synthesis.state === 'running' }, 'synthesis'),
          state.synthesis.elapsed
            ? h(Text, { color: 'gray' }, ` (${state.synthesis.elapsed}s)`)
            : null,
        )
      : null,

    // Messages
    ...state.messages.map((msg, i) =>
      h(Text, { key: `msg-${i}`, color: 'gray' }, msg),
    ),

    // Result
    state.result
      ? h(Box, { flexDirection: 'column', marginTop: 1 },
          h(Text, { color: state.result.ok ? 'green' : 'red', bold: true },
            `${state.result.ok ? '✓' : '✗'} ${state.result.summary}`,
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
 * Returns update functions the pipeline can call to drive the UI.
 */
export function createPipelineTui(pipelineName: string) {
  let currentState: PipelineTuiState = {
    phase: 'init',
    models: [],
    messages: [],
  }

  let setState: ((s: PipelineTuiState) => void) | null = null

  function update(partial: Partial<PipelineTuiState>) {
    currentState = { ...currentState, ...partial }
    if (setState) setState({ ...currentState })
  }

  // Wrapper component that holds state
  function App() {
    const [state, setS] = useState(currentState)
    setState = setS
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true, color: 'blue' }, `hammerkit pipeline: ${pipelineName}`),
      h(PipelineTui, { state }),
    )
  }

  const instance = render(h(App), { stdout: process.stderr as NodeJS.WriteStream })

  return {
    /** Set model names and mark them as running */
    startReview(modelNames: string[]) {
      update({
        phase: 'reviewing',
        models: modelNames.map((name) => ({ name, state: 'running' })),
      })
    },

    /** Mark a model as done */
    modelDone(name: string, elapsed: string, ok: boolean) {
      const state: ModelStatus['state'] = ok ? 'done' : 'error'
      const models = currentState.models.map((m) =>
        m.name === name ? { ...m, state, elapsed } : m,
      )
      update({ models })
    },

    /** Mark a model as errored */
    modelError(name: string, elapsed: string, error: string) {
      const errState: ModelStatus['state'] = 'error'
      const models = currentState.models.map((m) =>
        m.name === name ? { ...m, state: errState, elapsed, error } : m,
      )
      update({ models })
    },

    /** Start synthesis phase */
    startSynthesis() {
      update({
        phase: 'synthesizing',
        synthesis: { state: 'running' },
      })
    },

    /** Mark synthesis as done */
    synthesisDone(elapsed: string) {
      update({
        synthesis: { state: 'done', elapsed },
      })
    },

    /** Show final result and exit */
    async finish(result: PipelineResult) {
      update({ phase: 'done', result })
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
