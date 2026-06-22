// /api/claims/[id]/receipt — upload or remove a receipt image for a claim.
// POST   FormData{ file } → uploads to the 'receipts' bucket, writes the public
//        URL to claims.receipt_url, returns { ok, receipt_url }.
// DELETE → removes the stored file (best-effort) and clears receipt_url.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' } as const
const BUCKET = 'receipts'
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
}

function pathFromPublicUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const i = url.indexOf(marker)
  return i === -1 ? null : url.slice(i + marker.length)
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin('POST /api/claims/[id]/receipt')
  if (g.response) return g.response

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400, headers: NO_STORE })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required (multipart/form-data)' }, { status: 400, headers: NO_STORE })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 413, headers: NO_STORE })
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 415, headers: NO_STORE })
  }

  const ext = EXT[file.type]
  const path = `${id}/${Date.now()}.${ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())

  const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: true,
  })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500, headers: NO_STORE })

  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
  const receipt_url = pub.publicUrl

  const { data: existing } = await supabaseAdmin.from('claims').select('receipt_url').eq('id', id).single()
  const previous = existing?.receipt_url ? pathFromPublicUrl(existing.receipt_url as string) : null

  const { error: updErr } = await supabaseAdmin.from('claims').update({ receipt_url }).eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500, headers: NO_STORE })

  if (previous && previous !== path) {
    await supabaseAdmin.storage.from(BUCKET).remove([previous])
  }

  return NextResponse.json({ ok: true, receipt_url }, { headers: NO_STORE })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin('DELETE /api/claims/[id]/receipt')
  if (g.response) return g.response

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400, headers: NO_STORE })

  const { data: existing } = await supabaseAdmin.from('claims').select('receipt_url').eq('id', id).single()
  const path = existing?.receipt_url ? pathFromPublicUrl(existing.receipt_url as string) : null

  const { error: updErr } = await supabaseAdmin.from('claims').update({ receipt_url: null }).eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500, headers: NO_STORE })

  if (path) await supabaseAdmin.storage.from(BUCKET).remove([path])
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
