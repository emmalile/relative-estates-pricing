import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { authorizeUrl, isDropboxConfigured } from '@/lib/dropbox'
import { randomBytes } from 'crypto'

// GET /api/dropbox/connect — start the Dropbox OAuth flow.
//
// Admin only: this connects the whole team's Dropbox, not a personal one.
// The state parameter is a random value stored in a short-lived, httpOnly
// cookie and checked on the way back, so a third party cannot walk somebody
// through an authorization they did not start.
export async function GET(request) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response

  if (!isDropboxConfigured()) {
    return NextResponse.json(
      { error: 'Dropbox app credentials are not configured on the server.' },
      { status: 400 }
    )
  }

  const { origin } = new URL(request.url)
  const redirectUri = `${origin}/api/dropbox/callback`
  const state = randomBytes(24).toString('hex')

  const response = NextResponse.redirect(authorizeUrl(redirectUri, state))
  response.cookies.set('dropbox_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return response
}
