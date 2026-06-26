# Half-day prep: MCP/Connector step + per-step quiz gating

**Date:** 2026-06-25
**Scope:** Half-day workshop variant of `/start` (all half-day events; not GLCC).
**Status:** Approved design — pending spec review, then implementation plan.

## Goal

1. Add a new step — **"Connect your apps to Claude (MCP / Connectors)"** — after "Install dev tools," with the Loom walkthrough embedded.
2. Make the half-day flow **strictly sequential**: a step locks until the step above it is complete.
3. Gate each step behind a short **objective quiz** (ABCD or True/False): after a participant ticks a step, they must answer its question correctly before the next step unlocks. Each quiz has a **hint button** and reveals the **"why"** explanation.

This makes the half-day flow match the GLCC flow's locking, and adds an engagement/learning gate on top.

## Current state (what we're changing)

- The half-day variant (`PREP_STEP_KEYS = ['1'..'6']`) renders 6 step cards in `app/start/page.tsx`. Tapping a card's round checkbox marks it done immediately. **No locking** today (locking is GLCC-only via `isLocked`, which is guarded by `isGlcc`).
- Step content today: 1 Install Claude Code · 2 Get Claude Pro · 3 Install dev tools · 4 Fill survey · 5 Prepare data · 6 Show up 9:30am.
- Progress (`done` booleans per step key) is saved to `localStorage` and synced to the cloud via `POST /api/prep`. Insights readiness board and Jarvis `/prep` read per-step counts from `lib/prep-steps.ts` (centralized).

## Design

### Step list change (stable keys, no renumbering)

The new step gets key **`'mcp'`**, inserted **after `'3'`** in the ordered key array:

```
PREP_STEP_KEYS = ['1', '2', '3', 'mcp', '4', '5', '6']
```

- Existing keys `1–6` keep their meaning → **no stored progress is corrupted** for in-progress attendees.
- Array order drives both lock order and Insights bar order, so it must be the visual order.
- **Display numbers are computed by position** (1–7), so the UI reads cleanly: MCP shows as "Step 4," survey as "Step 5," data as "Step 6," venue as "Step 7," while their underlying keys stay `mcp/4/5/6`.

Labels added in `lib/prep-steps.ts`:
- `PREP_STEP_LABELS['mcp'] = 'Connect apps (MCP)'`
- `PREP_STEP_SHORT['mcp'] = 'MCP'`

### Locking (extend to half-day)

Change `isLocked` so it applies to both variants and never locks an already-done step:

```ts
const isLocked = (n: string) =>
  !previewUnlock && stepKeys.indexOf(n) > firstOpenIdx && !steps[n]
```

- For a fresh attendee this is identical to today's GLCC behavior.
- The `&& !steps[n]` guard prevents an already-completed step (e.g. a mid-progress half-day attendee whose `survey` was done before `mcp` existed) from showing as locked.
- Each half-day `StepCard` now receives `locked={isLocked(<key>)}`.

### Quiz mechanic (inline, in-card)

A new `StepQuiz` component renders inside a step card. Per-step quiz definitions live in a new `lib/prep-quiz.ts`:

```ts
export interface PrepQuiz {
  question: string
  type: 'mc' | 'tf'
  options: { label: string; correct: boolean }[] // tf = exactly two: True / False
  hint: string
  why: string // explanation shown on correct answer and on reveal
}
export const HALFDAY_PREP_QUIZ: Record<string, PrepQuiz>
```

Flow (half-day steps only):
1. Step not done, quiz not open → card shows its content + an empty round checkbox.
2. Tapping the checkbox (after the one-time phone prompt) **opens the inline quiz** instead of marking done. Card border turns amber ("in progress"). A `quizOpen` set in component state tracks which step's quiz is open.
3. Quiz panel: question + tappable options + `💡 Hint` button + `Reveal answer` link.
   - **Correct** → option turns green, shows the `why`, step marked **done** (`steps[key]=true`, persisted + synced), card collapses to done, next step unlocks.
   - **Wrong** → option turns red, "Not quite — try again." Hint remains available.
   - **Hint** → toggles the hint text.
   - **Reveal answer** → highlights the correct option + shows the `why`; participant then taps the (highlighted) correct option to proceed. Keeps "must answer correctly" literally true while never trapping anyone.
4. Only the currently-open step shows content/quiz; locked steps show "Finish the step above to unlock."

Notes:
- GLCC steps keep `toggleStep` (no quiz). Only half-day step cards route through the new quiz handler. Cleanly scoped because the two variants render in separate JSX branches.
- `?preview=1` (tester mode) unlocks all steps so Kingsley can preview every quiz, and never writes to the live dashboard (existing behavior).
- Quiz answer state is **ephemeral** (not persisted/synced). Only the `done` boolean persists — so dashboard readiness still means "completed + understood."

