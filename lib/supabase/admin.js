import { createClient } from '@supabase/supabase-js'

// Service-role Supabase client. This BYPASSES row level security entirely,
// so it must never be imported into anything that runs in the browser.
//
// It exists for exactly two jobs:
//   1. The public manufacturer form, which has no signed-in user but still
//      needs to read its own schedule and write its own submission. Those
//      routes read narrowly and return only the fields the form needs.
//   2. Admin user management, which has to write rows for other users.
//
// Anywhere a real signed-in user is acting, use ./server.js instead so that
// RLS stays in force.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

let cached = null

// Which Postgres role this key actually authenticates as.
//
// Supabase hands out several keys that all look alike in an environment
// variable, and pasting the wrong one fails in a way that points at the
// database rather than at the key: reads quietly return nothing (RLS filters
// rows rather than erroring) and only writes fail, reported as a row level
// security violation on whichever table was being written. Naming the role
// turns that into an answer instead of an investigation.
//
// Legacy keys are JWTs carrying a `role` claim. Newer keys are opaque but
// self-describing by prefix. Anything unrecognized returns 'unknown', which
// callers treat as "cannot tell" rather than as a failure.
export function serviceRoleKeyRole() {
  const key = serviceRoleKey
  if (!key) return 'missing'
  if (key.startsWith('sb_secret_')) return 'service_role'
  if (key.startsWith('sb_publishable_')) return 'anon'
  if (!key.startsWith('ey')) return 'unknown'
  try {
    const claims = JSON.parse(
      Buffer.from(key.split('.')[1], 'base64').toString('utf8')
    )
    return claims.role || 'unknown'
  } catch {
    return 'unknown'
  }
}

export function createAdminClient() {
  // Only reject roles we can positively identify as wrong. An unrecognized
  // key is passed through — better to let Supabase judge it than to block a
  // valid key this check does not know about yet.
  const role = serviceRoleKeyRole()
  if (role === 'anon' || role === 'authenticated') {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY holds a "${role}" key, not a service_role ` +
      'key. Copy the service_role secret from Supabase under Project ' +
      'Settings > API Keys and replace it, then redeploy. Until then, every ' +
      'write that relies on bypassing row level security will fail.'
    )
  }
  if (!serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local (and to your ' +
      'Vercel environment variables). Find it in Supabase under ' +
      'Project Settings > API > service_role. Never prefix it with ' +
      'NEXT_PUBLIC_ — it must stay server-side only.'
    )
  }
  if (!cached) {
    cached = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return cached
}
