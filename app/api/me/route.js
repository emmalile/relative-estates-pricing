import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { canViewCosts, canExportCosts } from '@/lib/permissions'

// GET /api/me — who the browser is, and what it is allowed to do.
//
// The dashboard is a client component, so it has no way to read the signed
// in user's role without asking. It uses this to gate the export actions —
// an explicit permission check at the point of export, rather than the page
// assuming that whoever reached it may also carry the numbers out.
//
// This is not the control that protects the data. Cost never reaches a
// client's browser in the first place: row level security refuses the
// underlying rows, and every cost-bearing API route requires an internal
// role. This exists so the interface stops offering an action it would
// refuse to complete.
export async function GET() {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user } = auth

  return NextResponse.json({
    email: user.email,
    role: user.role,
    canViewCosts: canViewCosts(user.role),
    canExportCosts: canExportCosts(user.role),
  })
}
