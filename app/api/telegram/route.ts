import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { buildReport } from '@/lib/affiliates'
import { renderInvoicePDF, type InvoiceData, type InvoiceLineItem, type InvoicePayment } from '@/lib/invoice-pdf'
import { findAttendeesByName, type AttendeeMatch } from '@/lib/invoice-lookup'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET!
const ALLOWED_IDS = (process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Lazy OpenAI client — the SDK throws at construction if the key is missing,
// which would break `next build` page-data collection where the env isn't set.
let _openai: OpenAI | null = null
function openaiClient(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _openai
}

// ── Voice transcription (Telegram voice note → text via Whisper) ───────────────
async function transcribeVoice(fileId: string): Promise<string> {
  // 1. Resolve the file path on Telegram's servers
  const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`)
  const fileJson = await fileRes.json()
  const filePath = fileJson?.result?.file_path
  if (!filePath) throw new Error('voice: could not resolve file path')

  // 2. Download the audio bytes
  const audioRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`)
  if (!audioRes.ok) throw new Error('voice: download failed')
  const buf = Buffer.from(await audioRes.arrayBuffer())

  // 3. Transcribe with Whisper (opus/ogg in → text out).
  // Force English — auto-detect was mis-tagging English speech as Malay.
  // A prompt nudges Whisper toward the event-ops domain vocabulary.
  const file = new File([buf], 'voice.oga', { type: 'audio/ogg' })
  const tr = await openaiClient().audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'en',
    prompt: 'Jarvis, the EventOps assistant. Topics: attendees, paid, pending, VIP, revenue, checklist, survey, check-ins, floor plan, team.',
  })
  return tr.text.trim()
}

type Row = Record<string, unknown>

// ── HTML escaping (parse_mode: HTML — only < > & need escaping) ────────────────
function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
const b = (v: unknown) => `<b>${esc(v)}</b>`

// ── Telegram helpers ──────────────────────────────────────────────────────────
async function tg(method: string, body: Row) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) console.error(`[telegram] ${method} failed`, await res.text())
    return res
  } catch (e) {
    console.error(`[telegram] ${method} threw`, e)
  }
}

function chunk(text: string, size = 3800): string[] {
  if (text.length <= size) return [text]
  const parts: string[] = []
  let rest = text
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size)
    if (cut < size * 0.5) cut = size
    parts.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest) parts.push(rest)
  return parts
}

async function sendMessage(chatId: number, text: string) {
  for (const part of chunk(text)) {
    await tg('sendMessage', { chat_id: chatId, text: part, parse_mode: 'HTML', disable_web_page_preview: true })
  }
}

const sendTyping = (chatId: number) => tg('sendChatAction', { chat_id: chatId, action: 'typing' })
const sendUploadingDoc = (chatId: number) => tg('sendChatAction', { chat_id: chatId, action: 'upload_document' })

// Upload a PDF buffer to Telegram as a file attachment.
async function sendDocument(chatId: number, fileName: string, pdfBuffer: Buffer, caption?: string) {
  const form = new FormData()
  form.append('chat_id', String(chatId))
  form.append('document', new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }), fileName)
  if (caption) {
    form.append('caption', caption)
    form.append('parse_mode', 'HTML')
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) console.error('[telegram] sendDocument failed', await res.text())
    return res
  } catch (e) {
    console.error('[telegram] sendDocument threw', e)
  }
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function getActiveEvent() {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('events').select('*')
    .gte('date', now).order('date', { ascending: true }).limit(1)
  if (error) throw new Error(`events: ${error.message}`)
  return data?.[0] ?? null
}

// Load ALL events the admin has (past + future) for natural-language queries.
async function getAllEvents() {
  const { data, error } = await supabase
    .from('events').select('*')
    .order('date', { ascending: false })
  if (error) throw new Error(`events: ${error.message}`)
  return data ?? []
}

