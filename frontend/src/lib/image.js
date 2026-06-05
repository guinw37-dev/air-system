// Downscale + compress a captured photo before it enters the upload. Mobile
// camera files are often 3–8 MB (sometimes 48MP / HEIC) which stall the upload
// or, decoded at full resolution, can freeze/OOM the tab. We decode DOWNSCALED
// so peak memory stays bounded, and we time-box the whole thing so a hostile
// file can never hang the UI — on any failure or timeout we fall back to
// uploading the original file untouched.
async function downscale(file, maxDim, quality) {
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
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality))
  if (!blob || blob.size >= file.size) return file // keep original if not smaller
  return new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
}

export async function compressImage(file, { maxDim = 1600, quality = 0.7, timeoutMs = 15000 } = {}) {
  try {
    // Time-box: if decoding hangs (corrupt/unsupported file), fall back to the
    // original after timeoutMs so the upload — and the UI — never get stuck.
    return await Promise.race([
      downscale(file, maxDim, quality),
      new Promise((resolve) => setTimeout(() => resolve(file), timeoutMs)),
    ])
  } catch {
    return file // never block capture on a compression failure
  }
}
