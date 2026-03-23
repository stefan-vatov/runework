/**
 * Re-export ink + ink-spinner so pipelines can build TUIs
 * without declaring their own deps.
 *
 * Usage in pipelines:
 *   import { render, Text, Box, useApp } from 'hammerkit/ink'
 *   import { Spinner } from 'hammerkit/ink'
 */
export {
  render,
  renderToString,
  Box,
  Text,
  Static,
  Newline,
  Spacer,
  Transform,
  useApp,
  useInput,
  useStdin,
  useStdout,
  useStderr,
  useFocus,
  useFocusManager,
} from 'ink'

export type {
  Instance,
  BoxProps,
  TextProps,
  Key,
} from 'ink'

export { default as Spinner } from 'ink-spinner'
