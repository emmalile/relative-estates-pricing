import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'
import { getConnection, isDropboxConfigured } from '@/lib/dropbox'

// GET /api/dropbox/status — is Dropbox connected, and as whom?
//
// Returns metadata only. The tokens on the connection row never leave the
// server: this route reads the record and deliberately projects a handful of
// display fields out of it.
export async function GET() {
  const auth = await requireInternal()
  if (auth.response) return auth.response

  if (!isDropboxConfigured()) {
    return NextResponse.json({
      configured: false,
      connected: false,
      message: 'DROPBOX_APP_KEY and DROPBOX_APP_SECRET are not set in the environment.',
    })
  }

  const conn = await getConnection()
  if (!conn) {
    return NextResponse.json({ configured: true, connected: false })
  }

  return NextResponse.json({
    configured: true,
    connected: true,
    account: {
      name: conn.account_name,
      email: conn.account_email,
    },
    connectedAt: conn.connected_at,
  })
}
