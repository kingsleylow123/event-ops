'use client'
import { useCallback, useSyncExternalStore } from 'react'

const KEY = 'revenue_hidden'
const EVENT = 'revenue-visibility'

function read(): boolean {
  if (typeof window === 'undefined') return false
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

// External-store subscription: same-tab CustomEvent + cross-tab `storage`.
function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

function setGlobal(v: boolean) {
  try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVENT))
}

// Shared global revenue-visibility hook via useSyncExternalStore — one
// localStorage key drives every money figure; all components/tabs stay in sync.
// SSR snapshot is `false` (revenue shown) to match server render, then hydrates.
export function useRevenueHidden(): [boolean, () => void, (v: boolean) => void] {
  const hidden = useSyncExternalStore(subscribe, read, () => false)
  const setHidden = useCallback((v: boolean) => setGlobal(v), [])
  const toggle = useCallback(() => setGlobal(!read()), [])
  return [hidden, toggle, setHidden]
}

export function maskRM(value: string, hidden: boolean): string {
  return hidden ? 'RM ••••••' : value
}
