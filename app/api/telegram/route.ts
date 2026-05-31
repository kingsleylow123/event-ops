import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET!
const ALLOWED_IDS = (process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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
  const tr = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'en',
    prompt: 'EventOps assistant. Topics: attendees, paid, pending, VIP, revenue, checklist, survey, check-ins, floor plan, team.',
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

// ── Data loading ──────────────────────────────────────────────────────────────
async function getActiveEvent() {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('events').select('*')
    .gte('date', now).order('date', { ascending: true }).limit(1)
  if (error) throw new Error(`events: ${error.message}`)
  return data?.[0] ?? null
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

const HELP = `👋 ${b('EventOps Bot')}\n\n` +
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
  `/find &lt;name&gt; — look up an attendee\n\n` +
  `Or just ${b('ask anything')} in plain English 👇\n` +
  `<i>e.g. "who hasn't paid?", "how full are we vs capacity?", "which paid attendees skipped the survey?"</i>`

// ── Claude natural-language fallback ──────────────────────────────────────────
async function askClaude(question: string, ev: Row, d: Awaited<ReturnType<typeof loadAll>>) {
  const snapshot = {
    event: {
      name: ev.name, date: ev.date, venue: ev.venue, capacity: ev.capacity,
      days_until: daysUntil(ev.date as string),
      team: ev.team, floor_plan: ev.floor_plan,
    },
    totals: {
      registered: d.attendees.length,
      paid: d.attendees.filter(a => a.payment_status === 'paid').length,
      pending: d.attendees.filter(a => a.payment_status === 'pending').length,
      free: d.attendees.filter(a => a.payment_status === 'free').length,
      confirmed: d.attendees.filter(a => a.attendance_confirmed).length,
      revenue_rm: revenue(d.attendees),
      expenses_rm: totalExpenses(d.expenses),
      net_rm: revenue(d.attendees) - totalExpenses(d.expenses),
      survey_responses: d.survey.length,
    },
    attendees: d.attendees.map(a => ({
      name: a.name, ticket: a.ticket_type, payment: a.payment_status,
      method: a.payment_method, amount: a.payment_amount,
      confirmed: a.attendance_confirmed, phone: a.phone, email: a.email, notes: a.notes,
    })),
    checklist: d.checklist.map(c => ({ category: c.category, item: c.item, status: c.status, pic: c.pic_name, due: c.due_date })),
    expenses: d.expenses.map(e => ({ desc: e.description, amount: e.amount, category: e.category })),
    survey: d.survey.map(s => ({ name: s.name, industry: s.industry, company_size: s.company_size, challenge: s.biggest_challenge, goal: s.workshop_goal })),
    meetings: d.meetings.map(m => ({ title: m.title, date: m.meeting_date, attendance: m.attendance })),
  }

  const system = `You are the EventOps assistant — an internal ops bot for the event organiser (a single trusted admin). Answer questions about the event using the live JSON data below. Today is ${new Date().toISOString().slice(0, 10)}.

Rules:
- Be concise and direct. This is Telegram — short answers, no preamble.
- You may use these HTML tags ONLY: <b>, <i>. No markdown, no other tags, no headers.
- When listing people, use • bullets on separate lines.
- Do the math when asked (counts, %, revenue gaps, who's missing from X). Cross-reference survey vs attendees by name/phone when relevant.
- If data isn't present, say so plainly.

LIVE DATA:
${JSON.stringify(snapshot)}`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: question }],
  })
  const block = msg.content.find(x => x.type === 'text')
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
      reply = await askClaude(text, ev, data)
    }

    await sendMessage(chatId, reply)
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
  return NextResponse.json({ ok: true, service: 'eventops-telegram-bot' })
}
