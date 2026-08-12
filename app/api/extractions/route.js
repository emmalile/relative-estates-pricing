import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'
import { getCategory } from '@/lib/categories'
import { downloadFile } from '@/lib/dropbox'
import { EXTRACTION_MODEL, isExtractionConfigured, missingExtractionVars } from '@/lib/anthropic'
import { extractItems, isExtractable } from '@/lib/extraction'

// Reading a long schedule out of a PDF takes minutes, not seconds. Vercel
// caps this per plan (60s on Hobby, up to 800s on Pro) — a document that
// exceeds the cap fails as a gateway timeout rather than an app error.
export const maxDuration = 300

function extOf(name) {
  const m = String(name || '').match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : ''
}

// GET /api/extractions?projectSlug=…[&category=…] — extractions for a project.
//
// Deliberately omits `items`: the list is a index, and the proposed rows are
// large enough that sending them all would make it slow for no benefit.
export async function GET(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase } = auth

  const { searchParams } = new URL(request.url)
  const projectSlug = searchParams.get('projectSlug')
  const category = searchParams.get('category')
  if (!projectSlug) {
    return NextResponse.json({ error: 'projectSlug is required' }, { status: 400 })
  }

  const { data: project } = await supabase
    .from('projects').select('id').eq('slug', projectSlug).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  let query = supabase
    .from('extractions')
    .select('id, category, source_name, source_path, status, notes, error, created_at, applied_at')
    .eq('project_id', project.id)
    .order('created_at', { ascending: false })
  if (category) query = query.eq('category', category)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    configured: isExtractionConfigured(),
    missing: missingExtractionVars(),
    extractions: data || [],
  })
}

// POST /api/extractions — read one document and propose line items.
//
// Writes nothing to the schedule. The result is a proposal in `reviewing`
// state; it reaches a schedule only when someone applies it.
export async function POST(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase, user } = auth

  const { projectSlug, category: categoryId, path, name } = await request.json()

  if (!projectSlug || !categoryId || !path) {
    return NextResponse.json(
      { error: 'projectSlug, category and path are required' }, { status: 400 }
    )
  }

  const category = getCategory(categoryId)
  if (!category) return NextResponse.json({ error: 'Unknown category' }, { status: 400 })

  const sourceName = name || path.split('/').pop()
  const ext = extOf(sourceName)
  if (!isExtractable(ext)) {
    return NextResponse.json(
      { error: `Cannot read a .${ext || 'file'} — extraction handles PDFs and CSVs.` },
      { status: 400 }
    )
  }

  if (!isExtractionConfigured()) {
    return NextResponse.json({
      error: `${missingExtractionVars().join(' and ')} is not set in this deployment, ` +
             'so documents cannot be read yet.',
    }, { status: 503 })
  }

  const { data: project } = await supabase
    .from('projects').select('id').eq('slug', projectSlug).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // A failed read is recorded rather than discarded, so a document that
  // cannot be extracted says so on the page instead of vanishing.
  try {
    const bytes = await downloadFile(path)
    const { items, notes, usage } = await extractItems({
      categoryId, fileName: sourceName, ext, bytes,
    })

    const proposed = items.map((fields, i) => {
      const { sourceLocation, ...rest } = fields
      return { id: `${i}`, fields: rest, sourceLocation: sourceLocation || '', status: 'pending' }
    })

    const { data, error } = await supabase.from('extractions').insert({
      project_id: project.id,
      category: categoryId,
      source_path: path,
      source_name: sourceName,
      status: 'reviewing',
      model: EXTRACTION_MODEL,
      items: proposed,
      notes,
      usage,
      created_by: user.id,
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ extraction: data })
  } catch (e) {
    await supabase.from('extractions').insert({
      project_id: project.id,
      category: categoryId,
      source_path: path,
      source_name: sourceName,
      status: 'failed',
      model: EXTRACTION_MODEL,
      error: e.message,
      created_by: user.id,
    })
    return NextResponse.json({ error: e.message }, { status: 502 })
  }
}
