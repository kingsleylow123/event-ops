// Admins/founders who can approve / reject user signups.
export const ADMIN_EMAILS = [
  'wowo.vs.wawa@gmail.com',
  'kingsleylow99@gmail.com',
]

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return ADMIN_EMAILS.some(a => a.toLowerCase() === email.toLowerCase())
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface UserApproval {
  email: string
  status: ApprovalStatus
  is_admin: boolean
  requested_at: string
  decided_at: string | null
  decided_by: string | null
  notes: string | null
}