// Load attendees, expenses, etc. across multiple events at once for Claude.
async function loadAcrossEvents(eventIds: string[]) {
  if (!eventIds.length) return { attendees: [], expenses: [], survey: [], meetings: [] }
  const [attendees, expenses, survey, meetings] = await Promise.all([
    supabase.from('attendees').select('*').in('event_id', eventIds),
    supabase.from('expenses').select('*').in('event_id', eventIds),
    supabase.from('pre_event_survey_responses').select('*').in('event_id', eventIds),
    supabase.from('meetings').select('*').in('event_id', eventIds),
  ])
  for (const r of [attendees, expenses, survey, meetings]) {
    if (r.error) throw new Error(`load-across: ${r.error.message}`)
  }
  return {
    attendees: attendees.data ?? [],
    expenses: expenses.data ?? [],
    survey: survey.data ?? [],
    meetings: meetings.data ?? [],
  }
}

async function loadAll(eventId: string) {
  const [attendees, checklist, expenses, survey, meetings] = await Promise.all([
    supabase.from('attendees').select('*').eq('event_id', eventId).order('created_at', { ascending: false }),
    supabase.from('checklist_items').select('*').eq('event_id', eventId).order('category'),
    supabase.from('expenses').select('*').eq('event_id', eventId).order('created_at', { ascending: false }),
    supabase.from('pre_event_survey_responses').select('*').eq('event_id', eventId),
    supabase.from('meetings').select('*').eq('event_id', eventId).order('meeting_date', { ascending: false }),
  ])
  for (const r of [attendees, checklist, expenses, survey, meetings]) {
    if (r.error) throw new Error(`load: ${r.error.message}`)
  }
  return {
    attendees: attendees.data ?? [],
    checklist: checklist.data ?? [],
    expenses: expenses.data ?? [],
    survey: survey.data ?? [],
    meetings: meetings.data ?? [],
  }
}

// ── Compute helpers ───────────────────────────────────────────────────────────
const tt = (t: unknown) => String(t ?? '').replace(/_/g, ' ')
const num = (v: unknown) => Number(v ?? 0)

function revenue(att: Row[]) {
  return att.filter(a => a.payment_status === 'paid').reduce((s, a) => s + num(a.payment_amount), 0)
}
function totalExpenses(exp: Row[]) {
  return exp.reduce((s, e) => s + num(e.amount), 0)
}
function daysUntil(date: string) {
  const ms = new Date(date).getTime() - Date.now()
  const d = Math.floor(ms / 86400000)
  const h = Math.floor((ms % 86400000) / 3600000)
  if (d > 0) return `${d}d ${h}h`
  if (ms > 0) return `${h}h`
  return 'now / past'
}

// ── Command formatters (HTML) ─────────────────────────────────────────────────
function fmtStats(ev: Row, att: Row[], exp: Row[]) {
  const paid = att.filter(a => a.payment_status === 'paid').length
  const pending = att.filter(a => a.payment_status === 'pending').length
  const free = att.filter(a => a.payment_status === 'free').length
  const confirmed = att.filter(a => a.attendance_confirmed).length
  const rev = revenue(att)
  const spend = totalExpenses(exp)
  const cap = num(ev.capacity)
  const fill = cap ? Math.round((att.length / cap) * 100) : 0
  return `📊 ${b(ev.name)}\n` +
    `📅 ${esc(new Date(ev.date as string).toLocaleString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}  ·  ⏳ ${esc(daysUntil(ev.date as string))} to go\n` +
    `📍 ${esc(ev.venue || '—')}\n\n` +
    `👥 Registered: ${b(att.length)} / ${esc(cap)} (${fill}%)\n` +
    `✅ Paid: ${b(paid)}   ⏳ Pending: ${b(pending)}   🎟 Free: ${b(free)}\n` +
    `🏃 Attendance confirmed: ${b(confirmed)} / ${att.length}\n\n` +
    `💰 Revenue: ${b('RM ' + rev.toLocaleString())}\n` +
    `💸 Expenses: ${b('RM ' + spend.toLocaleString())}\n` +
    `📈 Net: ${b('RM ' + (rev - spend).toLocaleString())}`
}

function fmtCheckins(att: Row[]) {
  const ci = att.filter(a => a.attendance_confirmed)
  if (!ci.length) return `🏃 ${b('0')} checked in yet (of ${att.length}).`
  const list = ci.map(a => `• ${esc(a.name)} <i>(${esc(tt(a.ticket_type))})</i>`).join('\n')
  return `✅ ${b(ci.length + ' checked in')} / ${att.length}:\n${list}`
}

