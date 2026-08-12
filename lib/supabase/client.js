import { createBrowserClient } from '@supabase/ssr'

// Browser-side Supabase client. Unlike a plain createClient(), this one
// persists the signed-in user's session to cookies, which means:
//   • queries from the browser run AS that user, so RLS applies to them
//   • the server (middleware, route handlers) can read the same session
//
// Every query made through this client is still subject to row level
// security. It holds the public anon key, which is safe to ship to the
// browser — the protection comes from the RLS policies, not from the key
// being secret. See supabase-auth-migration.sql for those policies.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Check your .env.local file has NEXT_PUBLIC_SUPABASE_URL ' +
    'and NEXT_PUBLIC_SUPABASE_ANON_KEY set correctly.'
  )
}

export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}

// Shared instance for components that just want to query.
export const supabase = createClient()
