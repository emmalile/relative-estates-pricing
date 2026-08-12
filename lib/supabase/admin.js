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

export function createAdminClient() {
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
