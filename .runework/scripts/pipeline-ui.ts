import React, { createElement, useEffect, useReducer, useState } from 'react'
import { Box, Text, render, useApp } from 'ink'
import Spinner from 'ink-spinner'
import { runPipeline, type PipelineResult } from 'runework/pipelines'
import type {
  DogfoodJobProgressEvent,
  DogfoodJobStatus,
  DogfoodOutputProgressEvent,
  DogfoodProgressEvent,
  DogfoodRunProgressEvent,
} from './pipeline-ui-contract.ts'

type RunDogfoodPipelineOptions = {
  pipelineName: string
  runeworkDir: string
  pipelineOptions: Record<string, unknown>
  resumeRunId?: string
}

type PipelineLogEntry = {
  id: number
  message: string
}

type PipelineOutputLine = {
  stream: 'stdout' | 'stderr'
  text: string
}

type PipelineJobState = {
  id: string
  label: string
  group: string
  order: number
  status: DogfoodJobStatus
  detail?: string
  provider?: string
  cycle?: number
  output: PipelineOutputLine[]
}

type PipelineUiState = {
  pipelineName: string
  title: string
  subtitle?: string
  runId?: string
  resumed: boolean
  startedAt: number
  nextLogId: number
  jobs: Record<string, PipelineJobState>
  logs: PipelineLogEntry[]
  result?: PipelineResult
  exitCode?: number
  error?: string
}

type PipelineUiAction =
  | { type: 'log'; message: string }
  | { type: 'progress'; event: DogfoodProgressEvent }
  | { type: 'done'; result: PipelineResult }
  | { type: 'error'; message: string }

const MAX_LOG_ENTRIES = 8
const MAX_OUTPUT_LINES = 4
const h = createElement

