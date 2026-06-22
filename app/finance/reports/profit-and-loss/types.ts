export type PLLine = { code: string; name: string; amount: number }
export type PLPayload = {
  scope_label: string
  from: string
  to: string
  income: { lines: PLLine[]; total: number }
  expense: { lines: PLLine[]; total: number }
  net: number
}
