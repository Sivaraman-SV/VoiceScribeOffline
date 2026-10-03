import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  ClipboardList,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Moon,
  PlusCircle,
  Settings,
  ShieldCheck,
  Sun,
  Users,
} from 'lucide-react'

import { IconButton, Modal } from '@/components/ui/primitives'
import { SAFETY_NOTICE } from '@/constants'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/utils/cn'
import { initials } from '@/utils/format'

const BASE_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/sessions/new', label: 'New Consultation', icon: PlusCircle, end: false },
  // Temporarily hidden from public view - can be reactivated later:
  // { to: '/sessions/gmeet', label: 'Record Google Meet', icon: Video, end: false },
  { to: '/sessions', label: 'Consultations', icon: ClipboardList, end: true },
]

export function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const { theme, toggleTheme } = useUiStore()
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  useEffect(() => setMenuOpen(false), [location.pathname])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const rawDisplayName = user?.full_name || 'Dr. Saksham'
  const displayName = rawDisplayName.startsWith('Dr.') ? rawDisplayName : `Dr. ${rawDisplayName}`
  const department = user?.department || 'Pediatrics'
  const doctorId = user?.doctor_id

  const navItems = [...BASE_NAV]
  if (user?.role === 'ADMIN') {
    navItems.push({
      to: '/admin/doctors',
      label: 'Doctor Admin',
      icon: Users,
      end: false,
    })
  }

  const nav = (
    <nav className="seg max-w-full overflow-x-auto" aria-label="Primary">
      {navItems.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => cn('seg-item', isActive && 'seg-item-active')}
        >
          {({ isActive }) => (
            <>
              <span
                className={cn(
                  'grid h-6 w-6 place-items-center rounded-full transition',
                  isActive ? 'bg-lime text-lime-fg' : 'text-ink-3',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas font-sans text-ink transition-colors duration-200">
      <header className="z-30 shrink-0 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
        <div className="flex h-16 items-center gap-4 px-4 md:px-6">
          <Link to="/" className="flex shrink-0 items-center" aria-label="SIMS VoiceScribe AI home">
            <img
              src="/sims-logo.png"
              alt="SIMS VoiceScribe AI"
              className="h-8 w-auto max-w-[170px] object-contain dark:hidden"
            />
            <img
              src="/sims-logo-dark.png"
              alt="SIMS VoiceScribe AI"
              className="hidden h-8 w-auto max-w-[170px] object-contain dark:block"
            />
          </Link>

          <div className="hidden flex-1 justify-center lg:flex">{nav}</div>

          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <IconButton label="Help & Support" onClick={() => setShowHelpModal(true)}>
              <HelpCircle className="h-4 w-4" />
            </IconButton>
            <NavLink
              to="/settings"
              title="Settings"
              aria-label="Settings"
              className={({ isActive }) => cn('btn-icon', isActive && 'border-brand bg-brand text-brand-fg hover:bg-brand hover:text-brand-fg')}
            >
              <Settings className="h-4 w-4" />
            </NavLink>
            <IconButton
              label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </IconButton>

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className="flex items-center gap-2.5 rounded-full border border-line bg-surface py-1 pl-1 pr-3 transition hover:border-line-strong"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title={`${displayName} (${department})`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-xs font-semibold text-brand-fg">
                  {initials(displayName) || 'SS'}
                </span>
                <span className="hidden min-w-0 text-left leading-tight sm:block">
                  <span className="block max-w-[140px] truncate text-xs font-semibold text-ink">{displayName}</span>
                  <span className="block max-w-[140px] truncate text-2xs text-ink-3">{department}</span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-ink-3" />
              </button>

              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-40 mt-2 w-64 rounded-tile border border-line bg-surface p-2 shadow-float animate-fade-in-down"
                >
                  <div className="flex items-center gap-3 rounded-control bg-surface-2 p-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-brand-fg">
                      {initials(displayName) || 'SS'}
                    </span>
                    <div className="min-w-0 leading-tight">
                      <p className="truncate text-sm font-semibold text-ink">{displayName}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-3">
                        {department}
                        {doctorId ? ` • ${doctorId}` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleLogout}
                    className="mt-1 flex w-full items-center gap-2.5 rounded-control px-3 py-2.5 text-[13px] font-medium text-ink-2 transition hover:bg-tone-danger-bg hover:text-tone-danger-fg"
                    title="Sign out"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Sign out</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex justify-center px-4 pb-3 lg:hidden">{nav}</div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <main className="min-h-0 flex-1 overflow-hidden">
          <div key={location.pathname} className="h-full min-h-0 w-full animate-fade-in-up">
            <Outlet />
          </div>
        </main>
        {location.pathname !== '/' && (
          <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-line/70 bg-canvas px-6 py-2 text-2xs text-ink-3">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {SAFETY_NOTICE}
            </span>
            <span className="hidden shrink-0 font-semibold text-ink-2 md:inline">SIMS Hospital Clinical Informatics</span>
          </footer>
        )}
      </div>

      <Modal
        open={showHelpModal}
        title="Help & Clinical Support"
        icon={<HelpCircle className="h-4 w-4" />}
        onClose={() => setShowHelpModal(false)}
        footer={
          <button type="button" onClick={() => setShowHelpModal(false)} className="btn-primary">
            Close
          </button>
        }
      >
        <div className="space-y-3 text-[13px] leading-relaxed text-ink-2">
          <p>
            <strong className="text-ink">SIMS MedScribe</strong> provides ambient multi-lingual speech transcription,
            13-particular Ambulatory Care clinical structuring, and official hospital-grade documentation.
          </p>
          <div className="tile space-y-1 p-4 text-xs">
            <p className="font-semibold text-ink">Department of Clinical Informatics</p>
            <p>SIMS Hospital, Jawaharlal Nehru Salai, Vadapalani, Chennai</p>
            <p>Support Hotline: ext. 4401 | Email: support@simshospital.com</p>
          </div>
          <p className="text-xs text-ink-3">
            All generated clinical notes require physician review and verification prior to EHR sign-off.
          </p>
        </div>
      </Modal>
    </div>
  )
}
