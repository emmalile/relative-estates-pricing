import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { canViewCosts, isInternalPage } from '@/lib/permissions'

// Runs on every matched request. Two jobs:
//   1. Refresh the Supabase session cookie so it doesn't expire mid-session
//   2. Bounce anyone not signed in to /login
//
// PUBLIC_PREFIXES is the deliberate exception list. The manufacturer form
// and its API routes stay open — manufacturers are external vendors filling
// in pricing from a link, and we decided not to make them create accounts.
// Those routes read and write through the service-role client server-side
// and only ever touch the one schedule named in the URL.
const PUBLIC_PREFIXES = [
  '/login',
  '/auth/callback',
  '/api/form',
]

// /projects/<slug>/form/<category> — the manufacturer pricing form.
const PUBLIC_PAGE_PATTERN = /^\/projects\/[^/]+\/form\/[^/]+\/?$/

function isPublic(pathname) {
  if (PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'))) return true
  return PUBLIC_PAGE_PATTERN.test(pathname)
}

export async function middleware(request) {
  let response = NextResponse.next({ request: { headers: request.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request: { headers: request.headers } })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  // Must be getUser(), not getSession() — getUser revalidates the token
  // with Supabase rather than trusting whatever is in the cookie.
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && !isPublic(pathname)) {
    // API routes get a 401 they can handle; pages get sent to sign in.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Already signed in and sitting on the login page — send them onward.
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // ── Cost-bearing pages are internal only ────────────────────
  // Row level security already starves these pages for a client — the
  // queries behind them return nothing — so this is not what stops the
  // numbers leaking. It stops a client landing on an internal screen at
  // all, rather than on one that renders every figure as a dash.
  //
  // A failed role lookup lets the request through rather than locking
  // everyone out of the app over a transient database error. That is safe
  // precisely because it is not the control protecting the data: RLS and
  // the requireInternal guard on every cost-bearing API route both still
  // apply underneath.
  if (user && isInternalPage(pathname)) {
    const { data: profile, error } = await supabase
      .from('profiles').select('role').eq('id', user.id).maybeSingle()

    if (!error && profile && !canViewCosts(profile.role)) {
      // Clients get sent to their own view of the same project where there
      // is one, so a shared dashboard link lands somewhere useful.
      const projectMatch = pathname.match(/^\/projects\/([^/]+)\//)
      const target = projectMatch ? `/projects/${projectMatch[1]}/client` : '/my-projects'
      return NextResponse.redirect(new URL(target, request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets. Without this the
    // middleware would run for every image and font request too.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)',
  ],
}
