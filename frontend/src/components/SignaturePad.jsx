import { useRef, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'

export default function SignaturePad({ onSave, onCancel }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const [isEmpty, setIsEmpty] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect()
      const src = e.touches ? e.touches[0] : e
      return [src.clientX - rect.left, src.clientY - rect.top]
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
    const dataUrl = canvasRef.current.toDataURL('image/png')
    onSave(dataUrl)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative border-2 border-dashed border-gray-300 rounded-xl bg-white">
        <canvas
          ref={canvasRef}
          width={320}
          height={160}
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
