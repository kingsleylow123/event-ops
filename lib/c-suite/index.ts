// AI C-Suite — public surface. Routes and the Jarvis tool import from '@/lib/c-suite'.

export { runBoard, ingestResult, formatForChat, type RunSummary } from './run'
export { DEPTS } from './types'
export { deliberate } from './board'
export { getCSuiteConfig, cSuiteEnabled, authMode, type CSuiteConfig } from './config'
export { getRecentRuns, getRunDetail, type RunRow } from './store'
export type { BoardResult, BoardMode, HeadBrief, Ruling, Challenge, Dept } from './types'
