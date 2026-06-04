// Shared Telegram send helpers — used by both the webhook (app/api/telegram)
// and server-side notifiers (e.g. the affiliate-purchase cron). One impl.

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const ALLOWED_IDS = (process.env.TELEGRAM_ALLOWED_USER_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean)

type Body = Record<string, unknown>

// HTML escaping (parse_mode: HTML — only < > & need escaping)
export function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
export const b = (v: unknown) => `<b>${esc(v)}</b>`

export async function tg(method: string, body: Body) {
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

export function chunk(text: string, size = 3800): string[] {
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

export async function sendMessage(chatId: number | string, text: string) {
  for (const part of chunk(text)) {
    await tg('sendMessage', { chat_id: chatId, text: part, parse_mode: 'HTML', disable_web_page_preview: true })
  }
}

// Broadcast to every authorised admin (TELEGRAM_ALLOWED_USER_IDS).
export async function notifyAdmins(html: string) {
  for (const id of ALLOWED_IDS) {
    await sendMessage(id, html)
  }
}
