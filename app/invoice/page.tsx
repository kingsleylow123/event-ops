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
}

type LineItem = { desc: string; qty: string; unit: string }
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

// ── Main page ───────────────────────────────────────────────────────────
function InvoiceContent() {
  const params = useSearchParams()
  const initialMode = (params.get('mode') === 'balance' ? 'balance' : 'quick') as 'quick' | 'balance'
  const [mode, setMode] = useState<'quick' | 'balance'>(initialMode)

  // ── Shared
  const [name, setName] = useState(params.get('name') || 'CLIENT NAME')
  const [date, setDate] = useState(params.get('date') || todayIso())
  const dateParts = useMemo(() => formatDateParts(date), [date])
  const [companyName, setCompanyName] = useState('Oppa-Media')
  const [companyEmail, setCompanyEmail] = useState('kingsley@oppa-media.com')
  const [companyPhone, setCompanyPhone] = useState('6012 285 0125')
  const [bankName, setBankName] = useState('Maybank SME Biz')
  const [bankAccount, setBankAccount] = useState('5142 8090 1848')
  const [bankHolder, setBankHolder] = useState('Kingsley Low Yean Wee')

  // ── Quick mode
  const [desc, setDesc] = useState(params.get('desc') || '[VIP] Claude Half Day Workshop')
  const [note, setNote] = useState(params.get('note') || '[non refundable')
  const [amount, setAmount] = useState(params.get('amount') || '0')
  const amountNum = useMemo(() => num(amount), [amount])

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

  useEffect(() => {
    document.title = `Invoice - ${name}`
  }, [name])

  // ── PDF export
  const [exporting, setExporting] = useState(false)

  async function exportPDF() {
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
        const width = input.tagName === 'TEXTAREA' ? '100%' : 'auto'
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
      await html2pdf()
        .set({
          margin: 0,
          filename: `Invoice-${safeName}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            width: 794,
            height: 1123,
            windowWidth: 794,
            windowHeight: 1123,
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['avoid-all'] },
        })
        .from(el)
        .save()
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

  function pickAttendee(a: AttendeeLite) {
    const ticketLabel = TICKET_LABELS[a.ticket_type] || 'Ticket'
    setName(a.name)
    if (mode === 'quick') {
      setDesc(`[${ticketLabel}] Claude Workshop`)
      setNote(a.notes || '[non refundable')
      setAmount(String(a.payment_amount ?? 0))
    } else {
      // Add as a line item in balance mode
      setLineItems(items => [
        ...items.filter(li => li.desc || li.unit !== '0'),
        { desc: `[${ticketLabel}] Claude Workshop`, qty: '1', unit: String(a.payment_amount ?? 0) },
      ])
    }
    setQuery('')
    setShowResults(false)
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
          </div>

          <button onClick={exportPDF}>📄 Save as PDF</button>
          <button className="secondary" onClick={() => window.close()}>Close</button>
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
              <div className="inv-logo">
                <span className="inv-logo-oppa">OPPA-</span>
                <span className="inv-logo-media">MEDIA</span>
              </div>
              <div className="inv-title">INVOICE</div>
            </div>

            <div className="inv-divider" />

            <div className="inv-billing">
              <div>
                <div className="inv-lbl">Invoice To</div>
                <input
                  className="inv-edit inv-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  style={{ minWidth: 200 }}
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
                <div className="inv-company-contact">
                  <input
                    className="inv-edit"
                    value={companyEmail}
                    onChange={e => setCompanyEmail(e.target.value)}
                    style={{ textAlign: 'right', minWidth: 200, display: 'block', marginLeft: 'auto' }}
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
                  DATE: {dateParts.day}
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
                      <th className="col-price">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="col-desc">
                        <textarea
                          className="inv-edit inv-desc-edit"
                          value={`${desc}\n${note}`}
                          onChange={e => {
                            const lines = e.target.value.split('\n')
                            setDesc(lines[0] || '')
                            setNote(lines.slice(1).join('\n'))
                          }}
                        />
                      </td>
                      <td className="col-price">
                        <input
                          className="inv-edit"
                          value={amount}
                          onChange={e => setAmount(e.target.value)}
                          style={{ textAlign: 'right', width: 100 }}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="inv-footer">
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
                  <div className="inv-total">
                    <span className="inv-total-lbl">TOTAL</span>
                    <span className="inv-total-amt">{rm(amountNum)}</span>
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
    background: #ed1c24 !important;
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
  .red-stripe {
    width: 14px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
  }
  .red-stripe .seg-top    { background: #ed1c24; height: 90px; }
  .red-stripe .seg-gap    { background: #fff; height: 18px; }
  .red-stripe .seg-bottom { background: #ed1c24; flex: 1; }

  .invoice-content {
    flex: 1;
    padding: 40px 52px 40px 32px;
    display: flex;
    flex-direction: column;
  }

  .inv-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
  }
  .inv-logo {
    display: inline-flex;
    align-items: stretch;
    border: 2px solid #111;
    width: max-content;
    flex: 0 0 auto;
  }
  .inv-logo-oppa {
    background: #ed1c24;
    color: #fff;
    font-weight: 900;
    font-size: 18px;
    letter-spacing: 0.5px;
    padding: 10px 14px;
    line-height: 1;
    display: inline-block;
  }
  .inv-logo-media {
    color: #111;
    font-weight: 800;
    font-size: 18px;
    letter-spacing: 3px;
    padding: 10px 16px;
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
  .inv-divider { height: 1px; background: #d8d8d8; margin-bottom: 22px; }

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
  .inv-name { font-size: 22px; font-weight: 400; color: #111; }
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

  /* Quick mode table */
  .inv-table { width: 100%; border-collapse: collapse; }
  .inv-table thead tr { background: #ed1c24; }
  .inv-table thead th {
    color: #fff;
    font-weight: 700;
    font-size: 15px;
    letter-spacing: 0.5px;
    padding: 14px 24px;
  }
  .inv-table thead th.col-desc { text-align: left; }
  .inv-table thead th.col-price { text-align: right; }
  .inv-table tbody td {
    font-size: 14px;
    color: #222;
    padding: 20px 24px;
    vertical-align: top;
  }
  .inv-table tbody td.col-price { text-align: right; }

  /* Balance mode table */
  .items-table { width: 100%; border-collapse: collapse; }
  .items-table thead tr { background: #ed1c24; }
  .items-table thead th {
    color: #fff; font-weight: 700; font-size: 13px; letter-spacing: 0.5px;
    padding: 11px 12px;
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
  .add-btn:hover { color: #ed1c24 !important; border-color: #ed1c24 !important; }
  .add-btn-small {
    background: transparent !important;
    color: #888 !important;
    border: none !important;
    font-size: 11px !important;
    padding: 0 !important;
    cursor: pointer;
  }
  .add-btn-small:hover { color: #ed1c24 !important; }
  .x-btn {
    background: transparent !important;
    color: #ccc !important;
    border: none !important;
    font-size: 14px !important;
    padding: 2px 6px !important;
    cursor: pointer;
  }
  .x-btn:hover { color: #ed1c24 !important; }

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
    color: #ed1c24;
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
  .inv-total {
    background: #efeeec;
    padding: 16px 28px;
    display: flex;
    align-items: center;
    gap: 28px;
    min-width: 280px;
  }
  .inv-total-lbl { font-size: 14px; font-weight: 700; letter-spacing: 1px; color: #111; }
  .inv-total-amt { font-size: 16px; font-weight: 700; color: #111; }

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
  .inv-desc-edit { width: 100%; min-height: 60px; resize: vertical; }
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
`
