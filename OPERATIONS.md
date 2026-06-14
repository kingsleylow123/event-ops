# EventOps — Operations Runbook

> For the human running an event (ops manager / team lead), **not** for developers.
> App: https://event-ops-six.vercel.app · Log in with your approved email.
> If something here doesn't match the app, the app is right — tell Kingsley to update this file.

---

## 1. The event lifecycle at a glance

| Phase | Where | What happens |
|---|---|---|
| Pre-event | Events · Leads · Insights · Checklist · Floor Plan · Briefing | Create event, blast links, watch readiness |
| Day-of | Check-in · Floor Plan · Briefing · Capture | Run the room, log hot leads |
| Post-event | Pipeline · Revenue · Affiliates · Payout · Invoice · Month-End | Close deals, pay people, close books |

Every morning at **8:00 AM MYT**, Jarvis sends admins a digest: fill %, revenue,
overdue checklist, **prep laggards, missing surveys, no-shows, deal leads going cold**.
If you only read one thing daily, read that.

## 2. Pre-event (from T-14 to T-1)

1. **Create the event** — Events → New Event. Pick the right **Format**
   (Workshop = in-person survey · Webinar = ops survey). Set date/venue/capacity.
2. **Set it Active** — Events → "Set Active". Jarvis and the dashboard follow the active event.
3. **Blast the three links** (each page has a copy button — never hand-type):
   - **Survey**: Insights → "Copy Survey Link" → `https://…/survey?event=<id>`
   - **Prep page**: Insights → "Copy Start Link" → `https://…/start?event=<id>`
   - **Lead capture** (closers only): Pipeline → "Copy capture link" → `https://…/capture?event=<id>`
4. **Watch readiness** — Insights shows survey answers + the Pre-Workshop Prep widget
   (who's done which of the 6 steps). Jarvis `/prep` gives the same on Telegram.
5. **Checklist** — work the Checklist page; overdue items appear in the daily digest.
6. **Floor plan** — Floor Plan page; the Briefing page renders it automatically for the team.

## 3. Day-of

- **Check-in kiosk**: `https://…/checkin` (public). Attendees type name or phone.
  Duplicate-looking matches ask for both. Already-checked-in shows a friendly error.
- **Team briefing**: `https://…/briefing` (public, shareable to the whole crew).
  Tabs per role. Bank transfer details are NOT on this page on purpose —
  closers get them from Kingsley/team lead in the closers' WhatsApp group.
- **Hot leads**: closers open the **capture link**, identify once (name + WhatsApp),
  log client name/phone/needs. Each lead **instantly pings Kingsley's Telegram**.
- **Jarvis during the event**: `/checkins` (who's arrived), `/vip`, `/pending` (unpaid),
  `/floorplan`, `/find <name>`.

## 4. Post-event (T+0 → T+3)

1. **Work the pipeline** — Pipeline page: move leads New → Contacted → Meeting → Won/Lost,
   add private notes. Leads stuck in "new" >48h appear in the daily digest.
2. **No-shows** — listed in the digest for 3 days (paid, never checked in).
   Re-engage: offer next date or deposit credit.
3. **Money** — Revenue (totals), Affiliates (auto-matched daily 6:00 MYT),
   Payout (mark paid), Invoice (PDF), Month-End (close the month).
4. Jarvis: `/money`, `/affiliates`, `/pipeline`, `/stats <event>`.

## 5. Jarvis (Telegram bot) cheat sheet

`/stats` event summary · `/money` revenue+profit · `/checkins` arrivals ·
`/pending` unpaid · `/vip` VIP list · `/checklist` tasks+overdue · `/team` roster ·
`/floorplan` seating · `/agenda` run-of-show · `/survey` insights ·
`/prep` workshop readiness · `/pipeline` hot leads · `/leads` master CRM ·
`/affiliates` payouts · `/affiliate <handle>` one creator · `/duplicates` dupes ·
`/find <name>` lookup · or just ask in plain English.

Tip: add an event to any command — `/stats 7 june`, `/pipeline 1jun`.

Access is controlled by the `TELEGRAM_ALLOWED_USER_IDS` env var (Vercel) — adding
a teammate needs their Telegram user ID added there + redeploy.

## 6. Automated jobs (Vercel Cron, UTC)

| Time (MYT) | Job | What it does |
|---|---|---|
| 06:00 | `/api/affiliates/cron` | Affiliate auto-match + new-sale pings + lead tag sync |
| 08:00 | `/api/jarvis/digest` | Daily ops digest (the morning message) |
| 08:30 | `/api/jarvis/anomaly` | Anomaly alerts |

All crons require `CRON_SECRET`. If digests stop arriving, check Vercel → Logs first.

## 7. Env vars (Vercel → Settings → Environment Variables)

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Database (public client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB access (bypasses RLS) — required |
| `AUTH_ENFORCE` | Guards. Missing = still enforced in production (fail-closed). `false` only for local debugging |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ALLOWED_USER_IDS` | Jarvis bot + who may use it |
| `TELEGRAM_WEBHOOK_SECRET` | Authenticates Telegram → app calls |
| `CRON_SECRET` | Authenticates Vercel Cron → app calls |
| `ANTHROPIC_API_KEY` | Jarvis NL answers + survey recommendations |
| `OPENAI_API_KEY` | Voice-note transcription in Jarvis |
| `STRIPE_WEBHOOK_SECRET` | Stripe → auto-create attendee webhook |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Optional: global rate limiting (falls back to per-instance without) |

**Never paste keys into chat or commit them.** Set them in Vercel, redeploy.

## 8. Troubleshooting

| Symptom | First move |
|---|---|
| Public page redirects to /login | The path is missing from `PUBLIC_PATHS` in `middleware.ts` |
| "Too many requests" on a public form | Rate limiter (generous; real users rarely hit it). Wait 60s |
| Digest didn't arrive at 8am | Vercel → Logs → `/api/jarvis/digest`; check `CRON_SECRET` |
| Jarvis silent | Vercel → Logs → `/api/telegram`; check bot token + allowed IDs |
| Leads page count looks short | Was the 1000-row truncation bug — fixed 2026-06-12; if it recurs, check `fetchAllRows` usage |
| Deploy didn't go live | `git push` does NOT deploy — run `vercel --prod --yes`, then `vercel inspect event-ops-six.vercel.app` |

## 9. Hard rules

- **Never** change invoice/payout amounts or recipients without Kingsley's explicit OK.
- **Never** delete events/attendees/leads without explicit permission.
- Money figures are sensitive — keep the revenue-hide toggle ON when screen-sharing.
