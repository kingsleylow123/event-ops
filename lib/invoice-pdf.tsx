// Server-side PDF invoice generator using @react-pdf/renderer.
// Renders the CMO Consulting Sdn. Bhd. branded invoice as a Buffer for Telegram delivery.

import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { Document, Page, View, Text, Image, StyleSheet, pdf } from '@react-pdf/renderer'

// Load the brand logo once at module init. If the file isn't bundled into the
// serverless function (Next.js sometimes doesn't trace public/ assets), we fall
// back to a text-based logo block in the component below — the PDF still ships.
let LOGO_BUFFER: Buffer | null = null
try {
  LOGO_BUFFER = fs.readFileSync(path.join(process.cwd(), 'public', 'cmo-logo-orange.png'))
} catch (e) {
  console.warn('[invoice-pdf] cmo-logo-orange.png not found, falling back to text logo', e)
}

// ── Types ───────────────────────────────────────────────────────────────
export type InvoiceLineItem = {
  desc: string
  qty: number
  unit: number
}

export type InvoicePayment = {
  label: string
  amount: number
}

export type InvoiceData = {
  clientName: string
  date: Date
  invoiceNo?: string            // e.g. 'CMO-2026-0025' — rendered top-right under the INVOICE title. Optional so Balance-mode / legacy callers keep working without burning a number.
  companyName?: string
  companyEmail?: string
  companyPhone?: string
  bankName?: string
  bankAccount?: string
  bankHolder?: string
  note?: string                 // e.g. "[non refundable"
  lineItems: InvoiceLineItem[]  // 1 → quick mode look; many or payments → balance mode look
  payments?: InvoicePayment[]
}

// ── Helpers ─────────────────────────────────────────────────────────────
function ordinalSuffix(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'TH'
  switch (n % 10) {
    case 1: return 'ST'
    case 2: return 'ND'
    case 3: return 'RD'
    default: return 'TH'
  }
}

function formatDate(d: Date) {
  const day = d.getDate()
  const month = d.toLocaleString('en-US', { month: 'long' }).toUpperCase()
  return {
    day,
    suffix: ordinalSuffix(day),
    month,
    year: d.getFullYear(),
  }
}

function rm(n: number): string {
  return `RM ${n.toLocaleString('en-MY', { maximumFractionDigits: 2 })}`
}

// ── Styles ──────────────────────────────────────────────────────────────
const ORANGE = '#F26522'     // CMO Consulting brand color (matches the /invoice web page)
const INK = '#111111'
const MUTED = '#999999'
const RULE = '#d8d8d8'
const TOTAL_BG = '#efeeec'

