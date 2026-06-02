// Offline sync engine.
//
// Mutations made on the unit-detail screen (inspection saves + photo uploads) are
// written to an IndexedDB outbox first, then flushed to the server when online.
// Both server endpoints are idempotent:
//   - PUT /inspection upserts by (work_order_unit_id, template_item_id)
//   - POST /photos dedupes by client_token
// so re-sending after a crash/disconnect never duplicates or corrupts data.

import api from '../../api/client'
import { useOfflineStore } from '../../store/offline'
import { putItem, deleteItem, getAllItems, getItemsByWo, countItems } from './db'

const uuid = () =>
  (crypto?.randomUUID?.() ||
    `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`)

let flushing = false
let timer = null

async function refreshPending() {
  const n = await countItems()
  useOfflineStore.getState().setPending(n)
  return n
}

// ── enqueue ───────────────────────────────────────────────────────────────
// Inspection: one record per (woId, work_order_unit_id) — latest overwrites,
// keeping the queue small (the payload is the full current state anyway).
export async function enqueueInspection(woId, payload) {
  await putItem({
    id: `insp:${woId}:${payload.work_order_unit_id}`,
    kind: 'inspection',
    woId,
    payload,
    createdAt: Date.now(),
    retries: 0,
  })
  await refreshPending()
  flush()
}

// Photo: each capture is unique. The record id doubles as the server client_token.
export async function enqueuePhoto(woId, fields, blob) {
  const token = uuid()
  await putItem({
    id: `photo:${token}`,
    kind: 'photo',
    woId,
    token,
    fields, // { work_order_unit_id, phase, point_no, label }
    blob,
    createdAt: Date.now(),
    retries: 0,
  })
  await refreshPending()
  flush()
  return token
}

// Local pending photos for a WO (to render with a "รอ sync" badge).
export async function getPendingPhotos(woId) {
  const items = await getItemsByWo(woId)
  return items
    .filter((i) => i.kind === 'photo')
    .map((i) => ({
      id: i.id,
      token: i.token,
      work_order_unit_id: Number(i.fields.work_order_unit_id),
      phase: i.fields.phase,
      point_no: Number(i.fields.point_no || 1),
      label: i.fields.label,
      objectUrl: URL.createObjectURL(i.blob),
      pending: true,
    }))
}

// ── flush ─────────────────────────────────────────────────────────────────
function isNetworkError(err) {
  // axios sets err.response only when the server answered; absence = offline
  return !err?.response
}

export async function flush() {
  const store = useOfflineStore.getState()
  if (flushing || !store.online) return
  flushing = true
  store.setSyncing(true)
  store.setLastError(null)
  try {
    const items = await getAllItems() // ordered by createdAt
    for (const item of items) {
      if (item.failed) continue // permanently un-appliable — kept, not retried (audit F5-B)
      try {
        if (item.kind === 'inspection') {
          await api.put(`/work-orders/${item.woId}/inspection`, item.payload)
        } else if (item.kind === 'photo') {
          const fd = new FormData()
          fd.append('photo', item.blob, `${item.fields.phase}_${Date.now()}.jpg`)
          fd.append('work_order_unit_id', item.fields.work_order_unit_id)
          fd.append('phase', item.fields.phase)
          fd.append('point_no', item.fields.point_no || 1)
          if (item.fields.label) fd.append('label', item.fields.label)
          fd.append('client_token', item.token)
          await api.post(`/work-orders/${item.woId}/photos`, fd)
        }
        await deleteItem(item.id)
      } catch (err) {
        if (isNetworkError(err)) {
          // lost connection mid-flush — stop, keep the rest queued
          store.setOnline(false)
          break
        }
        // server rejected (4xx/5xx). Record the error; retry on next flush.
        item.retries = (item.retries || 0) + 1
        item.lastError = err.response?.data?.error || String(err)
        // After many tries, mark as failed and STOP retrying — but NEVER delete
        // the user's captured content silently (audit F5-B). It stays in the
        // outbox (kept for manual recovery) and is skipped on future flushes.
        if (item.retries >= 8) item.failed = true
        await putItem(item)
        store.setLastError(item.lastError)
      }
    }
  } finally {
    await refreshPending()
    store.setSyncing(false)
    flushing = false
  }
}

// ── lifecycle ─────────────────────────────────────────────────────────────
let started = false
export function initOfflineSync() {
  if (started || typeof window === 'undefined') return
  started = true
  const store = useOfflineStore.getState()
  window.addEventListener('online', () => {
    store.setOnline(true)
    flush()
  })
  window.addEventListener('offline', () => store.setOnline(false))
  // periodic safety flush while anything is queued
  timer = setInterval(() => {
    if (useOfflineStore.getState().pending > 0) flush()
  }, 15000)
  refreshPending().then(() => flush())
}

export function stopOfflineSync() {
  if (timer) clearInterval(timer)
  started = false
}
