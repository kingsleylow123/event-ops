'use client'
import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'eventops_theme'
const EVENT = 'theme-change'

function read(): Theme {
  if (typeof window === 'undefined') return 'dark'
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}

// Reflect the theme on <html> so CSS variables in globals.css switch app-wide.
function apply(theme: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

function setGlobal(theme: Theme) {
  try { localStorage.setItem(KEY, theme) } catch { /* ignore */ }
  apply(theme)
  window.dispatchEvent(new CustomEvent(EVENT))
}

// Shared global theme hook. One localStorage key drives the whole app; the
// chosen theme is mirrored onto <html data-theme> so CSS variables flip.
// SSR snapshot is 'dark' (matches the default server render), then hydrates.
export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, read, () => 'dark' as Theme)
  const toggle = useCallback(() => setGlobal(read() === 'light' ? 'dark' : 'light'), [])
  return [theme, toggle]
}
