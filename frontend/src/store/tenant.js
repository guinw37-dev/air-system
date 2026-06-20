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

// On a real production subdomain the leftmost label IS the branch slug
// (phayathai-sriracha.tw-carework.online → "phayathai-sriracha"). Deterministic,
// no network — used so a flaky /resolve-host can't drop the branch and 400 every
// API call. Restricted to *.tw-carework.online (sslip.io/IP hosts use ?branch).
function subdomainSlug() {
  try {
    const host = window.location.hostname.toLowerCase()
    if (!host.endsWith('.tw-carework.online')) return null
    const label = host.split('.')[0]
    if (['www', 'api', 'app'].includes(label)) return null
    return SLUG_RE.test(label) ? label : null
  } catch { return null }
}

export const useTenantStore = create((set, get) => ({
  resolved: false,
  isBranch: false,
  slug: null,
  name: null,
  forceCamera: false,   // บังคับถ่ายสด+timestamp (ตั้งต่อสาขา); จาก /resolve-host

  async resolve() {
    if (get().resolved) return
    const override = devBranchOverride()
    // Deterministic fallback: ?branch override, else the production subdomain label.
    const fallback = override || subdomainSlug()
    // Set the branch optimistically so X-Branch is sent even if /resolve-host is slow.
    if (fallback) set({ isBranch: true, slug: fallback, name: fallback })
    try {
      const params = override ? { branch: override } : { hostname: window.location.hostname }
      const { data } = await axios.get(`${BACKEND}/api/resolve-host`, { params })
      if (data && data.apex === false && data.slug) {
        set({ resolved: true, isBranch: true, slug: data.slug, name: data.name, forceCamera: !!data.force_camera })
        return
      }
    } catch { /* network/hiccup → keep the deterministic fallback below */ }
    // /resolve-host said apex or failed: keep the fallback branch if we have one,
    // so a transient failure on a real subdomain never drops the branch (→ 400s).
    if (fallback) set({ resolved: true, isBranch: true, slug: fallback, name: get().name || fallback })
    else set({ resolved: true, isBranch: false, slug: null, name: null })
  },

  // Super-admin only: re-point the SPA at another branch (sets X-Branch).
  switchBranch(slug, name) {
    if (slug && SLUG_RE.test(slug)) set({ isBranch: true, slug, name: name || slug })
    else set({ isBranch: false, slug: null, name: null })
  },
}))
