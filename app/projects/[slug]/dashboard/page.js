'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabase'
import { allCategories, getCategory } from '@/lib/categories'
import { formatCurrency, formatDate } from '@/lib/utils'

const SQM_TO_SQFT = 10.7639

export default function Dashboard({ params }) {
  const { slug } = params
  const [project, setProject] = useState(null)
  const [schedules, setSchedules] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [approvals, setApprovals] = useState({})
  const [quantities, setQuantities] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState(null)
  const [lightbox, setLightbox] = useState(null) // { images: [], index: 0 }
  const [importModal, setImportModal] = useState(null) // { schedule, category } when open
  const [addItemModal, setAddItemModal] = useState(null) // { schedule, category } when open

  // ── Passcode gate ──────────────────────────────────────
  // Internal dashboard is sensitive (cost + margin data), so it's
  // gated behind a shared passcode. Unlocking is remembered per
  // project for the rest of the browser session via sessionStorage.
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [unlocked, setUnlocked] = useState(false)
  const [passcodeInput, setPasscodeInput] = useState('')
  const [passcodeError, setPasscodeError] = useState(false)
  const PASSCODE = 'kce26'

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem(`re_auth_${slug}`) === 'true') {
      setUnlocked(true)
    }
    setCheckingAuth(false)
  }, [slug])

  function handlePasscodeSubmit(e) {
    e.preventDefault()
    if (passcodeInput === PASSCODE) {
      sessionStorage.setItem(`re_auth_${slug}`, 'true')
      setUnlocked(true)
      setPasscodeError(false)
    } else {
      setPasscodeError(true)
    }
  }

  useEffect(() => { if (unlocked) loadAll() }, [slug, unlocked])

  async function loadAll() {
    const { data: proj } = await supabase
      .from('projects').select('*').eq('slug', slug).single()
    if (!proj) { setLoading(false); return }
    setProject(proj)
    const [{ data: scheds }, { data: subs }, { data: apprs }] = await Promise.all([
      supabase.from('schedules').select('*').eq('project_id', proj.id),
      supabase.from('submissions').select('*').eq('project_id', proj.id),
      supabase.from('approvals').select('*').eq('project_id', proj.id),
    ])
    setSchedules(scheds || [])
    // Deduplicate — keep only the latest submission per manufacturer per category
    const allSubs = subs || []
    const subMap = {}
    allSubs.forEach(s => {
      const k = s.category + '|||' + s.manufacturer_name
      if (!subMap[k] || new Date(s.submitted_at) > new Date(subMap[k].submitted_at)) {
        subMap[k] = s
      }
    })
    setSubmissions(Object.values(subMap))
    const apprMap = {}
    ;(apprs || []).forEach(a => { apprMap[`${a.category}|||${a.item_key}`] = a })
    setApprovals(apprMap)
    const firstCat = (proj.categories || [])[0]
    if (firstCat) setActiveCategory(firstCat)
    setLoading(false)
  }

  async function saveApproval(category, itemKey, status, quantity, notes, shippingDdp, markupOverride) {
    const k = `${category}|||${itemKey}`
    setApprovals(prev => ({
      ...prev,
      [k]: {
        ...prev[k], category, item_key: itemKey, status, quantity, notes,
        shipping_ddp: shippingDdp ?? 0,
        markup_override: markupOverride === undefined ? null : markupOverride,
      },
    }))
    await fetch('/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id, category, itemKey, status,
        quantity: quantity || 0, notes: notes || '',
        shippingDdp: shippingDdp || 0,
        markupOverride: markupOverride === undefined ? null : markupOverride,
      }),
    })
  }

  function getLowestPrice(catSubs, itemIndex) {
    let best = null
    catSubs.forEach(sub => {
      const item = sub.pricing_data?.[itemIndex]
      if (!item) return
      const price = parseFloat(item.priceSqm || item.pricePerUnit || item.pricePerLinFt || item.unitPrice || 0)
      if (price > 0 && (!best || price < best.price)) best = { price, manufacturer: sub.manufacturer_name, data: item }
    })
    return best
  }

  // Convert lowest price to sqft
  function getLowestPriceSqft(catSubs, itemIndex) {
    const low = getLowestPrice(catSubs, itemIndex)
    if (!low) return null
    return { ...low, priceSqft: parseFloat((low.price / SQM_TO_SQFT).toFixed(2)) }
  }

  // 20% is the standard markup on top of total cost (material + shipping).
  // Internal team can override the markup price per line item to offer a discount.
  const MARKUP_RATE = 1.2

  function getLineEconomics(low, ap) {
    const materialSqft = low ? low.priceSqft : null
    const ddpSqft = parseFloat(ap?.shipping_ddp || 0)
    const totalCostSqft = materialSqft != null ? parseFloat((materialSqft + ddpSqft).toFixed(2)) : null
    const autoMarkupSqft = totalCostSqft != null ? parseFloat((totalCostSqft * MARKUP_RATE).toFixed(2)) : null
    const hasOverride = ap?.markup_override !== null && ap?.markup_override !== undefined && ap?.markup_override !== ''
    const markupSqft = hasOverride ? parseFloat(ap.markup_override) : autoMarkupSqft
    return { materialSqft, ddpSqft, totalCostSqft, autoMarkupSqft, markupSqft, hasOverride }
  }

  const totals = useCallback(() => {
    let totalItems = 0, approved = 0, rejected = 0, yourCost = 0, clientTotal = 0
    schedules.forEach(sched => {
      const catSubs = submissions.filter(s => s.category === sched.category)
      sched.items.forEach((item, i) => {
        totalItems++
        const k = `${sched.category}|||${item.key}`
        const ap = approvals[k]
        if (ap?.status === 'approved') approved++
        if (ap?.status === 'rejected') rejected++
        if (ap?.status !== 'rejected') {
          const qty = parseFloat(quantities[k] || ap?.quantity || 0)
          const low = getLowestPriceSqft(catSubs, i)
          const econ = getLineEconomics(low, ap)
          if (econ.totalCostSqft != null && qty) {
            yourCost += econ.totalCostSqft * qty
            clientTotal += econ.markupSqft * qty
          }
        }
      })
    })
    return { totalItems, approved, rejected, yourCost, clientTotal, profit: clientTotal - yourCost }
  }, [schedules, submissions, approvals, quantities])

  function exportCSV() {
    const lines = ['Category,Material,Finish,Cut,Material Price (sqft),Manufacturer,Status,Quantity (sqft),DDP/Shipping (sqft),Your Cost (sqft),Your Cost Total,Markup (sqft),Client Total,Notes']
    schedules.forEach(sched => {
      const catSubs = submissions.filter(s => s.category === sched.category)
      sched.items.forEach((item, i) => {
        const k = `${sched.category}|||${item.key}`
        const ap = approvals[k] || {}
        const qty = parseFloat(quantities[k] || ap.quantity || 0)
        const low = getLowestPriceSqft(catSubs, i)
        const econ = getLineEconomics(low, ap)
        const yourCostTotal = econ.totalCostSqft != null && qty ? (econ.totalCostSqft * qty).toFixed(2) : ''
        const clientTotalLine = econ.markupSqft != null && qty ? (econ.markupSqft * qty).toFixed(2) : ''
        lines.push([
          sched.category, `"${item.name}"`, `"${item.finish || ''}"`, `"${item.cut || ''}"`,
          low ? `$${low.priceSqft}/sqft` : '',
          low ? `"${low.manufacturer}"` : '',
          ap.status || 'pending', qty,
          econ.ddpSqft ? `$${econ.ddpSqft}` : '0',
          econ.totalCostSqft != null ? `$${econ.totalCostSqft}/sqft` : '',
          yourCostTotal ? `$${yourCostTotal}` : '',
          econ.markupSqft != null ? `$${econ.markupSqft}/sqft` : '',
          clientTotalLine ? `$${clientTotalLine}` : '',
          `"${(ap.notes || '').replace(/"/g, '""')}"`,
        ].join(','))
      })
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${slug}-approval-summary.csv`
    a.click()
  }

  function exportPDF() {
    const t = totals()
    const win = window.open('', '_blank')
    const now = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    let rows = ''
    schedules.forEach(sched => {
      const catSubs = submissions.filter(s => s.category === sched.category)
      const catDef = getCategory(sched.category)
      if (!sched.items?.length) return
      rows += `<tr style="background:#f2ead8;"><td colspan="10" style="padding:8px 12px;font-weight:600;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#9a7a4a;">${catDef?.label || sched.category} — ${sched.manufacturer || ''}</td></tr>`
      sched.items.forEach((item, i) => {
        const k = `${sched.category}|||${item.key}`
        const ap = approvals[k] || {}
        const qty = parseFloat(quantities[k] || ap.quantity || 0)
        const low = getLowestPriceSqft(catSubs, i)
        const econ = getLineEconomics(low, ap)
        const yourCostTotal = econ.totalCostSqft != null && qty ? formatCurrency(econ.totalCostSqft * qty) : '—'
        const clientTotalLine = econ.markupSqft != null && qty ? formatCurrency(econ.markupSqft * qty) : '—'
        const statusColor = ap.status === 'approved' ? '#2d5a3d' : ap.status === 'rejected' ? '#7a1f1f' : '#8a8880'
        rows += `<tr>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:12px;font-weight:500;">${item.name}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:11px;color:#6a6760;">${item.finish || ''}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:11px;color:#6a6760;">${item.cut || ''}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:12px;">${low ? `$${low.priceSqft}/sqft` : '—'}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:11px;color:#6a6760;">${low?.manufacturer || '—'}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:12px;text-align:right;">${qty || '—'}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:12px;font-weight:600;color:#9a7a4a;text-align:right;">${yourCostTotal}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:11px;text-align:right;">${econ.markupSqft != null ? `$${econ.markupSqft}/sqft` : '—'}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:12px;font-weight:600;text-align:right;">${clientTotalLine}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:10px;font-weight:600;color:${statusColor};text-transform:uppercase;letter-spacing:0.08em;">${ap.status || 'pending'}</td>
        </tr>`
        if (ap.notes) rows += `<tr><td colspan="10" style="padding:3px 12px 8px 28px;font-size:11px;color:#8a8880;font-style:italic;border-bottom:1px solid #ede9e0;">↳ ${ap.notes}</td></tr>`
      })
    })
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&display=swap" rel="stylesheet"/>
    <title>Material Approval Summary — ${project?.name}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Montserrat', sans-serif; font-size: 12px; color: #0d0d0b; background: white; padding: 40px; }
      .header { border-bottom: 2px solid #0d0d0b; padding-bottom: 20px; margin-bottom: 28px; display: flex; justify-content: space-between; align-items: flex-end; }
      .co { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #9a7a4a; margin-bottom: 6px; }
      .title { font-size: 24px; font-weight: 300; color: #0d0d0b; letter-spacing: -0.01em; }
      .meta { font-size: 11px; color: #6a6760; text-align: right; line-height: 1.6; }
      .summary { display: flex; gap: 32px; margin-bottom: 28px; padding: 16px 20px; background: #f7f5f0; border: 1px solid #dedad2; }
      .s-item { text-align: center; }
      .s-val { font-size: 22px; font-weight: 300; color: #0d0d0b; }
      .s-val.gold { color: #9a7a4a; }
      .s-val.green { color: #2d5a3d; }
      .s-label { font-size: 9px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #8a8880; margin-top: 3px; }
      table { width: 100%; border-collapse: collapse; }
      th { padding: 8px 12px; text-align: left; font-size: 9px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #8a8880; border-bottom: 2px solid #0d0d0b; background: white; }
      .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #dedad2; display: flex; justify-content: space-between; font-size: 10px; color: #8a8880; }
      @media print { body { padding: 20px; } }
    </style></head><body>
    <div class="header">
      <div>
        <div class="co">Relative Estates LLC — Material Pricing System</div>
        <div class="title">Material Approval Summary</div>
        <div style="font-size:13px;color:#6a6760;margin-top:4px;font-style:italic;">${project?.name}</div>
      </div>
      <div class="meta">
        Generated ${now}<br/>
        ${project?.client || ''}<br/>
        Confidential
      </div>
    </div>
    <div class="summary">
      <div class="s-item"><div class="s-val">${t.totalItems}</div><div class="s-label">Total Items</div></div>
      <div class="s-item"><div class="s-val green">${t.approved}</div><div class="s-label">Approved</div></div>
      <div class="s-item"><div class="s-val" style="color:#7a1f1f">${t.rejected}</div><div class="s-label">Rejected</div></div>
      <div class="s-item"><div class="s-val gold">${t.yourCost > 0 ? formatCurrency(t.yourCost) : '—'}</div><div class="s-label">Your Cost</div></div>
      <div class="s-item"><div class="s-val">${t.clientTotal > 0 ? formatCurrency(t.clientTotal) : '—'}</div><div class="s-label">Client Total</div></div>
      <div class="s-item"><div class="s-val green">${t.profit > 0 ? formatCurrency(t.profit) : '—'}</div><div class="s-label">Profit</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Material</th><th>Finish</th><th>Cut</th>
        <th>Price / sqft</th><th>Manufacturer</th>
        <th style="text-align:right">Qty (sqft)</th>
        <th style="text-align:right">Your Cost</th>
        <th style="text-align:right">Markup / sqft</th>
        <th style="text-align:right">Client Total</th>
        <th>Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer">
      <span>Relative Estates LLC · Kansas City, MO</span>
      <span>${project?.name} · ${now}</span>
    </div>
    <script>window.onload = () => { window.print(); }</script>
    </body></html>`)
    win.document.close()
  }

  if (checkingAuth) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  // ── PASSCODE GATE ──
  if (!unlocked) return (
    <div style={{ minHeight: '100vh', background: 'var(--black)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
      {[20,80].map(p => <div key={`h${p}`} style={{ position:'absolute', height:1, width:'100%', background:'rgba(255,255,255,0.04)', top:`${p}%` }} />)}
      {[15,85].map(p => <div key={`v${p}`} style={{ position:'absolute', width:1, height:'100%', background:'rgba(255,255,255,0.04)', left:`${p}%` }} />)}
      {[
        { pos:{top:36,left:48}, text:'Relative Estates LLC' },
        { pos:{top:36,right:48}, text:`Material Review · ${new Date().getFullYear()}` },
        { pos:{bottom:36,left:48}, text:'Confidential · Owner Copy' },
        { pos:{bottom:36,right:48}, text:'Kansas City, MO' },
      ].map((c,i) => <div key={i} style={{ position:'absolute', ...c.pos, fontSize:9, fontWeight:500, letterSpacing:'0.16em', color:'rgba(255,255,255,0.12)', textTransform:'uppercase', fontFamily:'var(--font-body)' }}>{c.text}</div>)}
      <form onSubmit={handlePasscodeSubmit} style={{ textAlign:'center', position:'relative', zIndex:2, padding:'0 24px', width:'100%', maxWidth:360 }}>
        <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.28em', textTransform:'uppercase', color:'var(--gold-light)', marginBottom:24 }}>Owner Review — Internal Access</div>
        <div style={{ fontFamily:'var(--font-display)', fontSize:'clamp(36px,6vw,56px)', fontWeight:200, lineHeight:1, color:'#f7f5f0', marginBottom:16 }}>Enter <em style={{color:'rgba(247,245,240,0.5)'}}>Passcode</em></div>
        <div style={{ fontSize:12, fontWeight:400, color:'rgba(247,245,240,0.4)', marginBottom:28 }}>This dashboard contains cost and margin data for {project?.name || 'this project'}.</div>
        <input
          type="password"
          autoFocus
          value={passcodeInput}
          onChange={e => { setPasscodeInput(e.target.value); setPasscodeError(false) }}
          placeholder="Passcode"
          style={{ width:'100%', padding:'14px 18px', fontSize:16, fontWeight:500, letterSpacing:'0.1em', textAlign:'center', background:'rgba(255,255,255,0.06)', border:`1px solid ${passcodeError ? 'var(--danger)' : 'rgba(255,255,255,0.18)'}`, color:'#f7f5f0', marginBottom:16, outline:'none' }}
        />
        {passcodeError && <div style={{ fontSize:11, color:'#e8a0a0', marginBottom:16 }}>Incorrect passcode — try again.</div>}
        <button type="submit" style={{ display:'inline-flex', alignItems:'center', gap:14, padding:'14px 40px', fontSize:10, fontWeight:600, letterSpacing:'0.2em', textTransform:'uppercase', background:'#f7f5f0', color:'var(--black)', border:'none', cursor:'pointer', transition:'background 0.3s', width:'100%', justifyContent:'center' }} onMouseEnter={e=>e.currentTarget.style.background='var(--gold-light)'} onMouseLeave={e=>e.currentTarget.style.background='#f7f5f0'}>
          Unlock Dashboard →
        </button>
      </form>
    </div>
  )

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>
  if (!project) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}><div style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 32 }}>Project Not Found</div></div>

  const t = totals()
  const pct = t.totalItems > 0 ? Math.round((t.approved / t.totalItems) * 100) : 0

  const activeSched = schedules.find(s => s.category === activeCategory)
  const activeCatSubs = submissions.filter(s => s.category === activeCategory)
  const activeCatDef = getCategory(activeCategory)

  return (
    <div style={{ minHeight:'100vh', background:'var(--off-white)' }}>
      {/* TOP BAR — z-index 200 */}
      <div style={{ position:'sticky', top:0, zIndex:200, background:'rgba(247,245,240,0.97)', backdropFilter:'blur(12px)', borderBottom:'1px solid var(--border)', height:64, display:'flex', alignItems:'center', padding:'0 40px', gap:0 }}>
        {/* Home button */}
        <button onClick={() => window.location.href = '/'} style={{ display:'flex', alignItems:'center', gap:8, background:'none', border:'none', cursor:'pointer', padding:'0 16px 0 0', borderRight:'1px solid var(--border)', marginRight:20, flexShrink:0, transition:'opacity 0.2s' }} onMouseEnter={e=>e.currentTarget.style.opacity='0.6'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          <span style={{ fontSize:10, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--black)' }}>All Projects</span>
        </button>
        <div style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:300, letterSpacing:'0.06em', flexShrink:0, marginRight:24 }}>
          Relative <span style={{ color:'var(--gold)' }}>Estates</span>
        </div>
        <div style={{ width:1, height:24, background:'var(--border)', marginRight:20, flexShrink:0 }} />
        <div style={{ fontSize:13, fontWeight:500, color:'var(--gray)', flex:1 }}>{project.name}</div>
        <div style={{ marginRight:24, flexShrink:0, textAlign:'right' }}>
          <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:1 }}>Your Cost</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:300, color:'var(--gold)', lineHeight:1 }}>{t.yourCost > 0 ? formatCurrency(t.yourCost) : '—'}</div>
        </div>
        <div style={{ marginRight:24, flexShrink:0, textAlign:'right' }}>
          <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:1 }}>Client Total</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:300, color:'var(--black)', lineHeight:1 }}>{t.clientTotal > 0 ? formatCurrency(t.clientTotal) : '—'}</div>
        </div>
        <div style={{ marginRight:24, flexShrink:0, textAlign:'right' }}>
          <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:1 }}>Profit</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:300, color:'var(--success)', lineHeight:1 }}>{t.profit > 0 ? formatCurrency(t.profit) : '—'}</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0, marginRight:20 }}>
          <div style={{ width:100, height:2, background:'var(--border)', borderRadius:1, overflow:'hidden' }}>
            <div style={{ height:'100%', background:'var(--black)', width:`${pct}%`, borderRadius:1, transition:'width 0.5s' }} />
          </div>
          <div style={{ fontSize:11, fontWeight:500, color:'var(--gray)', whiteSpace:'nowrap' }}>{t.approved} / {t.totalItems} approved</div>
        </div>
        {/* Export buttons */}
        <div style={{ display:'flex', gap:8, flexShrink:0 }}>
          <button className="btn btn-outline btn-sm" onClick={exportCSV}>Export CSV</button>
          <button className="btn btn-black btn-sm" onClick={exportPDF}>Export PDF</button>
        </div>
      </div>

      {/* HERO */}
      <div style={{ padding:'48px 56px 36px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'flex-end', justifyContent:'space-between', flexWrap:'wrap', gap:32 }}>
        <div>
          <div className="page-eyebrow">Material Pricing Review</div>
          <div className="page-title">{project.name.split(' ').slice(0,2).join(' ')}<br/><em>{project.name.split(' ').slice(2).join(' ') || project.client}</em></div>
          <div style={{ fontSize:13, fontWeight:400, color:'var(--gray)', marginTop:12, lineHeight:1.6 }}>
            {schedules.reduce((a,s)=>a+(s.items?.length||0),0)} total line items · {project.categories?.length} categories · Prices shown per square foot
          </div>
        </div>
        <div style={{ display:'flex', border:'1px solid var(--border)', flexWrap:'wrap' }}>
          {[
            { val:t.totalItems, label:'Total Items' },
            { val:t.approved, label:'Approved', color:'var(--success)' },
            { val:t.rejected, label:'Rejected', color:'var(--danger)' },
            { val:t.yourCost > 0 ? formatCurrency(t.yourCost) : '—', label:'Your Cost', color:'var(--gold)', sm:true },
            { val:t.clientTotal > 0 ? formatCurrency(t.clientTotal) : '—', label:'Client Total', color:'var(--black)', sm:true },
            { val:t.profit > 0 ? formatCurrency(t.profit) : '—', label:'Profit', color:'var(--success)', sm:true },
          ].map((s,i,arr) => (
            <div key={i} style={{ padding:'16px 24px', textAlign:'center', borderRight:i<arr.length-1?'1px solid var(--border)':'none' }}>
              <div style={{ fontFamily:'var(--font-display)', fontSize:s.sm?22:32, fontWeight:200, color:s.color||'var(--black)', lineHeight:1 }}>{s.val}</div>
              <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--gray-light)', marginTop:5 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* BULK APPROVE STRIP */}
      <div style={{ background:'var(--white)', borderBottom:'1px solid var(--border)', padding:'10px 56px', display:'flex', alignItems:'center', gap:16 }}>
        <span style={{ fontSize:11, fontWeight:600, color:'var(--gray-light)', letterSpacing:'0.06em' }}>Quick actions:</span>
        <button className="btn btn-outline btn-sm" onClick={() => {
          if (!activeSched) return
          activeSched.items.forEach(item => {
            const k = `${activeCategory}|||${item.key}`
            const ap = approvals[k] || {}
            saveApproval(activeCategory, item.key, 'approved', parseFloat(quantities[k] || ap.quantity || 0), ap.notes || '', ap.shipping_ddp, ap.markup_override)
          })
        }}>Approve All Visible</button>
        <button className="btn btn-outline btn-sm" onClick={() => {
          if (!activeSched) return
          activeSched.items.forEach(item => {
            const k = `${activeCategory}|||${item.key}`
            const ap = approvals[k] || {}
            saveApproval(activeCategory, item.key, 'pending', parseFloat(quantities[k] || ap.quantity || 0), ap.notes || '', ap.shipping_ddp, ap.markup_override)
          })
        }}>Reset All</button>
        <div style={{ marginLeft:'auto', fontSize:11, fontWeight:400, color:'var(--gray-light)' }}>
          Tab through rows · Space to approve · X to reject
        </div>
      </div>

      {/* CATEGORY TABS — sticky below top bar */}
      <div style={{ position:'sticky', top:64, zIndex:100, background:'var(--white)', borderBottom:'1px solid var(--border)', overflowX:'auto' }}>
        <div style={{ display:'flex', minWidth:'max-content' }}>
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
                const low = getLowestPriceSqft(catSubs, i)
                const econ = getLineEconomics(low, ap)
                if (econ.totalCostSqft != null && qty) catCost += econ.totalCostSqft * qty
              }
            })
            const isActive = activeCategory === catId
            return (
              <div key={catId} onClick={() => setActiveCategory(catId)} style={{ padding:'14px 28px', cursor:'pointer', borderBottom:isActive?'2px solid var(--black)':'2px solid transparent', background:isActive?'var(--off-white)':'transparent', transition:'all 0.15s', minWidth:160 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                  <span style={{ fontSize:14, color:isActive?'var(--gold)':'var(--gray-light)' }}>{catDef?.icon}</span>
                  <span style={{ fontSize:11, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:isActive?'var(--black)':'var(--gray)' }}>{catDef?.label || catId}</span>
                </div>
                <div style={{ fontSize:11, fontWeight:400, color:'var(--gray-light)' }}>
                  {catApproved}/{items.length} approved{catCost > 0 ? ` · ${formatCurrency(catCost)}` : ''}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* CATEGORY DETAIL — top offset accounts for both sticky bars */}
      <div style={{ padding:'0 40px 80px' }}>
        {activeSched && activeCatDef ? (
          <CategoryDetail
            schedule={activeSched}
            category={activeCatDef}
            submissions={activeCatSubs}
            approvals={approvals}
            quantities={quantities}
            onApprove={(itemKey, status, notes) => {
              const k = `${activeCategory}|||${itemKey}`
              const ap = approvals[k] || {}
              const qty = parseFloat(quantities[k] || ap.quantity || 0)
              saveApproval(activeCategory, itemKey, status, qty, notes, ap.shipping_ddp, ap.markup_override)
            }}
            onQtyChange={(itemKey, qty) => {
              const k = `${activeCategory}|||${itemKey}`
              setQuantities(prev => ({ ...prev, [k]: qty }))
              const ap = approvals[k] || {}
              saveApproval(activeCategory, itemKey, ap.status || 'pending', qty, ap.notes || '', ap.shipping_ddp, ap.markup_override)
            }}
            onNoteChange={(itemKey, notes) => {
              const k = `${activeCategory}|||${itemKey}`
              const ap = approvals[k] || {}
              const qty = parseFloat(quantities[k] || ap.quantity || 0)
              saveApproval(activeCategory, itemKey, ap.status || 'pending', qty, notes, ap.shipping_ddp, ap.markup_override)
            }}
            onDdpChange={(itemKey, ddp) => {
              const k = `${activeCategory}|||${itemKey}`
              const ap = approvals[k] || {}
              const qty = parseFloat(quantities[k] || ap.quantity || 0)
              saveApproval(activeCategory, itemKey, ap.status || 'pending', qty, ap.notes || '', ddp, ap.markup_override)
            }}
            onMarkupChange={(itemKey, markup) => {
              const k = `${activeCategory}|||${itemKey}`
              const ap = approvals[k] || {}
              const qty = parseFloat(quantities[k] || ap.quantity || 0)
              saveApproval(activeCategory, itemKey, ap.status || 'pending', qty, ap.notes || '', ap.shipping_ddp, markup)
            }}
            getLowestPriceSqft={getLowestPriceSqft}
            getLineEconomics={getLineEconomics}
            projectSlug={slug}
            activeCategory={activeCategory}
            onOpenLightbox={(images, index) => setLightbox({ images, index })}
            onImportCSV={() => setImportModal({ schedule: activeSched, category: activeCatDef })}
            onAddItem={() => setAddItemModal({ schedule: activeSched, category: activeCatDef })}
          />
        ) : (
          <div className="empty-state"><div className="empty-state-title">No schedule uploaded</div><div className="empty-state-sub">Upload a CSV for this category in the admin.</div></div>
        )}
      </div>

      {/* LIGHTBOX */}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.92)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div onClick={e => e.stopPropagation()} style={{ position:'relative', maxWidth:900, width:'100%' }}>
            <img src={lightbox.images[lightbox.index].url} alt="" style={{ width:'100%', maxHeight:'80vh', objectFit:'contain', display:'block' }}/>
            <div style={{ position:'absolute', top:-40, right:0, display:'flex', gap:12, alignItems:'center' }}>
              <span style={{ fontSize:11, color:'rgba(255,255,255,0.5)' }}>{lightbox.index+1} / {lightbox.images.length}</span>
              <button onClick={() => setLightbox(null)} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:24, cursor:'pointer', lineHeight:1 }}>✕</button>
            </div>
            {lightbox.images.length > 1 && (
              <>
                <button onClick={() => setLightbox(l => ({ ...l, index: (l.index - 1 + l.images.length) % l.images.length }))}
                  style={{ position:'absolute', left:-48, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:28, cursor:'pointer' }}>‹</button>
                <button onClick={() => setLightbox(l => ({ ...l, index: (l.index + 1) % l.images.length }))}
                  style={{ position:'absolute', right:-48, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:28, cursor:'pointer' }}>›</button>
              </>
            )}
            <div style={{ display:'flex', gap:6, marginTop:10, justifyContent:'center', flexWrap:'wrap' }}>
              {lightbox.images.map((img, idx) => (
                <img key={idx} src={img.url} alt="" onClick={() => setLightbox(l => ({ ...l, index: idx }))}
                  style={{ width:48, height:48, objectFit:'cover', cursor:'pointer', border:`2px solid ${idx===lightbox.index?'white':'transparent'}`, opacity:idx===lightbox.index?1:0.5, transition:'all 0.15s' }}/>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* IMPORT CSV MODAL */}
      {importModal && (
        <ImportCSVModal
          schedule={importModal.schedule}
          category={importModal.category}
          submissions={activeCatSubs}
          projectSlug={slug}
          onClose={() => setImportModal(null)}
          onImported={() => { setImportModal(null); loadAll() }}
        />
      )}

      {/* ADD MATERIAL MODAL */}
      {addItemModal && (
        <AddItemModal
          schedule={addItemModal.schedule}
          category={addItemModal.category}
          projectSlug={slug}
          onClose={() => setAddItemModal(null)}
          onAdded={() => { setAddItemModal(null); loadAll() }}
        />
      )}

      {/* FOOTER */}
      <div style={{ borderTop:'2px solid var(--black)', padding:'40px 56px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:24, background:'var(--off-white)' }}>
        <div style={{ display:'flex', gap:0, flexWrap:'wrap' }}>
          {[
            { val:t.totalItems, label:'Total Materials' },
            { val:t.approved, label:'Approved', color:'var(--success)' },
            { val:t.rejected, label:'Rejected', color:'var(--danger)' },
            { val:t.yourCost > 0 ? formatCurrency(t.yourCost) : '—', label:'Your Cost', color:'var(--gold)' },
            { val:t.clientTotal > 0 ? formatCurrency(t.clientTotal) : '—', label:'Client Total', color:'var(--black)' },
            { val:t.profit > 0 ? formatCurrency(t.profit) : '—', label:'Profit', color:'var(--success)' },
          ].map((s,i,arr) => (
            <div key={i} style={{ paddingRight:40, marginRight:40, borderRight:i<arr.length-1?'1px solid var(--border)':'none' }}>
              <div style={{ fontFamily:'var(--font-display)', fontSize:36, fontWeight:200, color:s.color||'var(--black)', lineHeight:1 }}>{s.val}</div>
              <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--gray-light)', marginTop:5 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <button className="btn btn-outline btn-lg" onClick={exportCSV}>Export CSV</button>
          <button className="btn btn-black btn-lg" onClick={exportPDF}>Export PDF →</button>
        </div>
      </div>
    </div>
  )
}

// ── Category Detail Table ──────────────────────────────────
function CategoryDetail({ schedule, category, submissions, approvals, quantities, onApprove, onQtyChange, onNoteChange, onDdpChange, onMarkupChange, getLowestPriceSqft, getLineEconomics, projectSlug, activeCategory, onOpenLightbox, onImportCSV, onAddItem }) {
  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'24px 0 16px', borderBottom:'2px solid var(--black)', flexWrap:'wrap', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:13, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase' }}>{category.label} Schedule</span>
          <span style={{ fontSize:12, fontWeight:400, color:'var(--gray-light)' }}>{schedule.items.length} items</span>
          {schedule.manufacturer && (
            <div style={{ padding:'3px 10px', fontSize:9, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', background:'var(--gold-pale)', color:'var(--gold)', border:'1px solid rgba(154,122,74,0.2)' }}>
              {schedule.manufacturer}
            </div>
          )}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-outline btn-sm" onClick={onAddItem}>+ Add {category.id === 'doors' ? 'Door' : 'Material'}</button>
          <button className="btn btn-outline btn-sm" onClick={onImportCSV}>Import Manufacturer CSV</button>
          <button className="btn btn-outline btn-sm" onClick={() => {
            const realSlug = window.location.pathname.split('/').filter(Boolean)[1]
            const url = `${window.location.origin}/projects/${realSlug}/form/${activeCategory}`
            navigator.clipboard?.writeText(url)
            alert('Form link copied to clipboard:\n\n' + url)
          }}>Copy Form Link</button>
        </div>
      </div>

      {submissions.length === 0 && (
        <div style={{ padding:'16px 20px', background:'var(--gold-pale)', border:'1px solid rgba(154,122,74,0.2)', marginTop:16, marginBottom:0, fontSize:12, fontWeight:400, color:'var(--gray)' }}>
          No pricing received yet. Copy the form link above and send it to {schedule.manufacturer || 'your manufacturer'}.
        </div>
      )}

      <div style={{ overflowX:'auto', marginTop:0 }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            {category.id === 'doors' ? (
              <tr>
                <th style={th('70px')}>NO</th>
                <th style={th('140px')}>Location</th>
                <th style={th('180px')}>Description</th>
                <th style={th('100px')}>Size</th>
                <th style={th('110px')}>Door Type</th>
                <th style={th('72px')}>Images</th>
                {submissions.map(sub => (
                  <th key={sub.id} style={{ ...th('140px'), color:'var(--gold)', background:'var(--gold-pale)', borderLeft:'1px solid var(--border)' }}>
                    {sub.manufacturer_name}<br/>
                    <span style={{ fontSize:9, fontWeight:400, color:'var(--gold-light)' }}>
                      {new Date(sub.submitted_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                    </span>
                  </th>
                ))}
                <th style={th('60px')}>Qty</th>
                <th style={th('100px')}>Amount</th>
                <th style={th('80px')}>Margin</th>
                <th style={th('100px')}>Total Price</th>
                <th style={th('140px')}>Approval</th>
                <th style={th('180px')}>Notes</th>
              </tr>
            ) : (
              <tr>
                <th style={th('220px')}>Material</th>
                <th style={th('72px')}>Images</th>
                {submissions.map(sub => (
                  <th key={sub.id} style={{ ...th('160px'), color:'var(--gold)', background:'var(--gold-pale)', borderLeft:'1px solid var(--border)' }}>
                    {sub.manufacturer_name}<br/>
                    <span style={{ fontSize:9, fontWeight:400, color:'var(--gold-light)' }}>
                      {new Date(sub.submitted_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                    </span>
                  </th>
                ))}
                <th style={th('100px')}>Qty (sqft)</th>
                <th style={th('110px')}>DDP / Shipping</th>
                <th style={th('120px')}>Your Cost</th>
                <th style={th('110px')}>Markup</th>
                <th style={th('120px')}>Client Total</th>
                <th style={th('140px')}>Approval</th>
                <th style={th('180px')}>Notes</th>
              </tr>
            )}
          </thead>
          <tbody>
            {schedule.items.map((item, i) => {
              const k = `${schedule.category}|||${item.key}`
              const ap = approvals[k] || { status:'pending', notes:'' }
              const qty = parseFloat(quantities[k] || ap.quantity || 0)
              const low = getLowestPriceSqft(submissions, i)
              const econ = getLineEconomics(low, ap)
              const yourCostTotal = econ.totalCostSqft != null && qty ? econ.totalCostSqft * qty : null
              const clientTotalLine = econ.markupSqft != null && qty ? econ.markupSqft * qty : null

              // Door-specific pricing: read directly from lowest submission data
              const doorLow = category.id === 'doors' ? (() => {
                let best = null
                submissions.forEach(sub => {
                  const d = sub.pricing_data?.[i]
                  if (!d) return
                  const price = parseFloat(d.unitPrice || 0)
                  if (price > 0 && (!best || price < best.unitPrice)) best = { ...d, unitPrice: price, manufacturer: sub.manufacturer_name }
                })
                return best
              })() : null

              return (
                <tr key={i} style={{ background: ap.status==='approved'?'var(--success-bg)': ap.status==='rejected'?'var(--danger-bg)':'transparent', opacity:ap.status==='rejected'?0.6:1 }}>

                  {category.id === 'doors' ? (
                    <>
                      <td style={td()}><div style={{ fontSize:13, fontWeight:700, color:'var(--black)' }}>{item.no}</div></td>
                      <td style={td()}><div style={{ fontSize:12, fontWeight:500, color:'var(--gray)' }}>{item.location || '—'}</div></td>
                      <td style={td()}>
                        <div style={{ fontSize:11, color:'var(--gray)', lineHeight:1.5, maxHeight:60, overflow:'hidden', textOverflow:'ellipsis' }}
                          title={item.description || ''}>
                          {item.description ? item.description.substring(0, 120) + (item.description.length > 120 ? '…' : '') : '—'}
                        </div>
                      </td>
                      <td style={td()}>
                        <div style={{ fontSize:12, fontWeight:500, lineHeight:1.5 }}>
                          {item.widthInches && item.heightInches ? `${item.widthInches}" × ${item.heightInches}"` : '—'}
                          {item.thickMm && <div style={{ fontSize:10, color:'var(--gray-light)' }}>{item.thickMm} thick</div>}
                        </div>
                      </td>
                      <td style={td()}><div style={{ fontSize:12, fontWeight:500, color:'var(--gold)' }}>{item.type || '—'}</div></td>
                    </>
                  ) : (
                    <td style={td()}><MaterialCell item={item} /></td>
                  )}

                  <td style={td()}>
                    {(() => {
                      const allImgs = submissions.flatMap(sub => {
                        const d = sub.pricing_data?.[i]
                        const imgs = d?.images || []
                        const designs = d?.designOptions || []
                        return [...imgs, ...designs]
                      }).filter(img => img?.url)
                      if (!allImgs.length) return (
                        <div style={{ width:44, height:44, background:'var(--cream)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gray-light)" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        </div>
                      )
                      return (
                        <div style={{ display:'flex', gap:3, flexWrap:'wrap', maxWidth:100 }}>
                          {allImgs.slice(0,3).map((img, idx) => (
                            <img key={idx} src={img.url} alt="" onClick={() => onOpenLightbox(allImgs, idx)}
                              style={{ width:44, height:44, objectFit:'cover', border:'1px solid var(--border)', cursor:'pointer', transition:'opacity 0.15s' }}
                              onMouseEnter={e=>e.target.style.opacity='0.75'} onMouseLeave={e=>e.target.style.opacity='1'}
                            />
                          ))}
                          {allImgs.length > 3 && (
                            <div onClick={() => onOpenLightbox(allImgs, 3)}
                              style={{ width:44, height:44, background:'var(--cream)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', fontSize:10, fontWeight:600, color:'var(--gray)' }}>
                              +{allImgs.length-3}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </td>

                  {submissions.map(sub => {
                    const d = sub.pricing_data?.[i]
                    const pd = category.dashboardPriceDisplay(d || {})
                    if (category.id === 'doors') {
                      const unitP = d?.unitPrice ? parseFloat(d.unitPrice) : null
                      const totalP = d?.totalPrice ? parseFloat(d.totalPrice) : null
                      const isLow = doorLow && sub.manufacturer_name === doorLow.manufacturer
                      return (
                        <td key={sub.id} style={{ ...td(), borderLeft:'1px solid var(--border)', background:'rgba(242,234,216,0.25)' }}>
                          {unitP ? (
                            <div>
                              <div style={{ fontSize:15, fontWeight:600, color:isLow?'var(--black)':'var(--gray)', lineHeight:1.3 }}>
                                {formatCurrency(unitP)}/unit
                              </div>
                              {totalP && <div style={{ fontSize:10, color:'var(--gold)', marginTop:2 }}>Total: {formatCurrency(totalP)}</div>}
                              {d?.designOptions?.length > 0 && (
                                <div style={{ fontSize:9, color:'var(--gray-light)', marginTop:3 }}>
                                  {d.designOptions.length} design option{d.designOptions.length !== 1 ? 's' : ''}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ fontSize:12, fontStyle:'italic', color:'rgba(0,0,0,0.2)' }}>Awaiting quote</span>
                          )}
                        </td>
                      )
                    }
                    const isLow = low && sub.manufacturer_name === low.manufacturer
                    const sqftPrice = d?.priceSqm ? (parseFloat(d.priceSqm) / SQM_TO_SQFT).toFixed(2) : null
                    return (
                      <td key={sub.id} style={{ ...td(), borderLeft:'1px solid var(--border)', background:'rgba(242,234,216,0.25)' }}>
                        {d && (d.priceSqm || d.pricePerUnit) ? (
                          <div>
                            <div style={{ fontSize:15, fontWeight:600, color:isLow?'var(--black)':'var(--gray)', lineHeight:1.3 }}>
                              {sqftPrice ? `$${sqftPrice}/sqft` : pd.primary || '—'}
                            </div>
                            {d.priceSqm && <div style={{ fontSize:10, color:'var(--gray-light)', marginTop:2 }}>${parseFloat(d.priceSqm).toFixed(2)}/sqm</div>}
                            {pd.volume && <div style={{ fontSize:10, color:'var(--gold)', marginTop:2 }}>{pd.volume}</div>}
                            {pd.moq && <div style={{ fontSize:10, color:'var(--gray-light)', marginTop:1 }}>{pd.moq}</div>}
                          </div>
                        ) : (
                          <span style={{ fontSize:12, fontStyle:'italic', color:'rgba(0,0,0,0.2)' }}>Awaiting quote</span>
                        )}
                      </td>
                    )
                  })}

                  {category.id === 'doors' ? (
                    <>
                      <td style={td()}>
                        <div style={{ fontSize:14, fontWeight:600 }}>{doorLow?.qty || item.qty || '—'}</div>
                      </td>
                      <td style={td()}>
                        <div style={{ fontSize:14, fontWeight:600, color:'var(--gold)' }}>
                          {doorLow?.amount ? formatCurrency(parseFloat(doorLow.amount)) : '—'}
                        </div>
                        <div style={{ fontSize:9, color:'var(--gray-light)' }}>EXW</div>
                      </td>
                      <td style={td()}>
                        {(() => {
                          const defaultMargin = doorLow?.margin ? parseFloat(doorLow.margin) * 100 : 10
                          const hasOverride = ap.markup_override != null && ap.markup_override !== ''
                          const displayVal = hasOverride ? ap.markup_override : defaultMargin
                          return (
                            <div>
                              <div style={{ display:'flex', alignItems:'baseline', gap:2 }}>
                                <input type="number" min="0" max="100" step="1" placeholder={defaultMargin}
                                  value={displayVal}
                                  onChange={e => onMarkupChange(item.key, e.target.value === '' ? null : parseFloat(e.target.value))}
                                  style={{ width:50, padding:'6px 0', fontFamily:'var(--font-body)', fontSize:13, fontWeight:500, background:'transparent', border:'none', borderBottom:`1px solid ${hasOverride?'var(--gold)':'var(--border)'}`, color: hasOverride ? 'var(--gold)' : 'var(--black)', textAlign:'left', transition:'border-color 0.2s' }}
                                  onFocus={e=>e.target.style.borderBottomColor='var(--gold)'}
                                  onBlur={e=>e.target.style.borderBottomColor=hasOverride?'var(--gold)':'var(--border)'}
                                />
                                <span style={{ fontSize:12, color:'var(--gray-light)' }}>%</span>
                              </div>
                              {hasOverride && (
                                <button onClick={() => onMarkupChange(item.key, null)} style={{ fontSize:9, color:'var(--gold)', background:'none', border:'none', cursor:'pointer', padding:0, marginTop:3, textDecoration:'underline' }}>
                                  reset to {defaultMargin}%
                                </button>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                      <td style={td()}>
                        {(() => {
                          const amt = doorLow?.amount ? parseFloat(doorLow.amount) : null
                          if (!amt) return <div style={{ fontSize:16, fontWeight:600, color:'var(--black)' }}>—</div>
                          const defaultMargin = doorLow?.margin ? parseFloat(doorLow.margin) : 0.10
                          const marginPct = ap.markup_override != null && ap.markup_override !== '' ? parseFloat(ap.markup_override) / 100 : defaultMargin
                          const total = amt * (1 + marginPct)
                          return (
                            <div style={{ fontSize:16, fontWeight:600, color:'var(--black)' }}>
                              {formatCurrency(total)}
                            </div>
                          )
                        })()}
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={td()}>
                        <input type="number" min="0" placeholder="0" value={quantities[k] || ap.quantity || ''} onChange={e => onQtyChange(item.key, parseFloat(e.target.value)||0)}
                          style={{ width:72, padding:'6px 0', fontFamily:'var(--font-body)', fontSize:16, fontWeight:500, background:'transparent', border:'none', borderBottom:'1px solid var(--border)', color:'var(--black)', textAlign:'left', transition:'border-color 0.2s' }}
                          onFocus={e=>e.target.style.borderBottomColor='var(--gold)'}
                          onBlur={e=>e.target.style.borderBottomColor='var(--border)'}
                        />
                      </td>
                      <td style={td()}>
                        <input type="number" min="0" step="0.01" placeholder="0.00" value={ap.shipping_ddp || ''} onChange={e => onDdpChange(item.key, parseFloat(e.target.value)||0)}
                          style={{ width:80, padding:'6px 0', fontFamily:'var(--font-body)', fontSize:13, fontWeight:500, background:'transparent', border:'none', borderBottom:'1px solid var(--border)', color:'var(--black)', textAlign:'left', transition:'border-color 0.2s' }}
                          onFocus={e=>e.target.style.borderBottomColor='var(--gold)'}
                          onBlur={e=>e.target.style.borderBottomColor='var(--border)'}
                        />
                        <div style={{ fontSize:9, color:'var(--gray-light)', marginTop:2 }}>$/sqft</div>
                      </td>
                      <td style={td()}>
                        <div style={{ fontSize:16, fontWeight:600, color:'var(--gold)', whiteSpace:'nowrap' }}>
                          {yourCostTotal ? formatCurrency(yourCostTotal) : '—'}
                        </div>
                        {econ.totalCostSqft != null && <div style={{ fontSize:9, color:'var(--gray-light)', marginTop:2 }}>${econ.totalCostSqft}/sqft</div>}
                      </td>
                      <td style={td()}>
                        <input type="number" min="0" step="0.01" placeholder="0.00"
                          value={econ.hasOverride ? ap.markup_override : (econ.autoMarkupSqft ?? '')}
                          onChange={e => onMarkupChange(item.key, e.target.value === '' ? null : parseFloat(e.target.value))}
                          style={{ width:80, padding:'6px 0', fontFamily:'var(--font-body)', fontSize:13, fontWeight:500, background:'transparent', border:'none', borderBottom:`1px solid ${econ.hasOverride?'var(--gold)':'var(--border)'}`, color: econ.hasOverride ? 'var(--gold)' : 'var(--black)', textAlign:'left', transition:'border-color 0.2s' }}
                          onFocus={e=>e.target.style.borderBottomColor='var(--gold)'}
                          onBlur={e=>e.target.style.borderBottomColor=econ.hasOverride?'var(--gold)':'var(--border)'}
                        />
                        <div style={{ fontSize:9, color:'var(--gray-light)', marginTop:2 }}>
                          $/sqft{econ.hasOverride && (
                            <button onClick={() => onMarkupChange(item.key, null)} style={{ marginLeft:6, fontSize:9, color:'var(--gold)', background:'none', border:'none', cursor:'pointer', padding:0, textDecoration:'underline' }}>
                              reset to auto
                            </button>
                          )}
                        </div>
                      </td>
                      <td style={td()}>
                        <div style={{ fontSize:16, fontWeight:600, color:'var(--black)', whiteSpace:'nowrap' }}>
                          {clientTotalLine ? formatCurrency(clientTotalLine) : '—'}
                        </div>
                      </td>
                    </>
                  )}

                  <td style={td()}>
                    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                      <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.14em', textTransform:'uppercase', padding:'3px 8px', border:'1px solid', display:'inline-block', width:'fit-content', ...(ap.status==='approved'?{borderColor:'var(--success)',color:'var(--success)',background:'var(--success-bg)'}:ap.status==='rejected'?{borderColor:'var(--danger)',color:'var(--danger)',background:'var(--danger-bg)'}:{borderColor:'var(--border-dark)',color:'var(--gray-light)'}) }}>
                        {ap.status}
                      </div>
                      <div style={{ display:'flex', gap:4 }}>
                        {['approved','rejected'].map(s => (
                          <button key={s} onClick={() => onApprove(item.key, ap.status===s?'pending':s, ap.notes)}
                            style={{ padding:'5px 10px', fontSize:9, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', cursor:'pointer', border:'1px solid', transition:'all 0.15s', ...(ap.status===s ? s==='approved'?{background:'var(--black)',color:'var(--off-white)',borderColor:'var(--black)'}:{background:'var(--danger)',color:'white',borderColor:'var(--danger)'}:{background:'transparent',color:'var(--gray)',borderColor:'var(--border-dark)'}) }}>
                            {s==='approved'?'✓':'✕'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </td>
                  <td style={td()}>
                    <textarea value={ap.notes||''} onChange={e=>onNoteChange(item.key,e.target.value)} placeholder="Add a note…" rows={2}
                      style={{ width:'100%', padding:'5px 0', fontFamily:'var(--font-body)', fontSize:12, fontWeight:400, background:'transparent', border:'none', borderBottom:'1px solid transparent', color:'var(--gray)', resize:'none', transition:'border-color 0.2s' }}
                      onFocus={e=>e.target.style.borderBottomColor='var(--border)'}
                      onBlur={e=>e.target.style.borderBottomColor='transparent'}
                    />
                    {ap.client_notes && (
                      <div style={{ fontSize:11, fontStyle:'italic', color:'var(--gold)', marginTop:4, padding:'6px 8px', background:'var(--gold-pale)', borderLeft:'2px solid var(--gold-light)' }}>
                        <span style={{ fontWeight:600, fontStyle:'normal', fontSize:9, letterSpacing:'0.06em', textTransform:'uppercase', display:'block', marginBottom:2 }}>Client note</span>
                        {ap.client_notes}
                      </div>
                    )}
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

// ── Import Manufacturer CSV Modal ──────────────────────────
// For manufacturers who send pricing back in their own spreadsheet rather
// than using the web form. The team uploads it and manually maps the
// manufacturer's columns to the fields this category needs — there's no
// fixed template to match, since every manufacturer formats things
// differently.
function ImportCSVModal({ schedule, category, submissions, projectSlug, onClose, onImported }) {
  const [step, setStep] = useState(1) // 1: upload, 2: mapping, 3: result
  const [manufacturer, setManufacturer] = useState(schedule.manufacturer || '')
  const [csvHeaders, setCsvHeaders] = useState([])
  const [csvRows, setCsvRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  // Fields we need mapped: identification fields (used to match a CSV row
  // to a schedule item) plus the category's price fields. A field can be
  // both (e.g. "material" doubles as an ID field and a stored value).
  const fieldDefs = {}
  category.itemKeyFields.forEach(f => {
    fieldDefs[f] = { id: f, label: f.charAt(0).toUpperCase() + f.slice(1), matching: true }
  })
  category.formFields.filter(f => f.type !== 'calculated' && f.type !== 'images').forEach(f => {
    fieldDefs[f.id] = { ...(fieldDefs[f.id] || {}), id: f.id, label: f.label, pricing: true, required: f.required }
  })
  const targetFields = Object.values(fieldDefs)

  function guessColumn(field, headers) {
    const aliases = category.csvColumns?.[field.id] || []
    const candidates = [field.id, field.label, ...aliases]
    const lower = headers.map(h => h.toLowerCase())
    for (const cand of candidates) {
      const idx = lower.findIndex(h => h.includes(cand.toLowerCase()))
      if (idx >= 0) return headers[idx]
    }
    return ''
  }

  function handleFile(file) {
    setError('')
    const reader = new FileReader()
    reader.onload = (e) => {
      const parsed = Papa.parse(e.target.result, { header: true, skipEmptyLines: true })
      const headers = parsed.meta?.fields || []
      if (!headers.length) { setError('Could not read any columns from that file.'); return }
      setCsvHeaders(headers)
      setCsvRows(parsed.data)
      const guessed = {}
      targetFields.forEach(f => { guessed[f.id] = guessColumn(f, headers) })
      setMapping(guessed)
      setStep(2)
    }
    reader.readAsText(file)
  }

  // CSV rows can't carry photos, and the schedule item itself never has any
  // (images only ever live on a submission). Without this, importing a CSV
  // price for a material that a manufacturer already photographed via the
  // web form would silently wipe those photos the moment this becomes the
  // lowest (displayed) price. So: look at what's already on file for this
  // item across existing submissions, preferring whichever one is currently
  // cheapest (matching what's shown today), falling back to any submission
  // that has photos if the cheapest one doesn't.
  function existingImagesFor(index) {
    let best = null
    let anyWithImages = null
    submissions.forEach(sub => {
      const data = sub.pricing_data?.[index]
      if (!data) return
      const price = parseFloat(data.priceSqm || data.pricePerUnit || data.pricePerLinFt || data.unitPrice || 0)
      if (price > 0 && (!best || price < best.price)) best = { price, images: data.images }
      if (!anyWithImages && (data.images || []).length) anyWithImages = data.images
    })
    if (best?.images?.length) return best.images
    return anyWithImages || []
  }

  async function handleImport() {
    const idFields = category.itemKeyFields
    if (idFields.some(f => !mapping[f])) {
      setError('Map every identification field above before importing — that\u2019s what matches their rows to your materials.')
      return
    }
    setImporting(true)
    setError('')

    const csvKeyToRow = {}
    csvRows.forEach(row => {
      const key = idFields.map(f => (row[mapping[f]] || '').trim()).join('|||')
      if (key.replace(/\|/g, '').trim()) csvKeyToRow[key] = row
    })

    let matched = 0
    const priceFields = category.formFields.filter(f => f.type !== 'calculated' && f.type !== 'images')
    const pricingData = schedule.items.map((item, i) => {
      const row = csvKeyToRow[item.key]
      if (!row) return { ...item }
      matched++
      const fields = {}
      priceFields.forEach(f => {
        const col = mapping[f.id]
        if (col && row[col] !== undefined && row[col] !== '') fields[f.id] = row[col]
      })
      if (fields.priceSqm) fields.priceSqft = parseFloat((parseFloat(fields.priceSqm) / SQM_TO_SQFT).toFixed(2))
      return { ...item, ...fields, images: existingImagesFor(i) }
    })

    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectSlug, category: category.id,
        manufacturerName: manufacturer.trim() || schedule.manufacturer || 'Imported',
        pricingData,
        isDraft: true, // skip the notification email — this is an internal import, not a real manufacturer submission
      }),
    })

    setImporting(false)
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Import failed.'); return }
    setResult({ matched, total: schedule.items.length, unmatched: csvRows.length - matched })
    setStep(3)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Import Manufacturer CSV</div>
            <div style={{ fontSize:11, fontWeight:300, color:'var(--gray)', marginTop:4 }}>{category.label} — Step {step} of 3</div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && (
            <div style={{ padding:'10px 14px', background:'var(--danger-bg)', border:'1px solid var(--danger)', fontSize:12, color:'var(--danger)', marginBottom:20 }}>{error}</div>
          )}

          {step === 1 && (
            <div>
              <div style={{ fontSize:12, fontWeight:400, color:'var(--gray)', marginBottom:20, lineHeight:1.6 }}>
                For manufacturers who send pricing back in their own spreadsheet instead of using the web form. Upload it here, then map their columns to the fields you need on the next step.
              </div>
              <div style={{ marginBottom:20 }}>
                <label className="field-label">Manufacturer Name</label>
                <input className="field-input" value={manufacturer} onChange={e => setManufacturer(e.target.value)} placeholder="e.g. Stone Source International" />
              </div>
              <div>
                <label className="field-label">CSV File</label>
                <label style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px', border:'1px dashed var(--border-dark)', cursor:'pointer', background:'var(--cream)', fontSize:12, fontWeight:400, color:'var(--gray)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  Upload CSV from the manufacturer
                  <input type="file" accept=".csv,.txt" style={{ display:'none' }} onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
                </label>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div style={{ fontSize:12, fontWeight:400, color:'var(--gray)', marginBottom:16, lineHeight:1.6 }}>
                Match each field below to a column from their CSV. Fields marked <span style={{ color:'var(--gold)', fontWeight:600 }}>match</span> are used to line their rows up with your materials — map at least one (ideally all) to avoid mismatches.
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {targetFields.map(f => (
                  <div key={f.id} style={{ display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ width:170, flexShrink:0 }}>
                      <div style={{ fontSize:12, fontWeight:500, color:'var(--black)' }}>{f.label}</div>
                      <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--gray-light)', display:'flex', gap:6, marginTop:2 }}>
                        {f.matching && <span style={{ color:'var(--gold)' }}>match</span>}
                        {f.required && <span>required</span>}
                      </div>
                    </div>
                    <select className="field-input" value={mapping[f.id] || ''} onChange={e => setMapping(prev => ({ ...prev, [f.id]: e.target.value }))} style={{ flex:1 }}>
                      <option value="">— Not in this CSV —</option>
                      {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div style={{ fontSize:11, fontWeight:400, color:'var(--gray-light)', marginTop:16 }}>{csvRows.length} rows found in the uploaded file.</div>
            </div>
          )}

          {step === 3 && result && (
            <div style={{ textAlign:'center', padding:'20px 0' }}>
              <div style={{ fontFamily:'var(--font-display)', fontSize:32, fontWeight:300, color:'var(--success)', marginBottom:8 }}>Imported</div>
              <div style={{ fontSize:13, color:'var(--gray)', lineHeight:1.7 }}>
                Matched {result.matched} of {result.total} materials on your schedule.
                {result.unmatched > 0 && <><br/>{result.unmatched} row{result.unmatched !== 1 ? 's' : ''} in the CSV didn’t match any material — worth double-checking the identification mapping if that’s unexpected.</>}
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {step === 1 && <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>}
          {step === 2 && (
            <>
              <button className="btn btn-outline btn-sm" onClick={() => setStep(1)}>Back</button>
              <button className="btn btn-black btn-sm" onClick={handleImport} disabled={importing}>{importing ? 'Importing…' : 'Import Pricing'}</button>
            </>
          )}
          {step === 3 && <button className="btn btn-black btn-sm" onClick={onImported}>Done</button>}
        </div>
      </div>
    </div>
  )
}

function fieldLabel(key) {
  const overrides = { finish: 'Finish/Color' }
  return overrides[key] || key.charAt(0).toUpperCase() + key.slice(1)
}

function AddItemModal({ schedule, category, projectSlug, onClose, onAdded }) {
  const idFields = category.itemKeyFields
  const allFields = Object.keys(category.csvColumns || {})
  const [values, setValues] = useState(() => Object.fromEntries(allFields.map(f => [f, ''])))
  const [manufacturer, setManufacturer] = useState('')
  const [priceSqm, setPriceSqm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleAdd() {
    const missing = idFields.filter(f => !values[f]?.trim())
    if (missing.length) {
      setError(`Fill in ${missing.map(fieldLabel).join(', ')} — that\u2019s what identifies this as a distinct material.`)
      return
    }
    setSubmitting(true)
    setError('')

    const res = await fetch('/api/schedules/add-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectSlug, category: category.id, item: values }),
    })
    const data = await res.json()
    if (!res.ok) {
      setSubmitting(false)
      setError(data.error || 'Could not add this material.')
      return
    }

    // Optional immediate pricing — registers it the same way a manufacturer's
    // own submission would, just skipping the notification email. Submission
    // pricing_data is matched to schedule.items by ARRAY POSITION, not key,
    // so this has to be the full schedule (existing items passed through
    // unpriced) with the new item's price slotted in at the end, not a
    // one-item array on its own.
    const price = parseFloat(priceSqm)
    if (price > 0) {
      const priceSqft = parseFloat((price / SQM_TO_SQFT).toFixed(2))
      const fullItems = [...schedule.items, data.item]
      const pricingData = fullItems.map(it =>
        it.key === data.item.key ? { ...it, priceSqm: price, priceSqft, images: [] } : { ...it }
      )
      await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectSlug, category: category.id,
          manufacturerName: manufacturer.trim() || 'Manual Entry',
          pricingData,
          isDraft: true,
        }),
      })
    }

    setSubmitting(false)
    setDone(true)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Add Material</div>
            <div style={{ fontSize:11, fontWeight:300, color:'var(--gray)', marginTop:4 }}>{category.label} Schedule</div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && (
            <div style={{ padding:'10px 14px', background:'var(--danger-bg)', border:'1px solid var(--danger)', fontSize:12, color:'var(--danger)', marginBottom:20 }}>{error}</div>
          )}

          {done ? (
            <div style={{ textAlign:'center', padding:'20px 0' }}>
              <div style={{ fontFamily:'var(--font-display)', fontSize:32, fontWeight:300, color:'var(--success)', marginBottom:8 }}>Added</div>
              <div style={{ fontSize:13, color:'var(--gray)', lineHeight:1.7 }}>
                {values.name} is now on your {category.label.toLowerCase()} schedule.
                {parseFloat(priceSqm) > 0 ? ' Its price is already in.' : ' Add a price later via the manufacturer form or a CSV import.'}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize:12, fontWeight:400, color:'var(--gray)', marginBottom:20, lineHeight:1.6 }}>
                For a material that wasn’t on the original schedule — found in a new vendor quote, a late substitution, anything that needs its own line. Fields marked <span style={{ color:'var(--gold)', fontWeight:600 }}>required</span> are what makes it a distinct item.
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                {allFields.map(f => (
                  <div key={f}>
                    <label className="field-label">
                      {fieldLabel(f)}{idFields.includes(f) && <span style={{ color:'var(--gold)', fontWeight:600 }}> · required</span>}
                    </label>
                    <input className="field-input" value={values[f]} onChange={e => setValues(prev => ({ ...prev, [f]: e.target.value }))}
                      placeholder={idFields.includes(f) ? `e.g. ${fieldLabel(f)}` : 'Optional'} />
                  </div>
                ))}
              </div>
              <div style={{ borderTop:'1px solid var(--border)', marginTop:20, paddingTop:20 }}>
                <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:14 }}>
                  Price — optional, add now or later
                </div>
                <div style={{ display:'flex', gap:12 }}>
                  <div style={{ flex:1 }}>
                    <label className="field-label">Price per sqm (USD)</label>
                    <input className="field-input" type="number" step="0.01" value={priceSqm} onChange={e => setPriceSqm(e.target.value)} placeholder="0.00" />
                  </div>
                  <div style={{ flex:1 }}>
                    <label className="field-label">Source / Manufacturer</label>
                    <input className="field-input" value={manufacturer} onChange={e => setManufacturer(e.target.value)} placeholder="e.g. Stoneland" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {done ? (
            <button className="btn btn-black btn-sm" onClick={onAdded}>Done</button>
          ) : (
            <>
              <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
              <button className="btn btn-black btn-sm" onClick={handleAdd} disabled={submitting}>{submitting ? 'Adding…' : 'Add Material'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function MaterialCell({ item }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <div style={{ fontSize:14, fontWeight:600, color:'var(--black)', lineHeight:1.2 }}>{item.name}</div>
      {item.finish && <div style={{ fontFamily:'var(--font-display)', fontSize:12, fontStyle:'italic', color:'var(--gold)', marginTop:2 }}>{item.finish}</div>}
      {item.cut && <div style={{ fontSize:11, fontWeight:400, color:'var(--gray-light)', marginTop:1 }}>{item.cut}</div>}
      {(item.locations||[]).length > 0 && (
        <>
          <button onClick={()=>setOpen(!open)} style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:10, fontWeight:500, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--gray-light)', background:'none', border:'none', cursor:'pointer', padding:0, marginTop:5, transition:'color 0.15s' }}>
            <span style={{ transform:open?'rotate(180deg)':'none', transition:'transform 0.2s', display:'inline-block' }}>▾</span>
            {item.locations.length} location{item.locations.length!==1?'s':''}
          </button>
          {open && (
            <div style={{ fontSize:11, fontWeight:400, color:'var(--gray)', lineHeight:1.9, padding:'8px 12px', background:'var(--cream)', borderLeft:'2px solid var(--gold-light)', marginTop:5 }}>
              {item.locations.map((loc,i) => <div key={i}>· {loc}</div>)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function th(minWidth) {
  return {
    padding:'11px 14px', textAlign:'left', fontSize:9, fontWeight:600,
    letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--gray-light)',
    background:'var(--off-white)', borderBottom:'2px solid var(--border)',
    borderTop:'1px solid var(--border)',
    whiteSpace:'nowrap', minWidth,
  }
}
function td() {
  return { padding:'14px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle', fontWeight:400, fontSize:13 }
}
