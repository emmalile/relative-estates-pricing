import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'
import { getConnection, isDropboxConfigured, missingDropboxVars } from '@/lib/dropbox'

// Which deployment answered. Environment variables are baked into a
// deployment when it builds, and preview deployments only receive variables
// scoped to Preview — so "not configured" is frequently a question of which
// build you are talking to rather than which variables exist. Reporting it
// turns that into something visible instead of something to guess at.
//
// Vercel sets these; locally they are absent and the fields come back null.
function servingDeployment() {
  return {
    env: process.env.VERCEL_ENV || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    url: process.env.VERCEL_URL || null,
  }
}

// GET /api/dropbox/status — is Dropbox connected, and as whom?
//
// Returns metadata only. The tokens on the connection row never leave the
// server: this route reads the record and deliberately projects a handful of
// display fields out of it.
export async function GET() {
  const auth = await requireInternal()
  if (auth.response) return auth.response

  const deployment = servingDeployment()

  if (!isDropboxConfigured()) {
    const missing = missingDropboxVars()
    return NextResponse.json({
      configured: false,
      connected: false,
      missing,
      deployment,
      message: `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set in this deployment's environment.`,
    })
  }

  const conn = await getConnection()
  if (!conn) {
    return NextResponse.json({ configured: true, connected: false, deployment })
  }

  return NextResponse.json({
    configured: true,
    connected: true,
    deployment,
    account: {
      name: conn.account_name,
      email: conn.account_email,
    },
    connectedAt: conn.connected_at,
  })
}