function humanizePipelineName(name: string): string {
  return name
    .split(/[-_/]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function isDogfoodProgressEvent(event: unknown): event is DogfoodProgressEvent {
  return (
    typeof event === 'object'
    && event !== null
    && 'type' in event
    && typeof (event as { type?: unknown }).type === 'string'
    && (event as { type: string }).type.startsWith('dogfood:')
  )
}

function trimOutput(lines: PipelineOutputLine[]): PipelineOutputLine[] {
  return lines.slice(-MAX_OUTPUT_LINES)
}

function trimLogs(logs: PipelineLogEntry[]): PipelineLogEntry[] {
  return logs.slice(-MAX_LOG_ENTRIES)
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatOutputCount(jobs: PipelineJobState[]): string {
  const outputJobCount = jobs.filter((job) => job.output.length > 0).length
  return `${outputJobCount} stream${outputJobCount === 1 ? '' : 's'}`
}

function jobStatusColor(status: DogfoodJobStatus): string {
  switch (status) {
    case 'success':
      return 'green'
    case 'failed':
      return 'red'
    case 'skipped':
    case 'cached':
      return 'yellow'
    case 'running':
      return 'cyan'
  }
}

function jobStatusLabel(status: DogfoodJobStatus): string {
  switch (status) {
    case 'success':
      return 'done'
    case 'failed':
      return 'failed'
    case 'skipped':
      return 'skipped'
    case 'cached':
      return 'cached'
    case 'running':
      return 'running'
  }
}

function summarizeCounts(jobs: PipelineJobState[]): {
  running: number
  success: number
  failed: number
} {
  return jobs.reduce(
    (counts, job) => {
      if (job.status === 'running') counts.running += 1
      if (job.status === 'success') counts.success += 1
      if (job.status === 'failed') counts.failed += 1
      return counts
    },
    { running: 0, success: 0, failed: 0 },
  )
}

function uiReducer(state: PipelineUiState, action: PipelineUiAction): PipelineUiState {
  switch (action.type) {
    case 'log':
      return {
        ...state,
        nextLogId: state.nextLogId + 1,
        logs: trimLogs([
          ...state.logs,
          { id: state.nextLogId, message: action.message },
        ]),
      }
    case 'progress':
      return applyProgressEvent(state, action.event)
    case 'done':
      return {
        ...state,
        result: action.result,
        exitCode: action.result.ok ? 0 : 1,
      }
    case 'error':
      return {
        ...state,
        error: action.message,
        exitCode: 1,
      }
  }
}

function applyProgressEvent(
  state: PipelineUiState,
  event: DogfoodProgressEvent,
): PipelineUiState {
  switch (event.type) {
    case 'dogfood:run':
      return applyRunEvent(state, event)
    case 'dogfood:job':
      return applyJobEvent(state, event)
    case 'dogfood:output':
      return applyOutputEvent(state, event)
  }
}

function applyRunEvent(
  state: PipelineUiState,
  event: DogfoodRunProgressEvent,
): PipelineUiState {
  return {
    ...state,
    pipelineName: event.pipelineName,
    title: event.title,
    subtitle: event.subtitle,
    runId: event.runId,
    resumed: event.resumed,
  }
}

function applyJobEvent(
  state: PipelineUiState,
  event: DogfoodJobProgressEvent,
): PipelineUiState {
  const current = state.jobs[event.jobId]
  return {
    ...state,
    jobs: {
      ...state.jobs,
      [event.jobId]: {
        id: event.jobId,
        label: event.label,
        group: event.group,
        order: event.order,
        status: event.status,
        detail: event.detail,
        provider: event.provider,
        cycle: event.cycle,
        output: current?.output ?? [],
      },
    },
  }
}

function applyOutputEvent(
  state: PipelineUiState,
  event: DogfoodOutputProgressEvent,
): PipelineUiState {
  const current = state.jobs[event.jobId] ?? {
    id: event.jobId,
    label: event.jobId,
    group: 'activity',
    order: 999,
    status: 'running' as DogfoodJobStatus,
    provider: event.provider,
    output: [],
  }

  return {
    ...state,
    jobs: {
      ...state.jobs,
      [event.jobId]: {
        ...current,
        output: trimOutput([
          ...current.output,
          { stream: event.stream, text: event.text },
        ]),
      },
    },
  }
}

function createInitialState(pipelineName: string): PipelineUiState {
  return {
    pipelineName,
    title: humanizePipelineName(pipelineName),
    startedAt: Date.now(),
    nextLogId: 1,
    jobs: {},
    logs: [],
    resumed: false,
  }
}

function renderStatusIndicator(job: PipelineJobState) {
  if (job.status === 'running') {
    return h(Spinner, { type: 'dots' })
  }

  const symbol = job.status === 'success'
    ? '●'
    : job.status === 'failed'
      ? '●'
      : '○'

  return h(Text, { color: jobStatusColor(job.status) }, symbol)
}

function renderJob(job: PipelineJobState) {
  const outputLines = job.status === 'running' || job.status === 'failed'
    ? job.output
    : []

  return h(
    Box,
    { key: job.id, flexDirection: 'column', marginLeft: 2, marginBottom: 1 },
    h(
      Box,
      {},
      h(Box, { width: 2 }, renderStatusIndicator(job)),
      h(
        Text,
        { wrap: 'truncate-end' },
        `${job.label} `,
        h(Text, { color: jobStatusColor(job.status), bold: job.status === 'failed' }, jobStatusLabel(job.status)),
        job.detail ? h(Text, { dimColor: true }, `  ${job.detail}`) : null,
      ),
    ),
    ...outputLines.map((line, index) =>
      h(
        Box,
        { key: `${job.id}:${line.stream}:${index}`, marginLeft: 2 },
        h(
          Text,
          {
            color: line.stream === 'stderr' ? 'yellow' : 'gray',
            wrap: 'truncate-end',
          },
          `${line.stream === 'stderr' ? '!' : '›'} ${line.text}`,
        ),
      )),
  )
}

function renderGroup(group: string, jobs: PipelineJobState[]) {
  return h(
    Box,
    { key: group, flexDirection: 'column', marginBottom: 1 },
    h(Text, { color: 'cyan', bold: true }, group),
    ...jobs.map((job) => renderJob(job)),
  )
}

function renderLogs(logs: PipelineLogEntry[]) {
  if (logs.length === 0) return null

  return h(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'cyan', bold: true }, 'notes'),
    ...logs.map((entry) =>
      h(
        Box,
        { key: entry.id, marginLeft: 2 },
        h(Text, { dimColor: true, wrap: 'truncate-end' }, `• ${entry.message}`),
      )),
  )
}

function renderOutputs(outputs: Record<string, string> | undefined) {
  if (!outputs || Object.keys(outputs).length === 0) return null

  return h(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'cyan', bold: true }, 'outputs'),
    ...Object.entries(outputs).slice(0, 6).map(([label, path]) =>
      h(
        Box,
        { key: label, marginLeft: 2 },
        h(Text, { wrap: 'truncate-middle' }, `${label}: `, h(Text, { dimColor: true }, path)),
      )),
  )
}

function formatPlainJobEvent(event: DogfoodJobProgressEvent): string {
  const detail = event.detail ? ` — ${event.detail}` : ''
  return `[${event.group}] ${event.label}: ${jobStatusLabel(event.status)}${detail}`
}

function formatPlainOutputEvent(
  event: DogfoodOutputProgressEvent,
  labels: Map<string, string>,
): string {
  const label = labels.get(event.jobId) ?? event.jobId
  const stream = event.stream === 'stderr' ? 'stderr' : 'stdout'
  return `[${label}] ${stream}: ${event.text}`
}