const styles = StyleSheet.create({
  page: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    fontSize: 11,
    color: INK,
  },
  // Left red stripe with notch (gap from 90→108 pts approx)
  stripeTop:    { position: 'absolute', left: 0, top: 0,   width: 12, height: 75,  backgroundColor: ORANGE },
  stripeBottom: { position: 'absolute', left: 0, top: 90,  width: 12, bottom: 0,   backgroundColor: ORANGE },

  content: {
    flex: 1,
    paddingTop: 36,
    paddingRight: 44,
    paddingBottom: 36,
    paddingLeft: 28,
    flexDirection: 'column',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  logoImage: {
    width: 56,
    height: 56,
  },
  logoFallback: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderColor: INK,
  },
  logoFallbackOrange: {
    backgroundColor: ORANGE,
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 900,
    paddingTop: 4,
    paddingBottom: 11,
    paddingLeft: 10,
    paddingRight: 10,
  },
  logoFallbackText: {
    color: INK,
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 2,
    paddingTop: 4,
    paddingBottom: 11,
    paddingLeft: 10,
    paddingRight: 10,
  },
  invoiceTitleCol: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  invoiceTitle: {
    fontSize: 36,
    fontWeight: 400,
    letterSpacing: 3,
    marginTop: -8,
  },
  invoiceNo: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 1,
    color: ORANGE,
    marginTop: 4,
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: RULE,
    marginBottom: 20,
  },

  // Billing
  billingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  billingLeft: { flexDirection: 'column' },
  billingRight: { flexDirection: 'column', alignItems: 'flex-end' },
  lbl: {
    fontSize: 7.5,
    color: MUTED,
    marginBottom: 4,
    letterSpacing: 1.5,
  },
  clientName: {
    fontSize: 14,
    color: INK,
  },
  companyName: {
    fontSize: 14,
    color: INK,
    marginBottom: 2,
  },
  companyReg: {
    fontSize: 9,
    color: '#777777',
    textAlign: 'right',
    marginBottom: 4,
  },
  companyContact: {
    fontSize: 10,
    color: '#555555',
    lineHeight: 1.6,
    textAlign: 'right',
  },

  dateRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 18,
    marginBottom: 14,
  },
  dateText: {
    fontSize: 10,
    color: '#333333',
    letterSpacing: 2.5,
  },
  dateSup: {
    fontSize: 6,
    color: '#333333',
    marginLeft: -1,
    marginRight: 4,
  },

  // Table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: ORANGE,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  th: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 700,
  },
  thDesc: { flex: 1, textAlign: 'left' },
  thQty: { width: 40, textAlign: 'center' },
  thUnit: { width: 70, textAlign: 'right' },
  thAmount: { width: 90, textAlign: 'right' },

  tableRow: {
    flexDirection: 'row',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#f0f0f0',
  },
  td: {
    fontSize: 10.5,
    color: '#222222',
  },
  tdDesc: { flex: 1, textAlign: 'left', paddingRight: 8 },
  tdQty: { width: 40, textAlign: 'center' },
  tdUnit: { width: 70, textAlign: 'right' },
  tdAmount: { width: 90, textAlign: 'right' },

  // Totals stack (right column)
  totals: {
    marginTop: 14,
    marginLeft: 'auto',
    width: 280,
  },
  totalLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    paddingHorizontal: 10,
    fontSize: 11,
    color: '#222222',
  },
  subtotalLine: {
    borderTopWidth: 0.5,
    borderTopColor: '#cccccc',
    paddingTop: 9,
    fontWeight: 600,
  },
  paymentsHeader: {
    fontSize: 7.5,
    color: MUTED,
    letterSpacing: 1.5,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 3,
  },
  balanceLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: TOTAL_BG,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginTop: 6,
  },
  balanceLbl: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1,
    color: ORANGE,
  },
  balanceAmt: {
    fontSize: 14,
    fontWeight: 800,
    color: INK,
  },

  // Footer
  footer: {
    flexDirection: 'column',
    marginTop: 'auto',
    paddingTop: 18,
  },
  payTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: INK,
    marginBottom: 8,
  },
  payDetails: {
    fontSize: 10,
    color: '#333333',
    lineHeight: 1.7,
    marginBottom: 12,
  },
  payNote: {
    fontSize: 9.5,
    color: '#555555',
    maxWidth: 260,
    lineHeight: 1.5,
  },

  // Quick-mode single-line "Description / Price" variant
  quickTableHeader: {
    flexDirection: 'row',
    backgroundColor: ORANGE,
    paddingVertical: 11,
    paddingHorizontal: 18,
  },
  quickHeaderTitle: { color: '#ffffff', fontSize: 12, fontWeight: 700 },
  quickRow: {
    flexDirection: 'row',
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  totalBox: {
    flexDirection: 'row',
    backgroundColor: TOTAL_BG,
    paddingVertical: 12,
    paddingHorizontal: 22,
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 22,
    marginTop: 16,
  },
  totalLbl: { fontSize: 11, fontWeight: 700, letterSpacing: 1 },
  totalAmt: { fontSize: 13, fontWeight: 700 },
})

