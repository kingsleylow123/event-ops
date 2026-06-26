// Telegram HTML escaping (parse_mode: HTML — only < > & need escaping).
// Mirrors the helpers in app/api/telegram/route.ts so the jarvis modules can
// build previews without importing from the route file.
export function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
export const b = (v: unknown) => `<b>${esc(v)}</b>`
