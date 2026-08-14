import { createAdminClient } from './supabase/admin'

// ═══════════════════════════════════════════════════════
// VENDOR FORM TOKENS
// ═══════════════════════════════════════════════════════
// The pricing form is open to people with no account, so the link is the
// credential. It used to be /projects/<slug>/form/<category>, which
// identified a project and a category but never a vendor — so the link was
// guessable from the project name, and two vendors given the same link
// shared one set of pricing.
//
// A token identifies the vendor. Everything the public routes do is derived
// from it rather than from the URL: which project, which category, and
// whose pricing to load and save.
//
// Read through the service-role client on purpose. The person opening the
// link has no session for RLS to evaluate, so these functions are the check
// — which is why each one resolves the token first and trusts nothing from
// the request.
// ═══════════════════════════════════════════════════════

// Resolves a token to the vendor it belongs to, or null.
//
// `slug` and `category` come from the URL and are verified against the
// token rather than used: a valid token for one schedule must not open a
// different one just because the path says so.
export async function resolveFormToken(token, { slug, category } = {}) {
  if (!token || typeof token !== 'string' || token.length < 32) return null

  const admin = createAdminClient()

  const { data: row } = await admin
    .from('vendor_form_tokens')
    .select('id, project_id, category, vendor_name, revoked_at')
    .eq('token', token)
    .is('revoked_at', null)
    .maybeSingle()

  if (!row) return null

  const { data: project } = await admin
    .from('projects')
    .select('id, name, slug')
    .eq('id', row.project_id)
    .single()

  if (!project) return null
  if (slug && project.slug !== slug) return null
  if (category && row.category !== category) return null

  return {
    tokenId: row.id,
    project,
    category: row.category,
    vendorName: row.vendor_name,
  }
}

// Records that a link was opened. Best effort: never allowed to fail a
// vendor's page load over bookkeeping.
export async function touchFormToken(tokenId) {
  if (!tokenId) return
  try {
    await createAdminClient()
      .from('vendor_form_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', tokenId)
  } catch (e) {
    console.warn('[form tokens] could not record use:', e.message)
  }
}

// The link to send a vendor. Kept here so the shape is defined once.
export function formUrlFor(origin, slug, category, token) {
  return `${origin}/projects/${encodeURIComponent(slug)}/form/${encodeURIComponent(category)}?t=${token}`
}
