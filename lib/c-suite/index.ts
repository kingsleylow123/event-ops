// AI C-Suite — public surface. Routes, the Telegram webhook, and the Jarvis tool
// import from '@/lib/c-suite'.

export { runBoard, ingestResult, measureOutcomes, formatForChat, type RunSummary } from './run'
export { DEPTS } from './types'
export { deliberate } from './board'
export { getCSuiteConfig, cSuiteEnabled, authMode, ingestToken, type CSuiteConfig } from './config'
export { getRecentRuns, getRunDetail, transitionDecision, type RunRow } from './store'
export { handleCSuiteCallback } from './telegram-cards'
export { normalizeBoardResult } from './ingest'
export type { BoardResult, BoardMode, HeadBrief, Ruling, Challenge, Dept, DecisionStatus, Prediction } from './types'