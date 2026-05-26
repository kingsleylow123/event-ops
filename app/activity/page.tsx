'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Event, TeamRole } from '@/lib/supabase'

interface WeeklyActivity {
  id: string
  person_name: string
  week_start: string  // YYYY-MM-DD
  active: boolean
}

interface PersonRow {
  name: string
  role: TeamRole | string
}

const WEEKS_TO_SHOW = 12

const ROLE_ORDER: (TeamRole | string)[] = ['facilitator', 'content_creator', 'videographer', 'speaker', 'other']

const ROLE_COLORS: Record<string, string> = {
  facilitator: 'border-emerald-500/30 bg-emerald-500/5',
  content_creator: 'border-pink-500/30 bg-pink-500/5',
  videographer: 'border-sky-500/30 bg-sky-500/5',
  speaker: 'border-amber-500/30 bg-amber-500/5',
  other: 'border-zinc-700',
}

const ROLE_LABEL_COLORS: Record<string, string> = {
  facilitator: 'text-emerald-400',
  content_creator: 'text-pink-400',
  videographer: 'text-sky-400',
  speaker: 'text-amber-400',
  other: 'text-zinc-400',
}

function mondayOf(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() // 0 = Sun, 1 = Mon, ...
  const offset = (day + 6) % 7 // Days since Monday
  d.setDate(d.getDate() - offset)
  return d
}

