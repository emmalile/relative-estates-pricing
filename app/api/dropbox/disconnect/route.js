import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { disconnect } from '@/lib/dropbox'

// POST /api/dropbox/disconnect — forget the stored Dropbox credentials.
//
// Folder mappings and cached file metadata are left in place, so reconnecting
// later picks up where things left off rather than losing the wiring.
export async function POST() {
  const auth = await requireAdmin()
  if (auth.response) return auth.response

  await disconnect()
  return NextResponse.json({ success: true })
}