function fmtPending(att: Row[]) {
  const p = att.filter(a => a.payment_status === 'pending')
  if (!p.length) return '✅ No pending payments.'
  const list = p.map(a => `• ${esc(a.name)} — RM${esc(a.payment_amount)} <i>(${esc(tt(a.ticket_type))})</i>`).join('\n')
  return `⏳ ${b(p.length + ' pending')}:\n${list}`
}

function fmtVip(att: Row[]) {
  const v = att.filter(a => String(a.ticket_type).includes('vip'))
  if (!v.length) return '— No VIPs yet.'
  const list = v.map(a => {
    const s = a.payment_status === 'paid' ? '✅' : a.payment_status === 'free' ? '🎟' : '⏳'
    return `${s} ${esc(a.name)}${a.attendance_confirmed ? ' 🏃' : ''}`
  }).join('\n')
  return `👑 ${b('VIPs (' + v.length + ')')}:\n${list}`
}

function fmtChecklist(items: Row[]) {
  if (!items.length) return '— Checklist empty.'
  const today = new Date().toISOString().slice(0, 10)
  const byCat: Record<string, Row[]> = {}
  items.forEach(i => { (byCat[String(i.category || 'General')] ??= []).push(i) })
  const done = items.filter(i => i.status === 'done').length
  let out = `✅ ${b('Checklist')} — ${done}/${items.length} done\n`
  for (const [cat, rows] of Object.entries(byCat)) {
    const d = rows.filter(r => r.status === 'done').length
    out += `\n${b(cat)} (${d}/${rows.length})\n`
    out += rows.filter(r => r.status !== 'done').map(r => {
      const overdue = r.due_date && String(r.due_date) < today ? ' ⚠️' : ''
      const icon = r.status === 'in_progress' ? '🔄' : '⬜'
      const pic = r.pic_name ? ` — ${esc(r.pic_name)}` : ''
      return `  ${icon} ${esc(r.item)}${pic}${overdue}`
    }).join('\n') || '  ✅ all done'
  }
  return out
}

function fmtFind(att: Row[], q: string) {
  if (q.length < 2) return 'Give me at least 2 characters: /find <name>'
  const ql = q.toLowerCase()
  const m = att.filter(a =>
    String(a.name ?? '').toLowerCase().includes(ql) ||
    String(a.email ?? '').toLowerCase().includes(ql) ||
    String(a.phone ?? '').includes(q))
  if (!m.length) return `❌ No attendee matching "${esc(q)}"`
  return m.slice(0, 20).map(a => {
    const s = a.payment_status === 'paid' ? '✅ Paid' : a.payment_status === 'free' ? '🎟 Free' : '⏳ Pending'
    const ci = a.attendance_confirmed ? ' · 🏃 checked in' : ''
    const phone = a.phone ? `\n📱 ${esc(a.phone)}` : ''
    const email = a.email ? `\n✉️ ${esc(a.email)}` : ''
    return `${b(a.name)}\n🎫 ${esc(tt(a.ticket_type))} · ${s}${ci}${phone}${email}`
  }).join('\n\n')
}

function fmtTeam(ev: Row) {
  const team = (ev.team as Row[]) || []
  if (!team.length) return '— No team roster set.'
  const byRole: Record<string, Row[]> = {}
  team.forEach(t => { (byRole[String(t.role || 'Team')] ??= []).push(t) })
  let out = `👥 ${b('Team Roster')} (${team.length})\n`
  for (const [role, members] of Object.entries(byRole)) {
    out += `\n${b(role)}\n`
    out += members.map(m => `  • ${esc(m.name)}${m.phone ? ` — ${esc(m.phone)}` : ''}`).join('\n')
  }
  return out
}

