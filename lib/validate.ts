// Shared input validation for the public forms (/survey, /start, /capture).

// Phone: strip +, spaces, dashes, parens → require 8–15 digits.
// Accepts MY (0123456789), SG (+65 9116 2866), UK (+44 7868 872241);
// rejects '123', 'abc'. Mirrors the server-side normPhone tolerance.
export function isValidPhone(s: string): boolean {
  const digits = s.replace(/[\s+()-]/g, '')
  return /^\d{8,15}$/.test(digits)
}
