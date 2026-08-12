import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Server-side Supabase client for route handlers and server components.
// It reads the session out of the request cookies, so queries run AS the
// signed-in user and RLS applies to them exactly as it does in the browser.
//
// Use this for anything acting on behalf of a user. For the small number of
// operations that must bypass RLS (the public manufacturer form), use the
// service-role client in ./admin.js instead — never this one.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export function createClient() {
  const cookieStore = cookies()

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore: middleware refreshes the session on every
          // request, so the cookie still gets written there.
        }
      },
    },
  })
}

// Returns the signed-in user's auth record and profile (which carries their
// role), or null if nobody is signed in.
//
// Always uses getUser() rather than getSession(): getSession() trusts the
// cookie as-is, while getUser() revalidates it against Supabase. On the
// server that difference matters — a forged cookie would pass the first and
// fail the second.
export async function getCurrentUser() {
  const supabase = createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return { ...user, profile: profile || null, role: profile?.role || null }
}
