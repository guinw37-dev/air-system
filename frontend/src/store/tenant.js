import { create } from 'zustand'
import axios from 'axios'

// Per-branch (ลูกค้า/สาขา) context, resolved from the browser hostname on boot.
// On a branch subdomain (acme-co.<domain>) the SPA sends X-Branch on every API
// call so the backend scopes to that branch's Postgres schema. On apex / IP /
// localhost it is super-admin mode (no X-Branch; backend uses public + the
// branch switcher picks one). Dev override: ?branch=<slug> or VITE_DEV_BRANCH.
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
  slug: null,
  name: null,

  async resolve() {
    if (get().resolved) return
    const override = devBranchOverride()
    try {
      const params = override ? { branch: override } : { hostname: window.location.hostname }
      const { data } = await axios.get(`${BACKEND}/api/resolve-host`, { params })
      if (data && data.apex === false && data.slug) {
        set({ resolved: true, isBranch: true, slug: data.slug, name: data.name })
        return
      }
    } catch { /* unknown branch / network → apex */ }
    set({ resolved: true, isBranch: false, slug: null, name: null })
  },

  // Super-admin only: re-point the SPA at another branch (sets X-Branch).
  switchBranch(slug, name) {
    if (slug && SLUG_RE.test(slug)) set({ isBranch: true, slug, name: name || slug })
    else set({ isBranch: false, slug: null, name: null })
  },
}))
