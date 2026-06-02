import { useOfflineStore } from '../store/offline'

// Compact status pill: online/offline + pending count + syncing spinner.
// Rendered in the Layout header.
export default function SyncIndicator() {
  const { online, pending, syncing } = useOfflineStore()

  let text, bg, fg
  if (!online) {
    text = pending ? `ออฟไลน์ · รอ sync ${pending}` : 'ออฟไลน์'
    bg = '#fde2e1'; fg = '#b3261e'
  } else if (syncing) {
    text = `กำลัง sync${pending ? ` ${pending}` : ''}…`
    bg = '#e3f2fd'; fg = '#1565c0'
  } else if (pending) {
    text = `รอ sync ${pending}`
    bg = '#fff3cd'; fg = '#8a6d00'
  } else {
    text = 'บันทึกแล้ว'
    bg = '#e6f4ea'; fg = '#1e7e34'
  }

  return (
    <span
      title={online ? 'เชื่อมต่อแล้ว' : 'ไม่มีเน็ต — บันทึกในเครื่องไว้ก่อน'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
        background: bg, color: fg, whiteSpace: 'nowrap',
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: fg, opacity: syncing ? 0.5 : 1,
      }} />
      {text}
    </span>
  )
}
