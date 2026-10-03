import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'

export function NotFoundPage() {
  return (
    <div className="page flex items-center justify-center p-6">
      <div className="card flex w-full max-w-md flex-col items-center gap-4 px-8 py-10 text-center animate-fade-in-up">
        <span className="icon-badge h-14 w-14">
          <Compass className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <p className="text-xl font-semibold tracking-tight text-ink">Page not found</p>
          <p className="mt-1.5 text-sm text-ink-3">The route you requested does not exist in MedScribe Live.</p>
        </div>
        <Link to="/" className="btn-primary mt-2">
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
