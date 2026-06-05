import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './index.css'

// Global safety net: React's ErrorBoundary only catches errors thrown during
// render. Errors in async code / event handlers / browser-level failures escape
// it and leave a blank white screen with nothing to act on. This shows any
// uncaught error as a visible, recoverable overlay so failures are diagnosable.
function showFatal(message) {
  let el = document.getElementById('fatal-overlay')
  if (!el) {
    el = document.createElement('div')
    el.id = 'fatal-overlay'
    el.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:#fff;padding:20px;' +
      'font-family:sans-serif;overflow:auto'
    document.body.appendChild(el)
  }
  const safe = String(message).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
  el.innerHTML =
    '<h2 style="color:#b3261e;font-size:18px;margin:0 0 8px">เกิดข้อผิดพลาด</h2>' +
    '<p style="color:#555;margin:0 0 8px">ส่งข้อความด้านล่างให้ผู้ดูแล แล้วกดโหลดใหม่</p>' +
    '<pre style="background:#f5f5f5;padding:12px;border-radius:8px;font-size:12px;' +
    'white-space:pre-wrap;word-break:break-word;color:#333">' + safe + '</pre>' +
    '<button onclick="location.reload()" style="margin-top:12px;padding:8px 20px;' +
    'background:#1565c0;color:#fff;border:none;border-radius:8px;font-weight:600;' +
    'cursor:pointer">โหลดใหม่</button>'
}

window.addEventListener('error', (e) => {
  // ignore resource-load errors (e.g. a broken <img> src) — only real JS errors
  if (e.target && e.target !== window) return
  showFatal(e.error?.stack || e.message || 'error')
})
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason
  // ignore network/HTTP rejections (axios) — those are handled by interceptors
  // and shouldn't blank the app; only surface real programming errors.
  if (r?.isAxiosError || r?.response || r?.request) return
  showFatal(r?.stack || r?.message || r || 'unhandled rejection')
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
