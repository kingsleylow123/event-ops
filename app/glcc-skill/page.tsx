'use client'
import { useState, Suspense } from 'react'
import { isValidPhone } from '@/lib/validate'

interface VerifyResult { ok: boolean; name?: string; startUrl?: string; skill?: string }

function SkillGate() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)

  const canSubmit = name.trim().length > 1 && email.includes('@') && isValidPhone(phone)

  async function verify() {
    if (!canSubmit || loading) return
    setLoading(true); setFailed(false)
    try {
      const r = await fetch('/api/glcc-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim() }),
      })
      const d: VerifyResult = await r.json()
      if (d.ok) setResult(d)
      else setFailed(true)
    } catch { setFailed(true) }
    setLoading(false)
  }

  function copySkill() {
    if (!result?.skill) return
    try { navigator.clipboard.writeText(result.skill); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ }
  }

  return (
    <div className="relative min-h-screen text-white" style={{ background: '#060606' }}>
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[680px] h-[680px] rounded-full blur-[120px] opacity-[0.20]"
          style={{ background: 'radial-gradient(circle, #6366f1 0%, transparent 65%)' }} />
        <div className="absolute bottom-0 right-0 w-[420px] h-[420px] rounded-full blur-[120px] opacity-[0.12]"
          style={{ background: 'radial-gradient(circle, #f59e0b 0%, transparent 65%)' }} />
      </div>

      <div className="max-w-lg mx-auto px-5 py-10">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🤖</div>
          <p className="text-[11px] font-semibold tracking-[0.15em] text-indigo-300/90 uppercase mb-2">Go Live Claude Challenge</p>
          <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight">Meet Kingsley AI</h1>
          <p className="text-zinc-400 text-[14px] mt-3 leading-relaxed"><span className="text-white font-medium">Kingsley AI</span> sets up every account for you, click-by-click in your browser. This is for <span className="text-amber-300 font-medium">paid attendees</span> — confirm your seat to unlock it.</p>
        </div>

        {!result ? (
          <div className="rounded-[22px] border border-white/[0.08] p-5 space-y-3"
            style={{ background: 'rgba(255,255,255,0.035)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
            <Field label="Full name" value={name} onChange={setName} placeholder="Your name" type="text" />
            <Field label="Email" value={email} onChange={setEmail} placeholder="you@email.com" type="email" />
            <Field label="Phone (WhatsApp)" value={phone} onChange={setPhone} placeholder="e.g. 0123456789" type="tel" />
            {failed && (
              <p className="text-[13px] text-red-300 leading-relaxed">
                We couldn&apos;t find a <b>paid</b> Go Live Claude Challenge seat for those details. Just paid? Give it a few minutes, double-check the email/phone you registered with, or message the team.
              </p>
            )}
            <button onClick={verify} disabled={!canSubmit || loading}
              className="w-full mt-1 disabled:opacity-40 text-black font-semibold rounded-2xl py-3.5 text-sm transition-all"
              style={{ background: 'linear-gradient(135deg, #6366f1, #818cf8)' }}>
              {loading ? 'Checking…' : '🔓 Unlock my setup co-pilot'}
            </button>
            <p className="text-[11px] text-zinc-600 text-center leading-relaxed">Your details are only used to confirm your seat. You&apos;ll never be asked for a password or API key here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-[22px] border border-emerald-500/25 p-5 text-center"
              style={{ background: 'rgba(16,185,129,0.06)' }}>
              <div className="text-3xl mb-1">✅</div>
              <div className="text-lg font-bold">Welcome, {result.name}!</div>
              <div className="text-[13px] text-zinc-400 mt-1">You&apos;re in. Here&apos;s Kingsley AI 👇</div>
            </div>

            <div className="rounded-[22px] border border-white/[0.08] p-4"
              style={{ background: 'rgba(255,255,255,0.035)' }}>
              <div className="text-sm font-semibold mb-1">How to use it (2 steps)</div>
              <ol className="text-[13px] text-zinc-400 leading-relaxed list-decimal list-inside space-y-1 mb-3">
                <li>Open <b className="text-zinc-200">Claude Code</b> on your laptop.</li>
                <li>Paste the whole thing below and press Enter. Kingsley AI takes over from there.</li>
              </ol>
              <textarea readOnly value={result.skill ?? ''}
                className="w-full h-44 text-[11px] font-mono text-zinc-300 bg-black/40 border border-white/10 rounded-xl p-3 resize-none" />
              <button onClick={copySkill}
                className="w-full mt-3 text-black font-semibold rounded-2xl py-3 text-sm transition-all"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #D4684A)' }}>
                {copied ? '✅ Copied — paste into Claude Code' : '📋 Copy Kingsley AI'}
              </button>
              {result.startUrl && (
                <a href={result.startUrl} target="_blank" rel="noopener noreferrer"
                  className="block text-center text-[13px] text-indigo-300 hover:text-indigo-200 mt-3">
                  → Or open your checklist and do it yourself
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type: string
}) {
  return (
    <label className="block">
      <span className="text-[12px] text-zinc-500">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={type}
        className="w-full mt-1 bg-black/40 border border-white/15 rounded-xl px-3.5 py-3 text-white text-sm focus:outline-none focus:border-indigo-500/60" />
    </label>
  )
}

export default function GlccSkillPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-black"><div className="text-zinc-500">Loading…</div></div>}>
      <SkillGate />
    </Suspense>
  )
}
