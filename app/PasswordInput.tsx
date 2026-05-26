'use client'
import { useState } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
  minLength?: number
  autoComplete?: string
}

export default function PasswordInput({
  value, onChange, placeholder = 'Password', required, minLength, autoComplete,
}: Props) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative w-full">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-3 pr-10 py-2 text-white text-sm"
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-amber-400 text-xs px-1.5 py-1"
      >
        {visible ? '🙈' : '👁'}
      </button>
    </div>
  )
}
