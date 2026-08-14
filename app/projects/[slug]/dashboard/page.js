'use client'

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabase'
import { allCategories, getCategory, applicationsFor, roomsFor } from '@/lib/categories'
import { formatCurrency, formatDate, plural, displayProjectName, displayClient } from '@/lib/utils'
import { ShipmentCell, ShipmentIcon, BulkTrackingButton, SampleTag } from './ShipmentControls'
import { SQM_TO_SQFT, MARKUP_RATE, DOORS_MARGIN_PCT, pricingFor, normalizePrice, unitSuffix, unitQtyLabel } from '@/lib/pricing'
import SignOutButton from '@/app/components/SignOutButton'
import ActionMenu from '@/app/components/ActionMenu'
import VendorLinks from './VendorLinks'
import ProjectSidebar from './ProjectSidebar'
import ApprovalHistory from './ApprovalHistory'
import { CLIENT_SHARE_SCOPE, VENDOR_SHARE_SCOPE, INTERNAL_EXPORT_SCOPE } from '@/lib/permissions'
import { priceState, isPriced, internalPriceLabel, daysSince, PRICE_STATES } from '@/lib/priceState'
import { isTypingTarget } from '@/lib/utils'

export default function Dashboard({ params }) {
  const { slug } = params
  const [project, setProject] = useState(null)
  const [schedules, setSchedules] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [approvals, setApprovals] = useState({})
  const [quantities, setQuantities] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // Defaults to no export rights until /api/me says otherwise, so a slow
  // response can never briefly offer an action the server would refuse.
  const [me, setMe] = useState({ canExportCosts: false })
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [shareLinksFor, setShareLinksFor] = useState(null)
  const approveAllPricedRef = useRef(null)
  const [lightbox, setLightbox] = useState(null)
  const [importModal, setImportModal] = useState(null)
  const [addItemModal, setAddItemModal] = useState(null)

  // Access is enforced by middleware (you must be signed in to be here at
  // all) and by row level security (you only see projects you belong to).
  // This page used to gate itself on a passcode hardcoded a few lines up
  // from here, which shipped to the browser in the JS bundle and so was
  // readable by anyone who opened devtools.
  useEffect(() => { loadAll() }, [slug])

  useEffect(() => {
    function onKey(e) {
      if (isTypingTarget(e)) return
      if (e.key === '?') { e.preventDefault(); setShortcutsOpen(o => !o); return }
      if (e.key === 'Escape') { setShortcutsOpen(false); return }
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        approveAllPricedRef.current?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setMe(d))
      .catch(() => {})
  }, [])

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

  async function saveApproval(category, itemKey, status, quantity, notes, shippingDdp, markupOverride, designSelection) {
    const k = `${category}|||${itemKey}`
    setApprovals(prev => ({
      ...prev,
      [k]: {
        ...prev[k], category, item_key: itemKey, status, quantity, notes,
        shipping_ddp: shippingDdp ?? 0,
        markup_override: markupOverride === undefined ? null : markupOverride,
        design_selection: designSelection !== undefined ? designSelection : (prev[k]?.design_selection ?? null),
      },
    }))
    const body = {
      projectId: project.id, category, itemKey, status,
      quantity: quantity || 0, notes: notes || '',
      shippingDdp: shippingDdp || 0,
      markupOverride: markupOverride === undefined ? null : markupOverride,
    }
    if (designSelection !== undefined) body.designSelection = designSelection
    await fetch('/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  // Phase 3 — re-pull approvals only after a tracking change.
  // Deliberately NOT loadAll(): that resets activeCategory back to the
  // first category and would bounce you off the tab you're working in.
  async function refreshApprovals() {
    if (!project) return
    const { data: apprs } = await supabase
      .from('approvals').select('*').eq('project_id', project.id)
    const apprMap = {}
    ;(apprs || []).forEach(a => { apprMap[`${a.category}|||${a.item_key}`] = a })
    setApprovals(apprMap)
  }

  // Cheapest submitted price for one schedule item, in whatever unit it was
  // quoted in. Matched by item key rather than array position — see
  // pricingFor() for why position is not safe.
  function getLowestPrice(catSubs, item, itemIndex) {
    let best = null
    catSubs.forEach(sub => {
      const data = pricingFor(sub, item, itemIndex)
      const normalized = normalizePrice(data)
      if (!normalized) return
      if (!best || normalized.price < best.price) {
        best = { ...normalized, manufacturer: sub.manufacturer_name, data }
      }
    })
    return best
  }

  // Kept under its old name so every call site reads the same, but the price
  // it carries is now per-sqft ONLY when the quote was per-sqm. For a
  // per-unit or per-linear-foot category it is that price, unconverted, with
  // `unit` saying which.
  function getLowestPriceSqft(catSubs, item, itemIndex) {
    const low = getLowestPrice(catSubs, item, itemIndex)
    if (!low) return null
    return { ...low, priceSqft: low.price }
  }

  function getLineEconomics(low, ap) {
    const materialSqft = low ? low.priceSqft : null
    const ddpSqft = parseFloat(ap?.shipping_ddp || 0)
    const totalCostSqft = materialSqft != null ? parseFloat((materialSqft + ddpSqft).toFixed(2)) : null
    const autoMarkupSqft = totalCostSqft != null ? parseFloat((totalCostSqft * MARKUP_RATE).toFixed(2)) : null
    const hasOverride = ap?.markup_override !== null && ap?.markup_override !== undefined && ap?.markup_override !== ''
    const markupSqft = hasOverride ? parseFloat(ap.markup_override) : autoMarkupSqft
    return { materialSqft, ddpSqft, totalCostSqft, autoMarkupSqft, markupSqft, hasOverride, unit: low?.unit || 'sqft' }
  }

  // Doors: unit-price economics, no shipping_ddp, no sqm conversion.
  // Mirrors the doors branch in totals() exactly so exports agree with the summary.
  function getDoorLineEconomics(catSubs, item, i, ap, k) {
    let bestPrice = null, bestManufacturer = null
    catSubs.forEach(sub => {
      const d = pricingFor(sub, item, i)
      if (!d) return
      const oldPrice = parseFloat(d.unitPrice || 0)
      if (oldPrice > 0 && (!bestPrice || oldPrice < bestPrice)) { bestPrice = oldPrice; bestManufacturer = sub.manufacturer_name }
      ;(d.designOptions || []).forEach(opt => {
        const p = parseFloat(opt.unitPrice || 0)
        if (p > 0 && (!bestPrice || p < bestPrice)) { bestPrice = p; bestManufacturer = sub.manufacturer_name }
      })
    })
    const unitCost = ap?.design_selection?.unitPrice ? parseFloat(ap.design_selection.unitPrice) : bestPrice
    const qty = parseFloat(quantities[k] || ap?.quantity || 0)
    const marginPct = ap?.markup_override != null && ap.markup_override !== ''
      ? parseFloat(ap.markup_override) / 100
      : DOORS_MARGIN_PCT
    const yourCostTotal = unitCost != null && qty ? unitCost * qty : null
    const clientTotal = unitCost != null && qty ? unitCost * qty * (1 + marginPct) : null
    return { unitCost, manufacturer: bestManufacturer, qty, marginPct, yourCostTotal, clientTotal }
  }

  const totals = useCallback(() => {
    let totalItems = 0, approved = 0, rejected = 0, yourCost = 0, clientTotal = 0, priced = 0
    // The most recent thing that happened to this project's pricing, so a
    // total can say how current it is.
    let lastUpdated = null
    submissions.forEach(s => {
      if (s.submitted_at && (!lastUpdated || new Date(s.submitted_at) > new Date(lastUpdated))) lastUpdated = s.submitted_at
    })
    Object.values(approvals).forEach(a => {
      if (a?.updated_at && (!lastUpdated || new Date(a.updated_at) > new Date(lastUpdated))) lastUpdated = a.updated_at
    })
    schedules.forEach(sched => {
      const catSubs = submissions.filter(s => s.category === sched.category)
      const cat = getCategory(sched.category)
      sched.items.forEach((item, i) => {
        totalItems++
        const k = `${sched.category}|||${item.key}`
        const ap = approvals[k]
        if (isPriced(sched.category, catSubs, item, i, ap)) priced++
        if (ap?.status === 'approved') approved++
        if (ap?.status === 'rejected') rejected++
        if (ap?.status !== 'rejected') {
          if (cat?.id === 'doors') {
            const d = getDoorLineEconomics(catSubs, item, i, ap, k)
            if (d.yourCostTotal != null) {
              yourCost += d.yourCostTotal
              clientTotal += d.clientTotal
            }
          } else {
            const qty = parseFloat(quantities[k] || ap?.quantity || 0)
            const low = getLowestPriceSqft(catSubs, item, i)
            const econ = getLineEconomics(low, ap)
            if (econ.totalCostSqft != null && qty) {
              yourCost += econ.totalCostSqft * qty
              clientTotal += econ.markupSqft * qty
            }
          }
        }
      })
    })
    return { totalItems, approved, rejected, priced, lastUpdated, yourCost, clientTotal, profit: clientTotal - yourCost }
  }, [schedules, submissions, approvals, quantities])

  function exportCSV() {
    // Unit-bearing columns carry their suffix in the value rather than the
    // header, since a single export can mix per-sqft, per-unit and
    // per-linear-foot categories.
    const lines = ['Category,Material,Finish,Cut,Material Price,Unit,Manufacturer,Status,Quantity,DDP/Shipping,Your Cost (per unit),Your Cost Total,Markup (per unit),Client Total,Notes']
    schedules.forEach(sched => {
      const catSubs = submissions.filter(s => s.category === sched.category)
      sched.items.forEach((item, i) => {
        const k = `${sched.category}|||${item.key}`
        const ap = approvals[k] || {}
        if (sched.category === 'doors') {
          const d = getDoorLineEconomics(catSubs, item, i, ap, k)
          const name = item.description || item.location || `Door ${item.no}`
          lines.push([
            sched.category, `"${name}"`, '', '',
            d.unitCost != null ? `$${d.unitCost.toFixed(2)}` : '',
            'unit',
            d.manufacturer ? `"${d.manufacturer}"` : '',
            ap.status || 'pending', d.qty,
            '',
            d.unitCost != null ? `$${d.unitCost.toFixed(2)}` : '',
            d.yourCostTotal != null ? `$${d.yourCostTotal.toFixed(2)}` : '',
            '',
            d.clientTotal != null ? `$${d.clientTotal.toFixed(2)}` : '',
            `"${(ap.notes || '').replace(/"/g, '""')}"`,
          ].join(','))
          return
        }
        const qty = parseFloat(quantities[k] || ap.quantity || 0)
        const low = getLowestPriceSqft(catSubs, item, i)
        const econ = getLineEconomics(low, ap)
        const sfx = unitSuffix(econ.unit)
        const yourCostTotal = econ.totalCostSqft != null && qty ? (econ.totalCostSqft * qty).toFixed(2) : ''
        const clientTotalLine = econ.markupSqft != null && qty ? (econ.markupSqft * qty).toFixed(2) : ''
        lines.push([
          sched.category, `"${item.name}"`, `"${item.finish || ''}"`, `"${item.cut || ''}"`,
          low ? `$${low.priceSqft}` : '',
          low ? sfx.replace('/', '') : '',
          low ? `"${low.manufacturer}"` : '',
          ap.status || 'pending', qty,
          econ.ddpSqft ? `$${econ.ddpSqft}` : '0',
          econ.totalCostSqft != null ? `$${econ.totalCostSqft}` : '',
          yourCostTotal ? `$${yourCostTotal}` : '',
          econ.markupSqft != null ? `$${econ.markupSqft}` : '',
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

  // The slug in the URL is the real one; `slug` here can be a stale param
  // after a rename, which is why the old inline handler read it this way.
  function realSlug() {
    return window.location.pathname.split('/').filter(Boolean)[1]
  }

  function copyClientLink() {
    const url = `${window.location.origin}/projects/${realSlug()}/client`
    navigator.clipboard?.writeText(url)
    alert(`Client link copied:\n\n${url}\n\nThis one has no passcode, so only share it with the client directly.`)
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
      const groupLabel = [catDef?.label || sched.category, sched.manufacturer].filter(Boolean).join(' · ')
      rows += `<tr class="group"><td colspan="10">${groupLabel}</td></tr>`
      sched.items.forEach((item, i) => {
        const k = `${sched.category}|||${item.key}`
        const ap = approvals[k] || {}
        const isDoorsRow = sched.category === 'doors'
        const d = isDoorsRow ? getDoorLineEconomics(catSubs, item, i, ap, k) : null
        const qty = isDoorsRow ? d.qty : parseFloat(quantities[k] || ap.quantity || 0)
        const low = isDoorsRow ? null : getLowestPriceSqft(catSubs, item, i)
        const econ = isDoorsRow ? null : getLineEconomics(low, ap)
        const sfx = isDoorsRow ? '/unit' : unitSuffix(econ.unit)
        const name = isDoorsRow ? (item.description || item.location || `Door ${item.no}`) : item.name
        const manufacturer = isDoorsRow ? d.manufacturer : low?.manufacturer
        // The exported document says why a line has no number, for the same
        // reason the screen does — a page of dashes is the version of this
        // report that gets forwarded and misread.
        const rowState = priceState(sched.category, catSubs, item, i, ap)
        const waiting = internalPriceLabel(rowState, daysSince(sched.created_at)) || '—'
        const blank = rowState === PRICE_STATES.priced ? 'Awaiting qty' : waiting

        // Stated once, in the first money column. Repeating it across all
        // four reads as noise and buries the rows that do have numbers.
        // The dependent columns stay empty — the row has already said why.
        const priceSqftCell = isDoorsRow
          ? (d.unitCost != null ? `$${d.unitCost.toFixed(2)}/unit` : waiting)
          : (low ? `$${low.priceSqft}${sfx}` : waiting)
        const yourCostTotal = isDoorsRow
          ? (d.yourCostTotal != null ? formatCurrency(d.yourCostTotal) : (low || d.unitCost != null ? blank : ''))
          : (econ.totalCostSqft != null && qty ? formatCurrency(econ.totalCostSqft * qty) : (low ? blank : ''))
        const markupSqftCell = isDoorsRow ? '' : (econ.markupSqft != null ? `$${econ.markupSqft}${sfx}` : '')
        const clientTotalLine = isDoorsRow
          ? (d.clientTotal != null ? formatCurrency(d.clientTotal) : '')
          : (econ.markupSqft != null && qty ? formatCurrency(econ.markupSqft * qty) : '')
        const status = ap.status || 'pending'
        rows += `<tr>
          <td class="name">${name}</td>
          <td class="muted">${isDoorsRow ? '' : (item.finish || '')}</td>
          <td class="muted">${isDoorsRow ? '' : (item.cut || '')}</td>
          <td class="num">${priceSqftCell}</td>
          <td class="muted">${manufacturer || '—'}</td>
          <td class="num right">${qty || '—'}</td>
          <td class="num right strong">${yourCostTotal}</td>
          <td class="num right muted">${markupSqftCell}</td>
          <td class="num right strong">${clientTotalLine}</td>
          <td><span class="badge badge-${status}">${status}</span></td>
        </tr>`
        if (ap.notes) rows += `<tr class="note"><td colspan="10">${ap.notes}</td></tr>`
      })
    })
    // Styled to match the app itself — Inter, the monochrome gray palette,
    // hairline rules and pill status badges. Colour is reserved for status,
    // exactly as it is on screen. The stylesheet is inlined because this is
    // a brand new window that never loads globals.css.
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet"/>
    <title>Material Approval Summary — ${project?.name}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        font-size: 14px; color: #1C1A16; background: #FFFFFF; padding: 40px;
        -webkit-font-smoothing: antialiased;
      }
      .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 20px; margin-bottom: 24px; border-bottom: 1px solid #E7E3DC; }
      .title { font-size: 22px; font-weight: 500; letter-spacing: -0.01em; color: #1C1A16; }
      .subtitle { font-size: 14px; color: #574F43; margin-top: 2px; }
      .meta { font-size: 12px; color: #776E5F; text-align: right; line-height: 1.7; white-space: nowrap; }

      .summary { display: flex; gap: 10px; margin-bottom: 28px; }
      .s-item { flex: 1; background: #FAF9F7; border: 1px solid #E7E3DC; border-radius: 12px; padding: 14px 16px; }
      .s-val { font-size: 22px; font-weight: 500; color: #1C1A16; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
      .s-val.green { color: #2E6F4E; }
      .s-val.red { color: #A33A2C; }
      /* A count of zero is not an event. Red only once there is something
         to be red about. */
      .s-val.zero { color: #968E80; }
      .s-label { font-size: 12px; color: #776E5F; margin-top: 4px; }
      /* The denominator that keeps a partial total honest. */
      .s-sub { font-size: 11px; color: #968E80; margin-top: 2px; }

      table { width: 100%; border-collapse: collapse; }
      th { text-align: left; padding: 8px 14px; font-size: 12px; font-weight: 500; color: #776E5F; border-bottom: 1px solid #E7E3DC; white-space: nowrap; }
      td { padding: 10px 14px; border-bottom: 1px solid #E7E3DC; font-size: 14px; vertical-align: middle; }
      .right { text-align: right; }
      .num { font-variant-numeric: tabular-nums; }
      .name { font-weight: 500; }
      .muted { color: #574F43; font-size: 13px; }
      .strong { font-weight: 500; color: #38322A; }

      tr.group td { background: #FAF9F7; font-size: 13px; font-weight: 500; color: #38322A; padding: 8px 14px; }
      tr.note td { font-size: 13px; color: #776E5F; padding: 0 14px 10px 28px; }

      .badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; font-size: 11px; font-weight: 500; border-radius: 20px; border: 1px solid; text-transform: capitalize; }
      .badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; }
      .badge-approved { border-color: #2E6F4E; color: #2E6F4E; background: #E8F0EA; }
      .badge-approved::before { background: #2E6F4E; }
      .badge-rejected { border-color: #A33A2C; color: #A33A2C; background: #F7EAE7; }
      .badge-rejected::before { background: #A33A2C; }
      .badge-pending { border-color: #D6D1C8; color: #574F43; background: #FAF9F7; }
      .badge-pending::before { background: #968E80; }

      .footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #E7E3DC; display: flex; justify-content: space-between; font-size: 12px; color: #776E5F; }

      /* Ten columns do not fit portrait — material names wrap to four lines
         and the row count doubles. The print dialog can still override. */
      @page { size: landscape; margin: 12mm; }

      @media print {
        body { padding: 0; }
        /* Keep the badge and card fills — print drops backgrounds otherwise. */
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        thead { display: table-header-group; }
        tr { break-inside: avoid; }
      }
    </style></head><body>
    <div class="header">
      <div>
        <div class="title">Material Approval Summary</div>
        <div class="subtitle">${project?.name || ''}</div>
      </div>
      <div class="meta">
        Generated ${now}<br/>
        ${project?.client || ''}<br/>
        Confidential
      </div>
    </div>
    <div class="summary">
      <div class="s-item"><div class="s-val">${t.totalItems}</div><div class="s-label">Total items</div></div>
      <div class="s-item"><div class="s-val${t.approved > 0 ? ' green' : ' zero'}">${t.approved}</div><div class="s-label">Approved</div></div>
      <div class="s-item"><div class="s-val${t.rejected > 0 ? ' red' : ' zero'}">${t.rejected}</div><div class="s-label">Rejected</div></div>
      <div class="s-item"><div class="s-val">${t.yourCost > 0 ? formatCurrency(t.yourCost) : '—'}</div><div class="s-label">Total cost</div><div class="s-sub">${t.priced} of ${t.totalItems} priced</div></div>
      <div class="s-item"><div class="s-val">${t.clientTotal > 0 ? formatCurrency(t.clientTotal) : '—'}</div><div class="s-label">Total revenue</div><div class="s-sub">${t.priced} of ${t.totalItems} priced</div></div>
      <div class="s-item"><div class="s-val green">${t.profit > 0 ? formatCurrency(t.profit) : '—'}</div><div class="s-label">Total profit</div><div class="s-sub">${t.priced} of ${t.totalItems} priced</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Material</th><th>Finish</th><th>Cut</th>
        <th>Unit price</th><th>Manufacturer</th>
        <th class="right">Qty</th>
        <th class="right">Your cost</th>
        <th class="right">Client / unit</th>
        <th class="right">Client total</th>
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

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>
  if (!project) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}><div style={{ textAlign: 'center', fontFamily: 'var(--font)', fontSize: 32 }}>Project Not Found</div></div>

  const t = totals()
  const pct = t.totalItems > 0 ? Math.round((t.approved / t.totalItems) * 100) : 0
  const activeSched = schedules.find(s => s.category === activeCategory)
  const activeCatSubs = submissions.filter(s => s.category === activeCategory)
  const activeCatDef = getCategory(activeCategory)

  // `A` approves every priced line in the open schedule — the same action as
  // the toolbar button, so the two can never disagree about what "priced"
  // means.
  approveAllPricedRef.current = () => {
    if (!activeSched) return
    const keys = (activeSched.items || [])
      .filter((item, i) => isPriced(activeCategory, activeCatSubs, item, i, approvals[`${activeCategory}|||${item.key}`]))
      .map(item => item.key)
    if (!keys.length) return
    keys.forEach(key => {
      const k = `${activeCategory}|||${key}`
      const ap = approvals[k] || {}
      saveApproval(activeCategory, key, 'approved', parseFloat(quantities[k] || ap.quantity || 0), ap.notes || '', ap.shipping_ddp, ap.markup_override)
    })
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--off-white)' }}>
      <div className="app-header" style={{ position:'sticky', top:0, zIndex:200, background:'rgba(247,245,240,0.97)', backdropFilter:'blur(12px)', borderBottom:'1px solid var(--border)', height:64, display:'flex', alignItems:'center', padding:'0 40px', gap:0 }}>
        <button onClick={() => window.location.href = '/'} style={{ display:'flex', alignItems:'center', gap:8, background:'none', border:'none', cursor:'pointer', padding:'0 16px 0 0', borderRight:'1px solid var(--border)', marginRight:20, flexShrink:0, transition:'opacity 0.2s' }} onMouseEnter={e=>e.currentTarget.style.opacity='0.6'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          <span style={{ fontSize:12, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--black)' }}>All Projects</span>
        </button>
        <div style={{ fontSize:'var(--t-lg)', fontWeight:500, letterSpacing:'-0.01em', flexShrink:0, marginRight:24 }}>
          Relative <span style={{ color:'var(--g600)', fontWeight:400 }}>Estates</span>
        </div>
        <div style={{ width:1, height:24, background:'var(--border)', marginRight:20, flexShrink:0 }} />
        <div style={{ fontSize:13, fontWeight:500, color:'var(--gray)', flex:1 }}>{displayProjectName(project.name, allCategories.map(c => c.label))}</div>
        {/* The three figures worth carrying everywhere, each with the
            denominator that makes it honest. A total over 1 of 52 priced
            items is not the project total, and at full weight with nothing
            beside it that is exactly how it read. */}
        {[
          { label: 'Your cost',    val: t.yourCost,    color: 'var(--black)' },
          { label: 'Client total', val: t.clientTotal, color: 'var(--black)' },
          { label: 'Profit',       val: t.profit,      color: 'var(--success)' },
        ].map(s => (
          <div key={s.label} style={{ marginRight:28, flexShrink:0, textAlign:'right' }}>
            <div style={{ fontSize:12, color:'var(--gray-light)', marginBottom:2 }}>{s.label}</div>
            <div style={{ fontSize:20, fontWeight:500, color:s.color, lineHeight:1, fontVariantNumeric:'tabular-nums' }}>
              {s.val > 0 ? formatCurrency(s.val) : '—'}
            </div>
            <div style={{ fontSize:12, color:'var(--gray-light)', marginTop:3, whiteSpace:'nowrap' }}>
              {t.priced} of {t.totalItems} priced
            </div>
          </div>
        ))}
        {/* Approval progress moved down to the summary, next to the approved
            and rejected counts it belongs with. The header carries the three
            money figures and nothing else. */}
        {/* On a phone the actions collapse behind this, which is hidden
            entirely on a wide screen. */}
        <button
          className="header-menu-btn"
          aria-label={menuOpen ? 'Hide actions' : 'Show actions'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(o => !o)}
        >
          <i className={`ti ${menuOpen ? 'ti-x' : 'ti-menu-2'}`} style={{ fontSize:20 }} />
        </button>
        <div className={`header-actions project-header-actions${menuOpen ? ' open' : ''}`} style={{ alignItems:'center', gap:8, flexShrink:0 }}>
          {/* The two links that leave the building, together. */}
          <ActionMenu
            label="Share"
            items={[
              { note: CLIENT_SHARE_SCOPE },
              { label: 'Copy client link', onClick: copyClientLink },
              activeCategory && { sep: true },
              activeCategory && { note: VENDOR_SHARE_SCOPE },
              activeCategory && {
                label: `Pricing links for ${activeCatDef?.label?.toLowerCase() || 'this category'}…`,
                onClick: () => setShareLinksFor(activeCategory),
              },
            ]}
          />
          <ActionMenu
            label="More actions"
            trigger="icon"
            items={[
              { label: 'Files', onClick: () => window.location.href = `/projects/${slug}/files` },
              { label: 'Ask', onClick: () => window.location.href = `/projects/${slug}/chat` },
              // Exports carry cost and margin, so they are gated on the
              // export permission rather than on having reached this page.
              me.canExportCosts && { sep: true },
              me.canExportCosts && { note: INTERNAL_EXPORT_SCOPE },
              me.canExportCosts && { label: 'Export CSV', onClick: exportCSV },
              me.canExportCosts && { label: 'Export PDF', onClick: exportPDF },
            ]}
          />
        </div>
        {/* Outside the mobile-only group: the sidebar took over the action
            menus on a wide screen, but signing out is not one of the
            project's actions and belongs in the header on every width,
            same as every other page. */}
        <SignOutButton compact />
      </div>

      <div style={{ display:'flex', alignItems:'flex-start' }}>
      <ProjectSidebar
        slug={slug}
        projectName={project.name}
        canExport={me.canExportCosts}
        categoryLabel={activeCatDef?.label}
        onClientLink={copyClientLink}
        onManufacturerLinks={() => activeCategory && setShareLinksFor(activeCategory)}
        onExportCSV={exportCSV}
        onExportPDF={exportPDF}
      />
      <div style={{ flex:1, minWidth:0 }}>

      {/* One band where there were two. The title, who it is for, what it
          contains and how far along it is, on a single line — the page used
          to spend a third of the viewport before the first row of the thing
          you came to read. */}
      <div className="page-body" style={{ padding:'var(--s-4) var(--s-12)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'var(--s-6)' }}>
        <div style={{ minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:'var(--s-3)', flexWrap:'wrap' }}>
            <span style={{ fontSize:'var(--t-2xl)', fontWeight:500, letterSpacing:'-0.01em', color:'var(--black)' }}>
              {displayProjectName(project.name, allCategories.map(c => c.label))}
            </span>
            {(() => { const c = displayClient(project.client); return c.name ? (
              <span style={{ fontSize:'var(--t-sm)', color:'var(--gray)' }}>{c.name}</span>
            ) : null })()}
          </div>
          <div style={{ fontSize:'var(--t-xs)', color:'var(--gray)', marginTop:'var(--s-1)' }}>
            {plural(schedules.reduce((a,s)=>a+(s.items?.length||0),0), 'line item')} · {plural(project.categories?.length || 0, 'category', 'categories')} · prices per square foot
            {t.lastUpdated && <> · updated {formatDate(t.lastUpdated)}</>}
          </div>
        </div>

        {/* Counts inline with the title rather than stacked under it, and
            small enough to read as reference rather than headline. */}
        <div style={{ display:'flex', alignItems:'center', gap:'var(--s-6)', flexWrap:'wrap' }}>
          {[
            { val:t.totalItems, label:'items' },
            { val:t.priced, label:'priced' },
            { val:t.approved, label:'approved', color:'var(--success)' },
            { val:t.rejected, label:'rejected', color:'var(--danger)' },
          ].map(s => (
            <div key={s.label} style={{ textAlign:'right' }}>
              <div style={{ fontSize:'var(--t-xl)', fontWeight:500, lineHeight:1, fontVariantNumeric:'tabular-nums', color:s.val > 0 ? (s.color || 'var(--black)') : 'var(--g500)' }}>{s.val}</div>
              <div style={{ fontSize:'var(--t-xs)', color:'var(--gray)', marginTop:'var(--s-1)' }}>{s.label}</div>
            </div>
          ))}
          <div style={{ width:120 }}>
            <div style={{ height:4, background:'var(--border)', borderRadius:'var(--r-pill)', overflow:'hidden' }}>
              <div style={{ height:'100%', background:'var(--black)', width:`${pct}%`, borderRadius:'var(--r-pill)', transition:'width 0.5s' }} />
            </div>
            <div style={{ fontSize:'var(--t-xs)', color:'var(--gray)', marginTop:'var(--s-1)', whiteSpace:'nowrap' }}>{pct}% approved</div>
          </div>
        </div>
      </div>

      {/* The "Quick actions" bar is gone — approve-all and reset-all act on
          the visible schedule, so they now sit in that schedule's own toolbar
          rather than in a third row of buttons above it. */}

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
                // Doors are priced per unit with no shipping_ddp. Without this
                // branch the tab ran them through the per-sqft pipeline, so the
                // figure here disagreed with the header and the row cells.
                if (catId === 'doors') {
                  const d = getDoorLineEconomics(catSubs, item, i, ap, k)
                  if (d.yourCostTotal != null) catCost += d.yourCostTotal
                  return
                }
                const qty = parseFloat(quantities[k] || ap?.quantity || 0)
                const low = getLowestPriceSqft(catSubs, item, i)
                const econ = getLineEconomics(low, ap)
                if (econ.totalCostSqft != null && qty) catCost += econ.totalCostSqft * qty
              }
            })
            const isActive = activeCategory === catId
            return (
              <div key={catId} onClick={() => setActiveCategory(catId)} style={{ padding:'var(--s-3) var(--s-6)', cursor:'pointer', boxShadow:isActive?'inset 0 -2px 0 0 var(--black)':'none', background:isActive?'var(--off-white)':'transparent', transition:'all 0.15s', minWidth:160 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                  <span style={{ fontSize:14, color:isActive?'var(--black)':'var(--gray-light)' }}>{catDef?.icon}</span>
                  <span style={{ fontSize:12, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:isActive?'var(--black)':'var(--gray)' }}>{catDef?.label || catId}</span>
                </div>
                <div style={{ fontSize:12, fontWeight:400, color:'var(--gray-light)' }}>
                  {catApproved}/{items.length} approved{catCost > 0 ? ` · ${formatCurrency(catCost)}` : ''}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ padding:'0 40px 80px' }}>
        {activeSched && activeCatDef ? (
          <CategoryDetail
            schedule={activeSched}
            category={activeCatDef}
            submissions={activeCatSubs}
            approvals={approvals}
            quantities={quantities}
            // `onlyKeys` limits a bulk approve to the lines that carry a
            // price. Reset still applies to everything — an unpriced line
            // can still be sitting on a stale approval from before.
            onSetAll={(status, onlyKeys) => {
              if (!activeSched) return
              if (status === 'pending' && !confirm('Reset every item in this schedule back to pending?')) return
              const keys = onlyKeys ? new Set(onlyKeys) : null
              activeSched.items.forEach(item => {
                if (keys && !keys.has(item.key)) return
                const k = `${activeCategory}|||${item.key}`
                const ap = approvals[k] || {}
                saveApproval(activeCategory, item.key, status, parseFloat(quantities[k] || ap.quantity || 0), ap.notes || '', ap.shipping_ddp, ap.markup_override)
              })
            }}
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
            onDesignSelect={(itemKey, selection) => {
              const k = `${activeCategory}|||${itemKey}`
              const ap = approvals[k] || {}
              const qty = parseFloat(quantities[k] || ap.quantity || 0)
              saveApproval(activeCategory, itemKey, ap.status || 'pending', qty, ap.notes || '', ap.shipping_ddp, ap.markup_override, selection)
            }}
            getLowestPriceSqft={getLowestPriceSqft}
            getLineEconomics={getLineEconomics}
            projectSlug={slug}
            projectId={project?.id}
            onTrackingSaved={refreshApprovals}
            activeCategory={activeCategory}
            onOpenLightbox={(images, index) => setLightbox({ images, index })}
            onImportCSV={() => setImportModal({ schedule: activeSched, category: activeCatDef })}
            onAddItem={() => setAddItemModal({ schedule: activeSched, category: activeCatDef })}
          />
        ) : (
          <div className="empty-state"><div className="empty-state-title">No schedule uploaded</div><div className="empty-state-sub">Upload a CSV for this category in the admin.</div></div>
        )}
      </div>

      </div>{/* content column */}
      </div>{/* sidebar + content row */}

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.92)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div onClick={e => e.stopPropagation()} style={{ position:'relative', maxWidth:900, width:'100%' }}>
            <img src={lightbox.images[lightbox.index].url} alt="" style={{ width:'100%', maxHeight:'80vh', objectFit:'contain', display:'block' }}/>
            <div style={{ position:'absolute', top:-40, right:0, display:'flex', gap:12, alignItems:'center' }}>
              <span style={{ fontSize:12, color:'rgba(255,255,255,0.5)' }}>{lightbox.index+1} / {lightbox.images.length}</span>
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

      {shareLinksFor && (
        <VendorLinks
          projectId={project.id}
          category={shareLinksFor}
          categoryLabel={getCategory(shareLinksFor)?.label || shareLinksFor}
          scheduleManufacturer={schedules.find(s => s.category === shareLinksFor)?.manufacturer}
          onClose={() => setShareLinksFor(null)}
        />
      )}

      {shortcutsOpen && (
        <div onClick={e => e.target === e.currentTarget && setShortcutsOpen(false)}
          style={{ position:'fixed', inset:0, background:'rgba(28,26,22,0.5)', zIndex:900, display:'flex', alignItems:'center', justifyContent:'center', padding:'var(--s-6)' }}>
          <div style={{ background:'var(--white)', borderRadius:'var(--r-md)', width:'100%', maxWidth:420, padding:'var(--s-6)' }}>
            <div style={{ fontSize:'var(--t-lg)', fontWeight:500, marginBottom:'var(--s-4)' }}>Keyboard shortcuts</div>
            {[
              ['Tab', 'Move between rows'],
              ['Space', 'Approve the focused row'],
              ['X', 'Reject the focused row'],
              ['Enter', 'Open the focused row'],
              ['A', 'Approve every priced row in this schedule'],
              ['?', 'This list'],
            ].map(([key, what]) => (
              <div key={key} style={{ display:'flex', justifyContent:'space-between', gap:'var(--s-4)', padding:'var(--s-2) 0', borderBottom:'1px solid var(--border)' }}>
                <kbd style={{ fontFamily:'var(--font)', fontSize:'var(--t-xs)', fontWeight:600, background:'var(--g100)', border:'1px solid var(--border-dark)', borderRadius:'var(--r-md)', padding:'var(--s-1) var(--s-2)', minWidth:52, textAlign:'center' }}>{key}</kbd>
                <span style={{ fontSize:'var(--t-sm)', color:'var(--gray)', textAlign:'right' }}>{what}</span>
              </div>
            ))}
            <div style={{ fontSize:'var(--t-xs)', color:'var(--gray)', marginTop:'var(--s-4)' }}>
              Row shortcuts act on the row you have focused, and only when it has a price.
            </div>
            <button className="btn btn-outline btn-sm" style={{ marginTop:'var(--s-4)' }} onClick={() => setShortcutsOpen(false)}>Close</button>
          </div>
        </div>
      )}

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

      {addItemModal && (
        <AddItemModal
          schedule={addItemModal.schedule}
          category={addItemModal.category}
          projectSlug={slug}
          onClose={() => setAddItemModal(null)}
          onAdded={() => { setAddItemModal(null); loadAll() }}
        />
      )}

      <div className="page-body" style={{ borderTop:'2px solid var(--black)', padding:'40px 56px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:24, background:'var(--off-white)' }}>
        <div className="stat-row" style={{ display:'flex', gap:0, flexWrap:'wrap' }}>
          {[
            { val:t.totalItems, label:'Total Materials' },
            { val:t.approved, label:'Approved', color:'var(--success)' },
            { val:t.rejected, label:'Rejected', color:'var(--danger)' },
            { val:t.yourCost > 0 ? formatCurrency(t.yourCost) : '—', label:'Total Cost', color:'var(--black)' },
            { val:t.clientTotal > 0 ? formatCurrency(t.clientTotal) : '—', label:'Total Revenue', color:'var(--black)' },
            { val:t.profit > 0 ? formatCurrency(t.profit) : '—', label:'Total Profit', color:'var(--success)' },
          ].map((s,i,arr) => (
            <div key={i} style={{ paddingRight:40, marginRight:40, borderRight:i<arr.length-1?'1px solid var(--border)':'none' }}>
              <div style={{ fontFamily:'var(--font)', fontSize:36, fontWeight:200, color:s.color||'var(--black)', lineHeight:1 }}>{s.val}</div>
              <div style={{ fontSize:12, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--gray-light)', marginTop:5 }}>{s.label}</div>
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

// ── Category Detail — collapsible rows ─────────────────────
// Collapsed: material, our cost, client total, shipment, approval.
// Everything else (quotes, images, qty, DDP, markup, notes) is in the panel.
function CategoryDetail({ schedule, category, submissions, approvals, quantities, onApprove, onQtyChange, onNoteChange, onDdpChange, onMarkupChange, onDesignSelect, getLowestPriceSqft, getLineEconomics, projectSlug, projectId, onTrackingSaved, activeCategory, onOpenLightbox, onImportCSV, onAddItem, onSetAll }) {
  const isDoors = category.id === 'doors'
  const [expanded, setExpanded] = useState(new Set())
  const [linksOpen, setLinksOpen] = useState(false)

  // How long this schedule has been out with the vendor. The schedule's
  // creation is the only "waiting since" the data actually has — there is
  // no record of when a vendor was last chased, so the counter reads from
  // when the work was handed over. Worth revisiting if chasing is ever logged.
  const scheduleAge = schedule.created_at

  // Lines that can actually be approved, for the bulk control's count.
  const pricedKeys = (schedule.items || [])
    .filter((item, i) => isPriced(schedule.category, submissions, item, i, approvals[`${schedule.category}|||${item.key}`]))
    .map(item => item.key)

  function toggle(key) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }
  const allExpanded = expanded.size === schedule.items.length && schedule.items.length > 0
  function toggleAll() {
    setExpanded(allExpanded ? new Set() : new Set(schedule.items.map(it => it.key)))
  }

  return (
    <div>
      {/* The schedule's own heading row is gone: the tab above already says
          which schedule this is and how many items it holds, and the vendor
          rides with it. What is left is the actions, which is the only part
          of that row you could not read somewhere else. */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'var(--s-2) 0', flexWrap:'wrap', gap:'var(--s-3)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'var(--s-3)', flexWrap:'wrap', fontSize:'var(--t-xs)', color:'var(--gray)' }}>
          <span>{schedule.manufacturer ? `Quoted by ${schedule.manufacturer}` : 'No vendor assigned'}</span>
          {/* Only what actually works. The old line also promised "X to
              reject", which nothing in the app implements — see the note on
              the keyboard model. Tab and Space work because these are real
              buttons, not because anything handles keys. */}
          <span style={{ color:'var(--g500)' }}>Tab between rows · Space approve · X reject · ? shortcuts</span>
        </div>
        {/* Four things you reach for constantly, and the rest one click away.
            Everything here acts on this schedule only. */}
        <div style={{ display:'flex', alignItems:'center', gap:'var(--s-2)', flexWrap:'wrap' }}>
          <button className="btn btn-outline btn-sm" disabled={pricedKeys.length === 0}
            title={pricedKeys.length === 0 ? 'Nothing is priced yet' : undefined}
            style={pricedKeys.length === 0 ? { opacity:0.45, cursor:'not-allowed' } : undefined}
            onClick={() => onSetAll?.('approved', pricedKeys)}>
            Approve all priced ({pricedKeys.length})
          </button>
          <button className="btn btn-outline btn-sm" onClick={onAddItem}>+ Add {isDoors ? 'door' : 'material'}</button>
          <BulkTrackingButton
            projectId={projectId}
            category={schedule.category}
            items={schedule.items}
            approvals={approvals}
            onSaved={onTrackingSaved}
          />
          <button className="btn btn-outline btn-sm" onClick={toggleAll}>{allExpanded ? 'Collapse all' : 'Expand all'}</button>
          <ActionMenu
            label="More schedule actions"
            trigger="icon"
            items={[
              { label: 'Import manufacturer CSV', onClick: onImportCSV },
              { label: 'Manage pricing links…', onClick: () => setLinksOpen(true) },
              { sep: true },
              { label: 'Reset all to pending', onClick: () => onSetAll?.('pending'), danger: true },
            ]}
          />
        </div>
      </div>



      {linksOpen && (
        <VendorLinks
          projectId={projectId}
          category={schedule.category}
          categoryLabel={category.label}
          scheduleManufacturer={schedule.manufacturer}
          onClose={() => setLinksOpen(false)}
        />
      )}

      <div className="table-scroll" style={{ overflowX:'auto' }}>
        <table className="card-table" style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={th('280px')}>Material</th>
              {/* Quantity is the one field you fill in on every row, and it
                  used to be an expand away — fifty-two expansions to price a
                  schedule. */}
              <th style={th('90px')}>Qty</th>
              <th style={th('120px')}>Your Cost</th>
              <th style={th('120px')}>Client Total</th>
              {/* Two shipments were stacked in one cell, so every row showed
                  two plane icons on top of each other and read as a repeat.
                  One column each, same as the client view. */}
              <th style={th('130px')}>Sample</th>
              <th style={th('130px')}>Product</th>
              <th style={th('110px')}>Approval</th>
              <th style={th('40px')}></th>
            </tr>
          </thead>
          <tbody>
            {schedule.items.map((item, i) => {
              const k = `${schedule.category}|||${item.key}`
              const ap = approvals[k] || { status:'pending', notes:'' }
              const qty = parseFloat(quantities[k] || ap.quantity || 0)
              const low = getLowestPriceSqft(submissions, item, i)
              const econ = getLineEconomics(low, ap)
              const sfx = unitSuffix(econ.unit)
              const yourCostTotal = econ.totalCostSqft != null && qty ? econ.totalCostSqft * qty : null
              const clientTotalLine = econ.markupSqft != null && qty ? econ.markupSqft * qty : null
              const isOpen = expanded.has(item.key)

              const doorLow = isDoors ? (() => {
                let best = null
                submissions.forEach(sub => {
                  const d = pricingFor(sub, item, i)
                  if (!d) return
                  const oldPrice = parseFloat(d.unitPrice || 0)
                  if (oldPrice > 0 && (!best || oldPrice < best.unitPrice)) best = { ...d, unitPrice: oldPrice, manufacturer: sub.manufacturer_name }
                  ;(d.designOptions || []).forEach(opt => {
                    const p = parseFloat(opt.unitPrice || 0)
                    if (p > 0 && (!best || p < best.unitPrice)) best = { ...d, unitPrice: p, manufacturer: sub.manufacturer_name }
                  })
                })
                return best
              })() : null

              // Doors economics
              const doorQty = parseFloat(quantities[k] || ap.quantity || item.qty || 0)
              const doorSelPrice = ap.design_selection?.unitPrice ? parseFloat(ap.design_selection.unitPrice) : (doorLow?.unitPrice || null)
              const doorAmt = doorSelPrice && doorQty ? doorSelPrice * doorQty : null
              const doorDefaultPct = DOORS_MARGIN_PCT * 100
              const doorHasOverride = ap.markup_override != null && ap.markup_override !== ''
              const doorMarginPct = doorHasOverride ? parseFloat(ap.markup_override) / 100 : DOORS_MARGIN_PCT
              const doorClientTotal = doorAmt ? doorAmt * (1 + doorMarginPct) : null

              const displayCost = isDoors ? doorAmt : yourCostTotal
              const displayClient = isDoors ? doorClientTotal : clientTotalLine
              const rowBg = ap.status==='approved' ? 'var(--success-bg)' : ap.status==='rejected' ? 'var(--danger-bg)' : 'transparent'

              // Why this line has no number, rather than an em-dash that
              // could mean any of four things. Also decides whether the
              // approval controls do anything.
              const state = priceState(schedule.category, submissions, item, i, ap)
              const rowPriced = state === PRICE_STATES.priced
              const waitingLabel = internalPriceLabel(state, daysSince(scheduleAge))

              return (
                <Fragment key={item.key}>
                  {/* ── Collapsed summary ── */}
                  <tr
                    tabIndex={0}
                    aria-label={`${isDoors ? (item.description || item.no) : item.name}${rowPriced ? '' : ' — awaiting price'}`}
                    onClick={() => toggle(item.key)}
                    onKeyDown={e => {
                      if (isTypingTarget(e)) return
                      // Space approves, X rejects, Enter opens the row. The
                      // hint above the table has promised this for a long
                      // time; until now only Tab and Space did anything, and
                      // Space only because the buttons are buttons.
                      if (e.key === ' ' || e.key === 'Spacebar') {
                        if (!rowPriced) return
                        e.preventDefault()
                        onApprove(item.key, ap.status === 'approved' ? 'pending' : 'approved', ap.notes)
                      } else if (e.key === 'x' || e.key === 'X') {
                        if (!rowPriced) return
                        e.preventDefault()
                        onApprove(item.key, ap.status === 'rejected' ? 'pending' : 'rejected', ap.notes)
                      } else if (e.key === 'Enter') {
                        e.preventDefault()
                        toggle(item.key)
                      }
                    }}
                    style={{ background:rowBg, opacity:ap.status==='rejected'?0.6:1, cursor:'pointer' }}>
                    <td data-label="Material" style={td()}>
                      {isDoors ? (
                        <div>
                          <div style={{ fontSize:14, fontWeight:600 }}>{item.description || item.location || `Door ${item.no}`}</div>
                          <div style={{ fontSize:12, color:'var(--gray-light)', marginTop:2 }}>{item.no} · {item.type || '—'}</div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontSize:14, fontWeight:600 }}>{item.name}</div>
                          {/* Finish, then what this stone is FOR. Ten rooms
                              answered a question nobody asked; "Flooring" is
                              the thing you need at a glance. The rooms
                              themselves are in the expanded panel. */}
                          <div style={{ fontSize:12, color:'var(--gray)', marginTop:2 }}>
                            {[item.finish, applicationsFor(item).join(' · ')].filter(Boolean).join(' — ')}
                          </div>
                        </div>
                      )}
                    </td>
                    {/* stopPropagation so typing here does not toggle the
                        row open underneath you. */}
                    <td data-label="Qty" style={td()} onClick={e => e.stopPropagation()}>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={isDoors ? (quantities[k] ?? ap.quantity ?? item.qty ?? '') : (quantities[k] ?? ap.quantity ?? '')}
                        onChange={e => onQtyChange(item.key, e.target.value)}
                        aria-label={`Quantity for ${isDoors ? (item.description || item.no) : item.name}`}
                        style={{
                          width:'100%', maxWidth:80, padding:'var(--s-1) var(--s-2)',
                          fontFamily:'var(--font)', fontSize:'var(--t-base)',
                          fontVariantNumeric:'tabular-nums',
                          border:'1px solid var(--border)', borderRadius:'var(--r-md)',
                          background:'var(--white)', color:'var(--black)',
                        }}
                      />
                    </td>
                    <td data-label="Your Cost" style={td()}>
                      {displayCost ? (
                        <div style={{ fontSize:15, fontWeight:600, color:'var(--black)', whiteSpace:'nowrap', fontVariantNumeric:'tabular-nums' }}>{formatCurrency(displayCost)}</div>
                      ) : (
                        <div style={{ fontSize:12, color:'var(--gray-light)', whiteSpace:'nowrap' }}>
                          {rowPriced ? 'Awaiting quantity' : waitingLabel}
                        </div>
                      )}
                    </td>
                    {/* Left empty when there is no number: the Your Cost cell
                        beside it has already said why, and saying it twice on
                        one row buries the rows that do carry figures. */}
                    <td data-label="Client Total" style={td()}>
                      {displayClient ? (
                        <div style={{ fontSize:15, fontWeight:600, color:'var(--black)', whiteSpace:'nowrap', fontVariantNumeric:'tabular-nums' }}>{formatCurrency(displayClient)}</div>
                      ) : null}
                    </td>
                  <td data-label="Sample" style={tdTight}>
                      <ShipmentIcon approval={ap} kind="sample" />
                    </td>
                    <td data-label="Product" style={tdTight}>
                      <ShipmentIcon approval={ap} kind="product" />
                    </td>
                    {/* Approval is disabled until there is a price to approve.
                        A disabled button also drops out of the tab order, so
                        tabbing now walks only the rows that can be actioned. */}
                    <td data-label="Approval" style={td()} onClick={e => e.stopPropagation()}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <button onClick={() => onApprove(item.key, ap.status==='approved'?'pending':'approved', ap.notes)}
                          disabled={!rowPriced}
                          title={rowPriced ? 'Approve' : 'Awaiting price from vendor'}
                          aria-label={rowPriced ? 'Approve' : 'Awaiting price from vendor'}
                          style={{ background:'none', border:'none', cursor:rowPriced?'pointer':'not-allowed', padding:2, lineHeight:1, opacity:rowPriced?1:0.35 }}>
                          <i className="ti ti-circle-check" style={{ fontSize:24, color: ap.status==='approved' ? 'var(--success)' : 'var(--border-dark)' }} />
                        </button>
                        <button onClick={() => onApprove(item.key, ap.status==='rejected'?'pending':'rejected', ap.notes)}
                          disabled={!rowPriced}
                          title={rowPriced ? 'Reject' : 'Awaiting price from vendor'}
                          aria-label={rowPriced ? 'Reject' : 'Awaiting price from vendor'}
                          style={{ background:'none', border:'none', cursor:rowPriced?'pointer':'not-allowed', padding:2, lineHeight:1, opacity:rowPriced?1:0.35 }}>
                          <i className="ti ti-circle-x" style={{ fontSize:24, color: ap.status==='rejected' ? 'var(--danger)' : 'var(--border-dark)' }} />
                        </button>
                      </div>
                    </td>
                    <td data-label="" style={td()}>
                      <span style={{ fontSize:14, color:'var(--gray-light)', display:'inline-block', transform:isOpen?'rotate(180deg)':'none', transition:'transform 0.2s' }}>▾</span>
                    </td>
                  </tr>

                  {/* ── Expanded panel ── */}
                  {isOpen && (
                    <tr style={{ background:'var(--g50)' }}>
                      <td colSpan={8} style={{ padding:'0 14px 18px' }}>
                        <div style={{ background:'var(--white)', border:'1px solid var(--border)', padding:'18px 20px' }} onClick={e => e.stopPropagation()}>

                          {/* Doors: design options */}
                          {isDoors && (() => {
                            const allOptions = []
                            submissions.forEach(sub => {
                              const d = pricingFor(sub, item, i)
                              if (!d) return
                              const oldPrice = parseFloat(d.unitPrice || 0)
                              if (oldPrice > 0 && !(d.designOptions || []).length) {
                                allOptions.push({ manufacturer: sub.manufacturer_name, unitPrice: oldPrice, url: null, label: 'CSV Price', id: `${sub.id}-csv` })
                              }
                              ;(d.designOptions || []).forEach((opt, idx) => {
                                allOptions.push({ manufacturer: sub.manufacturer_name, unitPrice: parseFloat(opt.unitPrice || 0), url: opt.url, label: opt.name || `Design ${idx+1}`, id: `${sub.id}-${idx}` })
                              })
                            })
                            if (!allOptions.length) return <div style={{ fontSize:12, fontStyle:'italic', color:'var(--gray-light)', marginBottom:16 }}>No designs submitted yet</div>
                            const selectedId = ap.design_selection?.id || null
                            return (
                              <div style={{ marginBottom:18 }}>
                                <div style={dLabel}>Design options</div>
                                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                                  {allOptions.map(opt => {
                                    const sel = selectedId === opt.id
                                    return (
                                      <label key={opt.id}
                                        style={{ display:'flex', gap:8, alignItems:'center', padding:'6px 10px', cursor:'pointer', border:`1.5px solid ${sel?'var(--black)':'var(--border)'}`, background:sel?'var(--g100)':'transparent' }}
                                        onClick={() => onDesignSelect(item.key, { id: opt.id, manufacturer: opt.manufacturer, unitPrice: opt.unitPrice, url: opt.url, label: opt.label })}>
                                        <div style={{ width:14, height:14, borderRadius:'50%', border:`2px solid ${sel?'var(--black)':'var(--border-dark)'}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                          {sel && <div style={{ width:7, height:7, borderRadius:'50%', background:'var(--black)' }}/>}
                                        </div>
                                        {opt.url && <img src={opt.url} alt="" style={{ width:36, height:36, objectFit:'cover', border:'1px solid var(--border)' }} onClick={e => { e.stopPropagation(); onOpenLightbox([opt], 0) }} />}
                                        <div>
                                          <div style={{ fontSize:13, fontWeight:600 }}>{opt.unitPrice ? formatCurrency(opt.unitPrice) : '—'}</div>
                                          <div style={{ fontSize:12, color:'var(--gray-light)' }}>{opt.manufacturer} · {opt.label}</div>
                                        </div>
                                      </label>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })()}

                          {/* Stone: manufacturer quotes */}
                          {!isDoors && submissions.length > 0 && (
                            <div style={{ marginBottom:18 }}>
                              <div style={dLabel}>Manufacturer quotes</div>
                              <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                                {submissions.map(sub => {
                                  const d = pricingFor(sub, item, i)
                                  const isLow = low && sub.manufacturer_name === low.manufacturer
                                  const quoted = normalizePrice(d)
                                  return (
                                    <div key={sub.id} style={{ padding:'8px 12px', border:`1px solid ${isLow?'var(--black)':'var(--border)'}`, background:isLow?'var(--g100)':'transparent', minWidth:130 }}>
                                      <div style={{ fontSize:12, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--gray-light)' }}>{sub.manufacturer_name}</div>
                                      {quoted ? (
                                        <>
                                          <div style={{ fontSize:15, fontWeight:600, marginTop:3 }}>${quoted.price}{unitSuffix(quoted.unit)}</div>
                                          {quoted.priceSqm && <div style={{ fontSize:12, color:'var(--gray-light)' }}>${quoted.priceSqm.toFixed(2)}/sqm</div>}
                                        </>
                                      ) : <div style={{ fontSize:12, fontStyle:'italic', color:'var(--gray-light)', marginTop:3 }}>Awaiting quote</div>}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          {/* Editable economics */}
                          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:18 }}>
                            <div>
                              <div style={dLabel}>{isDoors ? 'Qty' : unitQtyLabel(econ.unit)}</div>
                              <input type="number" min="0" placeholder={isDoors ? (item.qty || '0') : '0'}
                                value={isDoors ? (quantities[k] || ap.quantity || item.qty || '') : (quantities[k] || ap.quantity || '')}
                                onChange={e => onQtyChange(item.key, parseFloat(e.target.value)||0)}
                                style={inp} />
                            </div>

                            {!isDoors && (
                              <div>
                                <div style={dLabel}>DDP / Shipping (${unitSuffix(econ.unit)})</div>
                                <input type="number" min="0" step="0.01" placeholder="0.00" value={ap.shipping_ddp || ''}
                                  onChange={e => onDdpChange(item.key, parseFloat(e.target.value)||0)} style={inp} />
                              </div>
                            )}

                            <div>
                              <div style={dLabel}>{isDoors ? 'Margin (%)' : `Markup ($${unitSuffix(econ.unit)})`}</div>
                              {isDoors ? (
                                <>
                                  <input type="number" min="0" max="100" step="1" placeholder={doorDefaultPct}
                                    value={doorHasOverride ? ap.markup_override : doorDefaultPct}
                                    onChange={e => onMarkupChange(item.key, e.target.value === '' ? null : parseFloat(e.target.value))}
                                    style={{ ...inp, borderBottomColor: doorHasOverride ? 'var(--black)' : 'var(--border)', color: doorHasOverride ? 'var(--black)' : 'var(--black)' }} />
                                  {doorHasOverride && (
                                    <button onClick={() => onMarkupChange(item.key, null)} style={resetBtn}>reset to {doorDefaultPct}%</button>
                                  )}
                                </>
                              ) : (
                                <>
                                  <input type="number" min="0" step="0.01" placeholder="0.00"
                                    value={econ.hasOverride ? ap.markup_override : (econ.autoMarkupSqft ?? '')}
                                    onChange={e => onMarkupChange(item.key, e.target.value === '' ? null : parseFloat(e.target.value))}
                                    style={{ ...inp, borderBottomColor: econ.hasOverride ? 'var(--black)' : 'var(--border)', color: econ.hasOverride ? 'var(--black)' : 'var(--black)' }} />
                                  {econ.hasOverride && (
                                    <button onClick={() => onMarkupChange(item.key, null)} style={resetBtn}>reset to auto</button>
                                  )}
                                </>
                              )}
                            </div>

                            <div>
                              <div style={dLabel}>Your cost</div>
                              <div style={{ fontSize:15, fontWeight:600, color:displayCost?'var(--black)':'var(--gray-light)' }}>{displayCost ? formatCurrency(displayCost) : (rowPriced ? 'Awaiting quantity' : waitingLabel)}</div>
                              {!isDoors && econ.totalCostSqft != null && <div style={{ fontSize:12, color:'var(--gray-light)' }}>${econ.totalCostSqft}{sfx}</div>}
                            </div>

                            <div>
                              <div style={dLabel}>Client total</div>
                              <div style={{ fontSize:15, fontWeight:600, color:displayClient?'var(--black)':'var(--gray-light)' }}>{displayClient ? formatCurrency(displayClient) : ''}</div>
                            </div>

                            {!isDoors && (
                              <div>
                                {/* Application first, because that is the
                                    fact about the material. The rooms are the
                                    detail behind it, listed once here rather
                                    than crowding every row of the table. */}
                                <div style={dLabel}>Application</div>
                                <div style={{ fontSize:13, fontWeight:500 }}>
                                  {applicationsFor(item).join(' · ') || '—'}
                                </div>
                                {roomsFor(item).length > 0 && (
                                  <>
                                    <div style={{ ...dLabel, marginTop:'var(--s-3)' }}>
                                      {plural(roomsFor(item).length, 'room')}
                                    </div>
                                    <div style={{ fontSize:12, color:'var(--gray)', lineHeight:'var(--lh-body)' }}>
                                      {roomsFor(item).join(', ')}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                            {isDoors && (
                              <div>
                                <div style={dLabel}>Size</div>
                                <div style={{ fontSize:12 }}>{item.widthInches && item.heightInches ? `${item.widthInches}" × ${item.heightInches}"` : '—'}</div>
                              </div>
                            )}
                          </div>

                          {/* Images */}
                          {(() => {
                            const allImgs = submissions.flatMap(sub => pricingFor(sub, item, i)?.images || []).filter(img => img?.url)
                            if (!allImgs.length) return null
                            return (
                              <div style={{ marginTop:16 }}>
                                <div style={dLabel}>Images</div>
                                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                                  {allImgs.map((img, idx) => (
                                    <img key={idx} src={img.url} alt="" onClick={() => onOpenLightbox(allImgs, idx)}
                                      style={{ width:52, height:52, objectFit:'cover', border:'1px solid var(--border)', cursor:'pointer' }} />
                                  ))}
                                </div>
                              </div>
                            )
                          })()}

                          {/* Provenance. Derived from the submission this
                              price came from — no new column, and it cannot
                              drift from the price it describes. Who approved
                              it and when needs the audit table in
                              supabase-audit-migration.sql. */}
                          {(() => {
                            const src = submissions.find(sub => pricingFor(sub, item, i))
                            if (!src) return null
                            return (
                              <div style={{ marginTop:'var(--s-4)', fontSize:'var(--t-xs)', color:'var(--gray)' }}>
                                Quoted by {src.manufacturer_name}
                                {src.submitted_at && <> · {formatDate(src.submitted_at)}</>}
                                {ap.updated_at && ap.status !== 'pending' && (
                                  <> · {ap.status} {formatDate(ap.updated_at)}</>
                                )}
                              </div>
                            )
                          })()}

                          <ApprovalHistory projectId={projectId} category={schedule.category} itemKey={item.key} />

                         {/* Shipment — full controls. Two independent shipments
                             per item: the product, and any sample sent for it. */}
                          <div style={{ marginTop:16, display:'flex', gap:32, flexWrap:'wrap' }}>
                            <div>
                              <div style={dLabel}>Shipment</div>
                              <ShipmentCell
                                projectId={projectId}
                                category={schedule.category}
                                itemKey={item.key}
                                approval={ap}
                                kind="product"
                                onSaved={onTrackingSaved}
                              />
                            </div>
                            <div style={{ borderLeft:'1px solid var(--border)', paddingLeft:24 }}>
                              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                                <span style={{ ...dLabel, marginBottom:0 }}>Sample shipment</span>
                                <SampleTag />
                              </div>
                              <ShipmentCell
                                projectId={projectId}
                                category={schedule.category}
                                itemKey={item.key}
                                approval={ap}
                                kind="sample"
                                onSaved={onTrackingSaved}
                              />
                            </div>
                          </div>

                          {/* Internal notes — written to approvals.notes, which the
                              client page never reads. Red rail = private. */}
                          <div style={{ marginTop:16 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                              <span style={{ ...dLabel, marginBottom:0 }}>Internal notes</span>
                              <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:12, fontWeight:600, letterSpacing:'0.06em', textTransform:'uppercase', color:'var(--danger)', background:'var(--danger-bg)', border:'1px solid rgba(197,34,31,0.2)', padding:'2px 7px' }}>
                                <i className="ti ti-lock" style={{ fontSize:12 }} />
                                Not visible to client
                              </span>
                            </div>
                            <div style={{ borderLeft:'3px solid var(--danger)', paddingLeft:10 }}>
                              <textarea value={ap.notes||''} onChange={e=>onNoteChange(item.key, e.target.value)} rows={2}
                                placeholder="Internal only — lead times, vendor issues, anything you don't want the client seeing…"
                                style={{ width:'100%', padding:'6px 8px', fontFamily:'var(--font-body)', fontSize:12, background:'transparent', border:'1px solid var(--border)', color:'var(--gray)', resize:'vertical' }} />
                            </div>
                            {ap.client_notes && (
                              <div style={{ fontSize:12, fontStyle:'italic', color:'var(--black)', marginTop:6, padding:'6px 8px', background:'var(--g100)', borderLeft:'2px solid var(--g300)' }}>
                                <span style={{ fontWeight:600, fontStyle:'normal', fontSize:12, letterSpacing:'0.06em', textTransform:'uppercase', display:'block', marginBottom:2 }}>Client note</span>
                                {ap.client_notes}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const dLabel = { fontSize:12, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:4 }
// Compact cell padding for collapsed rows — roughly half the height of td()
const tdTight = { padding:'var(--s-1) var(--s-4)', borderBottom:'1px solid var(--border)', verticalAlign:'middle', fontWeight:400, fontSize:'var(--t-base)' }
const inp = { width:'100%', maxWidth:110, padding:'6px 0', fontFamily:'var(--font-body)', fontSize:14, fontWeight:500, background:'transparent', border:'none', borderBottom:'1px solid var(--border)', color:'var(--black)' }
const resetBtn = { fontSize:12, color:'var(--black)', background:'none', border:'none', cursor:'pointer', padding:0, marginTop:3, textDecoration:'underline', display:'block' }// ── Import Manufacturer CSV Modal ──────────────────────────
function ImportCSVModal({ schedule, category, submissions, projectSlug, onClose, onImported }) {
  const [step, setStep] = useState(1)
  const [manufacturer, setManufacturer] = useState(schedule.manufacturer || '')
  const [csvHeaders, setCsvHeaders] = useState([])
  const [csvRows, setCsvRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

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

  function existingImagesFor(item, index) {
    let best = null
    let anyWithImages = null
    submissions.forEach(sub => {
      const data = pricingFor(sub, item, index)
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
      return { ...item, ...fields, images: existingImagesFor(item, i) }
    })
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectSlug, category: category.id,
        manufacturerName: manufacturer.trim() || schedule.manufacturer || 'Imported',
        pricingData,
        isDraft: true,
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
            <div style={{ fontSize:12, fontWeight:300, color:'var(--gray)', marginTop:4 }}>{category.label} — Step {step} of 3</div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div style={{ padding:'10px 14px', background:'var(--danger-bg)', border:'1px solid var(--danger)', fontSize:12, color:'var(--danger)', marginBottom:20 }}>{error}</div>}
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
                <label style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px', border:'1px dashed var(--border-dark)', cursor:'pointer', background:'var(--g50)', fontSize:12, fontWeight:400, color:'var(--gray)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  Upload CSV from the manufacturer
                  <input type="file" accept=".csv,.txt" style={{ display:'none' }} onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
                </label>
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <div style={{ fontSize:12, fontWeight:400, color:'var(--gray)', marginBottom:16, lineHeight:1.6 }}>
                Match each field below to a column from their CSV. Fields marked <span style={{ color:'var(--black)', fontWeight:600 }}>match</span> are used to line their rows up with your materials.
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {targetFields.map(f => (
                  <div key={f.id} style={{ display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ width:170, flexShrink:0 }}>
                      <div style={{ fontSize:12, fontWeight:500, color:'var(--black)' }}>{f.label}</div>
                      <div style={{ fontSize:12, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--gray-light)', display:'flex', gap:6, marginTop:2 }}>
                        {f.matching && <span style={{ color:'var(--black)' }}>match</span>}
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
              <div style={{ fontSize:12, fontWeight:400, color:'var(--gray-light)', marginTop:16 }}>{csvRows.length} rows found in the uploaded file.</div>
            </div>
          )}
          {step === 3 && result && (
            <div style={{ textAlign:'center', padding:'20px 0' }}>
              <div style={{ fontFamily:'var(--font)', fontSize:32, fontWeight:300, color:'var(--success)', marginBottom:8 }}>Imported</div>
              <div style={{ fontSize:13, color:'var(--gray)', lineHeight:1.7 }}>
                Matched {result.matched} of {result.total} materials on your schedule.
                {result.unmatched > 0 && <><br/>{result.unmatched} row{result.unmatched !== 1 ? 's' : ''} in the CSV didn't match any material.</>}
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
    if (!res.ok) { setSubmitting(false); setError(data.error || 'Could not add this material.'); return }
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
            <div style={{ fontSize:12, fontWeight:300, color:'var(--gray)', marginTop:4 }}>{category.label} Schedule</div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div style={{ padding:'10px 14px', background:'var(--danger-bg)', border:'1px solid var(--danger)', fontSize:12, color:'var(--danger)', marginBottom:20 }}>{error}</div>}
          {done ? (
            <div style={{ textAlign:'center', padding:'20px 0' }}>
              <div style={{ fontFamily:'var(--font)', fontSize:32, fontWeight:300, color:'var(--success)', marginBottom:8 }}>Added</div>
              <div style={{ fontSize:13, color:'var(--gray)', lineHeight:1.7 }}>
                {values.name} is now on your {category.label.toLowerCase()} schedule.
                {parseFloat(priceSqm) > 0 ? ' Its price is already in.' : ' Add a price later via the manufacturer form or a CSV import.'}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize:12, fontWeight:400, color:'var(--gray)', marginBottom:20, lineHeight:1.6 }}>
                For a material that wasn't on the original schedule. Fields marked <span style={{ color:'var(--black)', fontWeight:600 }}>required</span> are what makes it a distinct item.
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                {allFields.map(f => (
                  <div key={f}>
                    <label className="field-label">
                      {fieldLabel(f)}{idFields.includes(f) && <span style={{ color:'var(--black)', fontWeight:600 }}> · required</span>}
                    </label>
                    <input className="field-input" value={values[f]} onChange={e => setValues(prev => ({ ...prev, [f]: e.target.value }))}
                      placeholder={idFields.includes(f) ? `e.g. ${fieldLabel(f)}` : 'Optional'} />
                  </div>
                ))}
              </div>
              <div style={{ borderTop:'1px solid var(--border)', marginTop:20, paddingTop:20 }}>
                <div style={{ fontSize:12, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:14 }}>Price — optional, add now or later</div>
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
      {item.finish && <div style={{ fontFamily:'var(--font)', fontSize:12, fontStyle:'italic', color:'var(--black)', marginTop:2 }}>{item.finish}</div>}
      {item.cut && <div style={{ fontSize:12, fontWeight:400, color:'var(--gray-light)', marginTop:1 }}>{item.cut}</div>}
      {(item.locations||[]).length > 0 && (
        <>
          <button onClick={()=>setOpen(!open)} style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:12, fontWeight:500, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--gray-light)', background:'none', border:'none', cursor:'pointer', padding:0, marginTop:5, transition:'color 0.15s' }}>
            <span style={{ transform:open?'rotate(180deg)':'none', transition:'transform 0.2s', display:'inline-block' }}>▾</span>
            {item.locations.length} location{item.locations.length!==1?'s':''}
          </button>
          {open && (
            <div style={{ fontSize:12, fontWeight:400, color:'var(--gray)', lineHeight:1.9, padding:'8px 12px', background:'var(--g50)', borderLeft:'2px solid var(--g300)', marginTop:5 }}>
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
    padding:'11px 14px', textAlign:'left', fontSize:12, fontWeight:600,
    letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--gray-light)',
    background:'var(--off-white)', borderBottom:'2px solid var(--border)',
    borderTop:'1px solid var(--border)',
    whiteSpace:'nowrap', minWidth,
  }
}
// 8px rather than 14px top and bottom. Across 52 rows that is the
// difference between ten rows on a laptop and thirteen — and the row is
// what the page is for.
function td() {
  return { padding:'var(--s-2) var(--s-4)', borderBottom:'1px solid var(--border)', verticalAlign:'middle', fontWeight:400, fontSize:'var(--t-base)' }
}