function fmtMoney(att: Row[], exp: Row[]) {
  const paid = att.filter(a => a.payment_status === 'paid')
  const rev = revenue(att)
  const stripe = paid.filter(a => a.payment_method === 'stripe').reduce((s, a) => s + num(a.payment_amount), 0)
  const bank = paid.filter(a => a.payment_method === 'bank_transfer').reduce((s, a) => s + num(a.payment_amount), 0)
  const spend = totalExpenses(exp)
  const byTier: Record<string, { n: number; sum: number }> = {}
  paid.forEach(a => {
    const k = tt(a.ticket_type)
    byTier[k] ??= { n: 0, sum: 0 }
    byTier[k].n++; byTier[k].sum += num(a.payment_amount)
  })
  let out = `💰 ${b('Money')}\n\n`
  out += `Revenue: ${b('RM ' + rev.toLocaleString())}\n`
  out += `  • Stripe: RM ${stripe.toLocaleString()}\n  • Bank: RM ${bank.toLocaleString()}\n\n`
  out += `By tier:\n` + Object.entries(byTier).map(([k, v]) => `  • ${esc(k)}: ${v.n}× = RM ${v.sum.toLocaleString()}`).join('\n')
  out += `\n\n💸 Expenses: ${b('RM ' + spend.toLocaleString())}`
  if (exp.length) {
    const byCat: Record<string, number> = {}
    exp.forEach(e => { byCat[String(e.category || 'Other')] = (byCat[String(e.category || 'Other')] || 0) + num(e.amount) })
    out += '\n' + Object.entries(byCat).map(([c, v]) => `  • ${esc(c)}: RM ${v.toLocaleString()}`).join('\n')
  }
  out += `\n\n📈 Net profit: ${b('RM ' + (rev - spend).toLocaleString())}`
  return out
}

function fmtSurvey(survey: Row[], att: Row[]) {
  if (!survey.length) return '— No survey responses yet.'
  const paid = att.filter(a => a.payment_status === 'paid').length
  const byInd: Record<string, number> = {}
  const bySize: Record<string, number> = {}
  survey.forEach(s => {
    if (s.industry) byInd[String(s.industry)] = (byInd[String(s.industry)] || 0) + 1
    if (s.company_size) bySize[String(s.company_size)] = (bySize[String(s.company_size)] || 0) + 1
  })
  const top = (o: Record<string, number>) => Object.entries(o).sort((a, c) => c[1] - a[1]).slice(0, 6)
  let out = `📋 ${b('Survey')} — ${survey.length} responses (${paid} paid attendees)\n\n`
  out += `${b('Top industries')}\n` + top(byInd).map(([k, v]) => `  • ${esc(k)}: ${v}`).join('\n')
  out += `\n\n${b('Company size')}\n` + top(bySize).map(([k, v]) => `  • ${esc(k)}: ${v}`).join('\n')
  return out
}

function fmtFloorplan(ev: Row) {
  const fp = ev.floor_plan as Row | null
  if (!fp) return '— No floor plan set.'
  const sections = (fp.sections as Row[]) || []
  const planned = sections.reduce((s, x) => s + num(x.pax), 0)
  let out = `🗺 ${b('Floor Plan')}\n`
  out += `★ Stage: ${b(fp.stage_speaker || '—')}\n`
  out += `📋 Registration: ${esc(fp.registration || '—')}\n`
  out += `🍱 F&B: ${esc(fp.fnb || '—')}\n`
  out += `📹 Videographer: ${esc(fp.videographer || '—')}\n`
  out += `\nPlanned seating: ${b(planned + ' pax')} across ${sections.length} sections\n`
  out += sections.map(s => `  • ${esc(s.label)} — ${esc(s.pax)} ${esc(tt(s.type))}${s.note ? ` (${esc(String(s.note).split('•')[0].trim())})` : ''}`).join('\n')
  const needs = (fp.speaker_needs as string[]) || []
  if (needs.length) out += `\n\n🎤 Speaker needs:\n` + needs.map(n => `  • ${esc(n)}`).join('\n')
  return out
}

function fmtMeetings(meetings: Row[]) {
  if (!meetings.length) return '— No meetings logged for this event.'
  return meetings.map(m => {
    const att = (m.attendance as Row[]) || []
    const present = att.filter(a => a.attended).length
    const missed = att.filter(a => !a.attended).map(a => esc(a.name)).join(', ')
    const d = m.meeting_date ? new Date(m.meeting_date as string).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }) : '—'
    return `${b(m.title)} <i>(${esc(d)})</i>\n  Attendance: ${present}/${att.length}` + (missed ? `\n  Missed: ${missed}` : '')
  }).join('\n\n')
}

function fmtDuplicates(att: Row[]) {
  const groups: Record<string, Row[]> = {}
  att.forEach(a => {
    const key = String(a.email || a.phone || '').toLowerCase().replace(/\s|\+|^0+/g, '')
    if (key) (groups[key] ??= []).push(a)
  })
  const dupes = Object.values(groups).filter(g => g.length > 1)
  if (!dupes.length) return '✅ No duplicate attendees detected (by email/phone).'
  return `⚠️ ${b(dupes.length + ' possible duplicate(s)')}:\n\n` +
    dupes.map(g => `${esc(g[0].name)} ×${g.length}\n` + g.map(a => `  • ${esc(tt(a.ticket_type))} · ${esc(a.payment_status)} · ${esc(a.email || a.phone)}`).join('\n')).join('\n\n')
}

