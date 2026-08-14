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
    <div className="on-dark" style={{ minHeight:'100dvh', background:'var(--black)', display:'flex', alignItems:'center', justifyContent:'center', position:'relative', overflow:'hidden' }}>
      {[20,80].map(p => <div key={`h${p}`} style={{ position:'absolute', height:1, width:'100%', background:'rgba(255,255,255,0.04)', top:`${p}%` }} />)}
      {[15,85].map(p => <div key={`v${p}`} style={{ position:'absolute', width:1, height:'100%', background:'rgba(255,255,255,0.04)', left:`${p}%` }} />)}
      {[
        { pos:{top:36,left:48}, text:'Relative Estates LLC' },
        { pos:{top:36,right:48}, text:`Material Review · ${new Date().getFullYear()}` },
        { pos:{bottom:36,left:48}, text:'Confidential' },
        { pos:{bottom:36,right:48}, text:'Kansas City, MO' },
      ].map((c,i) => <div key={i} style={{ position:'absolute', ...c.pos, fontSize:9, fontWeight:500, letterSpacing:'0.16em', color:'rgba(255,255,255,0.4)', textTransform:'uppercase', fontFamily:'var(--font-body)' }}>{c.text}</div>)}

      <div style={{ textAlign:'center', position:'relative', zIndex:2, padding:'0 24px', width:'100%', maxWidth:380 }}>
        <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.28em', textTransform:'uppercase', color:'var(--g300)', marginBottom:24 }}>
          Material Pricing System
        </div>
        <div style={{ fontFamily:'var(--font)', fontSize:'clamp(36px,6vw,52px)', fontWeight:300, lineHeight:1, color:'#f7f5f0', marginBottom:16 }}>
          Relative <em style={{ color:'rgba(247,245,240,0.5)' }}>Estates</em>
        </div>

        {sent ? (
          <div>
            <div style={{ fontSize:13, color:'rgba(247,245,240,0.75)', lineHeight:1.7, marginBottom:20 }}>
              Check your inbox — we sent a sign-in link to<br/>
              <span style={{ color:'var(--g300)', fontWeight:600 }}>{email}</span>
            </div>
            <button onClick={() => { setSent(false); setEmail('') }}
              style={{ fontSize:11, color:'rgba(247,245,240,0.5)', background:'none', border:'none', cursor:'pointer', textDecoration:'underline' }}>
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontSize:12, fontWeight:400, color:'rgba(247,245,240,0.4)', marginBottom:28 }}>
              Sign in to continue. Access is granted by an admin.
            </div>

            {error && (
              <div style={{ fontSize:11, color:'#e8a0a0', marginBottom:16, lineHeight:1.6, padding:'10px 14px', background:'rgba(197,34,31,0.12)', border:'1px solid rgba(197,34,31,0.3)' }}>
                {error}
              </div>
            )}

            <button onClick={signInWithGoogle}
              style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:12, width:'100%', padding:'14px 24px', fontSize:11, fontWeight:600, letterSpacing:'0.14em', textTransform:'uppercase', background:'#f7f5f0', color:'var(--black)', border:'none', cursor:'pointer', marginBottom:20, fontFamily:'var(--font-body)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14z"/>
              </svg>
              Continue with Google
            </button>

            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
              <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.12)' }} />
              <span style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'rgba(247,245,240,0.3)' }}>or</span>
              <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.12)' }} />
            </div>

            <form onSubmit={sendMagicLink}>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError('') }}
                placeholder="you@company.com"
                style={{ width:'100%', padding:'13px 16px', fontSize:14, fontWeight:500, textAlign:'center', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.18)', color:'#f7f5f0', marginBottom:12, fontFamily:'var(--font-body)' }}
              />
              <button type="submit" disabled={sending || !email.trim()}
                style={{ width:'100%', padding:'13px 24px', fontSize:10, fontWeight:600, letterSpacing:'0.18em', textTransform:'uppercase', background:'transparent', color:'#f7f5f0', border:'1px solid rgba(255,255,255,0.35)', cursor:sending||!email.trim()?'not-allowed':'pointer', opacity:sending||!email.trim()?0.5:1, fontFamily:'var(--font-body)' }}>
                {sending ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </form>

            {/* A doorbell. Access is invitation-only, and most of the people
                who reach this screen are clients and vendors who have no way
                to ask — so they text somebody instead. */}
            <div style={{ marginTop:24, fontSize:12, color:'rgba(247,245,240,0.55)', lineHeight:1.7 }}>
              Don’t have access yet?{' '}
              <a
                href={`mailto:${ACCESS_EMAIL}?subject=${encodeURIComponent('Access request — Relative Estates')}&body=${encodeURIComponent('Hello,\n\nPlease could I be given access to the material pricing system.\n\nName:\nCompany:\nProject:\n\nThank you.')}`}
                style={{ color:'#f7f5f0', textDecoration:'underline', textUnderlineOffset:3 }}
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
