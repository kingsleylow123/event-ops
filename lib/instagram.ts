// Instagram scraping via Apify instagram-scraper (no OAuth). Ported from the
// content-dashboard, extended to capture COLLAB co-authors (coauthorProducers).
// Used by lib/creators.ts to populate creator_ig_posts.

const APIFY_TOKEN = process.env.APIFY_API_TOKEN
const ACTOR_ID = 'shu8hvrXbJbY3Eb9W' // apify/instagram-scraper

// The brand account we scan. Collab posts on its grid carry coauthorProducers;
// the creator(s) credited = the co-authors that are NOT this account.
export const COMMUNITY_ACCOUNT = 'claudemalaysiacommunity'

export interface ScrapedPost {
  ig_post_id: string
  short_code: string | null
  account: string
  owner_username: string | null
  is_collab: boolean
  collab_creators: string[]      // non-community co-authors = creators credited
  coauthor_usernames: string[]   // raw coauthorProducers usernames
  tagged_users: string[]
  post_type: string | null
  post_url: string | null
  caption: string | null
  posted_at: string              // ISO
  likes: number
  comments: number
  views: number
}

async function runApifyActor(input: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  if (!APIFY_TOKEN) throw new Error('APIFY_API_TOKEN not set')
  const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=180&memory=1024`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Apify IG error ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

function lc(v: unknown): string { return String(v ?? '').trim().toLowerCase() }

// Scrape an account's recent posts (most-recent-first), keep those on/after `sinceISO`.
// resultsLimit must be large enough to page back to the cutoff (backfill uses ~300).
export async function scrapeAccountPosts(
  account: string,
  sinceISO: string | null,
  limit = 300,
): Promise<ScrapedPost[]> {
  const items = await runApifyActor({
    directUrls: [`https://www.instagram.com/${account}/`],
    resultsLimit: limit,
    resultsType: 'posts',
  })

  const since = sinceISO ? new Date(sinceISO).getTime() : 0
  const out: ScrapedPost[] = []

  for (const it of items) {
    if (it.error) continue
    const ts = (it.timestamp ?? it.takenAt ?? it.date) as string | undefined
    const postedMs = ts ? new Date(ts).getTime() : 0
    if (since && postedMs && postedMs < since) continue

    const owner = lc(it.ownerUsername)
    const coRaw = Array.isArray(it.coauthorProducers) ? (it.coauthorProducers as Record<string, unknown>[]) : []
    const coauthors = coRaw.map(c => lc(c.username)).filter(Boolean)
    const isCollab = coauthors.length > 0

    // Creators credited = post owner + co-authors, minus the community account.
    const credited = new Set<string>()
    if (owner && owner !== COMMUNITY_ACCOUNT) credited.add(owner)
    for (const c of coauthors) if (c && c !== COMMUNITY_ACCOUNT) credited.add(c)

    const tagged = Array.isArray(it.taggedUsers)
      ? (it.taggedUsers as unknown[]).map(u => lc(typeof u === 'object' && u ? (u as Record<string, unknown>).username : u)).filter(Boolean)
      : []

    const shortCode = (it.shortCode as string) || null
    const igId = String(it.id ?? it.shortCode ?? '')
    if (!igId) continue

    out.push({
      ig_post_id: igId,
      short_code: shortCode,
      account,
      owner_username: owner || null,
      is_collab: isCollab,
      collab_creators: [...credited],
      coauthor_usernames: coauthors,
      tagged_users: tagged,
      post_type: (it.type as string) ?? null,
      post_url: String(it.url ?? (shortCode ? `https://www.instagram.com/p/${shortCode}/` : '')) || null,
      caption: (String(it.caption ?? '').slice(0, 1000)) || null,
      posted_at: ts ? new Date(ts).toISOString() : new Date().toISOString(),
      likes: Number(it.likesCount ?? 0),
      comments: Number(it.commentsCount ?? 0),
      views: Number(it.videoViewCount ?? it.videoPlayCount ?? it.igPlayCount ?? 0),
    })
  }

  return out
}
