import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/th'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import api from '../api/client'
import { Bell, CheckCheck } from 'lucide-react'

dayjs.extend(relativeTime)
dayjs.locale('th')

export default function Notifications() {
  const navigate = useNavigate()
  const [items, setItems]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [markingAll, setMarkingAll] = useState(false)

  const load = useCallback(() => {
    api.get('/notifications')
      .then((r) => setItems(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleClick = async (item) => {
    // Mark as read (fire-and-forget; navigate immediately)
    if (!item.read_at) {
      api.put(`/notifications/${item.id}/read`).catch(() => {})
      setItems((prev) =>
        prev.map((n) => n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)
      )
    }
    if (item.work_order_id) {
      navigate(`/work-orders/${item.work_order_id}`)
    }
  }

  const handleReadAll = async () => {
    setMarkingAll(true)
    try {
      await api.put('/notifications/read-all')
      setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })))
    } catch {
      // ignore
    } finally {
      setMarkingAll(false)
    }
  }

  const unreadCount = items.filter((n) => !n.read_at).length

  return (
    <Layout
      title="การแจ้งเตือน"
      back="/"
      actions={
        unreadCount > 0 ? (
          <button
            onClick={handleReadAll}
            disabled={markingAll}
            className="flex items-center gap-1 text-sm text-primary hover:text-primary-dark disabled:opacity-50"
          >
            <CheckCheck className="h-4 w-4" />
            อ่านทั้งหมด
          </button>
        ) : null
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <PageSpinner />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-ink-muted">
          <Bell className="h-12 w-12 mb-3 opacity-40" />
          <p className="text-sm">ไม่มีการแจ้งเตือน</p>
        </div>
      ) : (
        <div className="divide-y divide-line">
          {items.map((n) => {
            const isUnread = !n.read_at
            return (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={`w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-page transition-colors ${
                  isUnread ? 'bg-primary-soft' : 'bg-surface'
                }`}
              >
                {/* Dot indicator */}
                <span className={`mt-1.5 shrink-0 h-2.5 w-2.5 rounded-full ${isUnread ? 'bg-primary' : 'bg-transparent'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${isUnread ? 'font-semibold text-ink' : 'text-ink-muted'}`}>
                    {n.message}
                  </p>
                  {n.order_no && (
                    <p className="text-xs text-ink-muted mt-0.5">ใบงาน {n.order_no}</p>
                  )}
                  <p className="text-xs text-ink-muted mt-1">
                    {dayjs(n.created_at).fromNow()}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </Layout>
  )
}
