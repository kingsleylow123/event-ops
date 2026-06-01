'use client'
import { useState } from 'react'

type Row = { name: string; method: string; amount: string; notes: string }
type Section = { id: string; label: string; color: string; ticket: string; price: string; rows: Row[] }

const emptyRow = (): Row => ({ name: '', method: '', amount: '', notes: '' })

const DEFAULT_SECTIONS: Section[] = [
  {
    id: 'vip', label: 'VIP', color: 'text-blue-400', ticket: 'VIP', price: 'RM2,899',
    rows: [
      { name: 'Ethan', method: 'Stripe', amount: 'RM2,899', notes: '' },
      { name: 'Nick', method: 'Stripe', amount: 'RM2,899', notes: '' },
      { name: 'Melanie', method: 'Bank Transfer', amount: 'RM2,899', notes: '' },
      emptyRow(), emptyRow(),
    ],
  },
  {
    id: 'general', label: 'General', color: 'text-green-400', ticket: 'General', price: 'RM2,299',
    rows: [
      { name: 'Steve Wong', method: 'Stripe', amount: 'RM2,299', notes: '' },
      { name: 'Melanie', method: 'Bank Transfer', amount: 'RM2,299', notes: '' },
      { name: 'Jeremy | Daphne', method: 'TnG', amount: 'RM2,299', notes: '' },
      emptyRow(), emptyRow(),
    ],
  },
  {
    id: 'deposit', label: 'Pay Deposit', color: 'text-orange-400', ticket: 'Deposit', price: '',
    rows: [
      { name: 'Ralph', method: '', amount: 'RM500', notes: 'Next event after Sep, flying Netherlands' },
      { name: 'Jeremy | Daphne', method: 'TnG', amount: 'RM1,799', notes: 'Balance RM2,000 · 1 VIP + 3 General' },
      emptyRow(),
    ],
  },
]

const COLORS = ['text-blue-400', 'text-green-400', 'text-orange-400', 'text-pink-400', 'text-purple-400', 'text-sky-400']

function EditableTable({ rows, setRows }: { rows: Row[], setRows: (r: Row[]) => void }) {
  function update(i: number, key: keyof Row, val: string) {
    setRows(rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r))
  }
  function removeRow(i: number) { setRows(rows.filter((_, idx) => idx !== i)) }
  const inp = 'bg-transparent text-white text-sm w-full focus:outline-none border-b border-transparent focus:border-zinc-600'
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
          <th className="pb-2 pr-3 w-6">#</th>
          <th className="pb-2 pr-3">Name</th>
          <th className="pb-2 pr-3">Method</th>
          <th className="pb-2 pr-3">Amount</th>
          <th className="pb-2 pr-3">Notes</th>
          <th className="pb-2 w-4"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-zinc-900 group">
            <td className="py-2 pr-3 text-zinc-600">{i + 1}</td>
            <td className="py-2 pr-3"><input value={r.name} onChange={e => update(i, 'name', e.target.value)} className={inp} /></td>
            <td className="py-2 pr-3"><input value={r.method} onChange={e => update(i, 'method', e.target.value)} className={inp} /></td>
            <td className="py-2 pr-3"><input value={r.amount} onChange={e => update(i, 'amount', e.target.value)} className={`${inp} text-amber-400 font-semibold`} /></td>
            <td className="py-2 pr-3"><input value={r.notes} onChange={e => update(i, 'notes', e.target.value)} className={`${inp} text-zinc-400`} /></td>
            <td className="py-2 text-center">
              <button onClick={() => removeRow(i)} className="text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs">✕</button>
            </td>
          </tr>
        ))}
        <tr>
          <td colSpan={6} className="pt-2">
            <button onClick={() => setRows([...rows, emptyRow()])} className="text-xs text-zinc-600 hover:text-amber-400">+ Add row</button>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

let nextId = 100

export default function PaymentTemplatePage() {
  const [sections, setSections] = useState<Section[]>(DEFAULT_SECTIONS)

  function updateSection(id: string, patch: Partial<Section>) {
    setSections(s => s.map(sec => sec.id === id ? { ...sec, ...patch } : sec))
  }

  function addCustom() {
    const colorIdx = sections.length % COLORS.length
    const id = `custom_${++nextId}`
    setSections(s => [...s, {
      id, label: 'Custom', color: COLORS[colorIdx], ticket: 'Custom', price: '',
      rows: [emptyRow(), emptyRow(), emptyRow()],
    }])
  }

  function removeSection(id: string) {
    setSections(s => s.filter(sec => sec.id !== id))
  }

  function sectionTotal(sec: Section) {
    return sec.rows.reduce((sum, r) => sum + (parseFloat(r.amount.replace(/[^\d.]/g, '')) || 0), 0)
  }

  const grandTotal = sections.reduce((sum, sec) => sum + sectionTotal(sec), 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">📋 Payment Template</h1>
        <div className="flex gap-2 flex-wrap">
          <button onClick={addCustom}
            className="bg-zinc-800 hover:bg-zinc-700 text-white text-sm px-4 py-2 rounded-lg font-medium">
            + Custom Ticket
          </button>
          <button onClick={() => setSections(DEFAULT_SECTIONS)}
            className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 rounded-lg px-3 py-2">
            Reset
          </button>
        </div>
      </div>

      {sections.map(sec => (
        <div key={sec.id} className="bg-[#111] border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Editable label */}
              <input
                value={sec.label}
                onChange={e => updateSection(sec.id, { label: e.target.value })}
                className={`font-bold uppercase tracking-wider text-sm bg-transparent focus:outline-none border-b border-transparent focus:border-zinc-600 ${sec.color}`}
              />
              {/* Editable ticket + price */}
              <span className="text-zinc-600 text-xs">|</span>
              <input
                value={sec.ticket}
                onChange={e => updateSection(sec.id, { ticket: e.target.value })}
                placeholder="Ticket type"
                className="text-xs text-zinc-400 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 focus:outline-none w-28"
              />
              <input
                value={sec.price}
                onChange={e => updateSection(sec.id, { price: e.target.value })}
                placeholder="Default price"
                className="text-xs text-zinc-400 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 focus:outline-none w-24"
              />
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm font-bold text-amber-400">RM {sectionTotal(sec).toLocaleString()}</p>
              {!['vip','general','deposit'].includes(sec.id) && (
                <button onClick={() => removeSection(sec.id)} className="text-xs text-zinc-600 hover:text-red-400">✕ Remove</button>
              )}
            </div>
          </div>
          <EditableTable
            rows={sec.rows}
            setRows={rows => updateSection(sec.id, { rows })}
          />
        </div>
      ))}

      {/* Total */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-5 py-4 flex justify-between items-center">
        <p className="font-bold text-amber-400">💰 TOTAL COLLECTED</p>
        <p className="text-2xl font-black text-amber-400">RM {grandTotal.toLocaleString()}</p>
      </div>
    </div>
  )
}
