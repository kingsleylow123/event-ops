// One-time backfill: scrape @claudemalaysiacommunity IG posts (since May 2026)
// and upsert into creator_ig_posts. Mirrors lib/instagram.ts parsing.
// Run: node scripts/backfill-creators-ig.mjs
import fs from 'fs'

const ACTOR_ID = 'shu8hvrXbJbY3Eb9W'
const COMMUNITY = 'claudemalaysiacommunity'
const SINCE = '2026-05-01T00:00:00Z'
const LIMIT = 350

function envFrom(path) {
  const out = {}
  try {
    for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  } catch {}
  return out
}

const local = envFrom('.env.local')
const cd = envFrom('../content-dashboard/.env.local')
const APIFY = local.APIFY_API_TOKEN || cd.APIFY_API_TOKEN
const URL = local.NEXT_PUBLIC_SUPABASE_URL
const ANON = local.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!APIFY) { console.error('No APIFY_API_TOKEN'); process.exit(1) }
if (!URL || !ANON) { console.error('No Supabase URL/anon key'); process.exit(1) }

const lc = v => String(v ?? '').trim().toLowerCase()

async function scrape() {
  const u = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY}&timeout=200&memory=1024`
  const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directUrls: [`https://www.instagram.com/${COMMUNITY}/`], resultsLimit: LIMIT, resultsType: 'posts' }) })
  if (!r.ok) throw new Error(`Apify ${r.status}: ${(await r.text()).slice(0, 300)}`)
  return r.json()
}

function parse(items) {
  const since = new Date(SINCE).getTime()
  const rows = []
  for (const it of items) {
    if (it.error) continue
    const ts = it.timestamp || it.takenAt || it.date
    const ms = ts ? new Date(ts).getTime() : 0
    if (ms && ms < since) continue
    const owner = lc(it.ownerUsername)
    const co = Array.isArray(it.coauthorProducers) ? it.coauthorProducers.map(c => lc(c.username)).filter(Boolean) : []
    const credited = new Set()
    if (owner && owner !== COMMUNITY) credited.add(owner)
    for (const c of co) if (c && c !== COMMUNITY) credited.add(c)
    const tagged = Array.isArray(it.taggedUsers) ? it.taggedUsers.map(x => lc(typeof x === 'object' && x ? x.username : x)).filter(Boolean) : []
    const sc = it.shortCode || null
    const id = String(it.id ?? it.shortCode ?? '')
    if (!id) continue
    rows.push({
      ig_post_id: id, short_code: sc, account: COMMUNITY, owner_username: owner || null,
      is_collab: co.length > 0, collab_creators: [...credited], coauthor_usernames: co, tagged_users: tagged,
      post_type: it.type ?? null, post_url: it.url ?? (sc ? `https://www.instagram.com/p/${sc}/` : null),
      caption: (String(it.caption ?? '').slice(0, 1000)) || null,
      posted_at: ts ? new Date(ts).toISOString() : new Date().toISOString(),
      likes: Number(it.likesCount ?? 0), comments: Number(it.commentsCount ?? 0),
      views: Number(it.videoViewCount ?? it.videoPlayCount ?? it.igPlayCount ?? 0),
    })
  }
  return rows
}

async function upsert(rows) {
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200)
    const r = await fetch(`${URL}/rest/v1/creator_ig_posts?on_conflict=ig_post_id`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    })
    if (!r.ok) throw new Error(`upsert ${r.status}: ${(await r.text()).slice(0, 300)}`)
  }
}

;(async () => {
  console.log('Scraping @' + COMMUNITY + ' …')
  const items = await scrape()
  const rows = parse(items)
  console.log(`Parsed ${rows.length} posts since ${SINCE} (of ${items.length} scraped). Collabs: ${rows.filter(r => r.is_collab).length}`)
  await upsert(rows)
  console.log('✓ Upserted into creator_ig_posts')
})().catch(e => { console.error('FAIL', e.message); process.exit(1) })