function toYMD(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fmtWeek(d: Date): { month: string; day: string } {
  return {
    month: d.toLocaleDateString('en-MY', { month: 'short' }),
    day: String(d.getDate()),
  }
}

function uniquePeople(events: Event[]): PersonRow[] {
  const seen = new Set<string>()
  const out: PersonRow[] = []
  for (const ev of events) {
    for (const m of ev.team ?? []) {
      const key = m.name.trim().toLowerCase()
      if (key && !seen.has(key)) {
        seen.add(key)
        out.push({ name: m.name, role: m.role })
      }
    }
  }
  // Sort: Huda first, then by role, then alphabetical
  return out.sort((a, b) => {
    const aHuda = a.name.toLowerCase() === 'huda'
    const bHuda = b.name.toLowerCase() === 'huda'
    if (aHuda && !bHuda) return -1
    if (bHuda && !aHuda) return 1
    const aRole = ROLE_ORDER.indexOf(a.role)
    const bRole = ROLE_ORDER.indexOf(b.role)
    if (aRole !== bRole) return (aRole === -1 ? 99 : aRole) - (bRole === -1 ? 99 : bRole)
    return a.name.localeCompare(b.name)
  })
}

export default function ActivityPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [activity, setActivity] = useState<WeeklyActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0) // weeks back from current week (0 = current)

  async function loadAll() {
    try {
      const [eRes, aRes] = await Promise.all([fetch('/api/events'), fetch('/api/activity')])
      if (eRes.ok) setEvents(await eRes.json())
      if (aRes.ok) setActivity(await aRes.json())
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  const people = useMemo(() => uniquePeople(events), [events])

  // Week dates to display, oldest → newest
  const weeks = useMemo(() => {
    const current = mondayOf(new Date())
    const arr: { date: Date; ymd: string }[] = []
    for (let i = WEEKS_TO_SHOW - 1; i >= 0; i--) {
      const d = new Date(current)
      d.setDate(current.getDate() - (i + offset) * 7)
      arr.push({ date: d, ymd: toYMD(d) })
    }
    return arr
  }, [offset])

  // Lookup: key `name|week_ymd` → true if active
  const activeSet = useMemo(() => {
    const s = new Set<string>()
    for (const a of activity) {
      if (a.active) s.add(`${a.person_name.toLowerCase()}|${a.week_start.slice(0, 10)}`)
    }
    return s
  }, [activity])

  function isActive(name: string, ymd: string): boolean {
    return activeSet.has(`${name.toLowerCase()}|${ymd}`)
  }

  async function toggle(name: string, ymd: string) {
    const currentlyActive = isActive(name, ymd)
    // Optimistic update
    if (currentlyActive) {
      setActivity(prev => prev.filter(a => !(a.person_name.toLowerCase() === name.toLowerCase() && a.week_start.slice(0, 10) === ymd)))
    } else {
      setActivity(prev => [{ id: `tmp-${Date.now()}`, person_name: name, week_start: ymd, active: true } as WeeklyActivity, ...prev])
    }
    await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_name: name, week_start: ymd, active: !currentlyActive }),
    })
  }

  // Per-person stats across ALL activity (not just visible window)
  function personStats(name: string) {
    // Build all weeks since the person's first record
    const personRecords = activity.filter(a => a.person_name.toLowerCase() === name.toLowerCase() && a.active)
    const total = personRecords.length
    // Current streak: consecutive weeks back from current week
    const current = mondayOf(new Date())
    let streak = 0
    for (let i = 0; i < 52; i++) {
      const d = new Date(current)
      d.setDate(current.getDate() - i * 7)
      const ymd = toYMD(d)
      if (isActive(name, ymd)) streak++
      else break
    }
    return { total, streak }
  }

  // Group people by role
  const groupedPeople = useMemo(() => {
    const groups: Record<string, PersonRow[]> = {}
    for (const p of people) {
      const r = p.role || 'other'
      if (!groups[r]) groups[r] = []
      groups[r].push(p)
    }
    return ROLE_ORDER.filter(r => groups[r]).map(r => ({ role: r, people: groups[r] }))
  }, [people])

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Activity</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Tick a box to mark someone showed up that week</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setOffset(o => o + 12)}
            className="text-xs border border-zinc-700 text-zinc-300 hover:border-amber-500/50 hover:text-amber-400 px-3 py-1.5 rounded-lg">
            ← Older
          </button>
          <button onClick={() => setOffset(0)} disabled={offset === 0}
            className="text-xs border border-zinc-700 text-zinc-300 hover:border-amber-500/50 hover:text-amber-400 disabled:opacity-30 px-3 py-1.5 rounded-lg">
            Today
          </button>
          <button onClick={() => setOffset(o => Math.max(0, o - 12))} disabled={offset === 0}
            className="text-xs border border-zinc-700 text-zinc-300 hover:border-amber-500/50 hover:text-amber-400 disabled:opacity-30 px-3 py-1.5 rounded-lg">
            Newer →
          </button>
        </div>
      </div>

      <div className="bg-[#111] border border-zinc-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-zinc-500 sticky left-0 bg-[#111] z-10">Name</th>
              {weeks.map(w => {
                const f = fmtWeek(w.date)
                const isThisWeek = offset === 0 && w === weeks[weeks.length - 1]
                return (
                  <th key={w.ymd} className={`px-2 py-2 text-center font-normal ${isThisWeek ? 'bg-amber-500/10' : ''}`}>
                    <div className="text-[10px] text-zinc-500 uppercase">{f.month}</div>
                    <div className={`text-xs ${isThisWeek ? 'text-amber-400 font-bold' : 'text-zinc-300'}`}>{f.day}</div>
                  </th>
                )
              })}
              <th className="px-3 py-2 text-center text-xs uppercase tracking-wider text-zinc-500">Total</th>
              <th className="px-3 py-2 text-center text-xs uppercase tracking-wider text-zinc-500">🔥</th>
            </tr>
          </thead>
          <tbody>
            {groupedPeople.map(group => (
              <>
                <tr key={`grp-${group.role}`} className={`${ROLE_COLORS[group.role]}`}>
                  <td colSpan={weeks.length + 3}
                    className={`px-4 py-2 text-xs uppercase tracking-wider font-semibold ${ROLE_LABEL_COLORS[group.role]} sticky left-0 z-10`}>
                    {group.role.toString().replace('_', ' ')} ({group.people.length})
                  </td>
                </tr>
                {group.people.map(p => {
                  const stats = personStats(p.name)
                  return (
                    <tr key={p.name} className="border-t border-zinc-900 hover:bg-zinc-900/30">
                      <td className="px-4 py-2 text-sm text-white sticky left-0 bg-[#111] z-10">{p.name}</td>
                      {weeks.map(w => {
                        const active = isActive(p.name, w.ymd)
                        return (
                          <td key={w.ymd} className="px-2 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => toggle(p.name, w.ymd)}
                              className={`w-7 h-7 rounded-md border transition-all ${
                                active
                                  ? 'bg-emerald-500 border-emerald-500 hover:bg-emerald-400 text-black font-bold'
                                  : 'border-zinc-700 hover:border-amber-500/50 hover:bg-amber-500/10'
                              }`}
                              aria-label={`${active ? 'Unmark' : 'Mark'} ${p.name} as active week of ${w.ymd}`}
                            >
                              {active ? '✓' : ''}
                            </button>
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-center text-sm font-mono text-white">{stats.total}</td>
                      <td className="px-3 py-2 text-center">
                        {stats.streak > 0 ? (
                          <span className="text-sm text-amber-400 font-semibold">🔥{stats.streak}</span>
                        ) : (
                          <span className="text-xs text-zinc-700">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </>
            ))}
            {groupedPeople.length === 0 && (
              <tr>
                <td colSpan={weeks.length + 3} className="text-center text-zinc-500 py-10">
                  No team members yet. Add some on the Claude Intern page first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-600 text-center">
        Each column = one week (starting Monday). Click a box to tick/untick. Streak = consecutive recent weeks ticked.
      </p>
    </div>
  )
}
