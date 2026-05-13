'use client'
import { useEffect, useState } from 'react'
import type { Event, ChecklistItem, ChecklistStatus } from '@/lib/supabase'
import { CHECKLIST_CATEGORIES, toWhatsApp } from '@/lib/supabase'

const STATUS_STYLES: Record<ChecklistStatus, string> = {
  pending: 'bg-zinc-800 text-zinc-400',
  in_progress: 'bg-purple-900/40 text-purple-400 border border-purple-800',
  done: 'bg-green-900/40 text-green-400 border border-green-800',
}

const NEXT_STATUS: Record<ChecklistStatus, ChecklistStatus> = {
  pending: 'in_progress',
  in_progress: 'done',
  done: 'pending',
}

export default function ChecklistPage() {
  const [event, setEvent] = useState<Event | null>(null)
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    category: CHECKLIST_CATEGORIES[0],
    item: '', pic_name: '', pic_phone: '', due_date: '', notes: '',
  })

  async function loadData() {
    const evRes = await fetch('/api/events')
    const events: Event[] = await evRes.json()
    const active = events.find(e => e.is_active) ?? null
    setEvent(active)
    if (active) {
      const res = await fetch(`/api/checklist?event_id=${active.id}`)
      setItems(await res.json())
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  async function cycleStatus(it: ChecklistItem) {
    const next = NEXT_STATUS[it.status]
    await fetch('/api/checklist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: it.id, status: next }),
    })
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, status: next } : x))
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this item?')) return
    await fetch(`/api/checklist?id=${id}`, { method: 'DELETE' })
    setItems(prev => prev.filter(x => x.id !== id))
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault()
    if (!event) return
    const res = await fetch('/api/checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, event_id: event.id }),
    })
    const newItem = await res.json()
    setItems(prev => [...prev, newItem])
    setForm({ category: CHECKLIST_CATEGORIES[0], item: '', pic_name: '', pic_phone: '', due_date: '', notes: '' })
    setShowForm(false)
  }

  const grouped = CHECKLIST_CATEGORIES.reduce<Record<string, ChecklistItem[]>>((acc, cat) => {
    acc[cat] = items.filter(i => i.category === cat)
    return acc
  }, {})

  // also handle any custom categories
  const extraCats = [...new Set(items.map(i => i.category))].filter(c => !CHECKLIST_CATEGORIES.includes(c))
  extraCats.forEach(cat => { grouped[cat] = items.filter(i => i.category === cat) })

  const allCategories = [...CHECKLIST_CATEGORIES, ...extraCats]

  if (loading) return <div className="text-zinc-500 mt-20 text-center">Loading...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Event Checklist</h1>
          {event && <p className="text-sm text-zinc-400">{event.name}</p>}
        </div>
        <button onClick={() => setShowForm(s => !s)} disabled={!event}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm px-4 py-2 rounded-lg">
          + Add Item
        </button>
      </div>

      {/* Add Item Form */}
      {showForm && (
        <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
          <form onSubmit={addItem} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                {CHECKLIST_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="custom">Other…</option>
              </select>
              <input required value={form.item} onChange={e => setForm(f => ({ ...f, item: e.target.value }))}
                placeholder="Task *" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input value={form.pic_name} onChange={e => setForm(f => ({ ...f, pic_name: e.target.value }))}
                placeholder="PIC Name" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
              <input value={form.pic_phone} onChange={e => setForm(f => ({ ...f, pic_phone: e.target.value }))}
                placeholder="PIC Phone (e.g. 0123456789)" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Notes" className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm" />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded-lg text-sm">Add Item</button>
              <button type="button" onClick={() => setShowForm(false)} className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Grouped checklist */}
      {allCategories.map(cat => {
        const catItems = grouped[cat] ?? []
        const done = catItems.filter(i => i.status === 'done').length
        return (
          <div key={cat} className="bg-[#111] border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="font-semibold text-sm">{cat}</h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-500">{done}/{catItems.length} done</span>
                {catItems.length > 0 && (
                  <div className="w-24 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all"
                      style={{ width: `${catItems.length ? (done / catItems.length) * 100 : 0}%` }} />
                  </div>
                )}
              </div>
            </div>
            {catItems.length === 0 ? (
              <p className="text-zinc-600 text-sm px-5 py-4">No items yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-600 text-xs border-b border-zinc-900">
                    <th className="px-5 py-2">Task</th>
                    <th className="px-5 py-2">PIC</th>
                    <th className="px-5 py-2">Due</th>
                    <th className="px-5 py-2">Status</th>
                    <th className="px-5 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {catItems.map(it => {
                    const waUrl = toWhatsApp(it.pic_phone)
                    return (
                      <tr key={it.id} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                        <td className="px-5 py-3">
                          <span className={it.status === 'done' ? 'line-through text-zinc-500' : ''}>{it.item}</span>
                          {it.notes && <div className="text-xs text-zinc-600 mt-0.5">{it.notes}</div>}
                        </td>
                        <td className="px-5 py-3">
                          {it.pic_name ? (
                            <div className="flex items-center gap-2">
                              <span className="text-zinc-300">{it.pic_name}</span>
                              {waUrl && (
                                <a href={waUrl} target="_blank" rel="noopener noreferrer"
                                  className="text-green-400 hover:text-green-300" title="WhatsApp PIC">💬</a>
                              )}
                            </div>
                          ) : <span className="text-zinc-600">—</span>}
                        </td>
                        <td className="px-5 py-3 text-zinc-400 text-xs">
                          {it.due_date ? new Date(it.due_date).toLocaleDateString('en-MY', { dateStyle: 'medium' }) : '—'}
                        </td>
                        <td className="px-5 py-3">
                          <button onClick={() => cycleStatus(it)}
                            className={`text-xs px-2 py-1 rounded-full font-medium cursor-pointer hover:opacity-80 ${STATUS_STYLES[it.status]}`}>
                            {it.status.replace('_', ' ')}
                          </button>
                        </td>
                        <td className="px-5 py-3">
                          <button onClick={() => deleteItem(it.id)} className="text-zinc-600 hover:text-red-400 text-xs">✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )
      })}

      {!event && (
        <div className="text-center text-zinc-500 py-20">No active event. Create one first.</div>
      )}
    </div>
  )
}
