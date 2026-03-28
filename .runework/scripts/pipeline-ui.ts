import { createElement, useEffect, useReducer } from 'react'
import { Box, Text, render, useApp, useStdout } from 'ink'
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

type PipelineOutputLine = {
  stream: 'stdout' | 'stderr'
  text: string
}

type PipelineViewportLine = {
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
  jobs: Record<string, PipelineJobState>
  result?: PipelineResult
  exitCode?: number
  error?: string
}

type PipelineUiAction =
  | { type: 'progress'; event: DogfoodProgressEvent }
  | { type: 'done'; result: PipelineResult }
  | { type: 'error'; message: string }

const MAX_OUTPUT_LINES = 200
const h = createElement
const MIN_STREAM_HEIGHT = 10
const RESERVED_SCREEN_LINES = 8

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

function stripLeadingTimestamp(text: string): string {
  return text.replace(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s+/,
    '',
  )
}

function collapseRepeatedOutputLines(lines: PipelineOutputLine[]): PipelineOutputLine[] {
  const collapsed: PipelineOutputLine[] = []
  let pendingError:
    | {
      key: string
      text: string
      count: number
    }
    | undefined

  const flushPendingError = () => {
    if (!pendingError) return

    collapsed.push({
      stream: 'stderr',
      text: pendingError.count > 1
        ? `${pendingError.text} [x${pendingError.count}]`
        : pendingError.text,
    })
    pendingError = undefined
  }

  for (const line of lines) {
    if (line.stream !== 'stderr') {
      flushPendingError()
      collapsed.push(line)
      continue
    }

    const normalized = stripLeadingTimestamp(line.text).trim()
    if (!normalized) continue

    if (pendingError?.key === normalized) {
      pendingError.count += 1
      continue
    }

    flushPendingError()
    pendingError = {
      key: normalized,
      text: normalized,
      count: 1,
    }
  }

  flushPendingError()
  return collapsed
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return []

  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ['']

  const lines: string[] = []
  let current = ''

  const pushSegment = (segment: string) => {
    if (Array.from(segment).length <= width) {
      if (!current) {
        current = segment
        return
      }

      const candidate = `${current} ${segment}`
      if (Array.from(candidate).length <= width) {
        current = candidate
        return
      }

      lines.push(current)
      current = segment
      return
    }

    if (current) {
      lines.push(current)
      current = ''
    }

    const chars = Array.from(segment)
    for (let index = 0; index < chars.length; index += width) {
      lines.push(chars.slice(index, index + width).join(''))
    }
  }

  for (const segment of normalized.split(' ')) {
    pushSegment(segment)
  }

  if (current) lines.push(current)
  return lines
}

function wrapOutputLine(
  line: PipelineOutputLine,
  width: number,
): PipelineViewportLine[] {
  const firstPrefix = line.stream === 'stderr' ? '! ' : '› '
  const continuationPrefix = '  '
  const firstWidth = Math.max(1, width - Array.from(firstPrefix).length)
  const continuationWidth = Math.max(1, width - Array.from(continuationPrefix).length)

  const wrapped = wrapText(line.text, firstWidth)
  if (wrapped.length === 0) {
    return [{ stream: line.stream, text: firstPrefix.trimEnd() }]
  }

  return wrapped.flatMap((segment, index) => {
    if (index === 0) {
      return [{ stream: line.stream, text: `${firstPrefix}${segment}` }]
    }

    return wrapText(segment, continuationWidth).map((continued) => ({
      stream: line.stream,
      text: `${continuationPrefix}${continued}`,
    }))
  })
}

export function buildStreamViewportLines(
  lines: PipelineOutputLine[],
  width: number,
  height: number,
): PipelineViewportLine[] {
  const wrapped = collapseRepeatedOutputLines(lines)
    .flatMap((line) => wrapOutputLine(line, Math.max(1, width)))

  if (height <= 0) return []
  if (wrapped.length >= height) return wrapped.slice(-height)

  return [
    ...Array.from({ length: height - wrapped.length }, () => ({
      stream: 'stdout' as const,
      text: '',
    })),
    ...wrapped,
  ]
}

