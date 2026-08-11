import { NextResponse } from 'next/server'
import { createClient, getCurrentUser } from '@/lib/supabase/server'

// Where Google and the magic-link email land after a successful sign-in.
// Exchanges the one-time code for a session cookie, then decides where to
// send the person based on whether they actually have access.
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next') || '/'
  // Only ever redirect to a path on this site — never to an absolute URL
  // supplied in the query string, which would be an open redirect.
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=callback`)
  }

  const supabase = createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=callback`)
  }

  // Signing in is not the same as having access. A person with an auth
  // record but no profile row has not been invited by an admin yet.
  const user = await getCurrentUser()
  if (!user?.profile) {
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/login?error=no_access`)
  }

  // Clients have no business on the admin portal; send them to their project.
  if (user.role === 'client' && next === '/') {
    return NextResponse.redirect(`${origin}/my-projects`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
