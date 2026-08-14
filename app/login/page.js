'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

// Where an access request goes. Public by nature — it is on a sign-in
// page — so it is the same address already printed in the manufacturer
// emails, not an internal one.
const ACCESS_EMAIL = process.env.NEXT_PUBLIC_ACCESS_EMAIL || 'emma@relativeestates.com'

// Sign-in page. Two routes in: Google, or an emailed magic link for
// anyone without a Google account. Neither creates access on its own —
// an admin has to have added you first. Signing in without a profile
// lands you on the "no access yet" state below.
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [nextPath, setNextPath] = useState('/')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const next = params.get('next')
    if (next && next.startsWith('/')) setNextPath(next)
    const err = params.get('error')
    if (err === 'no_access') {
      setError('That account does not have access yet. Ask an admin to add you.')
    } else if (err === 'callback') {
      setError('Sign-in did not complete. Please try again.')
    }
  }, [])

  function redirectTarget() {
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
  }

  async function signInWithGoogle() {
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTarget() },
    })
    if (error) setError(error.message)
  }

  async function sendMagicLink(e) {
    e.preventDefault()
    if (!email.trim()) return
    setSending(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTarget() },
    })
    setSending(false)
    if (error) { setError(error.message); return }
    setSent(true)
  }

  return (
    <div style={{ minHeight:'100dvh', background:'var(--g50)', display:'flex', alignItems:'center', justifyContent:'center', padding:'var(--s-6)' }}>
      <div style={{ width:'100%', maxWidth:400, background:'var(--white)', border:'1px solid var(--border)', borderRadius:'var(--r-md)', padding:'var(--s-8)', textAlign:'center' }}>
        {/* One wordmark, the same one the app wears. */}
        <div style={{ fontSize:'var(--t-2xl)', fontWeight:500, letterSpacing:'-0.01em', color:'var(--black)', marginBottom:'var(--s-1)' }}>
          Relative <span style={{ color:'var(--g600)', fontWeight:400 }}>Estates</span>
        </div>
        <div style={{ fontSize:'var(--t-xs)', color:'var(--g600)', marginBottom:'var(--s-6)' }}>
          Material pricing system
        </div>

        {sent ? (
          <div>
            <div style={{ fontSize:'var(--t-sm)', color:'var(--gray)', lineHeight:'var(--lh-body)', marginBottom:'var(--s-4)' }}>
              Check your inbox — we sent a sign-in link to<br/>
              <span style={{ color:'var(--black)', fontWeight:600 }}>{email}</span>
            </div>
            <button onClick={() => { setSent(false); setEmail('') }}
              style={{ fontSize:'var(--t-xs)', color:'var(--gray)', background:'none', border:'none', cursor:'pointer', textDecoration:'underline' }}>
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontSize:'var(--t-sm)', color:'var(--gray)', marginBottom:'var(--s-6)', lineHeight:'var(--lh-body)' }}>
              Sign in to continue. Access is granted by an admin.
            </div>

            {error && (
              <div style={{ fontSize:'var(--t-xs)', color:'var(--danger)', marginBottom:'var(--s-4)', lineHeight:'var(--lh-body)', padding:'var(--s-3)', background:'var(--danger-bg)', border:'1px solid var(--danger)', borderRadius:'var(--r-md)', textAlign:'left' }}>
                {error}
              </div>
            )}

            <button onClick={signInWithGoogle}
              style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'var(--s-3)', width:'100%', padding:'var(--s-3) var(--s-6)', fontSize:'var(--t-base)', fontWeight:500, background:'var(--white)', color:'var(--black)', border:'1px solid var(--border-dark)', borderRadius:'var(--r-md)', cursor:'pointer', marginBottom:'var(--s-4)', fontFamily:'var(--font-body)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14z"/>
              </svg>
              Continue with Google
            </button>

            <div style={{ display:'flex', alignItems:'center', gap:'var(--s-3)', marginBottom:'var(--s-4)' }}>
              <div style={{ flex:1, height:1, background:'var(--border)' }} />
              <span style={{ fontSize:'var(--t-xs)', color:'var(--gray)' }}>or</span>
              <div style={{ flex:1, height:1, background:'var(--border)' }} />
            </div>

            <form onSubmit={sendMagicLink}>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError('') }}
                placeholder="you@company.com"
                style={{ width:'100%', padding:'var(--s-3) var(--s-4)', fontSize:'var(--t-base)', textAlign:'center', background:'var(--white)', border:'1px solid var(--border-dark)', borderRadius:'var(--r-md)', color:'var(--black)', marginBottom:'var(--s-3)', fontFamily:'var(--font-body)' }}
              />
              <button type="submit" disabled={sending || !email.trim()}
                style={{ width:'100%', padding:'var(--s-3) var(--s-6)', fontSize:'var(--t-base)', fontWeight:500, background:'var(--black)', color:'var(--white)', border:'1px solid var(--black)', borderRadius:'var(--r-md)', cursor:sending||!email.trim()?'not-allowed':'pointer', opacity:sending||!email.trim()?0.5:1, fontFamily:'var(--font-body)' }}>
                {sending ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </form>

            {/* A doorbell. Access is invitation-only, and most of the people
                who reach this screen are clients and vendors who have no way
                to ask — so they text somebody instead. */}
            <div style={{ marginTop:'var(--s-6)', fontSize:'var(--t-xs)', color:'var(--gray)', lineHeight:'var(--lh-body)' }}>
              Don’t have access yet?{' '}
              <a
                href={`mailto:${ACCESS_EMAIL}?subject=${encodeURIComponent('Access request — Relative Estates')}&body=${encodeURIComponent('Hello,\n\nPlease could I be given access to the material pricing system.\n\nName:\nCompany:\nProject:\n\nThank you.')}`}
                style={{ color:'var(--black)', textDecoration:'underline', textUnderlineOffset:3 }}
              >
                Request access
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
