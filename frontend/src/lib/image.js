// Downscale + compress a captured photo before it enters the offline outbox.
// Mobile camera files are often 3–8 MB which stall/fail the upload (the "sync
// flicker"); resizing to ~1600px JPEG q0.7 brings them to a few hundred KB so
// they actually reach the server. Falls back to the original file on any error.
export async function compressImage(file, { maxDim = 1600, quality = 0.7 } = {}) {
  try {
    if (!file || !file.type?.startsWith('image/')) return file;

    // Decode DOWNSCALED so a huge phone photo (e.g. 48MP / HEIC) never produces
    // a full-resolution bitmap — that can freeze the main thread or OOM-crash the
    // tab to a blank screen. resizeWidth alone keeps aspect ratio (per spec); the
    // canvas pass below caps the long side to maxDim.
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: maxDim, resizeQuality: 'high' });
    } catch {
      try {
        bitmap = await createImageBitmap(file, { resizeWidth: maxDim });
      } catch {
        bitmap = await createImageBitmap(file);
      }
    }

    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) return file;
    // Only use the compressed result if it is actually smaller.
    if (blob.size >= file.size) return file;
    return new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // never block capture on a compression failure
  }
}
