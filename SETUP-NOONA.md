# EventOps — Full Setup Guide for Noona

This dashboard tracks event attendees + payments for Kingsley's events. Both your laptop and Kingsley's stay synced via GitHub (code) and Supabase (data).

---

## How sync works (read first)

| What | Synced via | When |
|------|-----------|------|
| **Code** (pages, features, bug fixes) | GitHub (`git push` / `git pull`) | Manual — push when you edit, pull before you start |
| **Data** (attendees, checklist, events) | Supabase (live PostgreSQL) | Instant — both see same DB always |
| **Live website** | Vercel auto-deploy | Every push to `main` → live in ~30 sec at https://event-ops.vercel.app |

So: if you add an attendee on your machine, Kingsley sees it instantly on his. If you change a button color in code, you push → he pulls.

---

## Step 1 — Accept GitHub invite

1. Open https://github.com/kingsleylow123/event-ops/invitations
2. Click **Accept invitation**
3. You now have write access to the repo

---

## Step 2 — Install prerequisites (one-time)

Open **Terminal** and check what you have:

```bash
node --version    # need v20+
npm --version
git --version
gh --version      # GitHub CLI (optional but recommended)
```

If anything is missing, install via Homebrew:

```bash
# Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Then:
brew install node git gh
```

---

## Step 3 — Authenticate Git with GitHub

```bash
gh auth login
```
Choose: GitHub.com → HTTPS → Login with browser → paste the code.

---

## Step 4 — Clone the repo

```bash
mkdir -p ~/Documents/Projects
cd ~/Documents/Projects
git clone https://github.com/kingsleylow123/event-ops.git
cd event-ops
npm install
```

---

## Step 5 — Add the secrets file

Create a file at `~/Documents/Projects/event-ops/.env.local` with this template:

```
NEXT_PUBLIC_SUPABASE_URL=https://hxqpcicdrjgdjabkwlfu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ask Kingsley>
STRIPE_SECRET_KEY=<ask Kingsley — starts with rk_live_>
STRIPE_PUBLISHABLE_KEY=<ask Kingsley — starts with pk_live_>
```

Kingsley will send you the 3 secret values via WhatsApp / Signal / 1Password — **do not paste them anywhere public**. Paste each value in place of the `<ask Kingsley>` placeholders.

⚠️ **NEVER commit this file** — it's already in `.gitignore`.

---

## Step 6 — Run locally

```bash
cd ~/Documents/Projects/event-ops
npm run dev
```

Open http://localhost:3000 — you should see the dashboard with live data.

---

## Step 7 — Open in Claude Code

```bash
cd ~/Documents/Projects/event-ops
claude
```

Then tell Claude:
> Read CLAUDE.md and the SETUP-NOONA.md file, then summarize what this project does.

That gives Claude full context.

---

## Daily workflow (after setup)

**Before you start working:**
```bash
cd ~/Documents/Projects/event-ops
git pull
```

**After you make code changes:**
```bash
git add -A
git commit -m "describe what you changed"
git push
```
→ Vercel auto-deploys in 30 seconds.

**Data changes (adding attendees, checklist items):** just do it in the dashboard — auto-saved to Supabase, Kingsley sees instantly.

---

## Project structure

```
event-ops/
├── app/
│   ├── page.tsx              # Dashboard overview
│   ├── attendees/page.tsx    # Attendee list + manual add + Stripe sync
│   ├── checklist/page.tsx    # Event checklist by category
│   ├── events/page.tsx       # Event manager (active event toggle)
│   └── api/
│       ├── attendees/        # CRUD for attendees
│       ├── checklist/        # CRUD for checklist
│       ├── events/           # CRUD for events
│       └── stripe/sync/      # Pulls paid sessions from Stripe
├── lib/
│   ├── supabase.ts          # DB client + types
│   └── stripe.ts            # Stripe client
└── .env.local               # SECRETS (not in git)
```

---

## Common tasks

**Add a new ticket tier:** edit `lib/supabase.ts` → `TICKET_LABELS` + `TICKET_PRICES`, then update `app/api/stripe/sync/route.ts` → `guessTicketType()`.

**Sync new Stripe payments:** open `/attendees` page → click "Sync Stripe" button.

**Add new event:** open `/events` page → "+ New Event" → set as active.

**Add checklist items:** open `/checklist` → "+ Add Item" → pick category + PIC.

---

## Live URLs

- **Dashboard (production):** https://event-ops.vercel.app
- **GitHub repo:** https://github.com/kingsleylow123/event-ops
- **Supabase DB:** https://supabase.com/dashboard/project/hxqpcicdrjgdjabkwlfu
- **Stripe dashboard:** https://dashboard.stripe.com

---

## If something breaks

| Problem | Fix |
|---------|-----|
| `npm run dev` fails on port 3000 | Run `lsof -ti:3000 \| xargs kill -9` then try again |
| Page stuck on "Loading..." | Check `.env.local` exists and has correct keys |
| `git push` rejected | Run `git pull --rebase` first, then push |
| Stripe sync returns 0 | Check `STRIPE_SECRET_KEY` in `.env.local` |
| Vercel deploy fails | Check the Vercel dashboard logs — usually a TS error |

Ping Kingsley if stuck — or ask Claude Code: "Why is X failing? Here's the error: [paste]"
