# Monthly Accountant Bundle — setup & usage (Item D)

A local script that packages each month's **expense claims + receipts + a bank-statement slot**
for CMO Consulting Sdn Bhd, and (optionally) emails it to your accountant.

Script: [`scripts/cmo-monthly-bundle.mjs`](../../scripts/cmo-monthly-bundle.mjs)

## One-time setup

1. **Add two keys to `event-ops/.env.local`** (you paste these — I don't touch credentials):
   - `SUPABASE_SERVICE_ROLE_KEY=` — from Supabase → Project `hxqpcicdrjgdjabkwlfu` → Settings → API → `service_role` (without it the anon key is tried, which RLS may block).
   - `RESEND_API_KEY=` — only needed for `--send` (same key the deployed app uses).
2. **Set the accountant's email:** copy `scripts/.env.cmo.example` → `scripts/.env.cmo` and fill `ACCOUNTANT_EMAIL=`.

## Run it

```bash
cd ~/Documents/Projects/event-ops

# Build last month's folder only (no email) — safe to run anytime:
node scripts/cmo-monthly-bundle.mjs

# A specific month:
node scripts/cmo-monthly-bundle.mjs --month 2026-06

# Drop your bank-statement PDFs into the folder's bank-statements/ , then email it:
node scripts/cmo-monthly-bundle.mjs --month 2026-06 --send
```

Output lands in `~/CMO-Monthly/<YYYY-MM>/` (+ a `.zip`). Override with `--out <dir>`.

**Recommended flow:** run without `--send` → drop bank statements into `bank-statements/` → review → re-run with `--send`.

## Automate monthly (optional)

```bash
cp scripts/com.cmo.monthly-bundle.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.cmo.monthly-bundle.plist
```
Runs the 2nd of each month at 09:00, bundles the previous month, and emails (`--send`).
Check `which node` first and fix the node path in the plist if it isn't `/usr/local/bin/node`
(Apple Silicon Homebrew is usually `/opt/homebrew/bin/node`). Note: the auto-run emails
**without** bank statements unless you've dropped them in beforehand.

## Notes
- Receipts come from the Supabase `claims.receipt_url`. Right now **0 claims have receipts attached**
  (they're being captured in Bukku's Digital Shoebox via WhatsApp instead), so `receipts/` will be
  empty until receipts are uploaded through `/claims` — the claims CSV is still complete.
- Every email BCCs `finance@cmoaiconsulting.com` (same archive convention as `lib/email.ts`).
