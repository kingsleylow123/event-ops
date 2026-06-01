'use client'
import { useState } from 'react'

type Row = { name: string; method: string; amount: string; notes: string }

const DEFAULT_VIP: Row[] = [
  { name: 'Ethan', method: 'Stripe', amount: 'RM2,899', notes: '' },
  { name: 'Nick', method: 'Stripe', amount: 'RM2,899', notes: '' },
  { name: 'Melanie', method: 'Bank Transfer', amount: 'RM2,899', notes: '' },
  { name: '', method: '', amount: '', notes: '' },
  { name: '', method: '', amount: '', notes: '' },
]

const DEFAULT_GEN: Row[] = [
  { name: 'Steve Wong', method: 'Stripe', amount: 'RM2,299', notes: '' },
  { name: 'Melanie', method: 'Bank Transfer', amount: 'RM2,299', notes: '' },
  { name: 'Jeremy | Daphne', method: 'TnG', amount: 'RM2,299', notes: '' },
  { name: '', method: '', amount: '', notes: '' },
  { name: '', method: '', amount: '', notes: '' },
]

const DEFAULT_DEP: Row[] = [
  { name: 'Ralph', method: '', amount: 'RM500', notes: 'Next event after Sep, flying Netherlands' },
  { name: 'Jeremy | Daphne', method: 'TnG', amount: 'RM1,799', notes: 'Balance RM2,000 · 1 VIP + 3 General' },
  { name: '', method: '', amount: '', notes: '' },
]

function EditableTable({ rows, setRows, color }: { rows: Row[], setRows: (r: Row[]) => void, color: string }) {
  function update(i: number, key: keyof Row, val: string) {
    const next = rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r)
    setRows(next)
  }
  const inputClass = 'bg-transparent text-white text-sm w-full focus:outline-none border-b border-transparent focus:border-zinc-600'
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={`text-left text-xs border-b border-zinc-800 ${color}`}>
          <th className="pb-2 pr-3 w-6">#</th>
          <th className="pb-2 pr-3">Name</th>
          <th className="pb-2 pr-3">Method</th>
          <th className="pb-2 pr-3">Amount</th>
          <th className="pb-2">Notes</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-zinc-900">
            <td className="py-2 pr-3 text-zinc-600">{i + 1}</td>
            <td className="py-2 pr-3"><input value={r.name} onChange={e => update(i, 'name', e.target.value)} className={inputClass} /></td>
            <td className="py-2 pr-3"><input value={r.method} onChange={e => update(i, 'method', e.target.value)} className={inputClass} /></td>
            <td className="py-2 pr-3"><input value={r.amount} onChange={e => update(i, 'amount', e.target.value)} className={`${inputClass} text-amber-400 font-semibold`} /></td>
            <td className="py-2"><input value={r.notes} onChange={e => update(i, 'notes', e.target.value)} className={`${inputClass} text-zinc-400`} /></td>
          </tr>
        ))}
        <tr>
          <td colSpan={5} className="pt-2">
            <button onClick={() => setRows([...rows, { name: '', method: '', amount: '', notes: '' }])}
              className="text-xs text-zinc-600 hover:text-amber-400">+ Add row</button>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

export default function PaymentTemplatePage() {
  const [vip, setVip] = useState<Row[]>(DEFAULT_VIP)
  const [gen, setGen] = useState<Row[]>(DEFAULT_GEN)
  const [dep, setDep] = useState<Row[]>(DEFAULT_DEP)

  const vipTotal = vip.reduce((s, r) => s + (parseFloat(r.amount.replace(/[^\d.]/g, '')) || 0), 0)
  const genTotal = gen.reduce((s, r) => s + (parseFloat(r.amount.replace(/[^\d.]/g, '')) || 0), 0)
  const depTotal = dep.reduce((s, r) => s + (parseFloat(r.amount.replace(/[^\d.]/g, '')) || 0), 0)

  function reset() { setVip(DEFAULT_VIP); setGen(DEFAULT_GEN); setDep(DEFAULT_DEP) }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">📋 Payment Template</h1>
        <button onClick={reset} className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 rounded-lg px-3 py-2">Reset</button>
      </div>

      {/* VIP */}
      <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
        <div className="flex justify-between items-center mb-4">
          <p className="text-sm font-bold text-blue-400 uppercase tracking-wider">🔵 VIP</p>
          <p className="text-sm font-bold text-amber-400">RM {vipTotal.toLocaleString()}</p>
        </div>
        <EditableTable rows={vip} setRows={setVip} color="text-blue-400" />
      </div>

      {/* General */}
      <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
        <div className="flex justify-between items-center mb-4">
          <p className="text-sm font-bold text-green-400 uppercase tracking-wider">🟢 General</p>
          <p className="text-sm font-bold text-amber-400">RM {genTotal.toLocaleString()}</p>
        </div>
        <EditableTable rows={gen} setRows={setGen} color="text-green-400" />
      </div>

      {/* Deposit */}
      <div className="bg-[#111] border border-zinc-800 rounded-xl p-5">
        <div className="flex justify-between items-center mb-4">
          <p className="text-sm font-bold text-orange-400 uppercase tracking-wider">👉 Pay Deposit</p>
          <p className="text-sm font-bold text-amber-400">RM {depTotal.toLocaleString()} collected</p>
        </div>
        <EditableTable rows={dep} setRows={setDep} color="text-orange-400" />
      </div>

      {/* Total */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-5 py-4 flex justify-between items-center">
        <p className="font-bold text-amber-400">💰 TOTAL COLLECTED</p>
        <p className="text-2xl font-black text-amber-400">RM {(vipTotal + genTotal + depTotal).toLocaleString()}</p>
      </div>
    </div>
  )
}
