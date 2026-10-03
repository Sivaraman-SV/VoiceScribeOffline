import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Stethoscope,
  ShieldCheck,
  Lock,
  Mail,
  User,
  AlertCircle,
  Building2,
  ChevronRight,
  KeyRound,
  ShieldAlert,
  Loader2,
} from 'lucide-react'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/utils/cn'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setAuth } = useAuthStore()

  const [activeTab, setActiveTab] = useState<'DOCTOR' | 'ADMIN'>('DOCTOR')
  const [isAdminSetup, setIsAdminSetup] = useState<boolean>(false)

  // Doctor credentials
  const [doctorIdentifier, setDoctorIdentifier] = useState('')
  const [doctorPassword, setDoctorPassword] = useState('')

  // Admin credentials
  const [adminEmail, setAdminEmail] = useState('')
  const [adminFullName, setAdminFullName] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('')

  // UI status
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const redirectAfterLogin = (role: string) => {
    const from = (location.state as { from?: { pathname: string } })?.from?.pathname
    if (from && from !== '/login') {
      navigate(from, { replace: true })
    } else if (role === 'ADMIN') {
      navigate('/admin/doctors', { replace: true })
    } else {
      navigate('/', { replace: true })
    }
  }

  const handleDoctorLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessMessage(null)

    if (!doctorIdentifier.trim() || !doctorPassword) {
      setError('Please provide your Doctor ID or registered email and password.')
      return
    }

    setLoading(true)
    try {
      const resp = await api.login(doctorIdentifier.trim(), doctorPassword)
      setAuth(resp.token, resp.user)
      redirectAfterLogin(resp.user.role)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed. Please verify credentials.')
    } finally {
      setLoading(false)
    }
  }

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessMessage(null)

    if (!adminEmail.trim() || !adminPassword) {
      setError('Please provide administrator email and password.')
      return
    }

    setLoading(true)
    try {
      const resp = await api.login(adminEmail.trim(), adminPassword)
      if (resp.user.role !== 'ADMIN') {
        setError('This portal is reserved for Hospital Administrators.')
        return
      }
      setAuth(resp.token, resp.user)
      redirectAfterLogin('ADMIN')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Administrator authentication failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleAdminSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessMessage(null)

    if (!adminEmail.trim() || !adminFullName.trim() || !adminPassword) {
      setError('All fields are required to initialize the administrator account.')
      return
    }
    if (adminPassword.length < 8) {
      setError('Administrator password must contain at least 8 characters.')
      return
    }
    if (adminPassword !== adminConfirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const resp = await api.adminRegister({
        email: adminEmail.trim(),
        full_name: adminFullName.trim(),
        password: adminPassword,
      })
      setSuccessMessage('Administrator account initialized successfully.')
      setAuth(resp.token, resp.user)
      redirectAfterLogin('ADMIN')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Admin setup failed or administrator already exists.')
    } finally {
      setLoading(false)
    }
  }

  const iconSlot = 'pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-ink-3'

  return (
    <div className="relative flex h-full min-h-screen flex-col items-center justify-center overflow-y-auto bg-canvas px-4 py-12 text-ink">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_-10%,rgb(var(--aqua)/0.16),transparent)]" />

      <div className="relative w-full max-w-4xl animate-fade-in-up">
        <div className="card grid overflow-hidden p-0 shadow-raised md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <aside className="brand-panel relative flex flex-col justify-between gap-10 overflow-hidden bg-brand p-8 text-brand-fg sm:p-10">
            <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-fg/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-lime/15 blur-3xl" />

            <div className="relative">
              <span className="icon-badge h-12 w-12">
                <Building2 className="h-6 w-6" />
              </span>
              <h1 className="mt-6 text-title font-semibold tracking-tight md:text-display">SIMS Hospital</h1>
              <p className="mt-2 text-sm font-semibold text-brand-fg/90">Ambulatory Care & Clinical Documentation System</p>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-brand-fg/70">
                Secure clinical workstation with live ambient AI transcription
              </p>
            </div>

            <svg
              className="relative h-14 w-full text-brand-fg/50"
              viewBox="0 0 300 40"
              fill="none"
              preserveAspectRatio="none"
              aria-hidden
            >
              <path
                d="M0 20 H110 L122 8 L132 34 L144 2 L156 30 L166 14 L176 20 H300"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity="0.8"
              />
            </svg>
          </aside>

          <div className="p-6 sm:p-10">
            <div className="seg mb-6 flex w-full">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('DOCTOR')
                  setError(null)
                }}
                className={cn('seg-item flex-1 justify-center', activeTab === 'DOCTOR' && 'seg-item-active')}
              >
                <Stethoscope className="h-3.5 w-3.5" />
                Doctor Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('ADMIN')
                  setError(null)
                }}
                className={cn('seg-item flex-1 justify-center', activeTab === 'ADMIN' && 'seg-item-active')}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Admin Portal
              </button>
            </div>

            <div className="mb-5 flex items-center justify-between gap-3 rounded-tile border border-aqua/40 bg-aqua-soft px-4 py-3 text-xs text-ink-2">
              <div className="leading-snug">
                <span className="font-semibold text-ink">
                  {activeTab === 'DOCTOR' ? 'Default Doctor:' : 'Default Admin:'}
                </span>{' '}
                <span className="mono">
                  {activeTab === 'DOCTOR' ? 'DOC-101 / doctor123' : 'admin@simshospital.com / admin123'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (activeTab === 'DOCTOR') {
                    setDoctorIdentifier('DOC-101')
                    setDoctorPassword('doctor123')
                  } else {
                    setAdminEmail('admin@simshospital.com')
                    setAdminPassword('admin123')
                  }
                }}
                className="btn-teal btn-sm shrink-0"
              >
                1-Click Fill
              </button>
            </div>

            {error && (
              <div className="tone-danger mb-5 flex items-start gap-2.5 rounded-tile border px-4 py-3 text-xs animate-fade-in-down">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="leading-relaxed">{error}</p>
              </div>
            )}

            {successMessage && (
              <div className="tone-success mb-5 flex items-start gap-2.5 rounded-tile border px-4 py-3 text-xs animate-fade-in-down">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="leading-relaxed">{successMessage}</p>
              </div>
            )}

            {activeTab === 'DOCTOR' && (
              <form onSubmit={handleDoctorLogin} className="space-y-4 animate-tab-slide">
                <div>
                  <label className="field-label">Doctor ID or Registered Email</label>
                  <div className="relative">
                    <div className={iconSlot}>
                      <User className="h-4 w-4" />
                    </div>
                    <input
                      type="text"
                      value={doctorIdentifier}
                      onChange={(e) => setDoctorIdentifier(e.target.value)}
                      placeholder="e.g. DOC-101 or doctor@simshospital.com"
                      autoComplete="username"
                      required
                      className="field-input pl-10"
                    />
                  </div>
                </div>

                <div>
                  <label className="field-label">Password</label>
                  <div className="relative">
                    <div className={iconSlot}>
                      <Lock className="h-4 w-4" />
                    </div>
                    <input
                      type="password"
                      value={doctorPassword}
                      onChange={(e) => setDoctorPassword(e.target.value)}
                      placeholder="Enter assigned password"
                      autoComplete="current-password"
                      required
                      className="field-input pl-10"
                    />
                  </div>
                </div>

                <button type="submit" disabled={loading} className="btn-primary btn-lg mt-2 w-full">
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Authenticating Doctor...
                    </>
                  ) : (
                    <>
                      Access Clinical Workstation
                      <ChevronRight className="h-4 w-4" />
                    </>
                  )}
                </button>

                <div className="border-t border-line pt-4">
                  <div className="tile flex items-start gap-3 p-3.5 text-left">
                    <span className="icon-badge-soft h-8 w-8">
                      <KeyRound className="h-4 w-4" />
                    </span>
                    <p className="text-xs leading-relaxed text-ink-3">
                      Doctor accounts are provisioned exclusively by Hospital Administration. If you do not have an assigned Doctor ID, please contact the Medical Administration desk.
                    </p>
                  </div>
                </div>
              </form>
            )}

            {activeTab === 'ADMIN' && (
              <div className="animate-tab-slide">
                {!isAdminSetup ? (
                  <form onSubmit={handleAdminLogin} className="space-y-4 animate-fade-in-up">
                    <div>
                      <label className="field-label">Administrator Email</label>
                      <div className="relative">
                        <div className={iconSlot}>
                          <Mail className="h-4 w-4" />
                        </div>
                        <input
                          type="email"
                          value={adminEmail}
                          onChange={(e) => setAdminEmail(e.target.value)}
                          placeholder="admin@simshospital.com"
                          autoComplete="email"
                          required
                          className="field-input pl-10"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="field-label">Password</label>
                      <div className="relative">
                        <div className={iconSlot}>
                          <Lock className="h-4 w-4" />
                        </div>
                        <input
                          type="password"
                          value={adminPassword}
                          onChange={(e) => setAdminPassword(e.target.value)}
                          placeholder="Enter administrator password"
                          autoComplete="current-password"
                          required
                          className="field-input pl-10"
                        />
                      </div>
                    </div>

                    <button type="submit" disabled={loading} className="btn-primary btn-lg mt-2 w-full">
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Authenticating Administrator...
                        </>
                      ) : (
                        <>
                          Sign In as Administrator
                          <ChevronRight className="h-4 w-4" />
                        </>
                      )}
                    </button>

                    <div className="border-t border-line pt-4 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setIsAdminSetup(true)
                          setError(null)
                        }}
                        className="link text-xs"
                      >
                        First-time system setup? Register initial Administrator
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleAdminSetup} className="space-y-4">
                    <div className="tone-warning flex items-start gap-2.5 rounded-tile border px-4 py-3 text-xs">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      <p className="leading-snug">
                        Initial setup is allowed only once. Once configured, public registration will be locked.
                      </p>
                    </div>

                    <div>
                      <label className="field-label">Full Name</label>
                      <input
                        type="text"
                        value={adminFullName}
                        onChange={(e) => setAdminFullName(e.target.value)}
                        placeholder="e.g. Dr. Administrator"
                        required
                        className="field-input"
                      />
                    </div>

                    <div>
                      <label className="field-label">Administrator Email</label>
                      <input
                        type="email"
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                        placeholder="admin@simshospital.com"
                        required
                        className="field-input"
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="field-label">Password</label>
                        <input
                          type="password"
                          value={adminPassword}
                          onChange={(e) => setAdminPassword(e.target.value)}
                          placeholder="Minimum 8 characters"
                          required
                          className="field-input"
                        />
                      </div>

                      <div>
                        <label className="field-label">Confirm Password</label>
                        <input
                          type="password"
                          value={adminConfirmPassword}
                          onChange={(e) => setAdminConfirmPassword(e.target.value)}
                          placeholder="Re-enter password"
                          required
                          className="field-input"
                        />
                      </div>
                    </div>

                    <button type="submit" disabled={loading} className="btn-primary btn-lg mt-2 w-full">
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Setting Up Administrator...
                        </>
                      ) : (
                        'Complete Initial Setup'
                      )}
                    </button>

                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setIsAdminSetup(false)
                          setError(null)
                        }}
                        className="btn-ghost btn-sm"
                      >
                        Back to Administrator Sign In
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 text-center text-2xs text-ink-3">
          SIMS Hospital Clinical Informatics &middot; Encrypted &amp; Audited Access
        </div>
      </div>
    </div>
  )
}
