'use client'

import { useState, useEffect } from 'react'

// ═══════════════════════════════════════════════════════
// VENDOR PRICING LINKS
// ═══════════════════════════════════════════════════════
// One link per vendor, because the link is the credential. The old single
// URL was derived from the project name, so it was guessable, and it could
// not tell two vendors apart — the second to open it saw the first's
// pricing and overwrote it on save.
//
// Issuing again rotates the token in place: the previous link stops working
// the moment the new one exists, which is what "re-issue" has to mean if it
// is going to be useful after a link leaks.
// ═══════════════════════════════════════════════════════
export default function VendorLinks({ projectId, category, categoryLabel, scheduleManufacturer, onClose }) {
  const [links, setLinks] = useState(null)
  const [vendorName, setVendorName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(null)

  const base = `/api/form-links?projectId=${encodeURIComponent(projectId)}&category=${encodeURIComponent(category)}`

  useEffect(() => { load() }, [projectId, category])

  async function load() {
    setError('')
    const res = await fetch(base)
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || 'Could not load links'); setLinks([]); return }
    setLinks((await res.json()).links)
  }

  function urlFor(link) {
    return `${window.location.origin}/projects/${window.location.pathname.split('/').filter(Boolean)[1]}/form/${category}?t=${link.token}`
  }

  async function issue(name, isReissue) {
    if (isReissue && !confirm(`Issue a new link for ${name}?\n\nTheir current link stops working immediately, so it needs sending again.`)) return
    setBusy(true); setError('')
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendorName: name }),
    })
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'Could not issue a link')
    else { setVendorName(''); await load() }
    setBusy(false)
  }

  async function revoke(link) {
    if (!confirm(`Revoke ${link.vendor_name}'s link?\n\nThey will not be able to open the form or submit pricing until a new link is issued.`)) return
    setBusy(true)
    await fetch(`${base}&id=${link.id}`, { method: 'DELETE' })
    await load()
    setBusy(false)
  }

  async function copy(link) {
    await navigator.clipboard?.writeText(urlFor(link))
    setCopied(link.id)
    setTimeout(() => setCopied(null), 1800)
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position:'fixed', inset:0, background:'rgba(28,26,22,0.5)', zIndex:900, display:'flex', alignItems:'center', justifyContent:'center', padding:'var(--s-6)' }}>
      <div style={{ background:'var(--white)', borderRadius:'var(--r-md)', width:'100%', maxWidth:620, maxHeight:'88vh', display:'flex', flexDirection:'column' }}>
        <div style={{ padding:'var(--s-6)', borderBottom:'1px solid var(--border)' }}>
          <div style={{ fontSize:'var(--t-lg)', fontWeight:500 }}>{categoryLabel} pricing links</div>
          <div style={{ fontSize:'var(--t-xs)', color:'var(--gray)', marginTop:'var(--s-1)', lineHeight:'var(--lh-body)' }}>
            One link per vendor. A vendor sees only the materials and their own pricing —
            never another vendor’s. Anyone holding a link can price against it, so send it directly.
          </div>
        </div>

        <div style={{ padding:'var(--s-6)', overflowY:'auto' }}>
          {error && (
            <div style={{ padding:'var(--s-3)', background:'var(--danger-bg)', border:'1px solid var(--danger)', borderRadius:'var(--r-md)', color:'var(--danger)', fontSize:'var(--t-xs)', marginBottom:'var(--s-4)' }}>{error}</div>
          )}

          {links === null ? (
            <div style={{ padding:'var(--s-6) 0' }}><span className="spinner" /></div>
          ) : links.length === 0 ? (
            <div style={{ fontSize:'var(--t-sm)', color:'var(--gray)', marginBottom:'var(--s-4)' }}>
              No links yet{scheduleManufacturer ? ` — this schedule names ${scheduleManufacturer}.` : '.'} Issue one below.
            </div>
          ) : (
            <div style={{ border:'1px solid var(--border)', borderRadius:'var(--r-md)', marginBottom:'var(--s-6)' }}>
              {links.map((l, i) => (
                <div key={l.id} style={{ display:'flex', alignItems:'center', gap:'var(--s-3)', padding:'var(--s-3) var(--s-4)', borderBottom: i < links.length-1 ? '1px solid var(--border)' : 'none', flexWrap:'wrap' }}>
                  <div style={{ flex:1, minWidth:160 }}>
                    <div style={{ fontSize:'var(--t-base)', fontWeight:500 }}>{l.vendor_name}</div>
                    <div style={{ fontSize:'var(--t-xs)', color:'var(--gray)' }}>
                      {l.last_used_at ? `Opened ${new Date(l.last_used_at).toLocaleDateString('en-US', { month:'short', day:'numeric' })}` : 'Not opened yet'}
                    </div>
                  </div>
                  <button className="btn btn-outline btn-sm" onClick={() => copy(l)}>
                    {copied === l.id ? 'Copied' : 'Copy link'}
                  </button>
                  <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => issue(l.vendor_name, true)}>Re-issue</button>
                  <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => revoke(l)} style={{ color:'var(--danger)', borderColor:'var(--danger)' }}>Revoke</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display:'flex', gap:'var(--s-2)', flexWrap:'wrap' }}>
            <input
              value={vendorName}
              onChange={e => setVendorName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && vendorName.trim()) issue(vendorName.trim(), false) }}
              placeholder="Vendor name"
              style={{ flex:1, minWidth:200, padding:'var(--s-2) var(--s-3)', fontSize:'var(--t-base)', border:'1px solid var(--border-dark)', borderRadius:'var(--r-md)', fontFamily:'var(--font)' }}
            />
            <button className="btn btn-black btn-sm" disabled={busy || !vendorName.trim()} onClick={() => issue(vendorName.trim(), false)}>
              Issue link
            </button>
          </div>
        </div>

        <div style={{ padding:'var(--s-4) var(--s-6)', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end' }}>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
