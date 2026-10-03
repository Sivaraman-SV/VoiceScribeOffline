import React, { useEffect, useState } from 'react'
import {
  UserPlus,
  Search,
  ShieldCheck,
  Stethoscope,
  KeyRound,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  X,
  Loader2,
} from 'lucide-react'
import { api } from '@/services/api'
import { MedicalPulseLoader } from '@/components/ui/MedicalAnimations'
import { PageHeader } from '@/components/ui/primitives'
import type { AuthUser, DoctorCreatePayload } from '@/types'

const DEPARTMENTS = [
  'General Medicine',
  'Ambulatory Care',
  'Cardiology',
  'Pediatrics',
  'Neurology',
  'Orthopedics',
  'Emergency Medicine',
  'Dermatology',
  'Pulmonology',
  'Obstetrics & Gynecology',
]

export function AdminDoctorsPage() {
  const [doctors, setDoctors] = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isResetModalOpen, setIsResetModalOpen] = useState(false)
  const [selectedDoctor, setSelectedDoctor] = useState<AuthUser | null>(null)
  const [resetNewPassword, setResetNewPassword] = useState('')

  // Form State for Provisioning
  const [formData, setFormData] = useState<DoctorCreatePayload>({
    doctor_id: '',
    full_name: '',
    email: '',
    department: 'General Medicine',
    password: '',
  })
  const [submitting, setSubmitting] = useState(false)

  const loadDoctors = async () => {
    setLoading(true)
    try {
      const data = await api.listDoctors()
      setDoctors(data)
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve doctors list.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadDoctors()
  }, [])

  const handleCreateDoctor = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      const created = await api.createDoctor({
        doctor_id: formData.doctor_id.trim().toUpperCase(),
        full_name: formData.full_name.trim(),
        email: formData.email.trim().toLowerCase(),
        department: formData.department.trim(),
        password: formData.password,
      })
      setSuccess(`Doctor ${created.doctor_id} (${created.full_name}) provisioned successfully.`)
      setIsAddModalOpen(false)
      setFormData({
        doctor_id: '',
        full_name: '',
        email: '',
        department: 'General Medicine',
        password: '',
      })
      await loadDoctors()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to provision doctor.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleStatus = async (doctor: AuthUser) => {
    try {
      const updated = await api.updateDoctorStatus(doctor.id, !doctor.is_active)
      setDoctors((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
      setSuccess(`Doctor ${doctor.doctor_id} status updated to ${updated.is_active ? 'Active' : 'Suspended'}.`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to change doctor status.')
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedDoctor || !resetNewPassword) return

    setSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      await api.resetDoctorPassword(selectedDoctor.id, resetNewPassword)
      setSuccess(`Password for Doctor ${selectedDoctor.doctor_id || selectedDoctor.full_name} has been updated.`)
      setIsResetModalOpen(false)
      setSelectedDoctor(null)
      setResetNewPassword('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reset password.')
    } finally {
      setSubmitting(false)
    }
  }

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$'
    let pass = ''
    for (let i = 0; i < 10; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    setFormData((prev) => ({ ...prev, password: pass }))
  }

  const filteredDoctors = doctors.filter((doc) => {
    const q = searchQuery.toLowerCase()
    return (
      (doc.doctor_id && doc.doctor_id.toLowerCase().includes(q)) ||
      doc.full_name.toLowerCase().includes(q) ||
      doc.email.toLowerCase().includes(q) ||
      (doc.department && doc.department.toLowerCase().includes(q))
    )
  })

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          eyebrow={
            <span className="inline-flex items-center gap-1.5 text-brand">
              <ShieldCheck className="h-4 w-4" />
              Hospital Administration Portal
            </span>
          }
          title="Doctor ID Provisioning"
          subtitle="Assign unique Doctor IDs, departments, and credentials. Doctors access the workstation using their assigned ID."
          actions={
            <>
              <button
                type="button"
                onClick={loadDoctors}
                disabled={loading}
                className="btn-icon h-10 w-10"
                title="Refresh Doctor List"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAddModalOpen(true)
                  setError(null)
                  setSuccess(null)
                }}
                className="btn-primary"
              >
                <UserPlus className="h-4 w-4" />
                Provision New Doctor ID
              </button>
            </>
          }
        />

        {error && (
          <div className="flex items-start gap-3 rounded-tile border px-4 py-3 text-xs tone-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {success && (
          <div className="flex items-start gap-3 rounded-tile border px-4 py-3 text-xs tone-success">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{success}</p>
          </div>
        )}

        <section className="card flex flex-col overflow-hidden">
          <div className="flex flex-col gap-3 px-5 pb-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
              <input
                type="text"
                placeholder="Search by Doctor ID, name, email, or department..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="field-input rounded-full py-2 pl-10"
              />
            </div>
            <div className="chip py-1.5">
              Total Doctors: <span className="font-semibold text-ink">{doctors.length}</span>
            </div>
          </div>

          {loading && doctors.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center p-12">
              <MedicalPulseLoader
                label="Synchronizing Doctor Directory"
                sublabel="Accessing hospital credential registries and active sessions"
                size="md"
              />
            </div>
          ) : filteredDoctors.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 pb-14 pt-8 text-center">
              <div className="mb-3 grid h-14 w-14 place-items-center rounded-full bg-surface-3 text-ink-3">
                <Stethoscope className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-ink">No doctors found</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink-3">
                {searchQuery
                  ? 'No provisioned doctor matches your search query.'
                  : 'Click "Provision New Doctor ID" to assign credentials to doctors.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto px-2 pb-2">
              <table className="data-table min-w-[900px]">
                <thead>
                  <tr>
                    <th>Doctor ID</th>
                    <th>Doctor Name</th>
                    <th>Department</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Last Login</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDoctors.map((doc) => (
                    <tr key={doc.id}>
                      <td>
                        <span className="badge tone-brand mono">{doc.doctor_id || 'DOC-UNASSIGNED'}</span>
                      </td>
                      <td className="font-semibold text-ink">{doc.full_name}</td>
                      <td>{doc.department || 'General Medicine'}</td>
                      <td className="mono text-xs text-ink-3">{doc.email}</td>
                      <td>
                        {doc.is_active ? (
                          <span className="badge tone-success">
                            <CheckCircle2 className="h-3 w-3" /> Active
                          </span>
                        ) : (
                          <span className="badge tone-danger">
                            <XCircle className="h-3 w-3" /> Suspended
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-xs text-ink-3">
                        {doc.last_login_at
                          ? new Date(doc.last_login_at).toLocaleString(undefined, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })
                          : 'Never'}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDoctor(doc)
                              setResetNewPassword('')
                              setIsResetModalOpen(true)
                            }}
                            className="btn-secondary btn-sm"
                          >
                            Reset Password
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(doc)}
                            className={`btn btn-sm ${doc.is_active ? 'tone-warning hover:brightness-95' : 'tone-success hover:brightness-95'}`}
                          >
                            {doc.is_active ? 'Suspend' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {isAddModalOpen && (
        <div className="modal-backdrop">
          <div className="modal max-w-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="icon-badge-soft">
                  <UserPlus className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-base font-semibold tracking-tight text-ink">Provision Doctor ID</h3>
                  <p className="mt-0.5 text-xs text-ink-3">Create new doctor login credentials</p>
                </div>
              </div>
              <button type="button" onClick={() => setIsAddModalOpen(false)} className="btn-icon btn-icon-sm">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <form onSubmit={handleCreateDoctor} className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">
                    Doctor ID <span className="text-tone-danger-fg">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. DOC-101"
                    value={formData.doctor_id}
                    onChange={(e) => setFormData({ ...formData, doctor_id: e.target.value.toUpperCase() })}
                    className="field-input mono font-semibold uppercase"
                  />
                  <p className="field-hint">Unique doctor badge identifier</p>
                </div>

                <div>
                  <label className="field-label">
                    Department <span className="text-tone-danger-fg">*</span>
                  </label>
                  <select
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="field-input"
                  >
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="field-label">
                  Doctor Full Name <span className="text-tone-danger-fg">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dr. Arvind Swaminathan, MD"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  className="field-input"
                />
              </div>

              <div>
                <label className="field-label">
                  Official Email <span className="text-tone-danger-fg">*</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="doctor@simshospital.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="field-input"
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="field-label mb-0">
                    Initial Password <span className="text-tone-danger-fg">*</span>
                  </label>
                  <button type="button" onClick={generateRandomPassword} className="link text-xs">
                    Generate Secure
                  </button>
                </div>
                <input
                  type="text"
                  required
                  placeholder="Minimum 6 characters"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="field-input mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-line pt-5">
                <button type="button" onClick={() => setIsAddModalOpen(false)} className="btn-ghost">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn-primary">
                  {submitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Provisioning...
                    </>
                  ) : (
                    'Provision Doctor ID'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isResetModalOpen && selectedDoctor && (
        <div className="modal-backdrop">
          <div className="modal max-w-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="icon-badge-soft">
                  <KeyRound className="h-4 w-4" />
                </span>
                <h3 className="text-base font-semibold tracking-tight text-ink">Reset Password</h3>
              </div>
              <button type="button" onClick={() => setIsResetModalOpen(false)} className="btn-icon btn-icon-sm">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="mt-5 space-y-4">
              <p className="text-[13px] leading-relaxed text-ink-2">
                Reset password for <span className="font-semibold text-ink">{selectedDoctor.full_name}</span> (
                <span className="mono text-brand">{selectedDoctor.doctor_id || selectedDoctor.email}</span>):
              </p>

              <div>
                <label className="field-label">New Password</label>
                <input
                  type="text"
                  required
                  placeholder="Enter new password (min 6 characters)"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  className="field-input mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button type="button" onClick={() => setIsResetModalOpen(false)} className="btn-ghost">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn-primary">
                  {submitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    'Update Password'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
