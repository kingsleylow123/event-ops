// Per-step "quick check" quizzes for the half-day /start flow. A participant
// ticks a step, answers its question correctly, and only then does the next step
// unlock. Keyed by the half-day step keys in lib/prep-steps.ts (incl. 'mcp' and
// 'chrome'). GLCC has its own (un-quizzed) flow and is intentionally not here.

export interface PrepQuiz {
  question: string
  type: 'mc' | 'tf' // multiple-choice or true/false (tf = exactly two options)
  options: { label: string; correct: boolean }[]
  hint: string
  why: string // explanation shown when correct, and on "reveal answer"
}

export const HALFDAY_PREP_QUIZ: Record<string, PrepQuiz> = {
  '1': {
    question: 'You can run Claude Code on an iPad, as long as you install the app.',
    type: 'tf',
    options: [
      { label: 'True', correct: false },
      { label: 'False', correct: true },
    ],
    hint: 'Claude Code runs in a terminal.',
    why: 'Claude Code needs a real laptop with a terminal (Mac or Windows). iPads and tablets cannot run it — so bring a laptop.',
  },
  '2': {
    question: 'Why do you need Claude Pro (not the Free plan) for the workshop?',
    type: 'mc',
    options: [
      { label: 'The Free plan just looks different', correct: false },
      { label: 'The Free plan cannot run Claude Code and runs out of usage too fast', correct: true },
      { label: 'Pro removes ads', correct: false },
      { label: 'You do not — Free is fine', correct: false },
    ],
    hint: 'Think about what the Free plan literally cannot do.',
    why: 'The Free plan cannot run Claude Code and hits usage limits quickly. Pro gives you the access and headroom to build the whole workshop.',
  },
  '3': {
    question: 'Which tool do you install on each computer?',
    type: 'mc',
    options: [
      { label: 'Homebrew on Mac, Git on Windows', correct: true },
      { label: 'Git on Mac, Homebrew on Windows', correct: false },
      { label: 'Both computers need Homebrew', correct: false },
      { label: 'Neither — Claude installs them for you', correct: false },
    ],
    hint: 'Mac people brew their coffee.',
    why: 'On Mac you install Homebrew; on Windows you install Git. These let Claude Code do its job in class.',
  },
  'mcp': {
    question: 'What does connecting an app to Claude via MCP or a Connector let you do?',
    type: 'mc',
    options: [
      { label: 'It posts to your socials automatically', correct: false },
      { label: 'It lets Claude securely read and act on that app data (Gmail, Drive, Notion) so you can ask it about your real work', correct: true },
      { label: 'It speeds up your internet', correct: false },
      { label: 'It replaces your password', correct: false },
    ],
    hint: 'MCP is a secure bridge between Claude and your tools.',
    why: 'Connectors are a secure bridge that let Claude access an app data and take actions — that is how Claude becomes useful on YOUR business.',
  },
  'chrome': {
    question: 'You have added the Claude for Chrome extension. What is the last thing to do so it actually works?',
    type: 'mc',
    options: [
      { label: 'Nothing — installing is enough', correct: false },
      { label: 'Pin it and log in with your Claude account', correct: true },
      { label: 'Restart your router', correct: false },
      { label: 'Delete your other extensions', correct: false },
    ],
    hint: 'The extension needs to know it is you.',
    why: 'After installing, pin the extension and log in with your Claude account — that is what lets Claude work inside your browser during class.',
  },
  '4': {
    question: 'Filling the pre-event survey helps us tailor the class to your business.',
    type: 'tf',
    options: [
      { label: 'True', correct: true },
      { label: 'False', correct: false },
    ],
    hint: 'Why would we ask before the class?',
    why: 'Your answers tell us your industry and goals, so we tailor the live build to you — 2 minutes well spent.',
  },
  '5': {
    question: 'What data should you bring to plug into your first dashboard?',
    type: 'mc',
    options: [
      { label: 'Perfect, fully-cleaned data only', correct: false },
      { label: 'Real numbers from your own business — even a simple month-by-month sheet', correct: true },
      { label: 'A random sample dataset from the internet', correct: false },
      { label: 'No data needed', correct: false },
    ],
    hint: 'Messy real beats perfect fake.',
    why: 'Bring real numbers from your business (Excel or Google Sheets) — even a simple monthly sheet. Real data makes your dashboard come alive in class.',
  },
  '6': {
    question: 'What time should you arrive?',
    type: 'mc',
    options: [
      { label: '9:30am — early, caffeinated, ready', correct: true },
      { label: 'Whenever I get there', correct: false },
      { label: '12pm', correct: false },
      { label: 'After lunch', correct: false },
    ],
    hint: 'Earlier than you think.',
    why: 'We start setup at 9:30am sharp. Coming early (and caffeinated) means you do not miss any of the hands-on building.',
  },
}
