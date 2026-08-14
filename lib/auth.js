import { NextResponse } from 'next/server'
import { createClient, getCurrentUser } from './supabase/server'
import { INTERNAL_ROLES as INTERNAL_ROLE_LIST, canViewCosts } from './permissions'

// Role model
// ──────────────────────────────────────────────────────────
//   owner   — full access to everything; cannot be removed
//   admin   — full access to everything once signed in
//   member  — internal team; sees the owner dashboard, but only for
//             projects they have been added to
//   client  — sees the client view only, and only for projects they
//             have been added to
//
// owner and admin are global: they never need project_members rows.
// member and client are scoped: access comes from project_members.
export const ROLES = ['owner', 'admin', 'member', 'client']
export const FULL_ACCESS_ROLES = ['owner', 'admin']
// Single definition, in lib/permissions.js, so middleware and the browser
// can read it without pulling in the server-only Supabase client.
export const INTERNAL_ROLES = INTERNAL_ROLE_LIST

export function hasFullAccess(role) {
  return FULL_ACCESS_ROLES.includes(role)
}

// "Internal" means allowed to see cost, margin, and profit — i.e. the owner
// dashboard and the admin portal. Clients are deliberately excluded.
export function isInternal(role) {
  return canViewCosts(role)
}

// Guard for route handlers. Returns either { user, supabase } or
// { response } holding the error to return. Usage:
//
//   const auth = await requireUser()
//   if (auth.response) return auth.response
//   const { user, supabase } = auth
export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) {
    return { response: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) }
  }
  if (!user.profile) {
    return {
      response: NextResponse.json(
        { error: 'No profile for this account. An admin needs to grant access.' },
        { status: 403 }
      ),
    }
  }
  return { user, supabase: createClient() }
}

// Same, but additionally requires a role allowed to see internal pricing.
export async function requireInternal() {
  const auth = await requireUser()
  if (auth.response) return auth
  if (!isInternal(auth.user.role)) {
    return { response: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) }
  }
  return auth
}

// Same, but requires owner or admin — for user management and destructive
// project operations.
export async function requireAdmin() {
  const auth = await requireUser()
  if (auth.response) return auth
  if (!hasFullAccess(auth.user.role)) {
    return { response: NextResponse.json({ error: 'Admins only' }, { status: 403 }) }
  }
  return auth
}
