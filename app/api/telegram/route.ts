import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET!
const ALLOWED_IDS = (process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Telegram send helper ──────────────────────────────────────────────────────
async function sendMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
}

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function getActiveEvent() {
  const now = new Date().toISOString()
  const { data } = await supabase
    .from('events')
    .select('*')
    .gte('date', now)
    .order('date', { ascending: true })
    .limit(1)
  return data?.[0] ?? null
}

async function getAttendees(eventId: string) {
  const { data } = await supabase
    .from('attendees')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
  return data ?? []
}

async function getChecklist(eventId: string) {
  const { data } = await supabase
    .from('checklist_items')
    .select('*')
    .eq('event_id', eventId)
    .order('category')
  return data ?? []
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtStats(event: Record<string, unknown>, attendees: Record<string, unknown>[]) {
  const total = attendees.length
  const paid = attendees.filter(a => a.payment_status === 'paid').length
  const pending = attendees.filter(a => a.payment_status === 'pending').length
  const free = attendees.filter(a => a.payment_status === 'free').length
  const checkedIn = attendees.filter(a => a.attendance_confirmed).length
  const revenue = attendees
    .filter(a => a.payment_status === 'paid')
    .reduce((sum, a) => sum + Number(a.payment_amount ?? 0), 0)

  return `📊 *${event.name}*\n` +
    `📅 ${new Date(event.date as string).toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' })}\n\n` +
    `👥 Total: *${total}*\n` +
    `✅ Paid: *${paid}*\n` +
    `⏳ Pending: *${pending}*\n` +
    `🎟 Free: *${free}*\n` +
    `🏃 Checked in: *${checkedIn}*\n` +
    `💰 Revenue: *RM ${revenue.toLocaleString()}*`
}

function fmtCheckins(attendees: Record<string, unknown>[]) {
  const checkedIn = attendees.filter(a => a.attendance_confirmed)
  if (!checkedIn.length) return '🏃 No one checked in yet.'
  const list = checkedIn.map(a => `• ${a.name} (${(a.ticket_type as string).replace(/_/g, ' ')})`).join('\n')
  return `✅ *${checkedIn.length} checked in:*\n${list}`
}

function fmtPending(attendees: Record<string, unknown>[]) {
  const pending = attendees.filter(a => a.payment_status === 'pending')
  if (!pending.length) return '✅ No pending payments!'
  const list = pending.map(a => `• ${a.name} — RM${a.payment_amount} (${(a.ticket_type as string).replace(/_/g, ' ')})`).join('\n')
  return `⏳ *${pending.length} pending payments:*\n${list}`
}

function fmtVip(attendees: Record<string, unknown>[]) {
  const vips = attendees.filter(a => (a.ticket_type as string)?.includes('vip'))
  if (!vips.length) return '— No VIPs yet.'
  const list = vips.map(a => {
    const status = a.payment_status === 'paid' ? '✅' : a.payment_status === 'free' ? '🎟' : '⏳'
    const checkin = a.attendance_confirmed ? ' 🏃' : ''
    return `${status} ${a.name}${checkin}`
  }).join('\n')
  return `👑 *VIPs (${vips.length}):*\n${list}`
}

function fmtChecklist(items: Record<string, unknown>[]) {
  if (!items.length) return '— Checklist is empty.'
  const byCategory: Record<string, Record<string, unknown>[]> = {}
  items.forEach(i => {
    const cat = i.category as string || 'General'
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push(i)
  })
  return Object.entries(byCategory).map(([cat, rows]) => {
    const done = rows.filter(r => r.status === 'done').length
    const bar = `${done}/${rows.length}`
    const pending = rows.filter(r => r.status !== 'done').map(r => `  • ${r.item}`).join('\n')
    return `*${cat}* (${bar} done)${pending ? '\n' + pending : ''}`
  }).join('\n\n')
}

function fmtFind(attendees: Record<string, unknown>[], query: string) {
  const q = query.toLowerCase()
  const matches = attendees.filter(a =>
    (a.name as string)?.toLowerCase().includes(q) ||
    (a.email as string)?.toLowerCase().includes(q) ||
    (a.phone as string)?.includes(q)
  )
  if (!matches.length) return `❌ No attendee found matching "*${query}*"`
  return matches.map(a => {
    const status = a.payment_status === 'paid' ? '✅ Paid' : a.payment_status === 'free' ? '🎟 Free' : '⏳ Pending'
    const checkin = a.attendance_confirmed ? ' · 🏃 Checked in' : ''
    const ticket = (a.ticket_type as string).replace(/_/g, ' ')
    const phone = a.phone ? `\n📱 ${a.phone}` : ''
    return `*${a.name}*\n🎫 ${ticket} · ${status}${checkin}${phone}`
  }).join('\n\n')
}

// ── Claude fallback ───────────────────────────────────────────────────────────
async function askClaude(question: string, event: Record<string, unknown>, attendees: Record<string, unknown>[], checklist: Record<string, unknown>[]) {
  const context = `You are EventOps assistant for ${event.name} on ${new Date(event.date as string).toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.

ATTENDEES (${attendees.length} total):
${JSON.stringify(attendees.map(a => ({
  name: a.name, ticket: a.ticket_type, payment: a.payment_status,
  amount: a.payment_amount, checked_in: a.attendance_confirmed, phone: a.phone
})), null, 2)}

CHECKLIST (${checklist.length} items):
${JSON.stringify(checklist.map(c => ({
  category: c.category, item: c.item, status: c.status, pic: c.pic_name
})), null, 2)}

Answer the question clearly and concisely. Use plain text — no markdown headers. Keep it short (under 200 words).`

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    system: context,
    messages: [{ role: 'user', content: question }],
  })

  return (msg.content[0] as { text: string }).text
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Validate webhook secret
  const secret = req.headers.get('x-telegram-bot-api-secret-token')
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const update = await req.json()
  const message = update.message || update.edited_message
  if (!message?.text) return NextResponse.json({ ok: true })

  const userId = String(message.from?.id ?? '')
  const chatId = message.chat.id as number
  const text = (message.text as string).trim()

  // Auth check
  if (ALLOWED_IDS.length && !ALLOWED_IDS.includes(userId)) {
    await sendMessage(chatId, `🚫 Not authorised.\n\nYour Telegram ID: \`${userId}\``)
    return NextResponse.json({ ok: true })
  }

  // Load event data
  const event = await getActiveEvent()
  if (!event) {
    await sendMessage(chatId, '⚠️ No upcoming events found in EventOps.')
    return NextResponse.json({ ok: true })
  }

  const [attendees, checklist] = await Promise.all([
    getAttendees(event.id as string),
    getChecklist(event.id as string),
  ])

  // Route commands
  let reply = ''
  if (text === '/start' || text === '/help') {
    reply = `👋 *EventOps Bot*\n\n` +
      `*Commands:*\n` +
      `/stats — event summary\n` +
      `/checkins — who's checked in\n` +
      `/pending — unpaid attendees\n` +
      `/vip — VIP list\n` +
      `/checklist — task status\n` +
      `/find <name> — look up an attendee\n\n` +
      `Or just ask anything in plain English 👇`
  } else if (text === '/stats') {
    reply = fmtStats(event, attendees)
  } else if (text === '/checkins') {
    reply = fmtCheckins(attendees)
  } else if (text === '/pending') {
    reply = fmtPending(attendees)
  } else if (text === '/vip') {
    reply = fmtVip(attendees)
  } else if (text === '/checklist') {
    reply = fmtChecklist(checklist)
  } else if (text.toLowerCase().startsWith('/find ')) {
    reply = fmtFind(attendees, text.slice(6).trim())
  } else {
    // Natural language → Claude Haiku
    reply = await askClaude(text, event, attendees, checklist)
  }

  await sendMessage(chatId, reply)
  return NextResponse.json({ ok: true })
}

// Health check
export async function GET() {
  return NextResponse.json({ ok: true, service: 'eventops-telegram-bot' })
}
