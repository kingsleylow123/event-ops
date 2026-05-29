// Only these emails may access the app. Add more by appending strings.
// Emails are compared case-insensitively.
export const ALLOWED_EMAILS: string[] = [
  'wowo.vs.wawa@gmail.com',
  // TODO: add kingsley@<full-domain>.com once we have his actual email
].map(e => e.toLowerCase())

export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false
  return ALLOWED_EMAILS.includes(email.toLowerCase())
}
