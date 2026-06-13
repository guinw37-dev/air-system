// TW brand mark (Technical Water). The real artwork lives at /public/logo-tw.png.
// It has a white background, so it sits on a white rounded tile — reads on both
// the dark sidebar and light pages. `size` sets the tile's square height/width.
export default function Logo({ size = 40, className = '' }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-xl bg-white overflow-hidden shrink-0 ${className}`}
      style={{ height: size, width: size }}
    >
      <img src="/logo-tw.png" alt="Technical Water" className="w-full h-full object-contain" />
    </span>
  )
}
