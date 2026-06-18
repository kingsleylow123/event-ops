import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { requireUser } from '@/lib/auth/guard'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate' } as const

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await requireUser('GET /api/stripe/product'); if (g.response) return g.response

  const session_id = new URL(req.url).searchParams.get('session_id')
  if (!session_id) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items.data.price.product'],
    })
    const li = session.line_items?.data[0]
    const product = li?.price?.product
    const product_name =
      product && typeof product === 'object' && !('deleted' in product)
        ? product.name
        : null

    return NextResponse.json({ product_name }, { headers: NO_STORE_HEADERS })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Stripe error'
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
