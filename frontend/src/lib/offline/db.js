// Minimal IndexedDB wrapper for the offline outbox.
// One object store 'outbox' holding queued mutations (inspection saves + photos).
// No external deps.

const DB_NAME = 'air-offline'
const DB_VERSION = 1
const STORE = 'outbox'

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' })
        os.createIndex('by_createdAt', 'createdAt')
        os.createIndex('by_woId', 'woId')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const store = t.objectStore(STORE)
        let result
        Promise.resolve(fn(store)).then((r) => {
          result = r
        })
        t.oncomplete = () => resolve(result)
        t.onerror = () => reject(t.error)
        t.onabort = () => reject(t.error)
      })
  )
}

const reqToPromise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

export async function putItem(item) {
  await tx('readwrite', (store) => store.put(item))
  return item
}

export async function deleteItem(id) {
  await tx('readwrite', (store) => store.delete(id))
}

export async function getAllItems() {
  return tx('readonly', (store) => reqToPromise(store.index('by_createdAt').getAll()))
}

export async function getItemsByWo(woId) {
  return tx('readonly', (store) => reqToPromise(store.index('by_woId').getAll(woId)))
}

export async function countItems() {
  return tx('readonly', (store) => reqToPromise(store.count()))
}
