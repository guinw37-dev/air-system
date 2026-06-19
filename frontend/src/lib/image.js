// Downscale + compress a captured photo before it enters the upload. Mobile
// camera files are often 3–8 MB (sometimes 48MP / HEIC) which stall the upload
// or, decoded at full resolution, can freeze/OOM the tab. We decode DOWNSCALED
// so peak memory stays bounded, and we time-box the whole thing so a hostile
// file can never hang the UI — on any failure or timeout we fall back to
// uploading the original file untouched.
// Burn a วัน/เวลา stamp into the bottom-left so a photo can't be passed off as
// taken at another time (and so before/after shots are visibly distinct). Drawn
// onto the already-downscaled canvas right before encoding.
function drawTimestamp(ctx, w, h) {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const txt = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear() + 543} ${p(d.getHours())}:${p(d.getMinutes())}`
  const fs = Math.max(18, Math.round(w * 0.04))
  ctx.font = `bold ${fs}px sans-serif`
  ctx.textBaseline = 'alphabetic'
  const padX = Math.round(fs * 0.5)
  const padY = Math.round(fs * 0.35)
  const tw = ctx.measureText(txt).width
  const boxH = fs + padY * 2
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(padX, h - boxH - padX, tw + padX * 2, boxH)
  ctx.fillStyle = '#fff'
  ctx.fillText(txt, padX * 2, h - padX - padY)
}

async function downscale(file, maxDim, quality, stamp) {
  if (!file || !file.type?.startsWith('image/')) return file

  // Decode downscaled up front (resizeWidth alone preserves aspect per spec),
  // so a huge source never materialises a full-resolution bitmap in memory.
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: maxDim, resizeQuality: 'high' })
  } catch {
    try {
      bitmap = await createImageBitmap(file, { resizeWidth: maxDim })
    } catch {
      bitmap = await createImageBitmap(file)
    }
  }

  // Cap the long side at maxDim (the decode above only bounded the width).
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  if (stamp) drawTimestamp(ctx, w, h)

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality))
  if (!blob) return file
  // When stamping we MUST return the stamped image even if it's not smaller —
  // the timestamp is the point. Without a stamp, keep the original if smaller.
  if (!stamp && blob.size >= file.size) return file
  return new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
}

export async function compressImage(file, { maxDim = 1600, quality = 0.7, timeoutMs = 15000, stamp = false } = {}) {
  try {
    // Time-box: if decoding hangs (corrupt/unsupported file), fall back to the
    // original after timeoutMs so the upload — and the UI — never get stuck.
    return await Promise.race([
      downscale(file, maxDim, quality, stamp),
      new Promise((resolve) => setTimeout(() => resolve(file), timeoutMs)),
    ])
  } catch {
    return file // never block capture on a compression failure
  }
}
