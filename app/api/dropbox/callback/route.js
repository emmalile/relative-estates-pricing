import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { exchangeCodeForTokens, saveConnection, getCurrentAccount } from '@/lib/dropbox'

// GET /api/dropbox/callback — where Dropbox returns after authorization.
//
// Still admin-gated: the callback is a normal browser navigation carrying the
// caller's session, so an attacker who somehow obtained a code cannot redeem
// it without also being an admin here.
export async function GET(request) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  const { user } = auth

  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const settings = `${origin}/settings/dropbox`

  if (error) {
    return NextResponse.redirect(`${settings}?error=${encodeURIComponent(error)}`)
  }
  if (!code) {
    return NextResponse.redirect(`${settings}?error=missing_code`)
  }

  // The state must match the cookie set when the flow began.
  const expected = request.cookies.get('dropbox_oauth_state')?.value
  if (!expected || !state || state !== expected) {
    return NextResponse.redirect(`${settings}?error=state_mismatch`)
  }

  try {
    const tokens = await exchangeCodeForTokens(code, `${origin}/api/dropbox/callback`)
    if (!tokens.refresh_token) {
      // Without a refresh token the connection dies in about four hours.
      // Almost always means token_access_type=offline was lost somewhere.
      return NextResponse.redirect(`${settings}?error=no_refresh_token`)
    }

    await saveConnection({ tokens, account: null, userId: user.id })

    // Fetch the account name now that a token is stored, for display.
    try {
      const account = await getCurrentAccount()
      await saveConnection({ tokens, account, userId: user.id })
    } catch {
      // Non-fatal — the connection works, we just won't show who it is.
    }

    const response = NextResponse.redirect(`${settings}?connected=1`)
    response.cookies.delete('dropbox_oauth_state')
    return response
  } catch (e) {
    return NextResponse.redirect(`${settings}?error=${encodeURIComponent(e.message)}`)
  }
}
