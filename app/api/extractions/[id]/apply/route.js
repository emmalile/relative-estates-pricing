import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'
import { buildScheduleItems, getCategory } from '@/lib/categories'
import { ensureVendor } from '@/lib/repository'

// POST /api/extractions/:id/apply — copy the approved items onto the schedule.
//
// This is the only step that changes what a project is buying, and it acts on
// approved items only. Pending and rejected rows are left behind; a reviewer
// who approves nothing applies nothing.
export async function POST(request, { params }) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase, user } = auth

  const body = await request.json().catch(() => ({}))

  const { data: extraction } = await supabase
    .from('extractions').select('*').eq('id', params.id).maybeSingle()
  if (!extraction) return NextResponse.json({ error: 'Extraction not found' }, { status: 404 })

  if (extraction.status !== 'reviewing') {
    return NextResponse.json(
      { error: `This extraction is already ${extraction.status}.` }, { status: 409 }
    )
  }

  const category = getCategory(extraction.category)
  if (!category) return NextResponse.json({ error: 'Unknown category' }, { status: 400 })

  const approved = (extraction.items || []).filter(i => i.status === 'approved')
  if (!approved.length) {
    return NextResponse.json(
      { error: 'No items are approved, so there is nothing to add.' }, { status: 400 }
    )
  }

  // Shaped by the same function CSV import uses, so an applied item is
  // indistinguishable from an imported one.
  const proposed = buildScheduleItems(approved.map(i => i.fields), category)
  if (!proposed.length) {
    return NextResponse.json({
      error: `Every approved item is missing ${category.itemKeyFields[0]}, which is what ` +
             'identifies a line item. Fill it in and approve again.',
    }, { status: 400 })
  }

  const { data: schedule } = await supabase
    .from('schedules').select('*')
    .eq('project_id', extraction.project_id)
    .eq('category', extraction.category)
    .maybeSingle()

  let target = schedule

  // Building the first schedule for a category from a supplier document is
  // the point of this feature, so an absent schedule is created rather than
  // refused — but it needs a manufacturer, which only the reviewer knows.
  if (!target) {
    const manufacturer = String(body.manufacturer || '').trim()
    if (!manufacturer) {
      return NextResponse.json({
        error: 'No schedule exists for this category yet. Supply a manufacturer name to create one.',
        needsManufacturer: true,
      }, { status: 400 })
    }
    const { data: created, error: createError } = await supabase
      .from('schedules').insert({
        project_id: extraction.project_id,
        category: extraction.category,
        manufacturer,
        items: [],
      }).select().single()
    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 500 })
    }
    target = created

    // Same rule as creating a schedule anywhere else: the manufacturer named
    // here is a vendor, and the list should not need telling twice.
    try {
      await ensureVendor(supabase, { name: manufacturer, category: extraction.category })
    } catch (e) {
      console.warn('[vendors] could not record schedule manufacturer:', e.message)
    }
  }

  // An item already on the schedule is left alone rather than overwritten —
  // the schedule may carry edits and submitted pricing keyed to it, and a
  // re-read of the same document should not silently replace them.
  const existing = target.items || []
  const existingKeys = new Set(existing.map(i => i.key))
  const added = proposed.filter(i => !existingKeys.has(i.key))
  const skipped = proposed.length - added.length

  if (added.length) {
    const { error: updateError } = await supabase
      .from('schedules').update({ items: [...existing, ...added] }).eq('id', target.id)
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
  }

  const { error: markError } = await supabase.from('extractions').update({
    status: 'applied',
    applied_at: new Date().toISOString(),
    applied_by: user.id,
    updated_at: new Date().toISOString(),
  }).eq('id', params.id)
  if (markError) return NextResponse.json({ error: markError.message }, { status: 500 })

  return NextResponse.json({
    added: added.length,
    skipped,
    scheduleId: target.id,
    createdSchedule: !schedule,
  })
}