function PipelineApp(props: RunDogfoodPipelineOptions) {
  const { exit } = useApp()
  const [now, setNow] = useState(() => Date.now())
  const [state, dispatch] = useReducer(uiReducer, createInitialState(props.pipelineName))

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        const result = await runPipeline(props.pipelineName, props.runeworkDir, {
          options: props.pipelineOptions,
          resumeRunId: props.resumeRunId,
          log: (message) => {
            if (active) dispatch({ type: 'log', message })
          },
          onProgress: (event) => {
            if (active && isDogfoodProgressEvent(event)) {
              dispatch({ type: 'progress', event })
            }
          },
        })

        if (!active) return
        dispatch({ type: 'done', result })
      } catch (error) {
        if (!active) return
        dispatch({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })()

    return () => {
      active = false
    }
  }, [props.pipelineName, props.pipelineOptions, props.resumeRunId, props.runeworkDir])

  useEffect(() => {
    if (state.exitCode === undefined) return

    const timer = setTimeout(() => {
      exit(state.exitCode)
    }, 80)

    return () => clearTimeout(timer)
  }, [exit, state.exitCode])

  const jobs = Object.values(state.jobs).sort((left, right) => {
    const leftCycle = left.cycle ?? Number.MAX_SAFE_INTEGER
    const rightCycle = right.cycle ?? Number.MAX_SAFE_INTEGER
    if (leftCycle !== rightCycle) return leftCycle - rightCycle
    if (left.group !== right.group) return left.group.localeCompare(right.group)
    if (left.order !== right.order) return left.order - right.order
    return left.label.localeCompare(right.label)
  })

  const groupedJobs = jobs.reduce<Record<string, PipelineJobState[]>>((groups, job) => {
    groups[job.group] ??= []
    groups[job.group].push(job)
    return groups
  }, {})

  const counts = summarizeCounts(jobs)
  const elapsed = formatElapsed(now - state.startedAt)
  const headerStatus = state.error
    ? h(Text, { color: 'red', bold: true }, 'failed')
    : state.result
      ? h(Text, { color: state.result.ok ? 'green' : 'red', bold: true }, state.result.ok ? 'complete' : 'failed')
      : h(Text, { color: 'cyan', bold: true }, 'running')

  return h(
    Box,
    { flexDirection: 'column' },
    h(
      Box,
      { marginBottom: 1 },
      h(Text, { bold: true }, state.title),
      h(Text, {}, '  '),
      headerStatus,
      h(Text, { dimColor: true }, `  ${elapsed}`),
      state.runId ? h(Text, { dimColor: true }, `  run ${state.runId}`) : null,
      state.resumed ? h(Text, { color: 'yellow' }, '  resumed') : null,
    ),
    state.subtitle
      ? h(Text, { dimColor: true, wrap: 'truncate-end' }, state.subtitle)
      : null,
    h(
      Box,
      { marginBottom: 1 },
      h(Text, { color: 'cyan' }, `${counts.running} running`),
      h(Text, { dimColor: true }, '  •  '),
      h(Text, { color: 'green' }, `${counts.success} done`),
      h(Text, { dimColor: true }, '  •  '),
      h(Text, { color: counts.failed > 0 ? 'red' : 'gray' }, `${counts.failed} failed`),
      h(Text, { dimColor: true }, '  •  '),
      h(Text, { dimColor: true }, formatOutputCount(jobs)),
    ),
    ...Object.entries(groupedJobs).map(([group, groupJobs]) => renderGroup(group, groupJobs)),
    renderLogs(state.logs),
    state.result
      ? h(
        Box,
        { flexDirection: 'column', marginTop: 1 },
        h(Text, { color: state.result.ok ? 'green' : 'red', bold: true }, state.result.summary),
        renderOutputs(state.result.outputs),
      )
      : null,
    state.error
      ? h(
        Box,
        { marginTop: 1 },
        h(Text, { color: 'red', bold: true, wrap: 'truncate-end' }, state.error),
      )
      : null,
  )
}

export async function runDogfoodPipelineWithInk(
  options: RunDogfoodPipelineOptions,
): Promise<number> {
  const instance = render(h(PipelineApp, options), {
    patchConsole: false,
    maxFps: 20,
    incrementalRendering: true,
  })

  try {
    const result = await instance.waitUntilExit()
    return typeof result === 'number' ? result : 0
  } finally {
    instance.cleanup()
  }
}

export async function runDogfoodPipelinePlain(
  options: RunDogfoodPipelineOptions,
): Promise<number> {
  try {
    const jobLabels = new Map<string, string>()
    const result = await runPipeline(options.pipelineName, options.runeworkDir, {
      options: options.pipelineOptions,
      resumeRunId: options.resumeRunId,
      log: (message) => {
        console.error(message)
      },
      onProgress: (event) => {
        if (!isDogfoodProgressEvent(event)) return

        switch (event.type) {
          case 'dogfood:run':
            console.error(`${event.title} — run ${event.runId}${event.resumed ? ' (resumed)' : ''}`)
            return
          case 'dogfood:job':
            jobLabels.set(event.jobId, event.label)
            console.error(formatPlainJobEvent(event))
            return
          case 'dogfood:output':
            console.error(formatPlainOutputEvent(event, jobLabels))
        }
      },
    })

    console.error(result.summary)
    if (result.runId) console.error(`run: ${result.runId}`)
    if (result.outputs) {
      for (const [label, path] of Object.entries(result.outputs)) {
        console.error(`${label}: ${path}`)
      }
    }
    return result.ok ? 0 : 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Error: ${message}`)
    return 1
  }
}
