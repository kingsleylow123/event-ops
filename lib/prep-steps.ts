// Single source of truth for the pre-workshop prep checklist.
// The /start page, prep API, Insights widget, and Jarvis /prep all read from
// here — adding, removing, or renaming a step is a one-file change.

export const PREP_STEP_KEYS = ['1', '2', '3', '4', '5', '6'] as const
export type PrepStepKey = (typeof PREP_STEP_KEYS)[number]

export const PREP_STEP_COUNT = PREP_STEP_KEYS.length

// Full labels (Insights per-step bars)
export const PREP_STEP_LABELS: Record<string, string> = {
  '1': 'Install Claude Code',
  '2': 'Get Claude Pro',
  '3': 'Install dev tools',
  '4': 'Fill survey',
  '5': 'Prepare data',
  '6': 'Show up 9:30am',
}

// Compact labels (Jarvis /prep on Telegram)
export const PREP_STEP_SHORT: Record<string, string> = {
  '1': 'Install',
  '2': 'Pro',
  '3': 'Dev tools',
  '4': 'Survey',
  '5': 'Data',
  '6': '9:30am',
}

export function emptySteps(): Record<string, boolean> {
  return Object.fromEntries(PREP_STEP_KEYS.map(k => [k, false]))
}

export function zeroStepCounts(): Record<string, number> {
  return Object.fromEntries(PREP_STEP_KEYS.map(k => [k, 0]))
}
