#!/usr/bin/env node
// CMO Consulting — monthly accountant bundle (Item D).
//
// Builds a dated LOCAL folder for one month containing:
//   • claims-summary.csv  — every expense claim that month (claimant, category,
//     amount, status, receipt y/n)
//   • receipts/           — each claim's receipt image/PDF (downloaded from the
//     Supabase `receipts` bucket; empty until receipts are attached)
//   • bank-statements/    — a slot for you to drop the month's bank PDFs
//   • README.txt          — what's inside + the running total
// …then zips it, and (with --send) emails the zip to your accountant, BCC
// finance@cmoaiconsulting.com — matching how lib/email.ts archives finance mail.
//
// Usage:
//   node scripts/cmo-monthly-bundle.mjs                 # previous month, folder only (no email)
//   node scripts/cmo-monthly-bundle.mjs --month 2026-06 # a specific month
//   node scripts/cmo-monthly-bundle.mjs --send          # also email the accountant
//   node scripts/cmo-monthly-bundle.mjs --out ~/CMO     # custom output root
//
// Reads credentials from event-ops/.env.local and (optionally) scripts/.env.cmo.
// Required: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (anon key works
// only if RLS allows reading claims). For --send: RESEND_API_KEY + ACCOUNTANT_EMAIL.

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = join(__dirname, '..')

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv(file) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}
const env = { ...loadEnv(join(REPO, '.env.local')), ...loadEnv(join(__dirname, '.env.cmo')), ...process.env }

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const getArg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const SEND = args.includes('--send')
const OUT_ROOT = (getArg('--out') || join(homedir(), 'CMO-Monthly')).replace(/^~/, homedir())

function prevMonth() {
  const d = new Date()
  d.setDate(1); d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 7)
}
const MONTH = getArg('--month') || prevMonth() // YYYY-MM
if (!/^\d{4}-\d{2}$/.test(MONTH)) { console.error(`Bad --month "${MONTH}" (want YYYY-MM)`); process.exit(1) }
const [y, m] = MONTH.split('-').map(Number)
const from = `${MONTH}-01`
const to = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10) // first day of next month

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE key in .env.local'); process.exit(1) }
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

const rm = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