async function fmtLeads() {
  const { data, error } = await supabase.from('leads').select('owner, affiliate_handle')
  if (error) return `🗂 ${b('Leads')}\nCould not load leads.`
  const rows = data ?? []
  const total = rows.length
  const affiliate = rows.filter(r => r.owner === 'affiliate').length
  const kingsley = total - affiliate
  const byHandle: Record<string, number> = {}
  rows.forEach(r => {
    if (r.owner === 'affiliate') {
      const h = (r.affiliate_handle as string) || '?'
      byHandle[h] = (byHandle[h] ?? 0) + 1
    }
  })
  const top = Object.entries(byHandle).sort((a, c) => c[1] - a[1]).slice(0, 10)
  let out = `🗂 ${b('Leads')} — ${total} total\n`
  out += `${b('Affiliate')}: ${affiliate}   ${b('Kingsley')}: ${kingsley}\n`
  if (top.length) {
    out += `\n${b('Top affiliates by leads')}\n`
    out += top.map(([h, n]) => `• ${esc(h)}: ${n}`).join('\n')
  }
  return out
}

async function fmtAffiliates(eventId: string) {
  const rep = await buildReport(eventId)
  const money = (n: number) => 'RM ' + n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (!rep.summary.length) return `🤝 ${b('Affiliates')}\nNo attributions yet. Open the Affiliates page to auto-match or assign.`
  let out = `🤝 ${b('Affiliate Payout (10%)')}\n`
  rep.summary.forEach(s => {
    out += `\n${b(s.handle)} — ${money(s.commission)}\n  <i>${s.buyers} buyer${s.buyers !== 1 ? 's' : ''} · ${money(s.revenue)} revenue</i>`
  })
  out += `\n\n${b('Total payout')}: ${money(rep.totals.total_commission)}`
  out += `\n<i>Unattributed: ${money(rep.totals.unattributed_revenue)}</i>`
  return out
}

async function fmtPrep(eventId: string) {
  const STEP = { '1': 'Install', '2': 'Pro', '3': 'Videos', '4': 'Survey', '5': '9:30am' } as const
  const { data } = await supabase
    .from('prep_progress').select('name, phone, steps, completed').eq('event_id', eventId)
  const rows = data ?? []
  if (!rows.length) return `🎓 ${b('Pre-Workshop Prep')}\nNo one has started yet. Share the /start link.`
  const started = rows.length
  const completed = rows.filter(r => r.completed).length
  const per: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }
  for (const r of rows) {
    const s = (r.steps ?? {}) as Record<string, boolean>
    for (const k of Object.keys(per)) if (s[k]) per[k]++
  }
  let out = `🎓 ${b(`Prep: ${completed}/${started} workshop-ready`)}\n${started - completed} still in progress\n`
  out += '\n' + Object.entries(STEP).map(([k, lbl]) => `• ${esc(lbl)}: ${per[k]} ✓`).join('\n')
  const pending = rows.filter(r => !r.completed).map(r => esc((r.name as string) || (r.phone as string)))
  if (pending.length) out += `\n\n${b('Still pending')}:\n` + pending.slice(0, 25).map(n => `• ${n}`).join('\n')
  return out
}

const HELP = `🤖 ${b('Jarvis')} — your EventOps assistant\n\n` +
  `${b('Quick commands')}\n` +
  `/stats — full event summary\n` +
  `/money — revenue, expenses, profit\n` +
  `/checkins — who's checked in\n` +
  `/pending — unpaid attendees\n` +
  `/vip — VIP list\n` +
  `/checklist — tasks + overdue + PIC\n` +
  `/team — team roster + phones\n` +
  `/floorplan — seating layout\n` +
  `/survey — audience insights\n` +
  `/meetings — meeting attendance\n` +
  `/duplicates — flag duplicate entries\n` +
  `/affiliates — creator commission payout\n` +
  `/leads — master leads (affiliate vs Kingsley)\n` +
  `/prep — pre-workshop readiness\n` +
  `/find &lt;name&gt; — look up an attendee\n\n` +
  `Or just ${b('ask anything')} in plain English 👇\n` +
  `<i>e.g. "who hasn't paid?", "how full are we vs capacity?", "which paid attendees skipped the survey?"</i>\n\n` +
  `${b('🧾 Invoices')}\n` +
  `<i>"send Daphne an invoice"</i> · <i>"invoice Ken Ang RM 497"</i> · <i>"make an invoice for Jeremy with 2000 deposit"</i>\n` +
  `→ Jarvis generates a branded PDF and sends it back as a file.`

