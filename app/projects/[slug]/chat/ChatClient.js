'use client'

import { useState, useRef, useEffect } from 'react'
import SignOutButton from '@/app/components/SignOutButton'

// Asking questions about a project.
//
// The conversation lives here, in the browser, and is sent with each
// question. Nothing is stored: closing the tab ends the conversation. That
// keeps a chat about margins from accumulating anywhere, and it means there
// is no history to get out of step with the project as it changes.

const SUGGESTIONS = [
  'What is the total client price by category?',
  'Which line items have no quantity entered yet?',
  'Which items are still pending approval?',
  'What is our margin on the stone, in dollars?',
  'Which documents have been read into line items?',
]

export default function ChatClient({ slug }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  async function ask(question) {
    const text = (question ?? input).trim()
    if (!text || busy) return

    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setBusy(true)
    setError('')

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Only role and content go up; the server ignores anything else anyway.
      body: JSON.stringify({
        projectSlug: slug,
        messages: next.map(m => ({ role: m.role, content: m.content })),
      }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)

    if (!res.ok) {
      setError(d.error || 'Could not answer that.')
      return
    }
    setMessages([...next, { role: 'assistant', content: d.answer, consulted: d.consulted }])
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--off-white)', display:'flex', flexDirection:'column' }}>
      <div style={{ height:64, borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', padding:'0 40px', background:'var(--white)', gap:20, flexShrink:0 }}>
        <button onClick={() => window.location.href = `/projects/${slug}/dashboard`}
          style={{ display:'flex', alignItems:'center', gap:8, background:'none', border:'none', cursor:'pointer', padding:'0 16px 0 0', borderRight:'1px solid var(--border)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          <span style={{ fontSize:10, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase' }}>Dashboard</span>
        </button>
        <div style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:300, letterSpacing:'0.06em', flex:1 }}>
          Relative <span style={{ color:'var(--gold)' }}>Estates</span>
        </div>
        <SignOutButton compact />
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'40px 48px 20px' }}>
        <div style={{ maxWidth:760, margin:'0 auto' }}>
          {messages.length === 0 && (
            <>
              <div className="page-eyebrow">Ask</div>
              <div className="page-title" style={{ marginBottom:10 }}>About this <em>project</em></div>
              <div style={{ fontSize:13, color:'var(--gray)', lineHeight:1.7, marginBottom:28 }}>
                Questions about quantities, prices, margins, approvals and what documents
                have been read. Answers come from the same figures the dashboard shows —
                nothing is estimated. Internal only, and the conversation is not saved.
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => ask(s)} disabled={busy}
                    style={{ textAlign:'left', padding:'11px 14px', border:'1px solid var(--border)', background:'var(--white)', cursor:'pointer', fontSize:13, fontFamily:'var(--font-body)', color:'var(--black)' }}>
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}

          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom:24 }}>
              <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:6 }}>
                {m.role === 'user' ? 'You' : 'Claude'}
              </div>
              <div style={{
                fontSize:13, lineHeight:1.75, whiteSpace:'pre-wrap',
                padding: m.role === 'user' ? '12px 16px' : 0,
                background: m.role === 'user' ? 'var(--white)' : 'transparent',
                border: m.role === 'user' ? '1px solid var(--border)' : 'none',
              }}>{m.content}</div>
              {m.consulted?.length > 0 && (
                <div style={{ fontSize:10, color:'var(--gray-light)', marginTop:8, letterSpacing:'0.04em' }}>
                  Consulted: {m.consulted.join(' · ')}
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div style={{ marginBottom:24 }}>
              <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:6 }}>Claude</div>
              <div className="spinner" />
            </div>
          )}

          {error && (
            <div style={{ padding:'12px 16px', background:'var(--danger-bg)', border:'1px solid var(--danger)', color:'var(--danger)', fontSize:12, marginBottom:20 }}>{error}</div>
          )}

          <div ref={endRef} />
        </div>
      </div>

      <div style={{ borderTop:'1px solid var(--border)', background:'var(--white)', padding:'16px 48px', flexShrink:0 }}>
        <div style={{ maxWidth:760, margin:'0 auto', display:'flex', gap:10 }}>
          <input
            className="field-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}
            placeholder="Ask about quantities, prices, margins…"
            disabled={busy}
            style={{ flex:1 }}
          />
          <button className="btn btn-black btn-sm" onClick={() => ask()} disabled={busy || !input.trim()}>
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  )
}
