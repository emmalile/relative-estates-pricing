'use client'

import { supabase } from '@/lib/supabase'

export default function SignOutButton({ compact }) {
  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <button onClick={signOut}
      style={{
        fontFamily:'var(--font-body)', fontSize:compact ? 9 : 10, fontWeight:600,
        letterSpacing:'0.12em', textTransform:'uppercase',
        padding: compact ? '5px 10px' : '7px 14px', cursor:'pointer',
        border:'1px solid var(--border-dark)', background:'transparent', color:'var(--gray)',
      }}>
      Sign out
    </button>
  )
}