// ── Invoice generation (via Jarvis tool-use) ──────────────────────────────────

// JSON schema for Claude's tool
const GENERATE_INVOICE_TOOL: Anthropic.Tool = {
  name: 'generate_invoice',
  description:
    'Generate a branded Oppa-Media PDF invoice for an attendee and send it as a file. ' +
    'Use this whenever the admin asks to create, send, or make an invoice. ' +
    'Look up the attendee by their name (partial match supported). The PDF is sent ' +
    'to the chat as a file — do NOT also reply with a text summary; the tool result handles it.',
  input_schema: {
    type: 'object',
    properties: {
      attendee_name: {
        type: 'string',
        description: 'Name (or partial name) of the attendee to invoice. Will look up in the active event first, then all events.',
      },
      override_amount: {
        type: 'number',
        description: 'Optional total amount in RM. Defaults to the attendee\'s recorded payment_amount.',
      },
      description: {
        type: 'string',
        description: 'Optional line-item description. Defaults to "[<ticket label>] Claude Workshop".',
      },
      mode: {
        type: 'string',
        enum: ['quick', 'balance'],
        description: 'quick = single line + TOTAL box. balance = multi-line with Subtotal/Payments/BALANCE DUE. Default: quick.',
      },
      payments_received: {
        type: 'array',
        description: 'Only used when mode=balance. Each payment received so far.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'e.g. "TnG · Deposit"' },
            amount: { type: 'number', description: 'Amount in RM' },
          },
          required: ['label', 'amount'],
        },
      },
    },
    required: ['attendee_name'],
  },
}

type InvoiceToolInput = {
  attendee_name: string
  override_amount?: number
  description?: string
  mode?: 'quick' | 'balance'
  payments_received?: { label: string; amount: number }[]
}

// Execute the invoice tool: look up attendee → build InvoiceData → render PDF →
// send via Telegram. Returns a short text status that becomes Claude's tool_result.
async function executeInvoiceTool(
  input: InvoiceToolInput,
  chatId: number,
  ev: Row,
): Promise<string> {
  const matches = await findAttendeesByName(input.attendee_name, ev.id as string)
  // Fall back to all events if nothing matches in active event
  const finalMatches = matches.length ? matches : await findAttendeesByName(input.attendee_name)

  if (finalMatches.length === 0) {
    return `No attendee matching "${input.attendee_name}". Try a different spelling or check /attendees.`
  }
  if (finalMatches.length > 1) {
    const list = finalMatches.slice(0, 5).map((m: AttendeeMatch) => `• ${m.name} (${m.ticket_label}, RM ${m.payment_amount})`).join('\n')
    return `Multiple matches for "${input.attendee_name}":\n${list}\nReply with a more specific name.`
  }

  const a = finalMatches[0]
  const mode = input.mode || 'quick'
  const amount = input.override_amount ?? a.payment_amount
  const desc = input.description || `[${a.ticket_label}] Claude Workshop`

  let lineItems: InvoiceLineItem[]
  let payments: InvoicePayment[] | undefined

  if (mode === 'balance') {
    lineItems = [{ desc, qty: 1, unit: amount }]
    payments = input.payments_received || []
  } else {
    lineItems = [{ desc, qty: 1, unit: amount }]
  }

  const invoice: InvoiceData = {
    clientName: a.name,
    date: new Date(),
    lineItems,
    payments,
    note: mode === 'quick' ? '[non refundable' : undefined,
  }

  await sendUploadingDoc(chatId)
  const pdfBuffer = await renderInvoicePDF(invoice)
  const safeName = a.name.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '-')
  await sendDocument(chatId, `Invoice-${safeName}.pdf`, pdfBuffer,
    `🧾 <b>Invoice</b> for ${esc(a.name)} — RM ${amount.toLocaleString('en-MY')}`)

  return `Invoice PDF sent to the chat for ${a.name} (RM ${amount}).`
}