// ── Component ───────────────────────────────────────────────────────────
function InvoiceDocument({ data }: { data: InvoiceData }) {
  const dp = formatDate(data.date)
  const items = data.lineItems
  const subtotal = items.reduce((s, li) => s + li.qty * li.unit, 0)
  const totalPaid = (data.payments || []).reduce((s, p) => s + p.amount, 0)
  const balance = subtotal - totalPaid
  // "Quick" look = exactly 1 line item, no payments → render single big TOTAL box
  const isQuick = items.length === 1 && (!data.payments || data.payments.length === 0)

  const companyName = data.companyName || 'CMO Consulting Sdn. Bhd.'
  const companyReg = '202601024007 (1686104-X)'
  const companyEmail = data.companyEmail || 'claudemalaysiaofficial@gmail.com'
  const companyPhone = data.companyPhone || '012-285 0125'
  const bankName = data.bankName || 'Maybank SME Biz'
  const bankAccount = data.bankAccount || '5142 8090 1848'
  const bankHolder = data.bankHolder || 'Kingsley Low Yean Wee'

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Orange stripe (two pieces with a gap) */}
        <View style={styles.stripeTop} />
        <View style={styles.stripeBottom} />

        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            {LOGO_BUFFER ? (
              <Image style={styles.logoImage} src={{ data: LOGO_BUFFER, format: 'png' }} />
            ) : (
              <View style={styles.logoFallback}>
                <Text style={styles.logoFallbackOrange}>CMO</Text>
                <Text style={styles.logoFallbackText}>CONSULTING</Text>
              </View>
            )}
            <View style={styles.invoiceTitleCol}>
              <Text style={styles.invoiceTitle}>INVOICE</Text>
              {data.invoiceNo ? <Text style={styles.invoiceNo}>{data.invoiceNo}</Text> : null}
            </View>
          </View>

          <View style={styles.divider} />

          {/* Billing */}
          <View style={styles.billingRow}>
            <View style={styles.billingLeft}>
              <Text style={styles.lbl}>INVOICE TO</Text>
              <Text style={styles.clientName}>{data.clientName}</Text>
            </View>
            <View style={styles.billingRight}>
              <Text style={styles.lbl}>COMPANY:</Text>
              <Text style={styles.companyName}>{companyName}</Text>
              <Text style={styles.companyReg}>{companyReg}</Text>
              <Text style={styles.companyContact}>{companyEmail}</Text>
              <Text style={styles.companyContact}>{companyPhone}</Text>
            </View>
          </View>

          {/* Date */}
          <View style={styles.dateRow}>
            <Text style={styles.dateText}>{dp.day}</Text>
            <Text style={styles.dateSup}>{dp.suffix}</Text>
            <Text style={styles.dateText}>{` ${dp.month} ${dp.year}`}</Text>
          </View>

          {/* Table */}
          {isQuick ? (
            <View>
              <View style={styles.quickTableHeader}>
                <Text style={[styles.quickHeaderTitle, { flex: 1 }]}>Description</Text>
                <Text style={[styles.quickHeaderTitle, { width: 100, textAlign: 'right' }]}>Price</Text>
              </View>
              <View style={styles.quickRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ fontSize: 11, color: '#222222', lineHeight: 1.4 }}>{items[0].desc}</Text>
                  {data.note ? (
                    <Text style={{ fontSize: 11, color: '#222222', lineHeight: 1.4 }}>{data.note}</Text>
                  ) : null}
                </View>
                <Text style={{ width: 100, textAlign: 'right', fontSize: 11, color: '#222222' }}>
                  {items[0].unit.toLocaleString('en-MY')}
                </Text>
              </View>
              <View style={styles.totalBox}>
                <Text style={styles.totalLbl}>TOTAL</Text>
                <Text style={styles.totalAmt}>{rm(subtotal)}</Text>
              </View>
            </View>
          ) : (
            <View>
              <View style={styles.tableHeader}>
                <Text style={[styles.th, styles.thDesc]}>Description</Text>
                <Text style={[styles.th, styles.thQty]}>Qty</Text>
                <Text style={[styles.th, styles.thUnit]}>Unit</Text>
                <Text style={[styles.th, styles.thAmount]}>Amount</Text>
              </View>
              {items.map((li, i) => (
                <View key={i} style={styles.tableRow}>
                  <Text style={[styles.td, styles.tdDesc]}>{li.desc}</Text>
                  <Text style={[styles.td, styles.tdQty]}>{li.qty}</Text>
                  <Text style={[styles.td, styles.tdUnit]}>{li.unit.toLocaleString('en-MY')}</Text>
                  <Text style={[styles.td, styles.tdAmount]}>{rm(li.qty * li.unit)}</Text>
                </View>
              ))}

              {/* Totals stack */}
              <View style={styles.totals}>
                <View style={[styles.totalLine, styles.subtotalLine]}>
                  <Text>Subtotal</Text>
                  <Text>{rm(subtotal)}</Text>
                </View>
                {data.payments && data.payments.length > 0 && (
                  <>
                    <Text style={styles.paymentsHeader}>PAYMENTS RECEIVED</Text>
                    {data.payments.map((p, i) => (
                      <View key={i} style={styles.totalLine}>
                        <Text>{p.label}</Text>
                        <Text>− {rm(p.amount)}</Text>
                      </View>
                    ))}
                  </>
                )}
                <View style={styles.balanceLine}>
                  <Text style={balance <= 0 ? [styles.balanceLbl, { color: '#2c7a2f' }] : styles.balanceLbl}>
                    {balance <= 0 ? 'PAID IN FULL' : 'BALANCE DUE'}
                  </Text>
                  <Text style={styles.balanceAmt}>{rm(Math.max(0, balance))}</Text>
                </View>
              </View>
            </View>
          )}

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.payTitle}>PAYMENT METHOD</Text>
            <Text style={styles.payDetails}>
              {`Bank Name: ${bankName}\nBank Account: ${bankAccount}\nName: ${bankHolder}`}
            </Text>
            <Text style={styles.payNote}>
              Full payment should be made a minimum of 7 days to avoid termination of my services
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}

// ── Public API ──────────────────────────────────────────────────────────
export async function renderInvoicePDF(data: InvoiceData): Promise<Buffer> {
  const instance = pdf(<InvoiceDocument data={data} />)
  const stream = await instance.toBuffer()
  // toBuffer() returns a NodeJS.ReadableStream — collect into a Buffer
  return await streamToBuffer(stream as unknown as NodeJS.ReadableStream)
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (c: Buffer) => chunks.push(c))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}
