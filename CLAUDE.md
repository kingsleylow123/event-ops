# event-ops — Brain

> Claude Malaysia's **event operations platform**. The system that runs every workshop end-to-end: survey → leads → attendees → check-in → meetings → invoice/payout → month-end. Inherits brand, ICP, and voice from `../claudemalaysia/CLAUDE.md`.

## What this is

| Field | Value |
|-------|-------|
| **Purpose** | Run Claude Malaysia events/workshops operationally — the MoFu → BoFu engine |
| **Stack** | Next.js 16 · Supabase · Anthropic SDK · @react-pdf/renderer · Vercel |
| **Repo** | `github.com/kingsleylow123/event-ops` |
| **Parent brand** | Claude Malaysia (`@claudemalaysiaofficial`) — see `../claudemalaysia/CLAUDE.md` |
| **Cron** | `/api/affiliates/cron` daily 22:00 (affiliate payout calc) |

## Where it sits in the funnel

This app IS the MoFu→BoFu machinery. The workshop (MoFu) runs through here; the implementation call (BoFu) is booked off the back of it.

```
IG content → ManyChat DM → WhatsApp → [ event-ops: survey → workshop → check-in → call booked ] → B2B implementation
```

## Route map (the event lifecycle)

| Stage | Routes | Job |
|-------|--------|-----|
| **Pre-event** | `survey`, `leads`, `pending` | Capture signups, qualify (ICP = RM1-5M founder), pre-event survey per event |
| **Roster** | `attendees`, `events`, `team` | Manage who's coming, per-event roster |
| **Day-of** | `checkin`, `meeting-checkin`, `briefing`, `floorplan`, `checklist` | Run the room — check people in, seat them, brief the team |
| **Sales** | `meetings`, `insights` | Book + track BoFu implementation calls from attendees |
| **Money** | `invoice`, `payout`, `payment-template`, `revenue`, `month-end` | Invoice clients, pay affiliates, close the month |
| **Growth** | `affiliates` | Creator Circle (ToFu) — affiliate tracking + daily payout cron |
| **Admin** | `admin`, `auth`, `login`, `profile` | Access control, password reset |

## Key context

- **Surveys are event-parameterized via URL** — one survey page serves all events, switched by URL param. When updating "the survey for the 7th June event," you're changing which event the live link targets, not editing a per-event file.
- **Revenue is sensitive** — `useRevenueHidden` hook gates revenue visibility across pages. Respect it; don't expose revenue in shared/screenshot contexts by default.
- **Affiliates = Creator Circle** — the ToFu affiliate layer of Claude Malaysia. Payouts calculated by daily cron.
- **Sidebar nav is grouped by lifecycle** (pre-event → day-of → money), not alphabetical. New pages slot into the matching `app/Sidebar.tsx` group.

## Dev commands

```bash
npm run dev      # localhost:3000
npm run build    # production build (run before deploy)
npm run lint
```
Deploy: push to `master` → Vercel auto-deploys. Supabase migrations in `supabase/migrations/`.

## Supabase

- Project: `hxqpcicdrjgdjabkwlfu` (EventOps — the project the live code actually uses). Note: `wdkljqckvhzovnzkmisg` ("Content System") is a DIFFERENT project (freebie-maker / Content System), not this app.
- Events live in Supabase; survey responses, attendees, leads, affiliates all DB-backed
- Use `mcp__supabase__execute_sql` for reads, `apply_migration` for schema changes

## Rules for Claude in this folder

- **Inherit the Claude Malaysia brain** — ICP (RM1-5M Malaysian founders), voice, funnel all come from `../claudemalaysia/CLAUDE.md`. Don't re-derive them.
- **Lead qualification here = workshop signups** — ICP is the founder/decision-maker, NOT an employee or student who registered.
- **Always run `npm run build` before declaring a deploy ready** — catches TS errors.
- **Confirm before destructive SQL** — no `DELETE`/`DROP`/`TRUNCATE` without explicit permission (global hard rule).
- **Money pages**: never change invoice/payout logic without confirming amounts and recipients first.

@AGENTS.md