### New step content (Step 4 — MCP)

- Title: **Connect your apps to Claude** · subtitle: **5-min setup + real use cases (MCP / Connectors)**
- Embeds the Loom via the existing `<Loom>` component: id `3bd77d10c1394dc7afc7b7839427acfa`.
- Short blurb: what MCP/Connectors are (a secure bridge between Claude and your tools) + 2–3 example use cases (Gmail, Google Drive, Notion → ask Claude about your real work).
- Loom id stored as `mcp_loom_id?` in `lib/event-config.ts` with the above as the default, so it's per-event overridable with zero config.

### Files touched

| File | Change |
|------|--------|
| `lib/prep-steps.ts` | Insert `'mcp'` after `'3'` in `PREP_STEP_KEYS`; add `PREP_STEP_LABELS['mcp']` + `PREP_STEP_SHORT['mcp']`. |
| `lib/prep-quiz.ts` **(new)** | `PrepQuiz` interface + `HALFDAY_PREP_QUIZ` (7 entries). |
| `lib/event-config.ts` | Add `mcp_loom_id?: string` + default in `DEFAULT_EVENT_CONFIG`. |
| `app/start/page.tsx` | New MCP `StepCard`; renumber half-day display numbers to 1–7; extend `isLocked`; add `StepQuiz` + quiz state; route half-day ticks through the quiz; pass `locked` to each half-day card. |
| `app/api/telegram/route.ts` (line ~255) | Add `'mcp': 'MCP'` to the hardcoded per-step label map so Jarvis `/prep` digest stays correct. |

### Out of scope (YAGNI)

- No quiz on the GLCC variant (its behavior is unchanged).
- Quiz answers are not stored or analyzed — no per-question analytics.
- No DB migration (step progress is client-stored + synced as a JSON blob; a new key needs no schema change).

## Draft quiz questions (for review)

> ✅ marks the correct option. Edit freely.

**Step 1 — Install Claude Code** · *True/False*
"You can run Claude Code on an iPad as long as you install the app."
- True
- ✅ False
- 💡 Hint: Claude Code runs in a terminal.
- Why: Claude Code needs a real laptop with a terminal (Mac or Windows). iPads/tablets can't run it — that's why we ask you to bring a laptop.

**Step 2 — Get Claude Pro** · *Multiple choice*
"Why do you need Claude Pro (not the Free plan) for the workshop?"
- The Free plan looks different
- ✅ The Free plan can't run Claude Code and runs out of usage too fast
- Pro removes ads
- You don't — Free is fine
- 💡 Hint: Think about what the Free plan literally can't do.
- Why: The Free plan can't run Claude Code and hits usage limits quickly. Pro gives you the access and headroom to build the whole workshop.

**Step 3 — Install dev tools** · *Multiple choice*
"Which tool do you install on each computer?"
- ✅ Homebrew on Mac, Git on Windows
- Git on Mac, Homebrew on Windows
- Both computers need Homebrew
- Neither — Claude installs them for you
- 💡 Hint: Mac people brew their coffee ☕.
- Why: On Mac you install Homebrew; on Windows you install Git. These let Claude Code do its job in class.

**Step 4 — Connect apps (MCP)** · *Multiple choice*
"What does connecting an app to Claude via MCP / a Connector let you do?"
- It posts to your socials automatically
- ✅ It lets Claude securely read/act on that app's data (Gmail, Drive, Notion…) so you can ask it about your real work
- It speeds up your internet
- It replaces your password
- 💡 Hint: MCP = a secure bridge between Claude and your tools.
- Why: Connectors are a secure bridge that let Claude access an app's data and take actions — that's how Claude becomes useful on YOUR business.

**Step 5 — Fill the survey** · *True/False*
"Filling the pre-event survey helps us tailor the class to your business."
- ✅ True
- False
- 💡 Hint: Why would we ask before the class?
- Why: Your answers tell us your industry and goals so we tailor the live build to you — 2 minutes well spent.

**Step 6 — Prepare your data** · *Multiple choice*
"What data should you bring to plug into your first dashboard?"
- Perfect, fully-cleaned data only
- ✅ Real numbers from your own business — even a simple month-by-month sheet
- Someone else's sample data
- No data needed
- 💡 Hint: Messy real beats perfect fake.
- Why: Bring real numbers from your business (Excel/Sheets) — even a simple monthly sheet. Real data makes your dashboard come alive in class.

**Step 7 — Show up 9:30am** · *Multiple choice*
"What time should you arrive?"
- ✅ 9:30am — early, caffeinated, ready
- Whenever I get there
- 12pm
- After lunch
- 💡 Hint: Earlier than you think.
- Why: We start setup at 9:30am sharp. Coming early (and caffeinated ☕) means you don't miss any of the hands-on building.
