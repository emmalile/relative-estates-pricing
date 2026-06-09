'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { allCategories, getCategory } from '@/lib/categories'
import { formatCurrency, formatDate } from '@/lib/utils'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || ''

export default function Dashboard({ params }) {
  const { slug } = params
  const [project, setProject] = useState(null)
  const [schedules, setSchedules] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [approvals, setApprovals] = useState({})
  const [quantities, setQuantities] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState(null)
  const [showIntro, setShowIntro] = useState(true)

  useEffect(() => { loadAll() }, [slug])

  async function loadAll() {
    const { data: proj } = await supabase
      .from('projects')
      .select('*')
      .eq('slug', slug)
      .single()

    if (!proj) { setLoading(false); return }
    setProject(proj)

    const [{ data: scheds }, { data: subs }, { data: apprs }] = await Promise.all([
      supabase.from('schedules').select('*').eq('project_id', proj.id),
      supabase.from('submissions').select('*').eq('project_id', proj.id),
      supabase.from('approvals').select('*').eq('project_id', proj.id),
    ])

    setSchedules(scheds || [])
    setSubmissions(subs || [])

    // Map approvals to a lookup object
    const apprMap = {}
    ;(apprs || []).forEach(a => {
      const k = `${a.category}|||${a.item_key}`
      apprMap[k] = a
    })
    setApprovals(apprMap)

    const firstCat = (proj.categories || [])[0]
    if (firstCat) setActiveCategory(firstCat)
    setLoading(false)
  }

  // Save approval to DB (debounced in practice)
  async function saveApproval(category, itemKey, status, quantity, notes) {
    const k = `${category}|||${itemKey}`
    setApprovals(prev => ({
      ...prev,
      [k]: { ...prev[k], category, item_key: itemKey, status, quantity, notes },
    }))

    await fetch('/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        category,
        itemKey,
        status,
        quantity: quantity || 0,
        notes: notes || '',
      }),
    })
  }

  // Compute totals across all categories
  const totals = useCallback(() => {
    let totalItems = 0, approved = 0, rejected = 0, projectedCost = 0

    schedules.forEach(sched => {
      const cat = getCategory(sched.category)
      const catSubs = submissions.filter(s => s.category === sched.category)

      sched.items.forEach((item, i) => {
        totalItems++
        const k = `${sched.category}|||${item.key}`
        const ap = approvals[k]
        if (ap?.status === 'approved') approved++
        if (ap?.status === 'rejected') rejected++

        if (ap?.status !== 'rejected') {
          const qty = parseFloat(quantities[k] || ap?.quantity || 0)
          const lowest = getLowestPrice(catSubs, i)
          if (lowest && qty) projectedCost += lowest.price * qty
        }
      })
    })

    return { totalItems, approved, rejected, projectedCost }
  }, [schedules, submissions, approvals, quantities])

  function getLowestPrice(catSubs, itemIndex) {
    let best = null
    catSubs.forEach(sub => {
      const item = sub.pricing_data?.[itemIndex]
      if (!item) return
      const price = parseFloat(item.priceSqm || item.pricePerUnit || item.pricePerLinFt || 0)
      if (price > 0 && (!best || price < best.price)) {
        best = { price, manufacturer: sub.manufacturer_name, data: item }
      }
    })
    return best
  }

  function copyLink(type) {
    const url = `${window.location.origin}/projects/${slug}/${type}`
    navigator.clipboard?.writeText(url)
    alert(`Link copied: ${url}`)
  }

  function exportCSV() {
    const lines = ['Category,Material,Finish,Cut,Best Price,Unit,Status,Quantity,Total Cost,Notes']
    schedules.forEach(sched => {
      const catSubs = submissions.filter(s => s.category === sched.category)
      sched.items.forEach((item, i) => {
        const k = `${sched.category}|||${item.key}`
        const ap = approvals[k] || {}
        const qty = parseFloat(quantities[k] || ap.quantity || 0)
        const lowest = getLowestPrice(catSubs, i)
        const total = lowest && qty ? (lowest.price * qty).toFixed(2) : ''
        const unit = getCategory(sched.category)?.quantityUnit || ''
        lines.push([
          sched.category, item.name, item.finish || '', item.cut || '',
          lowest ? lowest.price : '', unit,
          ap.status || 'pending', qty, total ? `$${total}` : '',
          (ap.notes || '').replace(/,/g, ';'),
        ].join(','))
      })
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${slug}-approval-summary.csv`
    a.click()
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  )

  if (!project) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 300 }}>Project Not Found</div>
      </div>
    </div>
  )

  const t = totals()
  const pct = t.totalItems > 0 ? Math.round((t.approved / t.totalItems) * 100) : 0

  // ── INTRO SCREEN ──
  if (showIntro) return (
    <div style={{
      minHeight: '100vh', background: 'var(--black)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Grid lines */}
      {[20, 80].map(pct => (
        <div key={`h${pct}`} style={{ position: 'absolute', height: 1, width: '100%', background: 'rgba(255,255,255,0.04)', top: `${pct}%` }} />
      ))}
      {[15, 85].map(pct => (
        <div key={`v${pct}`} style={{ position: 'absolute', width: 1, height: '100%', background: 'rgba(255,255,255,0.04)', left: `${pct}%` }} />
      ))}

      {/* Corner labels */}
      {[
        { pos: { top: 36, left: 48 }, text: 'Relative Estates LLC' },
        { pos: { top: 36, right: 48 }, text: `Material Review · ${new Date().getFullYear()}` },
        { pos: { bottom: 36, left: 48 }, text: 'Confidential · Owner Copy' },
        { pos: { bottom: 36, right: 48 }, text: 'Kansas City, MO' },
      ].map((c, idx) => (
        <div key={idx} style={{
          position: 'absolute', ...c.pos,
          fontSize: 8, fontWeight: 300, letterSpacing: '0.16em',
          color: 'rgba(255,255,255,0.12)', textTransform: 'uppercase',
        }}>
          {c.text}
        </div>
      ))}

      <div style={{ textAlign: 'center', position: 'relative', zIndex: 2, padding: '0 24px', animation: 'riseIn 1.8s cubic-bezier(0.16,1,0.3,1) 0.3s both' }}>
        <style>{`@keyframes riseIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }`}</style>
        <div style={{ fontSize: 9, fontWeight: 400, letterSpacing: '0.32em', textTransform: 'uppercase', color: 'var(--gold-light)', marginBottom: 24 }}>
          Owner Review — Material Pricing Schedule
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(48px,8vw,100px)', fontWeight: 200, lineHeight: 0.95, color: '#f7f5f0', letterSpacing: '-0.02em' }}>
          Material<br/><em style={{ color: 'rgba(247,245,240,0.5)' }}>Selection</em>
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,2.5vw,24px)', fontWeight: 300, fontStyle: 'italic', color: 'var(--gold-light)', marginTop: 20 }}>
          {project.name}
        </div>
        <div style={{ width: 40, height: 1, background: 'rgba(201,169,110,0.5)', margin: '28px auto' }} />
        {/* Stats */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 32, marginBottom: 40 }}>
          {[
            { val: schedules.reduce((acc, s) => acc + (s.items?.length || 0), 0), label: 'Materials' },
            { val: project.categories?.length || 0, label: 'Categories' },
            { val: [...new Set(submissions.map(s => s.manufacturer_name))].length, label: 'Manufacturers' },
          ].map((stat, idx, arr) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 300, color: '#f7f5f0', lineHeight: 1 }}>{stat.val}</div>
                <div style={{ fontSize: 8, fontWeight: 400, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(247,245,240,0.3)', marginTop: 4 }}>{stat.label}</div>
              </div>
              {idx < arr.length - 1 && <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.08)' }} />}
            </div>
          ))}
        </div>
        <button
          onClick={() => setShowIntro(false)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 14,
            padding: '16px 44px',
            fontSize: 9, fontWeight: 400, letterSpacing: '0.26em', textTransform: 'uppercase',
            background: '#f7f5f0', color: 'var(--black)', border: 'none', cursor: 'pointer',
            transition: 'background 0.3s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--gold-light)'}
          onMouseLeave={e => e.currentTarget.style.background = '#f7f5f0'}
        >
          Begin Review →
        </button>
      </div>
    </div>
  )

  // ── MAIN DASHBOARD ──
  const activeSched = schedules.find(s => s.category === activeCategory)
  const activeCatSubs = submissions.filter(s => s.category === activeCategory)
  const activeCatDef = getCategory(activeCategory)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--off-white)' }}>

      {/* TOP BAR */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 200,
        background: 'rgba(247,245,240,0.96)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)', height: 64,
        display: 'flex', alignItems: 'center', padding: '0 40px', gap: 0,
      }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 300,
          letterSpacing: '0.06em', flexShrink: 0, marginRight: 24,
        }}>
          Relative <span style={{ color: 'var(--gold)' }}>Estates</span>
        </div>
        <div style={{ width: 1, height: 24, background: 'var(--border)', marginRight: 20, flexShrink: 0 }} />
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 14, fontStyle: 'italic',
          fontWeight: 300, color: 'var(--gray)', flex: 1,
        }}>
          {project.name}
        </div>
        {/* Projected cost */}
        <div style={{ marginRight: 28, flexShrink: 0, textAlign: 'right' }}>
          <div style={{ fontSize: 8, fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--gray-light)', marginBottom: 1 }}>
            Total Projected Cost
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 300, color: 'var(--gold)', lineHeight: 1 }}>
            {t.projectedCost > 0 ? formatCurrency(t.projectedCost) : '—'}
          </div>
        </div>
        {/* Progress */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ width: 100, height: 2, background: 'var(--border)', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--black)', width: `${pct}%`, borderRadius: 1, transition: 'width 0.5s' }} />
          </div>
          <div style={{ fontSize: 10, fontWeight: 300, color: 'var(--gray)', whiteSpace: 'nowrap' }}>
            {t.approved} / {t.totalItems} approved
          </div>
        </div>
      </div>

      {/* HERO */}
      <div style={{
        padding: '56px 56px 40px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 32,
      }}>
        <div>
          <div className="page-eyebrow">Material Pricing Review</div>
          <div className="page-title">{project.name.split(' ').slice(0, 2).join(' ')}<br/>
            <em>{project.name.split(' ').slice(2).join(' ') || project.client}</em>
          </div>
          <div style={{ fontSize: 12, fontWeight: 300, color: 'var(--gray)', marginTop: 12, lineHeight: 1.7 }}>
            {schedules.reduce((acc, s) => acc + (s.items?.length || 0), 0)} total line items across {project.categories?.length} categories · Review and approve each line item below.
          </div>
        </div>

        {/* Summary stats */}
        <div style={{ display: 'flex', border: '1px solid var(--border)', flexWrap: 'wrap' }}>
          {[
            { val: t.totalItems, label: 'Total Items' },
            { val: t.approved, label: 'Approved', color: 'var(--success)' },
            { val: t.rejected, label: 'Rejected', color: 'var(--danger)' },
            { val: t.projectedCost > 0 ? formatCurrency(t.projectedCost) : '—', label: 'Est. Cost', color: 'var(--gold)' },
          ].map((stat, i, arr) => (
            <div key={i} style={{
              padding: '16px 24px', textAlign: 'center',
              borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 200,
                color: stat.color || 'var(--black)', lineHeight: 1,
              }}>
                {stat.val}
              </div>
              <div style={{ fontSize: 8, fontWeight: 400, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--gray-light)', marginTop: 5 }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CATEGORY SUMMARY ROW */}
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--white)', overflowX: 'auto' }}>
        <div style={{ display: 'flex', minWidth: 'max-content' }}>
          {project.categories?.map(catId => {
            const sched = schedules.find(s => s.category === catId)
            const catDef = getCategory(catId)
            const catSubs = submissions.filter(s => s.category === catId)
            const items = sched?.items || []
            let catApproved = 0, catCost = 0

            items.forEach((item, i) => {
              const k = `${catId}|||${item.key}`
              const ap = approvals[k]
              if (ap?.status === 'approved') catApproved++
              if (ap?.status !== 'rejected') {
                const qty = parseFloat(quantities[k] || ap?.quantity || 0)
                const lowest = getLowestPrice(catSubs, i)
                if (lowest && qty) catCost += lowest.price * qty
              }
            })

            const isActive = activeCategory === catId
            return (
              <div
                key={catId}
                onClick={() => setActiveCategory(catId)}
                style={{
                  padding: '16px 28px', cursor: 'pointer',
                  borderBottom: isActive ? '2px solid var(--black)' : '2px solid transparent',
                  background: isActive ? 'var(--off-white)' : 'transparent',
                  transition: 'all 0.15s', minWidth: 160,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, color: isActive ? 'var(--gold)' : 'var(--gray-light)' }}>
                    {catDef?.icon}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase', color: isActive ? 'var(--black)' : 'var(--gray)' }}>
                    {catDef?.label || catId}
                  </span>
                </div>
                <div style={{ fontSize: 10, fontWeight: 300, color: 'var(--gray-light)' }}>
                  {catApproved}/{items.length} approved
                  {catCost > 0 && ` · ${formatCurrency(catCost)}`}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ACTIVE CATEGORY DETAIL */}
      <div style={{ padding: '0 40px 80px' }}>
        {activeSched && activeCatDef ? (
          <CategoryDetail
            schedule={activeSched}
            category={activeCatDef}
            submissions={activeCatSubs}
            approvals={approvals}
            quantities={quantities}
            onApprove={(itemKey, status, notes) => {
              const k = `${activeCategory}|||${itemKey}`
              const qty = parseFloat(quantities[k] || approvals[k]?.quantity || 0)
              saveApproval(activeCategory, itemKey, status, qty, notes)
            }}
            onQtyChange={(itemKey, qty) => {
              const k = `${activeCategory}|||${itemKey}`
              setQuantities(prev => ({ ...prev, [k]: qty }))
              const ap = approvals[k] || {}
              saveApproval(activeCategory, itemKey, ap.status || 'pending', qty, ap.notes || '')
            }}
            onNoteChange={(itemKey, notes) => {
              const k = `${activeCategory}|||${itemKey}`
              const ap = approvals[k] || {}
              const qty = parseFloat(quantities[k] || ap.quantity || 0)
              saveApproval(activeCategory, itemKey, ap.status || 'pending', qty, notes)
            }}
            getLowestPrice={getLowestPrice}
            projectSlug={slug}
            onCopyFormLink={() => copyLink(`form/${activeCategory}`)}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-state-title">No schedule uploaded</div>
            <div className="empty-state-sub">Upload a CSV for this category in the admin.</div>
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div style={{
        borderTop: '2px solid var(--black)', padding: '40px 56px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 24, background: 'var(--off-white)',
      }}>
        <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
          {[
            { val: t.totalItems, label: 'Total Materials' },
            { val: t.approved, label: 'Approved', color: 'var(--success)' },
            { val: t.rejected, label: 'Rejected', color: 'var(--danger)' },
            { val: t.projectedCost > 0 ? formatCurrency(t.projectedCost) : '—', label: 'Projected Cost', color: 'var(--gold)' },
          ].map((s, i) => (
            <div key={i} style={{
              paddingRight: 40, marginRight: 40,
              borderRight: i < 3 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 200, color: s.color || 'var(--black)', lineHeight: 1 }}>
                {s.val}
              </div>
              <div style={{ fontSize: 8, fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--gray-light)', marginTop: 5 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
        <button className="btn btn-black btn-lg" onClick={exportCSV}>
          Export Full Summary →
        </button>
      </div>
    </div>
  )
}

// ── Category Detail Table ─────────────────────────────────
function CategoryDetail({ schedule, category, submissions, approvals, quantities, onApprove, onQtyChange, onNoteChange, getLowestPrice, projectSlug, onCopyFormLink }) {

  return (
    <div>
      {/* Section header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '28px 0 20px', borderBottom: '2px solid var(--black)',
        flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 400, letterSpacing: '0.1em' }}>
            {category.label} Schedule
          </span>
          <span style={{ fontSize: 11, fontWeight: 300, color: 'var(--gray-light)' }}>
            {schedule.items.length} items
          </span>
          {schedule.manufacturer && (
            <div style={{
              padding: '3px 10px', fontSize: 8, fontWeight: 400,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              background: 'var(--gold-pale)', color: 'var(--gold)',
              border: '1px solid rgba(154,122,74,0.2)',
            }}>
              {schedule.manufacturer}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={onCopyFormLink}>
            Copy Form Link
          </button>
        </div>
      </div>

      {/* Manufacturer submissions info */}
      {submissions.length === 0 && (
        <div style={{
          padding: '20px 24px', background: 'var(--gold-pale)',
          border: '1px solid rgba(154,122,74,0.2)', marginTop: 16, marginBottom: 16,
          fontSize: 12, fontWeight: 300, color: 'var(--gray)',
        }}>
          No pricing received yet. Copy the form link above and send it to {schedule.manufacturer || 'your manufacturer'}.
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto', marginTop: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle('220px')}>Material</th>
              <th style={thStyle('80px')}>Images</th>
              {submissions.map(sub => (
                <th key={sub.id} style={{ ...thStyle('160px'), color: 'var(--gold)', background: 'var(--gold-pale)', borderLeft: '1px solid var(--border)' }}>
                  {sub.manufacturer_name}
                </th>
              ))}
              <th style={thStyle('100px')}>Qty ({category.quantityUnit})</th>
              <th style={thStyle('130px')}>Total Cost</th>
              <th style={thStyle('130px')}>Approval</th>
              <th style={thStyle('180px')}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {schedule.items.map((item, i) => {
              const k = `${schedule.category}|||${item.key}`
              const ap = approvals[k] || { status: 'pending', notes: '' }
              const qty = parseFloat(quantities[k] || ap.quantity || 0)
              const lowest = getLowestPrice(submissions, i)
              const total = lowest && qty ? lowest.price * qty : null

              return (
                <tr
                  key={i}
                  style={{
                    background: ap.status === 'approved' ? 'var(--success-bg)' :
                                ap.status === 'rejected' ? 'var(--danger-bg)' : 'transparent',
                    opacity: ap.status === 'rejected' ? 0.6 : 1,
                  }}
                >
                  <td style={tdStyle()}>
                    <MaterialNameCell item={item} />
                  </td>
                  <td style={tdStyle()}>
                    <div style={{
                      width: 48, height: 48, background: 'var(--cream)',
                      border: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', fontSize: 9, color: 'var(--gray-light)',
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                        <rect x="3" y="3" width="18" height="18" rx="1"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                    </div>
                  </td>
                  {submissions.map(sub => {
                    const d = sub.pricing_data?.[i]
                    const pd = category.dashboardPriceDisplay(d || {})
                    const isLowest = lowest && sub.manufacturer_name === lowest.manufacturer
                    return (
                      <td key={sub.id} style={{ ...tdStyle(), borderLeft: '1px solid var(--border)', background: 'rgba(242,234,216,0.3)' }}>
                        {d ? (
                          <div>
                            <div style={{
                              fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 300,
                              color: isLowest ? 'var(--black)' : 'var(--gray)', lineHeight: 1,
                            }}>
                              {pd.primary || '—'}
                            </div>
                            {pd.secondary && <div style={{ fontSize: 10, color: 'var(--gray-light)', marginTop: 2 }}>{pd.secondary}</div>}
                            {pd.volume && <div style={{ fontSize: 9, color: 'var(--gold)', marginTop: 2 }}>{pd.volume}</div>}
                            {pd.moq && <div style={{ fontSize: 9, color: 'var(--gray-light)', marginTop: 1 }}>{pd.moq}</div>}
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, fontStyle: 'italic', color: 'rgba(0,0,0,0.2)' }}>Awaiting quote</span>
                        )}
                      </td>
                    )
                  })}
                  <td style={tdStyle()}>
                    <input
                      type="number" min="0" placeholder="0"
                      value={quantities[k] || ap.quantity || ''}
                      onChange={e => onQtyChange(item.key, parseFloat(e.target.value) || 0)}
                      style={{
                        width: 72, padding: '7px 0',
                        fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 300,
                        background: 'transparent', border: 'none',
                        borderBottom: '1px solid var(--border)',
                        color: 'var(--black)', textAlign: 'left',
                      }}
                    />
                  </td>
                  <td style={tdStyle()}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 300, color: 'var(--gold)', whiteSpace: 'nowrap' }}>
                      {total ? formatCurrency(total) : '—'}
                    </div>
                  </td>
                  <td style={tdStyle()}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{
                        fontSize: 8, fontWeight: 400, letterSpacing: '0.16em',
                        textTransform: 'uppercase', padding: '3px 8px', border: '1px solid',
                        display: 'inline-block', width: 'fit-content',
                        ...(ap.status === 'approved' ? { borderColor: 'var(--success)', color: 'var(--success)', background: 'var(--success-bg)' }
                          : ap.status === 'rejected' ? { borderColor: 'var(--danger)', color: 'var(--danger)', background: 'var(--danger-bg)' }
                          : { borderColor: 'var(--border-dark)', color: 'var(--gray-light)' }),
                      }}>
                        {ap.status}
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {['approved', 'rejected'].map(s => (
                          <button
                            key={s}
                            onClick={() => onApprove(item.key, ap.status === s ? 'pending' : s, ap.notes)}
                            style={{
                              padding: '5px 10px', fontSize: 8, fontWeight: 400,
                              letterSpacing: '0.12em', textTransform: 'uppercase',
                              cursor: 'pointer', border: '1px solid', transition: 'all 0.15s',
                              ...(ap.status === s
                                ? s === 'approved'
                                  ? { background: 'var(--black)', color: 'var(--off-white)', borderColor: 'var(--black)' }
                                  : { background: 'var(--danger)', color: 'white', borderColor: 'var(--danger)' }
                                : { background: 'transparent', color: 'var(--gray)', borderColor: 'var(--border-dark)' }),
                            }}
                          >
                            {s === 'approved' ? '✓' : '✕'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </td>
                  <td style={tdStyle()}>
                    <textarea
                      value={ap.notes || ''}
                      onChange={e => onNoteChange(item.key, e.target.value)}
                      placeholder="Add a note…"
                      rows={2}
                      style={{
                        width: '100%', padding: '6px 0',
                        fontFamily: 'var(--font-display)', fontSize: 12,
                        fontStyle: 'italic', fontWeight: 300,
                        background: 'transparent', border: 'none',
                        borderBottom: '1px solid transparent',
                        color: 'var(--gray)', resize: 'none',
                        transition: 'border-color 0.2s',
                      }}
                      onFocus={e => e.target.style.borderBottomColor = 'var(--border)'}
                      onBlur={e => e.target.style.borderBottomColor = 'transparent'}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MaterialNameCell({ item }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 300, color: 'var(--black)', lineHeight: 1 }}>
        {item.name}
      </div>
      {item.finish && (
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontStyle: 'italic', color: 'var(--gold)', marginTop: 2 }}>
          {item.finish}
        </div>
      )}
      {item.cut && (
        <div style={{ fontSize: 10, fontWeight: 300, color: 'var(--gray-light)', marginTop: 1 }}>{item.cut}</div>
      )}
      {(item.locations || []).length > 0 && (
        <>
          <button
            onClick={() => setOpen(!open)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 9, fontWeight: 400, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'var(--gray-light)', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0, marginTop: 6, transition: 'color 0.15s',
            }}
          >
            <span style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
            {item.locations.length} location{item.locations.length !== 1 ? 's' : ''}
          </button>
          {open && (
            <div style={{
              fontSize: 10, fontWeight: 300, color: 'var(--gray)', lineHeight: 2,
              padding: '8px 12px', background: 'var(--cream)',
              borderLeft: '2px solid var(--gold-light)', marginTop: 6,
            }}>
              {item.locations.map((loc, i) => <div key={i}>· {loc}</div>)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function thStyle(minWidth) {
  return {
    padding: '12px 16px', textAlign: 'left',
    fontSize: 8, fontWeight: 400, letterSpacing: '0.2em', textTransform: 'uppercase',
    color: 'var(--gray-light)', background: 'var(--off-white)',
    borderBottom: '1px solid var(--border)',
    position: 'sticky', top: 64, zIndex: 10,
    whiteSpace: 'nowrap', minWidth,
  }
}

function tdStyle() {
  return {
    padding: '14px 16px', borderBottom: '1px solid var(--border)',
    verticalAlign: 'middle', fontWeight: 300, fontSize: 13,
  }
}
