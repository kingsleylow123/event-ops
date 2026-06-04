'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

// Tiny stale-while-revalidate hook (no deps).
// - Reads localStorage cache synchronously on mount → instant render, no spinner.
// - Always refetches in background; updates UI only if the payload changed.
// - Dedupes concurrent requests to the same URL across components/tabs.
// - SSR-safe.

const TTL_MS = 30_000 // freshness window (informational; we always revalidate)
const PREFIX = 'swr:'

// Module-level in-flight dedupe: same URL mounting in the same tick shares one fetch.
const inflight = new Map<string, Promise<unknown>>()

function readCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { t: number; v: T }
    return parsed.v ?? null
  } catch {
    return null
  }
}

function writeCache<T>(key: string, value: T) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ t: Date.now(), v: value }))
  } catch {
    /* quota / disabled — ignore */
  }
}

async function dedupedFetch<T>(url: string): Promise<T> {
  const existing = inflight.get(url)
  if (existing) return existing as Promise<T>
  const p = (async () => {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`)
    return (await res.json()) as T
  })()
  inflight.set(url, p)
  try {
    return await p
  } finally {
    inflight.delete(url)
  }
}

export interface CachedFetch<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

// key: stable cache key (e.g. "events", "attendees:<id>"). url: the endpoint.
// enabled: skip when false (e.g. url depends on an id not yet known).
export function useCachedFetch<T>(key: string | null, url: string | null, enabled = true): CachedFetch<T> {
  const cached = key ? readCache<T>(key) : null
  const [data, setData] = useState<T | null>(cached)
  const [loading, setLoading] = useState<boolean>(cached == null) // spinner only when no cache
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const run = useCallback(() => {
    if (!key || !url || !enabled) return
    dedupedFetch<T>(url)
      .then(fresh => {
        if (!mounted.current) return
        writeCache(key, fresh)
        // Only re-render if changed (cheap deep-ish compare via JSON)
        setData(prev => {
          try {
            if (JSON.stringify(prev) === JSON.stringify(fresh)) return prev
          } catch { /* fall through */ }
          return fresh
        })
        setError(null)
      })
      .catch(e => { if (mounted.current) setError(String(e)) })
      .finally(() => { if (mounted.current) setLoading(false) })
  }, [key, url, enabled])

  useEffect(() => {
    mounted.current = true
    // refresh cached value from storage in case another tab updated it
    if (key) {
      const c = readCache<T>(key)
      if (c != null) { setData(c); setLoading(false) }
    }
    run()
    return () => { mounted.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url, enabled])

  return { data, loading, error, refetch: run }
}

// Optimistically patch a cache entry so the NEXT tab/page sees the change
// before the background refetch lands. Pass an updater on the cached value.
export function mutateCache<T>(key: string, updater: (prev: T | null) => T) {
  const prev = readCache<T>(key)
  writeCache(key, updater(prev))
}

// Synchronously read a cached value (null if absent). For instant first paint
// before a manual fetch resolves.
export function peekCache<T>(key: string): T | null {
  return readCache<T>(key)
}

// Drop a cache entry (force a fresh fetch next mount).
export function invalidateCache(key: string) {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(PREFIX + key) } catch { /* ignore */ }
}

export const CACHE_TTL_MS = TTL_MS
