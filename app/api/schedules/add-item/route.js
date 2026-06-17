import { supabase } from '@/lib/supabase'
import { getCategory } from '@/lib/categories'
import { NextResponse } from 'next/server'

// POST /api/schedules/add-item — manually add a line item to a category's
// schedule from the owner dashboard, for materials that weren't on the
// original CSV (a new vendor quote, a late substitution, etc).
export async function POST(request) {
  const body = await request.json()
  const { projectSlug, category: categoryId, item } = body

  if (!projectSlug || !categoryId || !item) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const category = getCategory(categoryId)
  if (!category) {
    return NextResponse.json({ error: 'Unknown category' }, { status: 400 })
  }

  // Identification fields are what make this a distinct, addressable line
  // item — they're the same fields used to build item.key everywhere else.
  const idFields = category.itemKeyFields
  const missing = idFields.filter(f => !item[f] || !String(item[f]).trim())
  if (missing.length) {
    return NextResponse.json({ error: `Missing required field(s): ${missing.join(', ')}` }, { status: 400 })
  }

  const { data: project, error: projectError } = await supabase
    .from('projects').select('id').eq('slug', projectSlug).single()

  if (projectError || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules').select('*')
    .eq('project_id', project.id).eq('category', categoryId).single()

  if (scheduleError || !schedule) {
    return NextResponse.json({ error: 'No schedule exists yet for this category — upload a schedule CSV first.' }, { status: 404 })
  }

  const key = idFields.map(f => String(item[f] || '').trim()).join('|||')
  const items = schedule.items || []
  if (items.some(existing => existing.key === key)) {
    return NextResponse.json({ error: 'A material with this exact name, finish, and cut is already on the schedule.' }, { status: 409 })
  }

  const locations = [item.room, item.area].filter(Boolean).join(' — ')
  const newItem = { ...item, key, locations: locations ? [locations] : [] }

  const { error: updateError } = await supabase
    .from('schedules')
    .update({ items: [...items, newItem] })
    .eq('id', schedule.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ item: newItem })
}
