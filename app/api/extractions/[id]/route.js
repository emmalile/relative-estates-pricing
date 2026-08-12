import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'

// GET /api/extractions/:id — one extraction with its proposed items.
export async function GET(request, { params }) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase } = auth

  const { data, error } = await supabase
    .from('extractions').select('*').eq('id', params.id).maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Extraction not found' }, { status: 404 })

  return NextResponse.json({ extraction: data })
}

// PATCH /api/extractions/:id — record review decisions.
//
// Takes the reviewed items in full rather than a list of changes: the review
// screen holds the whole set anyway, and a wholesale replace cannot leave the
// stored copy half-updated the way a sequence of per-row patches can.
//
// Only fields the reviewer owns are writable. Everything identifying what was
// read — the source, the model, the original notes — is pinned to what is
// stored, so a review cannot rewrite the record of where the items came from.
export async function PATCH(request, { params }) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase } = auth

  const body = await request.json()

  const { data: existing } = await supabase
    .from('extractions').select('id, status, items').eq('id', params.id).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Extraction not found' }, { status: 404 })
  if (existing.status !== 'reviewing') {
    return NextResponse.json(
      { error: `This extraction is ${existing.status} and can no longer be edited.` },
      { status: 409 }
    )
  }

  const update = {}

  if (Array.isArray(body.items)) {
    const byId = new Map(existing.items.map(item => [item.id, item]))
    update.items = body.items.map(incoming => {
      const stored = byId.get(incoming.id)
      if (!stored) return null
      return {
        ...stored,
        // Edited values are the reviewer's, and so is the decision.
        fields: incoming.fields && typeof incoming.fields === 'object'
          ? incoming.fields : stored.fields,
        status: ['pending', 'approved', 'rejected'].includes(incoming.status)
          ? incoming.status : stored.status,
      }
    }).filter(Boolean)
  }

  if (body.status === 'discarded') update.status = 'discarded'

  if (!Object.keys(update).length) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }
  update.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('extractions').update(update).eq('id', params.id).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ extraction: data })
}
