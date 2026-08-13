'use client'

import { useState, useEffect } from 'react'
import SignOutButton from '@/app/components/SignOutButton'

// Reporting across projects.
//
// Deliberately shows how much of each figure is actually priced. A revenue
// total built from 1 of 52 line items is not wrong, but read without that
// context it is misleading — so the count travels with the number.

const money = n =>
  n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`

export default function ReportingClient() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/reporting')
    const d = await res.json().catch(() => ({}))
    setLoading(false)
    if (!res.ok) { setError(d.error || 'Could not load reporting.'); return }
    setData(d)
  }

  const t = data?.totals

  return (
    <div style={{ minHeight:'100vh', background:'var(--off-white)' }}>
      <div style={{ height:64, borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', padding:'0 40px', background:'var(--white)', gap:20 }}>
        <button onClick={() => window.location.href = '/'}
          style={{ display:'flex', alignItems:'center', gap:8, background:'none', border:'none', cursor:'pointer', padding:'0 16px 0 0', borderRight:'1px solid var(--border)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          <span style={{ fontSize:10, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase' }}>Projects</span>
        </button>
        <div style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:300, letterSpacing:'0.06em', flex:1 }}>
          Relative <span style={{ color:'var(--gold)' }}>Estates</span>
        </div>
        <SignOutButton compact />
      </div>

      <div style={{ padding:'48px 56px 80px' }}>
        <div className="page-eyebrow">Internal</div>
        <div className="page-title" style={{ marginBottom:10 }}>Report<em>ing</em></div>
        <div style={{ fontSize:13, color:'var(--gray)', lineHeight:1.7, marginBottom:28, maxWidth:640 }}>
          Cost, revenue and profit across every project you can see. Figures come from
          the same pricing the dashboards use, and count only line items that have both
          a price and a quantity. Rejected lines are excluded.
        </div>

        {error && (
          <div style={{ padding:'12px 16px', background:'var(--danger-bg)', border:'1px solid var(--danger)', color:'var(--danger)', fontSize:12, marginBottom:20 }}>{error}</div>
        )}

        {loading ? <div className="spinner" /> : !data ? null : (
          <>
            <div style={{ display:'flex', border:'1px solid var(--border)', flexWrap:'wrap', background:'var(--white)', marginBottom:14 }}>
              {[
                { val: money(t.revenue), label: 'Total Revenue', color: 'var(--black)' },
                { val: money(t.cost), label: 'Total Cost', color: 'var(--gold)' },
                { val: money(t.profit), label: 'Total Profit', color: 'var(--success)' },
                { val: t.marginPct == null ? '—' : `${t.marginPct}%`, label: 'Margin' },
                { val: t.projectCount, label: 'Projects' },
              ].map((s, i, arr) => (
                <div key={s.label} style={{ flex:'1 1 150px', padding:'18px 24px', textAlign:'center', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ fontFamily:'var(--font-display)', fontSize:26, fontWeight:200, color:s.color||'var(--black)', lineHeight:1 }}>{s.val}</div>
                  <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--gray-light)', marginTop:6 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Without this, a total built from a handful of priced lines reads
                as the whole picture. */}
            <div style={{ fontSize:11, color:'var(--gray-light)', marginBottom:32, lineHeight:1.7 }}>
              Based on {t.pricedItemCount} of {t.itemCount} line items — the rest are
              missing a price, a quantity, or both, and contribute nothing to these figures.
            </div>

            <SectionTitle>By project</SectionTitle>
            {data.projects.length === 0 ? (
              <Empty>No projects yet.</Empty>
            ) : (
              <Table
                head={['Project', 'Client', 'Priced', 'Cost', 'Revenue', 'Profit', 'Margin']}
                rows={data.projects.map(p => ({
                  key: p.slug,
                  onClick: () => window.location.href = `/projects/${p.slug}/dashboard`,
                  cells: [
                    p.name,
                    p.client || '—',
                    `${p.pricedItemCount}/${p.itemCount}`,
                    money(p.cost),
                    money(p.revenue),
                    money(p.profit),
                    p.marginPct == null ? '—' : `${p.marginPct}%`,
                  ],
                }))}
              />
            )}

            <SectionTitle style={{ marginTop:40 }}>By category</SectionTitle>
            {data.categories.length === 0 ? (
              <Empty>No schedules yet.</Empty>
            ) : (
              <Table
                head={['Category', 'Projects', 'Items', 'Cost', 'Revenue', 'Profit', 'Margin']}
                rows={data.categories.map(c => ({
                  key: c.category,
                  cells: [
                    c.label, c.projects, c.itemCount,
                    money(c.cost), money(c.revenue), money(c.profit),
                    c.marginPct == null ? '—' : `${c.marginPct}%`,
                  ],
                }))}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function SectionTitle({ children, style }) {
  return (
    <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:10, ...style }}>
      {children}
    </div>
  )
}

function Empty({ children }) {
  return <div style={{ fontSize:12, color:'var(--gray-light)', fontStyle:'italic', padding:'12px 0' }}>{children}</div>
}

function Table({ head, rows }) {
  return (
    <div style={{ overflowX:'auto', border:'1px solid var(--border)', background:'var(--white)' }}>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} style={{ ...th, textAlign: i >= 2 ? 'right' : 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} onClick={r.onClick} style={{ cursor: r.onClick ? 'pointer' : 'default' }}>
              {r.cells.map((c, i) => (
                <td key={i} style={{ ...td, textAlign: i >= 2 ? 'right' : 'left', whiteSpace: i >= 2 ? 'nowrap' : 'normal' }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const th = {
  padding:'11px 12px', fontSize:9, fontWeight:600, letterSpacing:'0.14em',
  textTransform:'uppercase', color:'var(--gray-light)',
  borderBottom:'1px solid var(--border)', whiteSpace:'nowrap',
}
const td = { padding:'12px', borderBottom:'1px solid var(--border)', fontSize:13, verticalAlign:'middle' }