// ── Claude natural-language fallback ──────────────────────────────────────────
async function askClaude(question: string, ev: Row, d: Awaited<ReturnType<typeof loadAll>>, chatId: number) {
  // Load every event (past + future) and their attendees so Claude can
  // answer questions about ANY event, not just the upcoming one.
  const allEvents = await getAllEvents()
  const eventIds = allEvents.map(e => e.id as string)
  const across = await loadAcrossEvents(eventIds)

  const eventsSnapshot = allEvents.map(e => {
    const att = across.attendees.filter(a => a.event_id === e.id)
    const exp = across.expenses.filter(x => x.event_id === e.id)
    return {
      id: e.id,
      name: e.name,
      date: e.date,
      venue: e.venue,
      capacity: e.capacity,
      is_active: e.is_active,
      days_until: daysUntil(e.date as string),
      totals: {
        registered: att.length,
        paid: att.filter(a => a.payment_status === 'paid').length,
        pending: att.filter(a => a.payment_status === 'pending').length,
        free: att.filter(a => a.payment_status === 'free').length,
        confirmed: att.filter(a => a.attendance_confirmed).length,
        revenue_rm: revenue(att),
        expenses_rm: totalExpenses(exp),
      },
      attendees: att.map(a => ({
        name: a.name, ticket: a.ticket_type, payment: a.payment_status,
        method: a.payment_method, amount: a.payment_amount,
        confirmed: a.attendance_confirmed, phone: a.phone, email: a.email, notes: a.notes,
      })),
      expenses: exp.map(x => ({ desc: x.description, amount: x.amount, category: x.category })),
    }
  })

  const snapshot = {
    today: new Date().toISOString().slice(0, 10),
    upcoming_event_id: ev.id,
    events: eventsSnapshot,
    // Active-event-only data that doesn't make sense to load globally
    active_event_checklist: d.checklist.map(c => ({ category: c.category, item: c.item, status: c.status, pic: c.pic_name, due: c.due_date })),
    active_event_survey: d.survey.map(s => ({ name: s.name, industry: s.industry, company_size: s.company_size, challenge: s.biggest_challenge, goal: s.workshop_goal })),
    active_event_meetings: d.meetings.map(m => ({ title: m.title, date: m.meeting_date, attendance: m.attendance })),
  }

  const system = `You are Jarvis — the EventOps assistant, an internal ops bot for the event organiser (a single trusted admin). You are sharp, concise, and quietly witty (think Tony Stark's Jarvis) — but never waste the admin's time with fluff. Answer questions about the event using the live JSON data below. Today is ${new Date().toISOString().slice(0, 10)}.

Rules:
- Be concise and direct. This is Telegram — short answers, no preamble.
- You may use these HTML tags ONLY: <b>, <i>. No markdown, no other tags, no headers.
- When listing people, use • bullets on separate lines.
- Do the math when asked (counts, %, revenue gaps, who's missing from X). Cross-reference survey vs attendees by name/phone when relevant.
- If data isn't present, say so plainly.
- If the admin asks to send, generate, create, or make an invoice for someone, CALL the generate_invoice tool — do not just describe what you would do. Infer mode='balance' only if they mention a deposit, partial payment, or balance; otherwise use mode='quick'.
- The snapshot below contains EVERY event (past and future). When the admin asks about a specific event (e.g. "1st June", "last month", "Claude Malaysia Workshop"), match by name OR date and answer from THAT event's data. Do NOT say "no data" just because an event is in the past — the data is right here in events[].

LIVE DATA:
${JSON.stringify(snapshot)}`

  // First turn: let Claude either answer directly OR call generate_invoice
  const first = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system,
    tools: [GENERATE_INVOICE_TOOL],
    messages: [{ role: 'user', content: question }],
  })

  // If Claude chose to call the invoice tool, execute it
  const toolUse = first.content.find(x => x.type === 'tool_use')
  if (toolUse && toolUse.type === 'tool_use' && toolUse.name === 'generate_invoice') {
    const status = await executeInvoiceTool(toolUse.input as InvoiceToolInput, chatId, ev)
    // We already sent the PDF (via sendDocument). Return empty so the caller
    // doesn't double-send. Errors / multi-match prompts come back through `status`.
    if (status.startsWith('Invoice PDF sent')) return ''
    return status
  }

  // Otherwise just return Claude's text reply
  const block = first.content.find(x => x.type === 'text')
  return block && block.type === 'text' ? block.text : 'Sorry, I could not generate a reply.'
}

