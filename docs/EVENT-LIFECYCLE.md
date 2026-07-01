# EventOps — the A–Z event lifecycle & every tab

The canonical reference for how one workshop date flows end to end, and what every
sidebar tab is for. Jarvis (the Telegram bot) is given a condensed version of this
in `lib/jarvis/prompt.ts` so it can explain any tab and route to the right tool.

## The A–Z flow (one event date)

```
create → sell → tickets in → survey in → day-of → upsell → close-the-money → reconcile
```

1. **Create** — Events tab: a new `events` row (date, capacity, format, config links). Set Venue, Floor Plan, Team (Claude Intern), seed the Checklist.
2. **Sell** — Insights: generate + blast the per-event **survey link** (`/survey?event=<id>`) and the **ticket link**. (Phase 1 target: EventOps-generated Stripe checkout `/register?event=<id>` so each ticket carries its `event_id` — replaces the manual Payment Link.)
3. **Tickets in** — Stripe → `attendees` (paid). Event is decided by `metadata.event_id` (Phase 1) — today it's a "soonest upcoming event" guess, the cause of multi-date mis-routing.
4. **Survey in** — registrants fill the pre-event survey → `pre_event_survey_responses` (scoped by the link's `?event=`). A stale link = responses on the wrong event.
5. **Day-of** — Check-in kiosk (`/checkin/[eventId]`), Floor Plan, Briefing, attendance-pulse; closers use the **Capture** link to log hot leads → `deal_leads`.
6. **Upsell → close** — Pipeline (BoFu): `deal_leads` new → contacted → meeting (Cal.com auto-syncs bookings) → won → lost.
7. **Money** — Revenue (per-event P&L), Invoice (PDF), Affiliates (10% Creator-Circle), Payout (affiliate + facilitator disbursement).
8. **Reconcile** — Claims (expense reimbursements), Deposits (balance-due), Bukku (push to accounting), Month-End (monthly accrual close).

## The 24 tabs

### Pre-event
| Tab | Route | Purpose | Data |
|---|---|---|---|
| Dashboard | `/` | Active-event KPI cards + ticket-type breakdown | events, attendees |
| Events | `/events` | Create/edit events; date, capacity, format, config | events |
| Venues | `/venues` | **Static** venue catalogue (`lib/venues.ts`); writes `events.venue` text | code + events.venue |
| Leads | `/leads` | Master ToFu CRM (ManyChat/WhatsApp), owner/affiliate-tagged | leads |
| Insights | `/insights` | Per-event survey responses + survey link/QR + prep readiness | survey, events |
| Checklist | `/checklist` | Per-event run-sheet/SOP (status, PIC, overdue) | checklist_items |
| Claude Intern | `/team` | Per-event crew roster (speaker/facilitator/creator/videographer) | events.team JSONB |
| Team Profiles | `/team-profiles` | **Global** onboarding + bank profiles (payroll) | team_member_profiles |
| Floor Plan | `/floorplan` | Per-event/day seating layout | events.floor_plan JSONB |
| Briefing | `/briefing` | Static day-of crew briefing page | events (read) |

### During event
| Tab | Route | Purpose | Data |
|---|---|---|---|
| Attendees | `/attendees` | Roster, payment status, attendance, reassign | attendees |
| Facilitators | `/attendees?type=facilitator` | Facilitator check-in + cross-event streak leaderboard | attendees (is_facilitator) |

### Post-event
| Tab | Route | Purpose | Data |
|---|---|---|---|
| Pipeline | `/pipeline` | BoFu deal pipeline new→won | deal_leads |
| Revenue | `/revenue` | Per-event revenue − expenses P&L; log expenses | attendees, expenses |
| Affiliates | `/affiliates` | 10% Creator-Circle attribution + commission | affiliate_* |
| Payment | `/payment-template` | **Scratchpad** worksheet → launches /invoice (no DB) | — |

### Finance
| Tab | Route | Purpose | Data |
|---|---|---|---|
| Finance | `/finance` | CFO dashboard charts (trend, cashflow, aging) | cross-event aggregate |
| Reports | `/finance/reports` | 10 accounting reports (P&L, aged AR/AP, by customer/supplier) | varies |
| Invoice | `/invoice` | Branded PDF invoice generator (no DB) | — |
| Payout | `/payout` | Affiliate + facilitator **disbursement** + bank details | affiliate_payouts, facilitator_payouts |
| Claims | `/claims` | Expense reimbursement claims → auto-expense | claims, expenses |
| Deposits | `/deposits` | Partial-payment / balance-due tracker | deposits |
| Bukku | `/bukku` | Push revenue/bills to Bukku accounting; sync state | events.bukku_income_id, *.bukku_bill_id |
| Month-End | `/month-end` | Calendar-month accrual close + 8-step checklist | cross-event by month |

## Jarvis tool coverage
Jarvis has a tool for every tab that holds queryable data. The A–Z status of any
event is `get_event_lifecycle` (stage: draft → selling → imminent → live → wrap →
closed, plus a readiness ledger). Tab-specific: `get_checklist`, `get_event_team`,
`get_facilitator_stats`, `get_bukku_status`, `get_team_members`, `analyze_surveys`,
`get_pipeline`, `get_finance_summary`, `get_affiliate_report`, `get_facilitator_payouts`,
`get_claims_deposits`, `find_person`, `analyze_pricing`, `get_trend`, `search_leads`,
`list_events`/`compare_events`, `get_meetings`, `get_prep_status`. Venues, Payment,
Briefing, Invoice are knowledge-only (no DB query needed).
