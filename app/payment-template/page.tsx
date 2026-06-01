'use client'
import { useState } from 'react'

const DEFAULT = `Event Payment Template

Pay in Full

VIP (name + payment method)
1. Ethan (Stripe RM2899)
2. Nick (Stripe RM2899)
3. Melanie (Bank transfer RM2899)
4.
5.

General (name + payment method)
1. Steve Wong (Stripe RM2299)
2. Melanie (Bank transfer RM2299)
3. Jeremy | Daphne (TnG RM2299)
4.
5.
6.
7.
8.
9.
10.

👉 Pay deposit (name + action item)

1. Ralph - RM500 deposit, hold for next event after September, flying Netherlands summer
2. Jeremy | Daphne (TnG RM1799)(RM2000) 1VIP, 3General
3.`

export default function PaymentTemplatePage() {
  const [text, setText] = useState(DEFAULT)
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">📋 Payment Template</h1>
        <div className="flex gap-2">
          <button onClick={() => setText(DEFAULT)}
            className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 rounded-lg px-3 py-2">
            Reset
          </button>
          <button onClick={handleCopy}
            className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-5 py-2 rounded-lg text-sm">
            {copied ? '✅ Copied!' : '📋 Copy'}
          </button>
        </div>
      </div>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        className="w-full bg-transparent text-white text-sm leading-7 resize-none focus:outline-none"
        style={{ fontFamily: 'inherit', minHeight: '70vh' }}
        spellCheck={false}
      />
    </div>
  )
}