// ── Command router ────────────────────────────────────────────────────────────
async function handle(text: string, ev: Row, d: Awaited<ReturnType<typeof loadAll>>): Promise<string> {
  const cmd = text.toLowerCase()
  if (cmd === '/start' || cmd === '/help') return HELP
  if (cmd === '/stats') return fmtStats(ev, d.attendees, d.expenses)
  if (cmd === '/money') return fmtMoney(d.attendees, d.expenses)
  if (cmd === '/checkins') return fmtCheckins(d.attendees)
  if (cmd === '/pending') return fmtPending(d.attendees)
  if (cmd === '/vip') return fmtVip(d.attendees)
  if (cmd === '/checklist') return fmtChecklist(d.checklist)
  if (cmd === '/team') return fmtTeam(ev)
  if (cmd === '/floorplan') return fmtFloorplan(ev)
  if (cmd === '/survey') return fmtSurvey(d.survey, d.attendees)
  if (cmd === '/meetings') return fmtMeetings(d.meetings)
  if (cmd === '/duplicates') return fmtDuplicates(d.attendees)
  if (cmd === '/affiliates') return await fmtAffiliates(ev.id as string)
  if (cmd === '/leads') return await fmtLeads()
  if (cmd === '/prep') return await fmtPrep(ev.id as string)
  if (cmd.startsWith('/find ')) return fmtFind(d.attendees, text.slice(6).trim())
  return '' // signal: natural language
}

// ── Main webhook ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Always ack with 200 so Telegram never retries (prevents duplicate-reply storms)
  try {
    if (WEBHOOK_SECRET && req.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    const update = await req.json()
    const message = update.message // ignore edited_message to avoid duplicate replies
    const voice = message?.voice || message?.audio
    if (!message?.text && !voice) return NextResponse.json({ ok: true })

    const userId = String(message.from?.id ?? '')
    const chatId = message.chat.id as number

    // Auth BEFORE transcription so Whisper credits are never spent on strangers
    if (ALLOWED_IDS.length && !ALLOWED_IDS.includes(userId)) {
      await sendMessage(chatId, `🚫 Not authorised.\n\nYour Telegram ID: <code>${esc(userId)}</code>`)
      return NextResponse.json({ ok: true })
    }

    // Resolve the text — typed, or transcribed from a voice note
    let text: string
    if (voice) {
      await sendTyping(chatId)
      try {
        text = await transcribeVoice(voice.file_id as string)
      } catch (e) {
        console.error('[telegram] transcribe failed', e)
        await sendMessage(chatId, '⚠️ Could not transcribe that voice note. Try again or type it.')
        return NextResponse.json({ ok: true })
      }
      if (!text) {
        await sendMessage(chatId, '🤔 I could not hear anything in that voice note.')
        return NextResponse.json({ ok: true })
      }
      await sendMessage(chatId, `🎙 <i>Heard:</i> "${esc(text)}"`)
    } else {
      text = (message.text as string).trim()
    }

    const ev = await getActiveEvent()
    if (!ev) {
      await sendMessage(chatId, '⚠️ No upcoming events found in EventOps.')
      return NextResponse.json({ ok: true })
    }

    const data = await loadAll(ev.id as string)

    let reply = await handle(text, ev, data)
    if (!reply) {
      await sendTyping(chatId)
      reply = await askClaude(text, ev, data, chatId)
    }

    // Empty reply = the handler already sent something (e.g. an invoice PDF)
    if (reply) await sendMessage(chatId, reply)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[telegram] unhandled', err)
    // Best-effort error reply to the admin, but still 200 to stop retries
    try {
      const u = await req.json().catch(() => null)
      const cid = u?.message?.chat?.id
      if (cid) await sendMessage(cid, '⚠️ Something went wrong handling that. Try again or use /help.')
    } catch { /* ignore */ }
    return NextResponse.json({ ok: true })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'jarvis-eventops-bot' })
}
