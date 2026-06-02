import { create } from 'zustand'

// UI-facing offline state. The sync engine (lib/offline/sync.js) drives these.
export const useOfflineStore = create((set) => ({
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pending: 0,      // queued mutations not yet synced
  syncing: false,  // a flush is in progress
  lastError: null,
  setOnline: (online) => set({ online }),
  setPending: (pending) => set({ pending }),
  setSyncing: (syncing) => set({ syncing }),
  setLastError: (lastError) => set({ lastError }),
}))
