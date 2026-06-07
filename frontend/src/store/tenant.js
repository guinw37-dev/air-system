import { create } from 'zustand'
import axios from 'axios'

// Per-branch (สาขา) context, resolved from the browser hostname on boot.
// On a branch subdomain (phayathai-1.<domain>) the app is LOCKED to that client:
// the api client auto-injects client_id + X-Branch, and selectors are hidden.
// On apex / localhost / IP it stays multi-client (super-admin), dropdowns shown.
// Dev override: ?branch=<slug> or VITE_DEV_BRANCH.
const BACKEND = import.meta.env.VITE_BACKEND_URL || ''
const SLUG_RE = /^[a-z0-9-]{1,63}$/

function devBranchOverride() {
  try {
    const q = new URLSearchParams(window.location.search).get('branch')
    if (q && SLUG_RE.test(q)) return q
  } catch { /* ignore */ }
  const env = import.meta.env.VITE_DEV_BRANCH
  return env && SLUG_RE.test(env) ? env : null
}

export const useTenantStore = create((set, get) => ({
  resolved: false,
  isBranch: false,
  clientId: null,
  slug: null,
  name: null,

  async resolve() {
    if (get().resolved) return
    const hostname = window.location.hostname
    const override = devBranchOverride()
    try {
      const params = override ? { branch: override } : { hostname }
      const { data } = await axios.get(`${BACKEND ? BACKEND : ''}/api/resolve-host`, { params })
      if (data && data.apex === false && data.clientId) {
        set({ resolved: true, isBranch: true, clientId: data.clientId, slug: data.slug, name: data.name })
        return
      }
    } catch { /* unknown branch / network → fall through to apex */ }
    set({ resolved: true, isBranch: false, clientId: null, slug: null, name: null })
  },
}))
