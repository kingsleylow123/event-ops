'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { TICKET_LABELS, type TicketType } from '@/lib/supabase'

type AttendeeLite = {
  id: string
  name: string
  ticket_type: TicketType
  payment_amount: number | null
  notes?: string | null
  email?: string | null
  stripe_session_id?: string | null
}

type LineItem = { desc: string; qty: string; unit: string }
type QuickItem = { desc: string; note: string; qty: string; price: string }
type RefundItem = { desc: string; ori: string; refund: string }
type Payment = { label: string; amount: string }

// ── Helpers ─────────────────────────────────────────────────────────────
function ordinalSuffix(n: number) {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'TH'
  switch (n % 10) {
    case 1: return 'ST'
    case 2: return 'ND'
    case 3: return 'RD'
    default: return 'TH'
  }
}
function formatDateParts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, (m || 1) - 1, d || 1)
  const day = date.getDate()
  const month = date.toLocaleString('en-US', { month: 'long' }).toUpperCase()
  return { day, suffix: ordinalSuffix(day), month, year: date.getFullYear() }
}
function todayIso() {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function num(v: string) {
  return parseFloat(String(v).replace(/[^\d.]/g, '')) || 0
}
function rm(n: number) {
  return `RM ${n.toLocaleString('en-MY', { maximumFractionDigits: 2 })}`
}
// Strip internal payment markers (e.g. "upgrade_payment") that can live in
// attendee notes or Stripe product names — they must never appear on a client invoice.
function cleanInvoiceText(s: string | null | undefined): string {
  return (s || '')
    .replace(/\bupgrade[_ ]payment\b/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*[·•,\-—]\s*$/, '')
    .trim()
}

// ── Main page ───────────────────────────────────────────────────────────
function InvoiceContent() {
  const params = useSearchParams()
  const modeParam = params.get('mode')
  const initialMode = (modeParam === 'balance' ? 'balance' : modeParam === 'refund' ? 'refund' : 'quick') as 'quick' | 'balance' | 'refund'
  const [mode, setMode] = useState<'quick' | 'balance' | 'refund'>(initialMode)

  // ── Shared
  const [name, setName] = useState(params.get('name') || 'CLIENT NAME')
  const [date, setDate] = useState(params.get('date') || todayIso())
  const dateParts = useMemo(() => formatDateParts(date), [date])
  const [companyName, setCompanyName] = useState('CMO Consulting Sdn. Bhd.')
  const [companyReg, setCompanyReg] = useState('202601024007 (1686104-X)')
  const [companyEmail, setCompanyEmail] = useState('claudemalaysiaofficial@gmail.com')
  const [companyPhone, setCompanyPhone] = useState('012-285 0125')
  const [bankName, setBankName] = useState('Maybank SME Biz')
  const [bankAccount, setBankAccount] = useState('5142 8090 1848')
  const [bankHolder, setBankHolder] = useState('Kingsley Low Yean Wee')
  // Invoice number — editable, remembered in the browser. Test-saving never changes it.
  const [invoiceNo, setInvoiceNo] = useState(
    () => (typeof window !== 'undefined' && localStorage.getItem('cmo_invoice_no')) || 'CMO-2026-0021',
  )
  const [issued, setIssued] = useState(false)

  // ── Quick mode — one row per ticket
  const [quickItems, setQuickItems] = useState<QuickItem[]>([
    {
      desc: cleanInvoiceText(params.get('desc')) || '[VIP] Claude Half Day Workshop',
      note: cleanInvoiceText(params.get('note')) || '[non refundable',
      qty: '1',
      price: params.get('amount') || '0',
    },
  ])
  const quickTotal = useMemo(
    () => quickItems.reduce((s, it) => s + num(it.qty) * num(it.price), 0),
    [quickItems],
  )

  // ── Balance mode
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { desc: '[General] Claude Half Day Workshop', qty: '1', unit: '0' },
  ])
  const [payments, setPayments] = useState<Payment[]>([])
  const subtotal = useMemo(
    () => lineItems.reduce((s, li) => s + num(li.qty) * num(li.unit), 0),
    [lineItems],
  )
  const totalPaid = useMemo(
    () => payments.reduce((s, p) => s + num(p.amount), 0),
    [payments],
  )
  const balanceDue = subtotal - totalPaid

  // ── Refund mode — each line shows the original price and the refund amount;
  // TOTAL REFUND sums the refund column (money returned to the client).
  const [refundItems, setRefundItems] = useState<RefundItem[]>([
    { desc: 'Partial refund — Claude Workshop', ori: '0', refund: '0' },
  ])
  const refundTotal = useMemo(
    () => refundItems.reduce((s, it) => s + num(it.refund), 0),
    [refundItems],
  )

  useEffect(() => {
    document.title = `Invoice - ${name}`
  }, [name])

  // Remember the invoice number across page reloads (browser-local)
  useEffect(() => {
    localStorage.setItem('cmo_invoice_no', invoiceNo)
  }, [invoiceNo])

  // Peek the next number from the database (draft, not consumed). Falls back
  // silently to the browser value if the DB isn't set up yet — nothing breaks.
  useEffect(() => {
    fetch('/api/invoice/number', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.next) { setInvoiceNo(d.next); setIssued(false) } })
      .catch(() => {})
  }, [])

  // ── PDF export
  const [exporting, setExporting] = useState(false)

  // ── Push to Bukku (writes a real sales invoice to the books)
  const [pushing, setPushing] = useState(false)
  const [pushMsg, setPushMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // ── Email invoice to client (attaches the same PDF as "Save as PDF")
  const [clientEmail, setClientEmail] = useState('')
  const [emailing, setEmailing] = useState(false)
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function pushToBukku() {
    const isBalance = mode === 'balance'
    const total = isBalance ? subtotal : quickTotal
    if (!name || name.trim().toUpperCase() === 'CLIENT NAME') {
      setPushMsg({ ok: false, text: 'Enter the client name first.' })
      return
    }
    if (total <= 0) {
      setPushMsg({ ok: false, text: 'Add a line with a non-zero amount first.' })
      return
    }
    const summary = isBalance
      ? `Create a Bukku invoice for ${name}: ${rm(subtotal)}` +
        (payments.length ? ` · ${payments.length} payment(s) · balance ${rm(Math.max(0, balanceDue))}` : '')
      : `Create a Bukku invoice for ${name}: ${rm(quickTotal)}`
    if (!window.confirm(`${summary}\n\nThis writes to your REAL Bukku books. Continue?`)) return

    setPushing(true)
    setPushMsg(null)
    try {
      const payload = isBalance
        ? {
            client_name: name,
            date,
            mode: 'balance' as const,
            lines: lineItems.map(li => ({ desc: li.desc, qty: num(li.qty), unit: num(li.unit) })),
            payments: payments.map(p => ({ label: p.label, amount: num(p.amount) })),
          }
        : {
            client_name: name,
            date,
            mode: 'quick' as const,
            lines: quickItems
              .filter(it => it.desc.trim() || num(it.price) !== 0)
              .map(it => ({ desc: it.desc, qty: num(it.qty) || 1, unit: num(it.price) })),
          }

      const res = await fetch('/api/bukku/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok && res.status !== 207) {
        setPushMsg({ ok: false, text: data.error ? `${data.error}${data.details ? ' — ' + data.details : ''}` : `Failed (${res.status})` })
      } else {
        const ref = data.bukku_invoice_number || data.bukku_invoice_id
        const bal = data.balance_due != null ? ` · balance due ${rm(data.balance_due)}` : ''
        setPushMsg({ ok: true, text: `✅ Booked in Bukku as ${ref}${bal}${data.partial ? ' (deposit needs a manual check)' : ''}` })
      }
    } catch (e) {
      setPushMsg({ ok: false, text: (e as Error).message })
    } finally {
      setPushing(false)
    }
  }

  // Shared PDF builder. action 'save' downloads it (📄 Save as PDF);
  // action 'datauri' returns the SAME PDF as a base64 data URI for emailing.
  // The captured invoice is byte-for-byte identical either way.
  async function renderPdf(action: 'save' | 'datauri'): Promise<string | undefined> {
    const el = document.getElementById('invoice-page-printable')
    if (!el) return

    const safeName = (name || 'Invoice').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-')

    // ── DIRECT DOM MUTATION on the live element.
    // html2pdf does its own pre-clone that strips/replaces things, so neither
    // onclone callbacks nor CSS classes survive reliably. We mutate the live
    // DOM, capture, then restore exactly. Wrapped in flushSync + try/finally
    // so we never leave the page in a broken state.
    flushSync(() => setExporting(true))

    type Swap = { node: Node; parent: Node; next: Node | null; replacement: Node }
    const swaps: Swap[] = []
    type StyleRevert = { el: HTMLElement; prop: string; old: string }
    const styleReverts: StyleRevert[] = []

    function setStyle(elem: HTMLElement, prop: string, value: string) {
      styleReverts.push({ el: elem, prop, old: elem.style.getPropertyValue(prop) })
      elem.style.setProperty(prop, value, 'important')
    }

    try {
      // 1. Replace inputs/textareas with plain spans/divs containing their value
      el.querySelectorAll('input, textarea').forEach(node => {
        const input = node as HTMLInputElement | HTMLTextAreaElement
        if (input.tagName === 'INPUT' && (input as HTMLInputElement).type === 'date') {
          setStyle(input, 'display', 'none')
          return
        }
        const cs = window.getComputedStyle(input)
        const inlineDisplay = input.style.display
        const isBlock = input.tagName === 'TEXTAREA' || inlineDisplay === 'block'
        const tag = isBlock ? 'div' : 'span'
        const replacement = document.createElement(tag) as HTMLElement
        replacement.textContent = input.value || ''
        const textAlign = input.style.textAlign || cs.textAlign
        // Billing name/address must stay in its column and wrap; other textareas
        // (line descriptions) fill their cell at 100%.
        const width = input.classList.contains('inv-name')
          ? '400px'
          : input.tagName === 'TEXTAREA' ? '100%' : 'auto'
        replacement.style.cssText =
          `display:${isBlock ? 'block' : 'inline-block'};` +
          `width:${width};` +
          `text-align:${textAlign};` +
          `font-family:${cs.fontFamily};` +
          `font-size:${cs.fontSize};` +
          `font-weight:${cs.fontWeight};` +
          `color:${cs.color};` +
          `letter-spacing:${cs.letterSpacing};` +
          `line-height:1.45;` +
          `white-space:pre-wrap;` +
          `word-break:break-word;` +
          `padding:0;margin:0;border:none;background:transparent;`
        const parent = input.parentNode!
        const next = input.nextSibling
        parent.replaceChild(replacement, input)
        swaps.push({ node: input, parent, next, replacement })
      })

      // 2. Hide every edit button + the X column
      el.querySelectorAll('.add-btn, .add-btn-small, .x-btn, .col-x').forEach(b => {
        setStyle(b as HTMLElement, 'display', 'none')
      })

      // 3. Wait one frame so layout settles before capture
      await new Promise(r => requestAnimationFrame(() => r(null)))

      const html2pdf = (await import('html2pdf.js')).default
      const worker = html2pdf()
        .set({
          margin: 0,
          filename: `Invoice-${safeName}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          // @ts-expect-error html2pdf supports `autoPaging` at runtime but the types miss it
          autoPaging: false,
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            width: 794,
            height: 1115,
            windowWidth: 794,
            windowHeight: 1115,
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['avoid-all'], avoid: '*' },
        })
        .from(el)

      if (action === 'datauri') {
        return (await worker.outputPdf('datauristring')) as string
      }
      await worker.save()
      return
    } finally {
      // Restore inputs/textareas — reverse order so siblings line up
      for (let i = swaps.length - 1; i >= 0; i--) {
        const { node, parent, replacement } = swaps[i]
        if (replacement.parentNode === parent) {
          parent.replaceChild(node, replacement)
        }
      }
      // Restore inline styles we changed
      styleReverts.forEach(({ el: e, prop, old }) => {
        if (old) e.style.setProperty(prop, old)
        else e.style.removeProperty(prop)
      })
      flushSync(() => setExporting(false))
    }
  }

  async function exportPDF() {
    await renderPdf('save')
  }

  async function emailInvoice() {
    const total = mode === 'balance' ? subtotal : mode === 'refund' ? refundTotal : quickTotal
    if (!name || name.trim().toUpperCase() === 'CLIENT NAME') {
      setEmailMsg({ ok: false, text: 'Enter the client name first.' })
      return
    }
    const to = clientEmail.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setEmailMsg({ ok: false, text: 'Enter a valid client email first.' })
      return
    }
    if (total <= 0) {
      setEmailMsg({ ok: false, text: 'Add a line with a non-zero amount first.' })
      return
    }
    if (!window.confirm(`Email this invoice to ${to}?`)) return

    setEmailing(true)
    setEmailMsg(null)
    try {
      // This is the real send — lock & log the invoice number now (once).
      // Test-saving (Save as PDF) never reaches here, so it never burns a number.
      if (!issued) {
        const issuedNo = await issueNumber(total)
        if (issuedNo) {
          flushSync(() => setInvoiceNo(issuedNo))
          setIssued(true)
        }
      }
      const dataUri = await renderPdf('datauri')
      if (!dataUri) {
        setEmailMsg({ ok: false, text: 'Could not generate the PDF.' })
        return
      }
      const base64 = dataUri.split(',')[1] || ''
      const safeName = (name || 'Invoice').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-')

      const res = await fetch('/api/invoice/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          client_name: name,
          filename: `Invoice-${safeName}.pdf`,
          pdf_base64: base64,
          company_name: companyName,
          company_email: companyEmail,
          company_phone: companyPhone,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        const reason = data.reason === 'no_key'
          ? 'Email not set up yet (RESEND_API_KEY missing).'
          : `Failed to send (${res.status})`
        setEmailMsg({ ok: false, text: data.error || reason })
      } else {
        setEmailMsg({ ok: true, text: `✅ Invoice emailed to ${to}` })
      }
    } catch (e) {
      setEmailMsg({ ok: false, text: (e as Error).message })
    } finally {
      setEmailing(false)
    }
  }

  // ── Attendee search
  const [attendees, setAttendees] = useState<AttendeeLite[]>([])
  const [query, setQuery] = useState('')
  const [showResults, setShowResults] = useState(false)
  const searchBoxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/attendees', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : []))
      .then((rows: AttendeeLite[]) => setAttendees(Array.isArray(rows) ? rows : []))
      .catch(() => setAttendees([]))
  }, [])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return attendees.filter(a => a.name?.toLowerCase().includes(q)).slice(0, 8)
  }, [attendees, query])

  async function pickAttendee(a: AttendeeLite) {
    const ticketLabel = TICKET_LABELS[a.ticket_type] || 'Ticket'
    setName(a.name)
    setClientEmail(a.email || '')
    setQuery('')
    setShowResults(false)

    // Try Stripe first for the real product name; fall back to template
    let stripeDesc: string | null = null
    if (a.stripe_session_id) {
      try {
        const r = await fetch(`/api/stripe/product?session_id=${encodeURIComponent(a.stripe_session_id)}`, { cache: 'no-store' })
        if (r.ok) {
          const j = await r.json()
          stripeDesc = (j.product_name as string | null) || null
        }
      } catch { /* fall through to template */ }
    }
    const fallbackDesc = `[${ticketLabel}] Claude Workshop`
    const finalDesc = cleanInvoiceText(stripeDesc) || fallbackDesc

    if (mode === 'quick') {
      // Add as a ticket row, dropping the empty placeholder row if present.
      // Stripe product name already contains "(non-refundable)" — skip the note line
      setQuickItems(items => [
        ...items.filter(it => it.desc.trim() || num(it.price) !== 0),
        {
          desc: finalDesc,
          // Never pull the attendee's notes onto the invoice — they hold internal
          // markers (e.g. upgrade_payment). Use the standard non-refundable line.
          note: stripeDesc ? '' : '[non refundable',
          qty: '1',
          price: String(a.payment_amount ?? 0),
        },
      ])
    } else if (mode === 'refund') {
      // Auto-fill a refund row: Original Price = what they paid, Refund defaults
      // to the same (full refund) — edit it down for a partial. Drop placeholder rows.
      const paid = String(a.payment_amount ?? 0)
      setRefundItems(items => [
        ...items.filter(it => num(it.ori) !== 0 || num(it.refund) !== 0),
        { desc: finalDesc, ori: paid, refund: paid },
      ])
    } else {
      // Add as a line item in balance mode
      setLineItems(items => [
        ...items.filter(li => li.desc || li.unit !== '0'),
        { desc: finalDesc, qty: '1', unit: String(a.payment_amount ?? 0) },
      ])
    }
  }

  // ── Quick ticket helpers
  function updateQuickItem(i: number, patch: Partial<QuickItem>) {
    setQuickItems(items => items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  }
  function removeQuickItem(i: number) {
    // Keep at least one row so the table never disappears
    setQuickItems(items => (items.length === 1 ? items : items.filter((_, idx) => idx !== i)))
  }
  function addQuickItem() {
    setQuickItems(items => [...items, { desc: '', note: '', qty: '1', price: '0' }])
  }

  // ── Refund line helpers
  function updateRefund(i: number, patch: Partial<RefundItem>) {
    setRefundItems(items => items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  }
  function removeRefund(i: number) {
    setRefundItems(items => (items.length === 1 ? items : items.filter((_, idx) => idx !== i)))
  }
  function addRefund() {
    setRefundItems(items => [...items, { desc: '', ori: '0', refund: '0' }])
  }

  // Lock & log the invoice number (issue). Returns the official number, or null
  // if the DB isn't set up yet — the caller proceeds gracefully with the draft.
  async function issueNumber(total: number): Promise<string | null> {
    try {
      const res = await fetch('/api/invoice/number', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: name, amount: total, date }),
      })
      const d = await res.json().catch(() => ({}))
      return res.ok && d.invoice_no ? (d.invoice_no as string) : null
    } catch {
      return null
    }
  }

  // ── Line items + payments helpers
  function updateLine(i: number, patch: Partial<LineItem>) {
    setLineItems(items => items.map((li, idx) => (idx === i ? { ...li, ...patch } : li)))
  }
  function removeLine(i: number) {
    setLineItems(items => items.filter((_, idx) => idx !== i))
  }
  function addLine() {
    setLineItems(items => [...items, { desc: '', qty: '1', unit: '0' }])
  }
  function updatePayment(i: number, patch: Partial<Payment>) {
    setPayments(ps => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }
  function removePayment(i: number) {
    setPayments(ps => ps.filter((_, idx) => idx !== i))
  }
  function addPayment() {
    setPayments(ps => [...ps, { label: 'TnG · Deposit', amount: '0' }])
  }

  return (
    <>
      <style>{INVOICE_CSS}</style>

      <div className="invoice-shell">
        <div className="invoice-toolbar">
          {/* Search */}
          <div ref={searchBoxRef} style={{ position: 'relative', minWidth: 260 }}>
            <input
              type="text"
              placeholder="🔎 Search attendee by name…"
              value={query}
              onChange={e => { setQuery(e.target.value); setShowResults(true) }}
              onFocus={() => setShowResults(true)}
              className="search-input"
            />
            {showResults && query && (
              <div className="search-results">
                {matches.length === 0 && <div className="no-match">No attendee found</div>}
                {matches.map(a => (
                  <button key={a.id} onClick={() => pickAttendee(a)} className="match-row">
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                      {TICKET_LABELS[a.ticket_type] || a.ticket_type} · RM {a.payment_amount ?? 0}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Mode tabs */}
          <div className="mode-tabs">
            <button
              className={`mode-tab ${mode === 'quick' ? 'active' : ''}`}
              onClick={() => setMode('quick')}
            >
              1 · Quick Invoice
            </button>
            <button
              className={`mode-tab ${mode === 'balance' ? 'active' : ''}`}
              onClick={() => setMode('balance')}
            >
              2 · Balance Invoice
            </button>
            <button
              className={`mode-tab ${mode === 'refund' ? 'active' : ''}`}
              onClick={() => setMode('refund')}
            >
              3 · Refund
            </button>
          </div>

          <button onClick={exportPDF}>📄 Save as PDF</button>
          {mode !== 'refund' && (
            <button onClick={pushToBukku} disabled={pushing}>
              {pushing ? '⏳ Pushing…' : '📒 Push to Bukku'}
            </button>
          )}
          <button className="secondary" onClick={() => window.close()}>Close</button>

          {/* ── Email invoice to client ── */}
          <div className="email-row">
            <input
              type="email"
              placeholder="✉️ Client email…"
              value={clientEmail}
              onChange={e => setClientEmail(e.target.value)}
              className="search-input"
              style={{ maxWidth: 280 }}
            />
            <button onClick={emailInvoice} disabled={emailing}>
              {emailing ? '⏳ Sending…' : '✉️ Send invoice'}
            </button>
          </div>

          {pushMsg && (
            <div
              style={{
                flexBasis: '100%',
                textAlign: 'center',
                fontSize: 13,
                fontWeight: 600,
                color: pushMsg.ok ? '#2c7a2f' : '#c0271f',
              }}
            >
              {pushMsg.text}
            </div>
          )}

          {emailMsg && (
            <div
              style={{
                flexBasis: '100%',
                textAlign: 'center',
                fontSize: 13,
                fontWeight: 600,
                color: emailMsg.ok ? '#2c7a2f' : '#c0271f',
              }}
            >
              {emailMsg.text}
            </div>
          )}
        </div>

        {/* ── Invoice page (A4) ── */}
        <div id="invoice-page-printable" className={`invoice-page ${exporting ? 'is-exporting' : ''}`}>
          <div className="red-stripe">
            <div className="seg-top" />
            <div className="seg-gap" />
            <div className="seg-bottom" />
          </div>

          <div className="invoice-content">
            <div className="inv-header">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/cmo-logo-orange.png" alt="CMO Consulting Sdn. Bhd." className="inv-logo-img" />
              <div style={{ textAlign: 'right' }}>
                <div className="inv-title">INVOICE</div>
                <div style={{ marginTop: 14 }}>
                  <input
                    className="inv-edit"
                    value={invoiceNo}
                    onChange={e => setInvoiceNo(e.target.value)}
                    style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, letterSpacing: 1, color: '#F26522', display: 'block', marginLeft: 'auto', minWidth: 150 }}
                  />
                </div>
              </div>
            </div>

            <div className="inv-divider" />

            <div className="inv-billing">
              <div>
                <div className="inv-lbl">Invoice To</div>
                <textarea
                  className="inv-edit inv-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  rows={5}
                  style={{ minWidth: 200, width: 380, resize: 'both', fontFamily: 'inherit', lineHeight: 1.5 }}
                />
              </div>
              <div className="inv-company-right">
                <div className="inv-lbl">Company:</div>
                <input
                  className="inv-edit inv-company-name"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  style={{ textAlign: 'right', minWidth: 180 }}
                />
                <input
                  className="inv-edit inv-company-reg"
                  value={companyReg}
                  onChange={e => setCompanyReg(e.target.value)}
                  style={{ textAlign: 'right', minWidth: 160, display: 'block', marginLeft: 'auto', fontSize: 12, color: '#777' }}
                />
                <div className="inv-company-contact">
                  <input
                    className="inv-edit"
                    value={companyEmail}
                    onChange={e => setCompanyEmail(e.target.value)}
                    style={{ textAlign: 'right', width: 290, display: 'block', marginLeft: 'auto' }}
                  />
                  <input
                    className="inv-edit"
                    value={companyPhone}
                    onChange={e => setCompanyPhone(e.target.value)}
                    style={{ textAlign: 'right', minWidth: 140, display: 'block', marginLeft: 'auto' }}
                  />
                </div>
              </div>
            </div>

            <div className="inv-date-row">
              <label style={{ position: 'relative', display: 'inline-block', cursor: 'pointer' }}>
                <span>
                  {dateParts.day}
                  <sup>{dateParts.suffix}</sup> {dateParts.month} {dateParts.year}
                </span>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    opacity: 0,
                    cursor: 'pointer',
                    border: 'none',
                  }}
                />
              </label>
            </div>

            {/* ── MODE: QUICK ────────────────────────────── */}
            {mode === 'quick' && (
              <>
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th className="col-desc">Description</th>
                      <th className="col-qty">Qty</th>
                      <th className="col-unit">Unit</th>
                      <th className="col-amount">Amount</th>
                      <th className="col-x"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {quickItems.map((it, i) => (
                      <tr key={i}>
                        <td className="col-desc">
                          <textarea
                            className="inv-edit inv-desc-edit"
                            value={`${it.desc}\n${it.note}`}
                            onChange={e => {
                              const lines = e.target.value.split('\n')
                              updateQuickItem(i, {
                                desc: lines[0] || '',
                                note: lines.slice(1).join('\n'),
                              })
                            }}
                          />
                        </td>
                        <td className="col-qty">
                          <input
                            className="inv-edit"
                            value={it.qty}
                            onChange={e => updateQuickItem(i, { qty: e.target.value })}
                            style={{ textAlign: 'center', width: 40 }}
                          />
                        </td>
                        <td className="col-unit">
                          <input
                            className="inv-edit"
                            value={it.price}
                            onChange={e => updateQuickItem(i, { price: e.target.value })}
                            style={{ textAlign: 'right', width: 80 }}
                          />
                        </td>
                        <td className="col-amount">{rm(num(it.qty) * num(it.price))}</td>
                        <td className="col-x">
                          {quickItems.length > 1 && (
                            <button onClick={() => removeQuickItem(i)} className="x-btn">✕</button>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="add-row">
                      <td colSpan={5}>
                        <button onClick={addQuickItem} className="add-btn">+ Add ticket</button>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="inv-total-row">
                  <div className="inv-total">
                    <span className="inv-total-lbl">TOTAL</span>
                    <span className="inv-total-amt">{rm(quickTotal)}</span>
                  </div>
                </div>

                <div className="inv-footer" style={{ marginTop: 80 }}>
                  <div className="inv-payment">
                    <div className="inv-pay-title">PAYMENT METHOD</div>
                    <div className="inv-pay-details">
                      Bank Name:{' '}
                      <input
                        className="inv-edit"
                        value={bankName}
                        onChange={e => setBankName(e.target.value)}
                        style={{ minWidth: 140 }}
                      /><br />
                      Bank Account:{' '}
                      <input
                        className="inv-edit"
                        value={bankAccount}
                        onChange={e => setBankAccount(e.target.value)}
                        style={{ minWidth: 140 }}
                      /><br />
                      Name:{' '}
                      <input
                        className="inv-edit"
                        value={bankHolder}
                        onChange={e => setBankHolder(e.target.value)}
                        style={{ minWidth: 180 }}
                      />
                    </div>
                    <div className="inv-pay-note">
                      Full payment should be made a minimum of 7 days to avoid termination of my services
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ── MODE: BALANCE ────────────────────────────── */}
            {mode === 'balance' && (
              <>
                <table className="items-table">
                  <thead>
                    <tr>
                      <th className="col-desc">Description</th>
                      <th className="col-qty">Qty</th>
                      <th className="col-unit">Unit</th>
                      <th className="col-amount">Amount</th>
                      <th className="col-x"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((li, i) => (
                      <tr key={i}>
                        <td className="col-desc">
                          <textarea
                            className="inv-edit inv-line-desc"
                            value={li.desc}
                            onChange={e => updateLine(i, { desc: e.target.value })}
                            rows={1}
                          />
                        </td>
                        <td className="col-qty">
                          <input
                            className="inv-edit"
                            value={li.qty}
                            onChange={e => updateLine(i, { qty: e.target.value })}
                            style={{ width: 40, textAlign: 'center' }}
                          />
                        </td>
                        <td className="col-unit">
                          <input
                            className="inv-edit"
                            value={li.unit}
                            onChange={e => updateLine(i, { unit: e.target.value })}
                            style={{ width: 80, textAlign: 'right' }}
                          />
                        </td>
                        <td className="col-amount">{rm(num(li.qty) * num(li.unit))}</td>
                        <td className="col-x">
                          <button onClick={() => removeLine(i)} className="x-btn">✕</button>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={5}>
                        <button onClick={addLine} className="add-btn">+ Add line item</button>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="totals-stack">
                  <div className="total-line subtotal-line">
                    <span>Subtotal</span>
                    <span>{rm(subtotal)}</span>
                  </div>

                  <div className="payments-header">
                    <span>Payments Received</span>
                    <button onClick={addPayment} className="add-btn-small">+ Add</button>
                  </div>
                  {payments.length === 0 && (
                    <div className="total-line muted-row" style={{ fontStyle: 'italic', color: '#888' }}>
                      (none)
                    </div>
                  )}
                  {payments.map((p, i) => (
                    <div className="total-line muted-row" key={i}>
                      <input
                        className="inv-edit"
                        value={p.label}
                        onChange={e => updatePayment(i, { label: e.target.value })}
                        style={{ flex: 1, fontSize: 13 }}
                      />
                      <input
                        className="inv-edit"
                        value={p.amount}
                        onChange={e => updatePayment(i, { amount: e.target.value })}
                        style={{ width: 80, textAlign: 'right', fontSize: 13 }}
                      />
                      <button onClick={() => removePayment(i)} className="x-btn" style={{ marginLeft: 6 }}>✕</button>
                    </div>
                  ))}

                  <div className={`balance-line ${balanceDue <= 0 ? 'zero' : ''}`}>
                    <span className={`balance-lbl ${balanceDue <= 0 ? 'zero' : ''}`}>
                      {balanceDue <= 0 ? 'PAID IN FULL' : 'BALANCE DUE'}
                    </span>
                    <span className="balance-amt">{rm(Math.max(0, balanceDue))}</span>
                  </div>
                </div>

                <div className="inv-footer" style={{ marginTop: 16 }}>
                  <div className="inv-payment">
                    <div className="inv-pay-title">PAYMENT METHOD</div>
                    <div className="inv-pay-details">
                      Bank Name:{' '}
                      <input
                        className="inv-edit"
                        value={bankName}
                        onChange={e => setBankName(e.target.value)}
                        style={{ minWidth: 140 }}
                      /><br />
                      Bank Account:{' '}
                      <input
                        className="inv-edit"
                        value={bankAccount}
                        onChange={e => setBankAccount(e.target.value)}
                        style={{ minWidth: 140 }}
                      /><br />
                      Name:{' '}
                      <input
                        className="inv-edit"
                        value={bankHolder}
                        onChange={e => setBankHolder(e.target.value)}
                        style={{ minWidth: 180 }}
                      />
                    </div>
                    <div className="inv-pay-note">
                      Full payment should be made a minimum of 7 days to avoid termination of my services
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ── MODE: REFUND ────────────────────────────── */}
            {mode === 'refund' && (
              <>
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th className="col-desc">Description</th>
                      <th className="col-amount">Original Price</th>
                      <th className="col-amount">Refund</th>
                      <th className="col-x"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {refundItems.map((it, i) => (
                      <tr key={i}>
                        <td className="col-desc">
                          <textarea
                            className="inv-edit inv-desc-edit"
                            value={it.desc}
                            onChange={e => updateRefund(i, { desc: e.target.value })}
                          />
                        </td>
                        <td className="col-amount">
                          <input
                            className="inv-edit"
                            value={it.ori}
                            onChange={e => updateRefund(i, { ori: e.target.value })}
                            style={{ textAlign: 'right', width: 90 }}
                          />
                        </td>
                        <td className="col-amount">
                          <input
                            className="inv-edit"
                            value={it.refund}
                            onChange={e => updateRefund(i, { refund: e.target.value })}
                            style={{ textAlign: 'right', width: 90 }}
                          />
                        </td>
                        <td className="col-x">
                          {refundItems.length > 1 && (
                            <button onClick={() => removeRefund(i)} className="x-btn">✕</button>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="add-row">
                      <td colSpan={4}>
                        <button onClick={addRefund} className="add-btn">+ Add line</button>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="inv-total-row">
                  <div className="inv-total">
                    <span className="inv-total-lbl">TOTAL REFUNDED</span>
                    <span className="inv-total-amt">{rm(refundTotal)}</span>
                  </div>
                </div>

                <div className="inv-footer" style={{ marginTop: 48 }}>
                  <div className="inv-payment">
                    <div className="inv-pay-title">PAYMENT METHOD</div>
                    <div className="inv-pay-details">
                      Bank Name:{' '}
                      <input
                        className="inv-edit"
                        value={bankName}
                        onChange={e => setBankName(e.target.value)}
                        style={{ minWidth: 140 }}
                      /><br />
                      Bank Account:{' '}
                      <input
                        className="inv-edit"
                        value={bankAccount}
                        onChange={e => setBankAccount(e.target.value)}
                        style={{ minWidth: 140 }}
                      /><br />
                      Name:{' '}
                      <input
                        className="inv-edit"
                        value={bankHolder}
                        onChange={e => setBankHolder(e.target.value)}
                        style={{ minWidth: 180 }}
                      />
                    </div>
                    <div className="inv-pay-note">
                      Refund will be processed to your bank account within 7 working days of this notice.
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default function InvoicePage() {
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>Loading invoice…</div>}>
      <InvoiceContent />
    </Suspense>
  )
}

// ── CSS ─────────────────────────────────────────────────────────────────
const INVOICE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

  .invoice-shell {
    font-family: 'Inter', Arial, sans-serif;
    background: #d8d8d8;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24px 20px;
    color: #111;
  }
  .invoice-toolbar {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
  }
  .invoice-toolbar button {
    background: #111;
    color: #fff;
    border: none;
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .invoice-toolbar button.secondary {
    background: #fff;
    color: #111;
    border: 1px solid #999;
  }
  .invoice-toolbar button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .email-row {
    flex-basis: 100%;
    display: flex;
    gap: 10px;
    justify-content: center;
    align-items: center;
  }
  .email-row .search-input { width: auto; }
  .search-input {
    width: 100%;
    padding: 10px 14px;
    font-size: 13px;
    border-radius: 8px;
    border: 1px solid #999;
    background: #fff;
    color: #111;
  }
  .search-results {
    position: absolute;
    top: 110%;
    left: 0;
    right: 0;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 8px;
    box-shadow: 0 8px 20px rgba(0,0,0,0.15);
    max-height: 280px;
    overflow-y: auto;
    z-index: 50;
  }
  .no-match { padding: 12px 14px; font-size: 13px; color: #666; }
  .match-row {
    display: block !important;
    width: 100%;
    text-align: left;
    padding: 10px 14px !important;
    background: #fff !important;
    color: #111 !important;
    border: none !important;
    border-bottom: 1px solid #eee !important;
    border-radius: 0 !important;
    cursor: pointer;
    font-size: 13px !important;
    font-weight: 400 !important;
  }
  .match-row:hover { background: #f5f5f5 !important; }

  .mode-tabs {
    display: inline-flex;
    background: #fff;
    border: 1px solid #999;
    border-radius: 8px;
    overflow: hidden;
  }
  .mode-tab {
    background: #fff !important;
    color: #555 !important;
    border: none !important;
    border-radius: 0 !important;
    padding: 10px 16px !important;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
  }
  .mode-tab.active {
    background: #F26522 !important;
    color: #fff !important;
  }

  .invoice-page {
    background: #fff;
    width: 794px;
    height: 1123px;
    display: flex;
    position: relative;
    box-shadow: 0 6px 30px rgba(0,0,0,0.18);
    overflow: hidden;
    color: #111;
  }
  /* Minimal template: no left stripe — clean white sheet */
  .red-stripe { display: none; }

  .invoice-content {
    flex: 1;
    padding: 46px 50px;
    display: flex;
    flex-direction: column;
  }

  .inv-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
  }
  .inv-logo-img {
    height: 64px;
    width: auto;
    border-radius: 10px;
    display: block;
    flex: 0 0 auto;
  }
  .inv-company-reg { font-size: 12px; color: #777; margin-bottom: 6px; }
  .inv-logo {
    display: inline-flex;
    align-items: stretch;
    border: 2px solid #111;
    width: max-content;
    flex: 0 0 auto;
  }
  .inv-logo-oppa {
    background: #F26522;
    color: #fff;
    font-weight: 900;
    font-size: 18px;
    letter-spacing: 0.5px;
    padding: 5px 14px 15px;
    line-height: 1;
    display: inline-block;
  }
  .inv-logo-media {
    color: #111;
    font-weight: 800;
    font-size: 18px;
    letter-spacing: 3px;
    padding: 5px 16px 15px;
    line-height: 1;
    display: inline-block;
  }
  .inv-title {
    font-size: 44px;
    font-weight: 400;
    letter-spacing: 4px;
    color: #111;
    line-height: 1;
    margin-top: -10px;
  }
  .inv-divider { height: 2px; background: #F26522; margin-bottom: 22px; }

  .inv-billing {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
  }
  .inv-lbl {
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #999;
    margin-bottom: 6px;
    font-weight: 500;
  }
  .inv-name { font-size: 14px; font-weight: 400; color: #111; line-height: 1.5; }
  .inv-company-right { text-align: right; }
  .inv-company-name { font-size: 22px; font-weight: 400; color: #111; margin-bottom: 6px; }
  .inv-company-contact { font-size: 13px; color: #555; line-height: 1.7; }

  .inv-date-row { text-align: right; margin: 18px 0 18px; }
  .inv-date-row span {
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 3px;
    color: #333;
  }
  .inv-date-row sup {
    font-size: 0.55em;
    letter-spacing: 0;
    vertical-align: super;
    top: 0;
    margin-left: -1px;
    margin-right: 6px;
  }

  /* Quick mode table */
  .inv-table { width: 100%; border-collapse: collapse; }
  .inv-table thead tr { background: transparent; }
  .inv-table thead th {
    color: #F26522;
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    padding: 8px 14px;
    border-bottom: 1.5px solid #F26522;
  }
  .inv-table thead th.col-desc { text-align: left; }
  .inv-table thead th.col-qty { text-align: center; width: 50px; }
  .inv-table thead th.col-unit { text-align: right; width: 90px; }
  .inv-table thead th.col-amount { text-align: right; width: 110px; }
  .inv-table thead th.col-x { width: 30px; }
  .inv-table tbody td {
    font-size: 14px;
    color: #222;
    padding: 4px 14px;
    vertical-align: top;
    line-height: 1.45;
  }
  .inv-table tbody td.col-qty { text-align: center; }
  .inv-table tbody td.col-unit, .inv-table tbody td.col-amount { text-align: right; }
  .inv-table tbody td.col-x { text-align: center; padding: 4px 8px; }
  /* The "+ Add ticket" row is screen-only — never in the printed/exported PDF */
  .is-exporting .add-row { display: none !important; }
  @media print { .add-row { display: none !important; } }

  /* Balance mode table */
  .items-table { width: 100%; border-collapse: collapse; }
  .items-table thead tr { background: transparent; }
  .items-table thead th {
    color: #F26522; font-weight: 700; font-size: 10px; letter-spacing: 1px;
    text-transform: uppercase;
    padding: 8px 12px;
    border-bottom: 1.5px solid #F26522;
  }
  .items-table thead th.col-desc { text-align: left; }
  .items-table thead th.col-qty { text-align: center; width: 60px; }
  .items-table thead th.col-unit { text-align: right; width: 100px; }
  .items-table thead th.col-amount { text-align: right; width: 110px; }
  .items-table thead th.col-x { width: 30px; }
  .items-table tbody td {
    font-size: 13.5px; color: #222; padding: 10px 12px;
    vertical-align: middle;
    border-bottom: 1px solid #f0f0f0;
  }
  .items-table tbody td.col-qty { text-align: center; }
  .items-table tbody td.col-unit, .items-table tbody td.col-amount { text-align: right; }

  .add-btn {
    background: transparent !important;
    color: #888 !important;
    border: 1px dashed #ccc !important;
    border-radius: 6px !important;
    padding: 6px 12px !important;
    font-size: 12px !important;
    cursor: pointer;
    margin: 6px 0;
  }
  .add-btn:hover { color: #F26522 !important; border-color: #F26522 !important; }
  .add-btn-small {
    background: transparent !important;
    color: #888 !important;
    border: none !important;
    font-size: 11px !important;
    padding: 0 !important;
    cursor: pointer;
  }
  .add-btn-small:hover { color: #F26522 !important; }
  .x-btn {
    background: transparent !important;
    color: #ccc !important;
    border: none !important;
    font-size: 14px !important;
    padding: 2px 6px !important;
    cursor: pointer;
  }
  .x-btn:hover { color: #F26522 !important; }

  .totals-stack {
    margin-left: auto;
    margin-top: 14px;
    width: 340px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .total-line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    font-size: 13.5px;
    color: #222;
    gap: 8px;
  }
  .total-line.muted-row { color: #555; }
  .subtotal-line {
    border-top: 1px solid #ccc;
    font-weight: 600;
    padding-top: 10px;
  }
  .payments-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #999;
    padding: 12px 10px 4px;
    font-weight: 500;
  }
  .balance-line {
    margin-top: 6px;
    background: #efeeec;
    padding: 14px 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .balance-line.zero { background: #e7f4e8; }
  .balance-lbl {
    font-size: 13px; font-weight: 700; letter-spacing: 1.2px;
    color: #F26522;
  }
  .balance-lbl.zero { color: #2c7a2f; }
  .balance-amt { font-size: 18px; font-weight: 800; color: #111; }

  .inv-footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-top: auto;
    gap: 30px;
  }
  .inv-payment { flex: 1; max-width: 340px; }
  .inv-pay-title {
    font-size: 13px; font-weight: 700; letter-spacing: 0.5px;
    color: #111; margin-bottom: 10px;
  }
  .inv-pay-details {
    font-size: 12.5px; color: #333; line-height: 1.8; margin-bottom: 14px;
  }
  .inv-pay-note {
    font-size: 12px; color: #555; max-width: 240px; line-height: 1.6;
  }
  .inv-total-row { display: flex; justify-content: flex-end; margin-top: 18px; }
  .inv-total {
    background: #fdebe0;
    padding: 14px 18px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 28px;
    min-width: 280px;
  }
  .inv-total-lbl { font-size: 13px; font-weight: 700; letter-spacing: 1px; color: #F26522; }
  .inv-total-amt { font-size: 18px; font-weight: 700; color: #111; }

  /* Inline edit fields */
  .inv-edit {
    background: transparent;
    border: 1px dashed transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    padding: 2px 4px;
    border-radius: 4px;
    min-width: 40px;
  }
  .inv-edit:hover { border-color: #cfcfcf; }
  .inv-edit:focus { outline: none; border-color: #888; background: #fafafa; }
  .inv-desc-edit { width: 100%; min-height: 28px; resize: vertical; }
  .inv-line-desc {
    width: 100%;
    min-height: 60px;
    resize: both;
    font-family: inherit;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    border: 1px dashed #bbb !important;
    padding: 6px 8px !important;
    background: #fff !important;
  }
  .inv-line-desc:focus {
    border-color: #888 !important;
    background: #fafafa !important;
    outline: none;
  }
  @media print {
    .inv-line-desc {
      border: none !important;
      padding: 0 !important;
      background: transparent !important;
      resize: none !important;
    }
  }

  @media print {
    body { background: #fff !important; }
    nav, .invoice-toolbar { display: none !important; }
    main { padding: 0 !important; max-width: none !important; margin: 0 !important; }
    .invoice-shell { background: #fff; padding: 0; }
    .invoice-page { box-shadow: none; width: 210mm; height: 297mm; }
    .inv-edit { border-color: transparent !important; background: transparent !important; }
    .add-btn, .add-btn-small, .x-btn { display: none !important; }
  }

  /* ── Export / PDF mode (toggled by React state during html2pdf capture) ── */
  .is-exporting .add-btn,
  .is-exporting .add-btn-small,
  .is-exporting .x-btn,
  .is-exporting .col-x { display: none !important; }

  .is-exporting input,
  .is-exporting textarea {
    border: none !important;
    background: transparent !important;
    outline: none !important;
    padding: 0 !important;
    margin: 0 !important;
    resize: none !important;
    appearance: none !important;
    -webkit-appearance: none !important;
    box-shadow: none !important;
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    line-height: 1.45 !important;
  }

  .is-exporting input[type="date"] { display: none !important; }

  .is-exporting .inv-line-desc {
    width: 100% !important;
    min-height: 0 !important;
    border: none !important;
    padding: 0 !important;
    background: transparent !important;
    resize: none !important;
    white-space: pre-wrap !important;
    word-break: break-word !important;
    overflow: visible !important;
  }

  /* ── Mobile (iPhone / narrow viewport) ──
     The invoice page is a fixed 794×1123 A4 canvas so PDF export captures it
     pixel-perfect. On narrow screens we scale the whole sheet down with
     transform so it fits the viewport, and use a negative margin to recover
     the empty space below. :not(.is-exporting) keeps html2pdf's capture
     (windowWidth: 794) running at the original 1× scale. */
  @media (max-width: 820px) {
    .invoice-shell { padding: 12px 8px 20px; overflow-x: hidden; }
    .invoice-toolbar { width: 100%; gap: 8px; }
    .invoice-toolbar > div:first-child { min-width: 0 !important; width: 100%; }
    .invoice-toolbar .search-input { width: 100%; box-sizing: border-box; }
    .mode-tabs { width: 100%; }
    .mode-tab { flex: 1; padding: 10px 8px !important; font-size: 12px !important; }
    .invoice-toolbar > button {
      flex: 1 1 calc(50% - 8px);
      padding: 10px 12px;
      font-size: 12px;
      min-width: 0;
    }
    .email-row { flex-direction: column; gap: 8px; }
    .email-row .search-input { max-width: none !important; }
    .email-row button { width: 100%; }
    .invoice-page:not(.is-exporting) {
      align-self: flex-start;
      transform-origin: top left;
      transform: scale(calc((100vw - 16px) / 794px));
      margin-bottom: calc(1123px * (((100vw - 16px) / 794px) - 1));
    }
  }
`