function uiReducer(state: PipelineUiState, action: PipelineUiAction): PipelineUiState {
  switch (action.type) {
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
    jobs: {},
    resumed: false,
  }
}

function renderStatusIndicator(job: PipelineJobState) {
  if (job.status === 'running') {
    return h(Text, { color: 'cyan' }, '›')
  }

  const symbol = job.status === 'success'
    ? '●'
    : job.status === 'failed'
      ? '●'
      : '○'

  return h(Text, { color: jobStatusColor(job.status) }, symbol)
}

function getPrimaryJob(jobs: PipelineJobState[]): PipelineJobState | undefined {
  return jobs.find((job) => job.status === 'running')
    ?? [...jobs].reverse().find((job) => job.output.length > 0)
    ?? jobs[jobs.length - 1]
}

function renderActiveJob(job: PipelineJobState | undefined, width: number) {
  const base = job
    ? `${job.group} · ${job.label}${job.detail ? `  ${job.detail}` : ''}`
    : 'waiting to start...'

  return h(
    Box,
    { marginBottom: 1 },
    h(Box, { width: 2 }, job ? renderStatusIndicator(job) : h(Text, { dimColor: true }, '·')),
    h(
      Text,
      { wrap: 'truncate-end' },
      wrapText(base, Math.max(1, width))[0] ?? '',
    ),
  )
}

function renderStreamBox(
  job: PipelineJobState | undefined,
  width: number,
  height: number,
) {
  const lines = buildStreamViewportLines(job?.output ?? [], width, height)
  const borderColor = job?.status === 'failed' ? 'red' : 'gray'

  return h(
    Box,
    { flexDirection: 'column' },
    h(Text, { color: 'cyan', bold: true }, 'stream'),
    h(
      Box,
      {
        borderStyle: 'round',
        borderColor,
        flexDirection: 'column',
        paddingX: 1,
        paddingY: 0,
        height: height + 2,
      },
      ...lines.map((line, index) =>
        h(
          Box,
          { key: `${job?.id ?? 'stream'}:${line.stream}:${index}`, height: 1 },
          h(
            Text,
            {
              color: line.text
                ? (line.stream === 'stderr' ? 'yellow' : 'gray')
                : 'gray',
              dimColor: !line.text,
              wrap: 'truncate-end',
            },
            line.text || ' ',
          ),
        )),
    ),
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
  const { stdout } = useStdout()
  const [state, dispatch] = useReducer(uiReducer, createInitialState(props.pipelineName))

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        const result = await runPipeline(props.pipelineName, props.runeworkDir, {
          options: props.pipelineOptions,
          resumeRunId: props.resumeRunId,
          log: () => {},
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

  const primaryJob = getPrimaryJob(jobs)
  const columns = stdout.columns ?? process.stdout.columns ?? 80
  const rows = stdout.rows ?? process.stdout.rows ?? 24
  const contentWidth = Math.max(20, columns - 4)
  const streamHeight = Math.max(
    MIN_STREAM_HEIGHT,
    rows - RESERVED_SCREEN_LINES,
  )
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
      { marginBottom: 0 },
      h(Text, { bold: true }, state.title),
      h(Text, {}, '  '),
      headerStatus,
      h(Text, { dimColor: true }, `  run ${state.runId ?? 'starting...'}`),
      state.resumed ? h(Text, { color: 'yellow' }, '  resumed') : null,
    ),
    h(
      Text,
      { dimColor: true, wrap: 'truncate-end' },
      wrapText(state.subtitle ?? ' ', Math.max(1, columns))[0] ?? ' ',
    ),
    renderActiveJob(primaryJob, contentWidth),
    renderStreamBox(primaryJob, contentWidth, streamHeight),
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
    incrementalRendering: false,
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
