// TW brand mark (Technical Water) — inline SVG so it's crisp at any size and
// needs no asset. A white rounded tile reads on both the dark sidebar and light
// pages; blue "TW" with a water-drop accent echoes the company logo. To use the
// real artwork later, drop it at /public/logo-tw.png and swap <Logo/> for an <img>.
export default function Logo({ size = 40, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="tw-b" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2E9BE0" />
          <stop offset="1" stopColor="#1763A8" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="#FFFFFF" stroke="#DCEAF6" strokeWidth="1.5" />
      <text x="24" y="30" textAnchor="middle" fontFamily="'Segoe UI', system-ui, sans-serif"
            fontSize="19" fontWeight="800" letterSpacing="-1" fill="url(#tw-b)">TW</text>
      {/* water-drop accent */}
      <path d="M35 9c1.6 1.9 2.6 3.3 2.6 4.6a2.6 2.6 0 1 1-5.2 0c0-1.3 1-2.7 2.6-4.6Z" fill="#2E9BE0" />
      <rect x="13" y="35" width="22" height="2.4" rx="1.2" fill="url(#tw-b)" opacity="0.35" />
    </svg>
  )
}