async function main() {
  console.log(`\n📦 CMO monthly bundle — ${MONTH}\n`)

  // ── claims for the month (exclude rejected) ──
  const { data: claims, error } = await supabase
    .from('claims')
    .select('id, event_id, claimant_name, claimant_phone, description, category, amount, status, submitted_at, receipt_url')
    .gte('submitted_at', from).lt('submitted_at', to)
    .neq('status', 'rejected')
    .order('submitted_at', { ascending: true })
  if (error) { console.error('Supabase read failed:', error.message); process.exit(1) }

  const { data: events } = await supabase.from('events').select('id, name')
  const eventName = new Map((events || []).map((e) => [e.id, e.name]))

  // ── folders ──
  const dir = join(OUT_ROOT, MONTH)
  const receiptsDir = join(dir, 'receipts')
  const bankDir = join(dir, 'bank-statements')
  mkdirSync(receiptsDir, { recursive: true })
  mkdirSync(bankDir, { recursive: true })

  // ── receipts ──
  let withReceipt = 0
  for (const c of claims || []) {
    if (!c.receipt_url) continue
    try {
      let buf, ext = (c.receipt_url.split('?')[0].match(/\.(\w{2,4})$/) || [, 'bin'])[1]
      if (/^https?:\/\//.test(c.receipt_url)) {
        const res = await fetch(c.receipt_url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        buf = Buffer.from(await res.arrayBuffer())
      } else {
        const { data, error: dErr } = await supabase.storage.from('receipts').download(c.receipt_url)
        if (dErr) throw dErr
        buf = Buffer.from(await data.arrayBuffer())
      }
      const safe = (c.claimant_name || 'unknown').replace(/[^\w]+/g, '_').slice(0, 30)
      writeFileSync(join(receiptsDir, `${safe}_${Number(c.amount).toFixed(0)}_${c.id.slice(0, 8)}.${ext}`), buf)
      withReceipt++
    } catch (e) { console.warn(`  ! receipt for ${c.claimant_name} failed: ${e.message}`) }
  }

  // ── CSV ──
  const header = ['Date', 'Claimant', 'Phone', 'Event', 'Category', 'Description', 'Amount (RM)', 'Status', 'Receipt']
  const lines = [header.join(',')]
  let total = 0
  for (const c of claims || []) {
    total += Number(c.amount || 0)
    lines.push([
      String(c.submitted_at).slice(0, 10), c.claimant_name, c.claimant_phone || '',
      eventName.get(c.event_id) || '', c.category || '', c.description || '',
      Number(c.amount || 0).toFixed(2), c.status, c.receipt_url ? 'yes' : 'no',
    ].map(csvCell).join(','))
  }
  lines.push(['', '', '', '', '', 'TOTAL', total.toFixed(2), '', ''].map(csvCell).join(','))
  writeFileSync(join(dir, 'claims-summary.csv'), lines.join('\n'))

  // ── README + bank slot ──
  writeFileSync(join(dir, 'README.txt'),
    `CMO CONSULTING SDN. BHD. (202601024007) — accounting bundle for ${MONTH}\n\n` +
    `Expense claims: ${(claims || []).length}  (with receipt: ${withReceipt})\n` +
    `Total claimed: ${rm(total)}\n\n` +
    `Contents:\n  • claims-summary.csv  — all claims this month\n  • receipts/           — receipt images/PDFs (${withReceipt} file(s))\n  • bank-statements/    — DROP this month's bank statement PDFs here before sending\n`)
  writeFileSync(join(bankDir, 'README.txt'),
    `Drop ${MONTH} bank statement PDF(s) here, then re-run with --send (or zip & email).\n`)

  // ── zip ──
  let zipPath = ''
  try {
    execSync(`cd ${JSON.stringify(OUT_ROOT)} && rm -f ${JSON.stringify(MONTH + '.zip')} && zip -r -q ${JSON.stringify(MONTH + '.zip')} ${JSON.stringify(MONTH)}`, { stdio: 'inherit' })
    zipPath = join(OUT_ROOT, `${MONTH}.zip`)
  } catch (e) { console.warn('  ! zip failed (folder is still ready):', e.message) }

  console.log(`✅ Folder: ${dir}`)
  console.log(`   ${(claims || []).length} claims · ${rm(total)} · ${withReceipt} receipt file(s)`)
  if (zipPath) console.log(`   Zip: ${zipPath}`)

  // ── email (opt-in) ──
  if (!SEND) {
    console.log(`\nℹ️  Folder built only. Re-run with --send to email your accountant.\n`)
    return
  }
  const ACCOUNTANT = env.ACCOUNTANT_EMAIL
  const FINANCE = env.FINANCE_EMAIL || 'finance@cmoaiconsulting.com'
  const FROM = env.EMAIL_FROM || `CMO Consulting Finance <${FINANCE}>`
  if (!env.RESEND_API_KEY) { console.error('\n✗ --send needs RESEND_API_KEY in .env.local'); process.exit(1) }
  if (!ACCOUNTANT) { console.error('\n✗ --send needs ACCOUNTANT_EMAIL set (in scripts/.env.cmo or env)'); process.exit(1) }
  if (!zipPath) { console.error('\n✗ no zip to send'); process.exit(1) }

  const resend = new Resend(env.RESEND_API_KEY)
  const { error: mailErr } = await resend.emails.send({
    from: FROM, to: ACCOUNTANT, bcc: FINANCE,
    subject: `CMO Consulting — accounting bundle ${MONTH}`,
    html: `<p>Hi,</p><p>Attached is the ${MONTH} accounting bundle for <b>CMO CONSULTING SDN. BHD. (202601024007)</b>:</p>` +
          `<ul><li>${(claims || []).length} expense claim(s), total ${rm(total)}</li><li>${withReceipt} receipt file(s)</li><li>Bank statements (if included)</li></ul>` +
          `<p>Thanks!</p>`,
    attachments: [{ filename: `CMO-${MONTH}.zip`, content: readFileSync(zipPath) }],
  })
  if (mailErr) { console.error('✗ email failed:', mailErr.message); process.exit(1) }
  console.log(`📧 Emailed to ${ACCOUNTANT} (BCC ${FINANCE})\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
