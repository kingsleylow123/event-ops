export type PLLine = { code: string; name: string; amount: number }
export type PLSection = { lines: PLLine[]; total: number }
export type PLPayload = {
  scope_label: string
  from: string
  to: string
  income: PLSection
  cost_of_sales: PLSection
  gross_profit: number
  operating_expense: PLSection
  net: number
}
