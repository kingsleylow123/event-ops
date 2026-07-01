# Ads Council Agent (v1) — Claude Malaysia workshop ads

An autonomous-but-**copilot** Meta/Instagram ads manager with a multi-agent self-review **council**. It senses ad performance, scores creative fatigue (re-anchored to **cost-per-ManyChat-DM**, not ROAS), runs a council of independent reviewers + a different-model judge, and posts **Approve/Reject** cards to Jarvis Telegram. **v1 changes nothing on live ad spend without a human tap.**

## Pipeline
```
nightly cron → 0 health-gate (breaker) → 1 sense (Meta insights, last 7d vs prior 7d)
→ 2 fatigue scorer (deterministic) → 3 council (4 Haiku reviewers, parallel)
→ 4 judge (Sonnet, different model, forced tool-use) → queue + Telegram card
→ [you tap Approve] → 5 guardrail executor (one capped write) → 6 log/snapshot
```

- **Council:** Scale-advocate · Kill-advocate (moderate dissent) · Significance-critic (hard veto on thin data) · Funnel-fit-critic. Each gets a different evidence lens so they don't rubber-stamp each other.
- **Judge:** different model from the debaters (bias mitigation); a hung judge force-commits to `escalate`, never a silent write.
- **Executor** is the only module that writes to Meta, only for an approved action: ≤`MAX_BUDGET_CHANGE_PCT` budget clamp, budget-governor ceiling, all-create-PAUSED, per-entity cooldown, prior-state snapshot for one-call rollback, and a circuit breaker on Meta throttle.

## Files
- `lib/ads-council/*` — engine (config, store, meta-api, fatigue, council, guardrails, executor, telegram-cards, run, index)
- `app/api/ads-council/run/route.ts` — nightly cron (Bearer `CRON_SECRET`)
- `app/api/ads-council/execute/route.ts` — manual approve+execute / rollback (Bearer `CRON_SECRET`)
- `app/api/telegram/route.ts` — `callback_query` branch routes button taps to the council
- `supabase/migrations/20260627190000_ads_council_v1.sql` — `ads_council_*` tables (RLS-on, server-only; already applied to `hxqpcicdrjgdjabkwlfu`)
- cron registered in `vercel.json` (`/api/ads-council/run`, `0 1 * * *` = 09:00 MYT)

## Environment (set in Vercel → event-ops project)

**Required to turn it on** (until both are set, the feature is inert):
```
META_ACCESS_TOKEN          = <long-lived system-user token with ads_management on the ad account>
META_AD_ACCOUNT_ID         = act_XXXXXXXXXXXX   (or just the digits)
```

**Recommended:**
```
META_PAGE_ID               = <FB page id backing the ads>
META_IG_USER_ID            = <Instagram actor id for @claudemalaysiaofficial>   (for creative refresh)
META_GRAPH_VERSION         = v23.0              (override if Meta deprecates it)
ADS_AUTONOMY_MODE          = copilot            (v1; set risk_tiered later for B)
ADS_DRY_RUN                = 1                  (recommended for the first night — deliberates + cards, never writes)
ADS_TARGET_COST_PER_DM     = <RM, e.g. 5>       (0 = learn baseline)
ADS_MIN_IMPRESSIONS        = 1000               (min-sample floor before a kill is allowed)
ADS_MIN_RESULTS            = 5
ADS_MIN_SPEND              = 50                  (RM)
ADS_MAX_BUDGET_CHANGE_PCT  = 20
ADS_COOLDOWN_HOURS         = 24
ADS_BUDGET_GOVERNOR_DAILY  = <RM/day ceiling, e.g. 300>   (0 = no ceiling)
ADS_MAX_CANDIDATES_PER_RUN = 12
ADS_RESULT_ACTION_TYPE     = messaging_conversation_started   (change if your objective isn't DM/messaging)
```

Already present in the repo and reused: `ANTHROPIC_API_KEY`, `CRON_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, `TELEGRAM_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`.

## CONFIG — fill these before go-live
```
META_AD_ACCOUNT_ID      = act_________
META_PAGE_ID            = _________
META_IG_USER_ID         = _________ (@claudemalaysiaofficial)
CAMPAIGN_OBJECTIVE      = messaging / Instagram-DM  (so cost-per-DM is a native Meta result)
TARGET_COST_PER_DM      = RM____  (or leave 0 to learn)
DAILY_BUDGET_PER_ADSET  = RM____  ·  TYPICAL_ADSET_COUNT = ____
MIN_SAMPLE_FLOOR        = ____ impr / ____ DMs / RM____ spend before any kill/cut
BUDGET_GOVERNOR_DAILY   = RM____/day per account
```

## Go-live checklist
1. Create a Meta **system-user token** with `ads_management` + `ads_read` on the ad account; set `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` in Vercel.
2. Confirm the workshop campaign uses a **messaging/DM objective** so "messaging conversations started" is a native result (else set `ADS_RESULT_ACTION_TYPE`).
3. Set `ADS_DRY_RUN=1` for the first run. Trigger manually:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://event-ops-six.vercel.app/api/ads-council/run`
4. Check Telegram cards arrive with sensible reasoning; review `ads_council_actions` in Supabase.
5. Tap **Approve** on a dry-run card → confirms the callback + executor wiring (logs a `dry_run` commit, no Meta write).
6. Remove `ADS_DRY_RUN` to go live in copilot mode. Approvals now commit one capped write each.
7. (Later, optional) Set `ADS_AUTONOMY_MODE=risk_tiered` to let reversible **cost-DOWN** actions (pause dead ad / cut spend ≤cap) auto-fire; spend-UP and new-creative stay gated.

## Fatigue thresholds (re-anchored to cost-per-DM)
- **WATCH** (monitor, no card): CTR −10–15% WoW OR frequency ≥ 2.5.
- **REFRESH** (`refresh_creative`): CTR −20% WoW with ≥2 metrics degrading, OR freq > 3.0, OR cost/DM +15% WoW.
- **REPLACE** (`pause`): CTR −30%+ WoW, OR CPM doubling, OR freq > 4, OR cost/DM +50%.
- **WINNER** (`scale`): below-target/stable cost/DM, CTR stable, freq < 2, enough data → propose +20% adset budget.
- **Saturation flag:** CPM +50%+ while CTR flat.
These are starting hypotheses (the research's numbers are DTC/ROAS-calibrated) — tune on real data via `ads_policy_memory`.

## Safety guarantees
- **copilot mode: no Meta write without a Telegram approval.** The cron only queues + notifies.
- Council has **zero write access**; the deterministic executor is the only writer and enforces caps/governor/cooldown/breaker **below** the council, so no LLM verdict can exceed them.
- **Never deletes** — only pauses. Every committed write is snapshotted for one-call rollback.
- Circuit breaker persists in Supabase, so a throttle survives across cron runs.
