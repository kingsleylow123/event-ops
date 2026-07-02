// AI C-Suite — per-head memory (the "each head has its OWN memory" requirement).
// Thin formatting layer over store: recall past learnings for a head's prompt, and
// remember a distilled learning after each run. (agent_id scope = the dept.)

import type { Dept } from './types'
import { loadHeadMemory, saveHeadMemory } from './store'

export async function recallHeadMemory(dept: Dept): Promise<string> {
  const items = await loadHeadMemory(dept)
  return items.length ? items.map(m => `- ${m}`).join('\n') : '(no prior memory yet)'
}

export async function rememberHeadLearning(dept: Dept, learning: string, runId: string | null, source = 'app'): Promise<void> {
  await saveHeadMemory(dept, learning, runId, source)
}
