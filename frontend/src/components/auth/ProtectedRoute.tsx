import React, { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { Loader2 } from 'lucide-react'

interface ProtectedRouteProps {
  children: React.ReactNode
  adminOnly?: boolean
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, adminOnly = false }) => {
  const { token, user, loading, initialized, initAuth } = useAuthStore()
  const location = useLocation()

  useEffect(() => {
    if (!initialized) {
      void initAuth()
    }
  }, [initialized, initAuth])

  if (loading || !initialized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-canvas text-ink">
        <span className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-aqua-soft">
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
        </span>
        <p className="text-sm font-medium text-ink-3">Verifying clinical credentials...</p>
      </div>
    )
  }

  if (!token || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (adminOnly && user.role !== 'ADMIN') {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
