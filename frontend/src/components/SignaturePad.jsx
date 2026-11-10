import { useRef, useLayoutEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { SIG_W, SIG_H, LINE_W, padBitmapSize, toCanvasPoint } from '../lib/signaturePad'

export default function SignaturePad({ onSave, onCancel }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const [isEmpty, setIsEmpty] = useState(true)

  // useLayoutEffect: ตั้งขนาด bitmap ก่อนจอวาดครั้งแรก
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    // bitmap ตามขนาดที่เห็นจริง × ความละเอียดจอ → เส้นคม (รายละเอียดใน lib/signaturePad.js)
    const [w, h] = padBitmapSize(canvas.getBoundingClientRect().width, window.devicePixelRatio)
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = LINE_W * (w / SIG_W)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // พิกเซลจอ → พิกเซล bitmap (กล่องโชว์ไม่เท่ากับ bitmap — ต้องคูณอัตราส่วน)
    const getPos = (e) => {
      const src = e.touches ? e.touches[0] : e
      return toCanvasPoint(src.clientX, src.clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height)
    }

    const start = (e) => {
      e.preventDefault()
      drawing.current = true
      const [x, y] = getPos(e)
      ctx.beginPath()
      ctx.moveTo(x, y)
    }

    const move = (e) => {
      e.preventDefault()
      if (!drawing.current) return
      const [x, y] = getPos(e)
      ctx.lineTo(x, y)
      ctx.stroke()
      setIsEmpty(false)
    }

    const end = (e) => {
      e.preventDefault()
      drawing.current = false
    }

    canvas.addEventListener('mousedown', start)
    canvas.addEventListener('mousemove', move)
    canvas.addEventListener('mouseup', end)
    canvas.addEventListener('touchstart', start, { passive: false })
    canvas.addEventListener('touchmove', move, { passive: false })
    canvas.addEventListener('touchend', end, { passive: false })

    return () => {
      canvas.removeEventListener('mousedown', start)
      canvas.removeEventListener('mousemove', move)
      canvas.removeEventListener('mouseup', end)
      canvas.removeEventListener('touchstart', start)
      canvas.removeEventListener('touchmove', move)
      canvas.removeEventListener('touchend', end)
    }
  }, [])

  const clear = () => {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    setIsEmpty(true)
  }

  const save = () => {
    if (isEmpty) return
    // ส่งออกเป็น PNG 320×160 เสมอ (เท่าเดิม) ไม่ว่าจอจะใหญ่แค่ไหน — รูปเล็ก
    // และไม่มีทางเกินเพดาน 400000 ตัวอักษรของ backend
    const out = document.createElement('canvas')
    out.width = SIG_W
    out.height = SIG_H
    const octx = out.getContext('2d')
    octx.imageSmoothingQuality = 'high'
    octx.drawImage(canvasRef.current, 0, 0, SIG_W, SIG_H)
    onSave(out.toDataURL('image/png'))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative border-2 border-dashed border-gray-300 rounded-xl bg-white">
        <canvas
          ref={canvasRef}
          className="w-full touch-none rounded-xl"
          style={{ aspectRatio: '2/1' }}
        />
        <p className="absolute bottom-2 left-0 right-0 text-center text-xs text-gray-300 pointer-events-none select-none">
          ลายเซ็น
        </p>
      </div>
      <div className="flex gap-2">
        <button onClick={clear} className="btn-secondary flex items-center gap-1">
          <Trash2 className="h-4 w-4" /> ล้าง
        </button>
        <button onClick={onCancel} className="btn-secondary flex-1">ยกเลิก</button>
        <button onClick={save} disabled={isEmpty} className="btn-primary flex-1">บันทึก</button>
      </div>
    </div>
  )
}
