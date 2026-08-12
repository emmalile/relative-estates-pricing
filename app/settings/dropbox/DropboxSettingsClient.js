'use client'

import { useState, useEffect } from 'react'
import SignOutButton from '@/app/components/SignOutButton'

const ERROR_TEXT = {
  state_mismatch: 'The authorization did not match the request that started it. Try connecting again.',
  no_refresh_token: 'Dropbox did not return a long-lived token. Try connecting again.',
  missing_code: 'Dropbox did not return an authorization code.',
  access_denied: 'Authorization was cancelled.',
}

export default function DropboxSettingsClient() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [justConnected, setJustConnected] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    if (err) setError(ERROR_TEXT[err] || err)
    if (params.get('connected')) setJustConnected(true)
    if (err || params.get('connected')) {
      window.history.replaceState({}, '', '/settings/dropbox')
    }
    load()
  }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/dropbox/status')
    if (res.ok) setStatus(await res.json())
    setLoading(false)
  }

  async function disconnect() {
    if (!confirm(
      'Disconnect Dropbox?\n\nFolder assignments and the file list are kept, so reconnecting later picks up where this left off. Files in Dropbox are never touched.'
    )) return
    setBusy(true)
    await fetch('/api/dropbox/disconnect', { method: 'POST' })
    setBusy(false)
    setJustConnected(false)
    load()
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--off-white)' }}>
      <div style={{ height:64, borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', padding:'0 40px', background:'var(--white)', gap:20 }}>
        <button onClick={() => window.location.href = '/'} style={{ display:'flex', alignItems:'center', gap:8, background:'none', border:'none', cursor:'pointer', padding:'0 16px 0 0', borderRight:'1px solid var(--border)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          <span style={{ fontSize:10, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase' }}>Back</span>
        </button>
        <div style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:300, letterSpacing:'0.06em', flex:1 }}>
          Relative <span style={{ color:'var(--gold)' }}>Estates</span>
        </div>
        <SignOutButton compact />
      </div>

      <div style={{ padding:'48px 56px 80px', maxWidth:760 }}>
        <div className="page-eyebrow">Integrations</div>
        <div className="page-title" style={{ marginBottom:10 }}>Drop<em>box</em></div>
        <div style={{ fontSize:13, color:'var(--gray)', lineHeight:1.7, marginBottom:32 }}>
          Connect Dropbox once for the whole team, then point each project at its folder.
          Files stay in Dropbox — nothing is copied here, and editing a file in Dropbox
          is reflected on the next sync. Only the internal team can see project files.
        </div>

        {error && (
          <div style={{ padding:'12px 16px', background:'var(--danger-bg)', border:'1px solid var(--danger)', color:'var(--danger)', fontSize:12, marginBottom:20, lineHeight:1.6 }}>
            {error}
          </div>
        )}
        {justConnected && (
          <div style={{ padding:'12px 16px', background:'var(--success-bg)', border:'1px solid var(--success)', color:'var(--success)', fontSize:12, marginBottom:20 }}>
            Dropbox connected. Open a project&apos;s Files tab to choose its folder.
          </div>
        )}

        {loading ? (
          <div className="spinner" />
        ) : !status?.configured ? (
          <div style={{ border:'1px solid var(--border)', background:'var(--white)', padding:'24px 26px' }}>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:8 }}>Not configured yet</div>
            <div style={{ fontSize:12, color:'var(--gray)', lineHeight:1.7 }}>
              The server needs <code>DROPBOX_APP_KEY</code> and <code>DROPBOX_APP_SECRET</code> before
              Dropbox can be connected. Create an app at{' '}
              <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener noreferrer"
                style={{ color:'var(--gold)' }}>dropbox.com/developers/apps</a>{' '}
              with scoped access to the full Dropbox, grant it{' '}
              <code>account_info.read</code>, <code>files.metadata.read</code> and{' '}
              <code>files.content.read</code>, then add the key and secret to the
              environment variables in Vercel.
            </div>
          </div>
        ) : status.connected ? (
          <div style={{ border:'1px solid var(--border)', background:'var(--white)', padding:'24px 26px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
              <i className="ti ti-circle-check" style={{ fontSize:22, color:'var(--success)' }} />
              <span style={{ fontSize:14, fontWeight:600 }}>Connected</span>
            </div>
            <table style={{ borderCollapse:'collapse', marginBottom:20 }}>
              <tbody>
                {[
                  ['Account', status.account?.name || '—'],
                  ['Email', status.account?.email || '—'],
                  ['Connected', status.connectedAt ? new Date(status.connectedAt).toLocaleString() : '—'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ padding:'4px 20px 4px 0', fontSize:9, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--gray-light)', verticalAlign:'top' }}>{k}</td>
                    <td style={{ padding:'4px 0', fontSize:13 }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={disconnect}
              style={{ color:'var(--danger)', borderColor:'var(--danger)' }}>
              Disconnect
            </button>
          </div>
        ) : (
          <div style={{ border:'1px solid var(--border)', background:'var(--white)', padding:'24px 26px' }}>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:8 }}>Not connected</div>
            <div style={{ fontSize:12, color:'var(--gray)', lineHeight:1.7, marginBottom:20 }}>
              Sign in with the Dropbox account that can already see your project folders.
              This app asks only to read file listings and download files — it cannot
              modify or delete anything in Dropbox.
            </div>
            <a href="/api/dropbox/connect" className="btn btn-black btn-sm" style={{ textDecoration:'none' }}>
              Connect Dropbox →
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
