import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// PUBLIC — image upload for the manufacturer form.
//
// The form used to upload straight from the browser to Supabase Storage
// with the anon key. That required the bucket to accept anonymous writes
// from anywhere. Going through here instead means the browser never holds
// write credentials, and we can bound what gets accepted.
const MAX_BYTES = 8 * 1024 * 1024 // 8MB — images are already compressed client-side
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

export async function POST(request, { params }) {
  const { slug, category } = params

  let formData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })
  }

  const file = formData.get('file')
  const kind = formData.get('kind') === 'design' ? 'designs' : ''

  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: 'Only JPEG, PNG or WebP images are accepted' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Image is too large' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Confirm the project+category actually exists before writing anything,
  // so the bucket can't be used as free storage via made-up URLs.
  const { data: project } = await supabase
    .from('projects').select('id').eq('slug', slug).single()
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  const { data: schedule } = await supabase
    .from('schedules').select('id')
    .eq('project_id', project.id).eq('category', category).single()
  if (!schedule) {
    return NextResponse.json({ error: 'Schedule not found for this category' }, { status: 404 })
  }

  // Strip anything path-like out of the supplied name.
  const safeName = (file.name || 'upload.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
  const path = [slug, category, kind, `${Date.now()}-${safeName}`].filter(Boolean).join('/')

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadError } = await supabase.storage
    .from('material-images')
    .upload(path, buffer, { contentType: file.type, upsert: false })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: urlData } = supabase.storage.from('material-images').getPublicUrl(path)
  return NextResponse.json({ url: urlData.publicUrl, name: file.name })
}
