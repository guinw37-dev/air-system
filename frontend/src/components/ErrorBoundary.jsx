import { Component } from 'react'

// App-wide error boundary — replaces the blank white screen on an uncaught
// render error with a readable message + reload, and logs the error to console.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // surfaced in DevTools console for debugging
    console.error('App crashed:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif', maxWidth: 640, margin: '40px auto' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#b3261e' }}>เกิดข้อผิดพลาด</h1>
        <p style={{ color: '#555', marginTop: 8 }}>
          หน้านี้ทำงานผิดพลาด ลองโหลดใหม่ ถ้ายังเป็นซ้ำให้ส่งข้อความด้านล่างให้ผู้ดูแล
        </p>
        <pre style={{
          marginTop: 12, padding: 12, background: '#f5f5f5', borderRadius: 8,
          fontSize: 12, color: '#333', whiteSpace: 'pre-wrap', overflowX: 'auto',
        }}>
          {String(this.state.error?.stack || this.state.error)}
        </pre>
        <button
          onClick={() => { this.setState({ error: null }); window.location.reload() }}
          style={{
            marginTop: 16, padding: '8px 20px', background: '#1565c0', color: '#fff',
            border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
          }}
        >
          โหลดใหม่
        </button>
      </div>
    )
  }
}
