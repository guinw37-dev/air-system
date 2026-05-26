export default function Spinner({ className = 'h-8 w-8' }) {
  return (
    <div className={`animate-spin rounded-full border-4 border-gray-200 border-t-blue-600 ${className}`} />
  )
}

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Spinner className="h-10 w-10" />
    </div>
  )
}
