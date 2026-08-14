'use client'

import { useState, useEffect, useRef } from 'react'
import { getCategory } from '@/lib/categories'
import { pricingFor, SQM_TO_SQFT } from '@/lib/pricing'
import { buildPricingCsv, pricingCsvFilename } from '@/lib/pricingCsv'

const MAX_IMG_WIDTH = 900 // compress phone photos to this width

export default function ManufacturerForm({ params }) {
  const { slug, category: categoryId } = params
  const [project, setProject] = useState(null)
  const [schedule, setSchedule] = useState(null)
  const [category, setCategory] = useState(null)
  const [formData, setFormData] = useState({})
  const [imageData, setImageData] = useState({}) // { itemIndex: [{ url, name }] }
  const [designData, setDesignData] = useState({}) // doors only: { itemIndex: [{ url, name }] }
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [error, setError] = useState('')
  const [uploadingFor, setUploadingFor] = useState(null) // item index currently uploading
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [copyEmail, setCopyEmail] = useState('')
  const [submittedTo, setSubmittedTo] = useState('')
  const saveTimer = useRef(null)

  useEffect(() => { loadData() }, [slug, categoryId])

  // The token identifies the vendor, so every call carries it — the URL
  // alone no longer says who is here.
  const [token, setToken] = useState(null)
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('t') || '')
  }, [])

  function formEndpoint(path = '') {
    const t = token ?? (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('t') || '' : '')
    return `/api/form/${encodeURIComponent(slug)}/${encodeURIComponent(categoryId)}${path}?t=${encodeURIComponent(t)}`
  }

  async function loadData() {
    // Goes through a public server route rather than querying Supabase
    // directly. The browser here has no signed-in user, and RLS no longer
    // lets the anon key read projects or schedules.
    const res = await fetch(formEndpoint())
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not load this form.')
      setLoading(false)
      return
    }
    const { project: proj, schedule: sched, existingSubmission: existingSub } = await res.json()
    setProject(proj)
    setSchedule(sched)

    const cat = getCategory(categoryId)
    if (!cat) { setError('Unknown category'); setLoading(false); return }
    setCategory(cat)

    const initial = {}
    const imgs = {}
    const designs = {}
    sched.items.forEach((item, i) => {
      const existing = pricingFor(existingSub, item, i)
      if (cat.id === 'doors') {
        initial[i] = {
          unitPrice: existing?.unitPrice || '',
          notes: existing?.notes || '',
        }
      } else {
        initial[i] = {
          priceSqm: existing?.priceSqm || '',
          moq: existing?.moq || '',
          volBreakQty: existing?.volBreakQty || '',
          volBreakPrice: existing?.volBreakPrice || '',
          notes: existing?.notes || '',
        }
      }
      if (existing?.images?.length) imgs[i] = existing.images
      if (existing?.designOptions?.length) designs[i] = existing.designOptions
    })
    setFormData(initial)
    setImageData(imgs)
    setDesignData(designs)
    if (existingSub) setLastSaved(new Date(existingSub.submitted_at))
    setLoading(false)
  }

  function updateField(itemIndex, fieldId, value) {
    const updated = { ...formData, [itemIndex]: { ...formData[itemIndex], [fieldId]: value } }
    setFormData(updated)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveDraft(updated, imageData, designData), 2000)
  }

  // Compress image to max width before uploading
  async function compressImage(file) {
    return new Promise((resolve) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let { width, height } = img
        if (width > MAX_IMG_WIDTH) {
          height = Math.round((height * MAX_IMG_WIDTH) / width)
          width = MAX_IMG_WIDTH
        }
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url)
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }))
        }, 'image/jpeg', 0.82)
      }
      img.src = url
    })
  }

  // Uploads go through a public server route instead of straight to Supabase
  // Storage, so the browser never holds write credentials for the bucket.
  async function uploadImage(file, kind) {
    const compressed = await compressImage(file)
    const body = new FormData()
    body.append('file', compressed)
    if (kind) body.append('kind', kind)
    const res = await fetch(formEndpoint('/upload'), { method: 'POST', body })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || 'Upload failed')
    }
    const { url } = await res.json()
    return { url, name: file.name }
  }

  async function handleImages(itemIndex, files) {
    setUploadingFor(itemIndex)
    const uploaded = [...(imageData[itemIndex] || [])]

    for (const file of Array.from(files)) {
      try {
        uploaded.push(await uploadImage(file))
      } catch (e) {
        console.error('Image error:', e)
      }
    }

    const newImageData = { ...imageData, [itemIndex]: uploaded }
    setImageData(newImageData)
    setUploadingFor(null)

    // Auto-save after image upload
    clearTimeout(saveTimer.current)
    saveDraft(formData, newImageData, designData)
  }

  async function handleDesignImages(itemIndex, files) {
    const existing = designData[itemIndex] || []
    const remaining = 5 - existing.length
    if (remaining <= 0) return
    setUploadingFor(`design-${itemIndex}`)
    const uploaded = [...existing]

    for (const file of Array.from(files).slice(0, remaining)) {
      try {
        uploaded.push(await uploadImage(file, 'design'))
      } catch (e) {
        console.error('Design image error:', e)
      }
    }

    const newDesignData = { ...designData, [itemIndex]: uploaded }
    setDesignData(newDesignData)
    setUploadingFor(null)
    clearTimeout(saveTimer.current)
    saveDraft(formData, imageData, newDesignData)
  }

  function removeDesignImage(itemIndex, imgIndex) {
    const updated = [...(designData[itemIndex] || [])]
    updated.splice(imgIndex, 1)
    const newDesignData = { ...designData, [itemIndex]: updated }
    setDesignData(newDesignData)
    clearTimeout(saveTimer.current)
    saveDraft(formData, imageData, newDesignData)
  }

  function buildPricingData(data, imgs, designs) {
    return (schedule?.items || []).map((item, i) => {
      const d = { ...data[i] }
      if (d.priceSqm) d.priceSqft = parseFloat((parseFloat(d.priceSqm) / SQM_TO_SQFT).toFixed(2))
      d.images = imgs[i] || []
      d.designOptions = designs?.[i] || []
      return { ...item, ...d }
    })
  }

  async function saveDraft(data, imgs, designs) {
    if (!project || !schedule) return
    setSaving(true)
    await fetch(formEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pricingData: buildPricingData(data, imgs || imageData, designs || designData),
        isDraft: true,
      }),
    })
    setSaving(false)
    setLastSaved(new Date())
  }

  function openConfirm() {
    let remembered = ''
    try { remembered = window.localStorage.getItem('re-pricing-copy-email') || '' } catch {}
    setCopyEmail(prev => prev || remembered)
    setError('')
    setConfirmOpen(true)
  }

  // Submitting is a two-step now: confirm where the copy goes, then send.
  // The address is only ever used to mail this receipt back.
  async function submit(copyEmail) {
    setSubmitting(true)
    setError('')
    const res = await fetch(formEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pricingData: buildPricingData(formData, imageData, designData),
        copyEmail: copyEmail || null,
      }),
    })
    setSubmitting(false)
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Submission failed.'); return }
    // Remembered so a vendor pricing a second category doesn't retype it.
    if (copyEmail) {
      try { window.localStorage.setItem('re-pricing-copy-email', copyEmail) } catch {}
    }
    setConfirmOpen(false)
    setSubmittedTo(copyEmail || '')
    setSubmitted(true)
  }

  // Lets the manufacturer download what they've entered so far as a CSV —
  // useful for their own records, or to forward internally before submitting.
  function exportMyCSV() {
    if (!schedule || !category) return
    // Same builder the emailed copy uses, so the download and the receipt
    // are the same file.
    const csv = buildPricingCsv(categoryId, buildPricingData(formData, imageData, designData))
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = pricingCsvFilename(schedule.manufacturer, categoryId)
    a.click()
  }

  const isDoors = category?.id === 'doors'
  const filledCount = isDoors
    ? Object.keys(designData).filter(k => (designData[k] || []).some(d => d.unitPrice)).length
    : Object.values(formData).filter(d => d.priceSqm).length
  const totalCount = schedule?.items?.length || 0

  if (loading) return <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}><div className="spinner"/></div>

  if (error && !project) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:40 }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontFamily:'var(--font)', fontSize:32, fontWeight:300, marginBottom:8 }}>Not Found</div>
        <div style={{ fontSize:13, color:'var(--gray)' }}>{error}</div>
      </div>
    </div>
  )

  if (submitted) return (
    <div style={{ minHeight:'100vh', background:'var(--black)', display:'flex', alignItems:'center', justifyContent:'center', padding:40 }}>
      <div style={{ textAlign:'center', maxWidth:480 }}>
        <div style={{ fontSize:12, fontWeight:600, letterSpacing:'0.22em', textTransform:'uppercase', color:'var(--g300)', marginBottom:24 }}>Submission Received</div>
        <div style={{ fontFamily:'var(--font)', fontSize:56, fontWeight:200, color:'#f7f5f0', lineHeight:1, marginBottom:16 }}>Thank you.</div>
        <div style={{ fontSize:13, fontWeight:400, color:'rgba(247,245,240,0.5)', lineHeight:1.7 }}>
          Your pricing has been submitted. You can return to this link at any time to update.
          {submittedTo && <> A copy has been emailed to <span style={{ color:'var(--g300)' }}>{submittedTo}</span>.</>}
        </div>
        <button onClick={() => setSubmitted(false)} style={{ marginTop:32, padding:'12px 28px', fontSize:12, fontWeight:600, letterSpacing:'0.14em', textTransform:'uppercase', background:'transparent', border:'1px solid rgba(247,245,240,0.2)', color:'rgba(247,245,240,0.6)', cursor:'pointer' }}>Return & Edit</button>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--off-white)' }}>
      <div style={{ background:'var(--black)', padding:'0 40px', height:60, display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:100 }}>
        <div style={{ fontFamily:'var(--font)', fontSize:18, fontWeight:300, color:'#f7f5f0', letterSpacing:'0.06em' }}>
          Relative <span style={{ color:'var(--g600)', fontWeight:400 }}>Estate</span>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:12, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'rgba(255,255,255,0.35)' }}>{category?.label} Pricing Request</div>
          <div style={{ fontFamily:'var(--font)', fontSize:14, fontStyle:'italic', color:'var(--g300)', marginTop:1 }}>{project?.name}</div>
        </div>
      </div>

      <div style={{ background:'var(--white)', borderBottom:'1px solid var(--border)', padding:'10px 40px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, position:'sticky', top:60, zIndex:99 }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <div style={{ width:160, height:4, background:'var(--border)', borderRadius:2, overflow:'hidden' }}>
            <div style={{ height:'100%', background:'var(--black)', width:`${totalCount>0?Math.round((filledCount/totalCount)*100):0}%`, borderRadius:2, transition:'width 0.3s' }} />
          </div>
          <span style={{ fontSize:12, fontWeight:500, color:'var(--gray)' }}>{filledCount} of {totalCount} items priced</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          {saving && <span style={{ fontSize:12, color:'var(--gray-light)' }}>Saving…</span>}
          {!saving && lastSaved && <span style={{ fontSize:12, color:'var(--gray-light)' }}>Last saved {lastSaved.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</span>}
          <button className="btn btn-outline btn-sm" onClick={exportMyCSV}>Export CSV</button>
          <button className="btn btn-black btn-sm" onClick={openConfirm} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Pricing →'}</button>
        </div>
      </div>

      {/* Full-bleed, same as the internal pages — 52 materials in a narrow
          column meant scrolling sideways to reach the notes field. page-body
          also picks up the shared mobile gutters. */}
      <div className="page-body" style={{ padding:'32px 56px 80px' }}>
        <div style={{ background:'var(--g100)', border:'1px solid var(--g300)', padding:'14px 18px', marginBottom:24, display:'flex', gap:14, alignItems:'flex-start' }}>
          <div style={{ fontSize:16, color:'var(--black)', flexShrink:0 }}>ℹ</div>
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--black)', marginBottom:3 }}>Instructions</div>
            <div style={{ fontSize:12, fontWeight:400, color:'var(--gray)', lineHeight:1.6 }}>
              {isDoors
                ? 'Enter your unit price per door below, and upload up to five design options for each. Progress saves as you type — you can close this and come back to the same link.'
                : 'Enter your price for each material below. Progress saves as you type — you can close this and come back to the same link, on any device.'}
              {' '}Only the price is required; everything else is optional.
            </div>
          </div>
        </div>

        {error && <div style={{ padding:'10px 14px', background:'var(--danger-bg)', border:'1px solid var(--danger)', fontSize:12, color:'var(--danger)', marginBottom:20 }}>{error}</div>}

        <div className="table-scroll" style={{ overflowX:'auto' }}>
          <table className="card-table" style={{ width:'100%', borderCollapse:'collapse', fontSize:'var(--t-sm)' }}>
            <thead>
              {isDoors ? (
                <tr>
                  <th style={fth('60px')}>NO</th>
                  <th style={fth('120px')}>Location</th>
                  <th style={fth('140px')}>Description</th>
                  <th style={fth('90px')}>Size</th>
                  <th style={fth('90px')}>Door Type</th>
                  <th style={fth('300px')}>Design Options &amp; Unit Price (up to 5)</th>
                  <th style={fth('180px')}>Notes</th>
                </tr>
              ) : (
                <tr>
                  <th style={fth('180px')}>Material</th>
                  <th style={fth('110px')}>Price / sqm ($) *</th>
                  <th style={fth('90px')}>Min Order</th>
                  <th style={fth('90px')}>Vol Break</th>
                  <th style={fth('100px')}>Vol Price / sqm</th>
                  <th style={fth('120px')}>Images</th>
                  <th style={fth('200px')}>Notes</th>
                </tr>
              )}
            </thead>
            <tbody>
              {schedule?.items?.map((item, i) => {
                const d = formData[i] || {}
                const imgs = imageData[i] || []
                const designs = designData[i] || []
                const hasPrice = isDoors ? (designs.some(d => d.unitPrice)) : !!d.priceSqm
                const isUploading = uploadingFor === i
                const isUploadingDesign = uploadingFor === `design-${i}`
                return (
                  <tr key={i} style={{ background:hasPrice?'#f0faf3':'var(--white)', transition:'background 0.2s' }}>

                    {isDoors ? (
                      <>
                        <td style={ftd()}><div style={{ fontSize:13, fontWeight:700 }}>{item.no}</div></td>
                        <td style={ftd()}><div style={{ fontSize:12, color:'var(--gray)' }}>{item.location || '—'}</div></td>
                        <td style={ftd()}>
                          <div style={{ fontSize:12, color:'var(--gray)', lineHeight:1.4, maxHeight:100, overflowY:'auto' }}>
                            {item.description || '—'}
                          </div>
                        </td>
                        <td style={ftd()}>
                          <div style={{ fontSize:12, lineHeight:1.5 }}>
                            {item.widthInches && item.heightInches ? `${item.widthInches}" × ${item.heightInches}"` : '—'}
                            {item.thickMm && <div style={{ fontSize:12, color:'var(--gray-light)' }}>{item.thickMm} thick</div>}
                          </div>
                        </td>
                        <td style={ftd()}><div style={{ fontSize:12, fontWeight:500, color:'var(--black)' }}>{item.type || '—'}</div></td>
                        <td style={ftd()}>
                          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                            {designs.map((img, idx) => (
                              <div key={idx} style={{ display:'flex', gap:6, alignItems:'center', padding:'4px 0', borderBottom: idx < designs.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                <div style={{ position:'relative', flexShrink:0 }}>
                                  <img src={img.url} alt={img.name}
                                    style={{ width:48, height:48, objectFit:'cover', border:'2px solid var(--black)' }}
                                    title={`Option ${idx+1}: ${img.name}`}
                                  />
                                  <div style={{ position:'absolute', top:-4, left:-4, width:16, height:16, background:'var(--black)', color:'white', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'50%' }}>{idx+1}</div>
                                  <button onClick={() => removeDesignImage(i, idx)}
                                    style={{ position:'absolute', top:-4, right:-4, width:16, height:16, background:'var(--danger)', color:'white', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'50%', border:'none', cursor:'pointer', lineHeight:1 }}>×</button>
                                </div>
                                <div style={{ flex:1 }}>
                                  <div style={{ fontSize:12, color:'var(--gray-light)', marginBottom:2 }}>Unit Price</div>
                                  <input type="number" step="0.01" min="0" placeholder="0.00"
                                    value={img.unitPrice || ''}
                                    onChange={e => {
                                      const updated = [...designs]
                                      updated[idx] = { ...updated[idx], unitPrice: e.target.value }
                                      const newDesignData = { ...designData, [i]: updated }
                                      setDesignData(newDesignData)
                                      clearTimeout(saveTimer.current)
                                      saveTimer.current = setTimeout(() => saveDraft(formData, imageData, newDesignData), 2000)
                                    }}
                                    style={{ width:80, padding:'4px 6px', fontSize:13, fontWeight:600, border:'1px solid var(--border)', color:'var(--black)', fontFamily:'var(--font-body)' }}
                                  />
                                </div>
                              </div>
                            ))}
                            {designs.length < 5 && (
                              <label style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', width:'100%', height:40, background:'var(--g50)', border:`1px dashed ${isUploadingDesign?'var(--black)':'var(--border-dark)'}`, cursor:'pointer', gap:2, transition:'all 0.15s' }}>
                                {isUploadingDesign ? (
                                  <div style={{ width:14, height:14, border:'1.5px solid var(--border)', borderTopColor:'var(--black)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }}/>
                                ) : (
                                  <span style={{ fontSize:12, color:'var(--gray-light)', letterSpacing:'0.08em' }}>+ Add Design Option ({designs.length}/5)</span>
                                )}
                                <input type="file" accept="image/*" multiple style={{ display:'none' }} disabled={isUploadingDesign}
                                  onChange={e => handleDesignImages(i, e.target.files)}/>
                              </label>
                            )}
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={ftd()}>
                          <div style={{ fontSize:13, fontWeight:600, color:'var(--black)' }}>{item.name}</div>
                          <div style={{ fontFamily:'var(--font)', fontSize:12, fontStyle:'italic', color:'var(--black)', marginTop:1 }}>{item.finish}</div>
                          {item.cut && <div style={{ fontSize:12, color:'var(--gray-light)' }}>{item.cut}</div>}
                          {/* Room list intentionally not shown — the manufacturer
                              prices the material, not the rooms it lands in. The
                              locations still travel on the item and still reach
                              the internal dashboard and the CSV export. */}
                        </td>
                        <td data-label="Price / sqm" style={ftd()}><input type="number" value={d.priceSqm||''} onChange={e=>updateField(i,'priceSqm',e.target.value)} placeholder="0.00" min="0" step="0.01" style={inp(hasPrice)}/></td>
                        <td data-label="Min order" style={ftd()}><input type="number" value={d.moq||''} onChange={e=>updateField(i,'moq',e.target.value)} placeholder="0" min="0" style={inp(false)}/></td>
                        <td data-label="Vol break" style={ftd()}><input type="number" value={d.volBreakQty||''} onChange={e=>updateField(i,'volBreakQty',e.target.value)} placeholder="0" min="0" style={inp(false)}/></td>
                        <td data-label="Vol price / sqm" style={ftd()}><input type="number" value={d.volBreakPrice||''} onChange={e=>updateField(i,'volBreakPrice',e.target.value)} placeholder="0.00" min="0" step="0.01" style={inp(false)}/></td>
                        <td data-label="Photos" style={ftd()}>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:4, alignItems:'center' }}>
                            {imgs.map((img, idx) => (
                              <img key={idx} src={img.url} alt={img.name}
                                style={{ width:40, height:40, objectFit:'cover', border:'1px solid var(--border)', cursor:'pointer' }}
                                title={img.name}
                              />
                            ))}
                            <label style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', width:40, height:40, background:'var(--g50)', border:`1px dashed ${isUploading?'var(--black)':'var(--border-dark)'}`, cursor:'pointer', gap:2, flexShrink:0, transition:'all 0.15s' }}>
                              {isUploading ? (
                                <div style={{ width:14, height:14, border:'1.5px solid var(--border)', borderTopColor:'var(--black)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }}/>
                              ) : (
                                <>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--black)" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                                  <span style={{ fontSize:7, color:'var(--gray-light)', letterSpacing:'0.08em', textTransform:'uppercase' }}>Add</span>
                                </>
                              )}
                              <input type="file" accept="image/*" multiple style={{ display:'none' }} disabled={isUploading}
                                onChange={e => handleImages(i, e.target.files)}/>
                            </label>
                          </div>
                        </td>
                      </>
                    )}

                    <td data-label="Notes" style={ftd()}><input type="text" value={d.notes||''} onChange={e=>updateField(i,'notes',e.target.value)} placeholder={isDoors ? 'Hardware, fire rating, notes…' : 'Lead time, availability, notes…'} style={{ ...inp(false), width:'100%' }}/></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:16, paddingTop:24, borderTop:'1px solid var(--border)', marginTop:24 }}>
          <div style={{ fontSize:12, fontWeight:400, color:'var(--gray)' }}>{filledCount} of {totalCount} items priced · Results sent to emma@relativeestates.com</div>
          <div style={{ display:'flex', gap:10 }}>
            <button className="btn btn-outline btn-lg" onClick={exportMyCSV}>Export CSV</button>
            <button className="btn btn-black btn-lg" onClick={openConfirm} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Pricing →'}</button>
          </div>
        </div>
      </div>

      {/* Pinned so the next action is always in reach — on a phone the
          desktop header is at the top of a very long page, and the footer
          button is fifty-two materials away. */}
      <div className="form-actionbar">
        <div style={{ fontSize:'var(--t-xs)', color:'var(--gray)' }}>
          <strong style={{ color:'var(--black)', fontWeight:500 }}>{filledCount} of {totalCount}</strong> priced
          {saving ? ' · saving…' : lastSaved ? ' · saved' : ''}
        </div>
        <button className="btn btn-black btn-sm" onClick={openConfirm} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit pricing'}
        </button>
      </div>

      {confirmOpen && (
        <SubmitConfirm
          filledCount={filledCount}
          totalCount={totalCount}
          email={copyEmail}
          onEmailChange={setCopyEmail}
          submitting={submitting}
          error={error}
          onCancel={() => setConfirmOpen(false)}
          onSubmit={submit}
        />
      )}
    </div>
  )
}

// Confirm step on submit. The email is optional — leaving it blank still
// submits, it just means no copy comes back. The address is used for this
// one receipt and nothing else.
function SubmitConfirm({ filledCount, totalCount, email, onEmailChange, submitting, error, onCancel, onSubmit }) {
  const [touched, setTouched] = useState(false)
  const trimmed = (email || '').trim()
  const looksValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)
  const invalid = trimmed.length > 0 && !looksValid
  const unpriced = totalCount - filledCount

  return (
    <div
      onClick={e => e.target === e.currentTarget && !submitting && onCancel()}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:900, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}
    >
      <div style={{ background:'var(--white)', width:'100%', maxWidth:460 }}>
        <div style={{ padding:'22px 26px', borderBottom:'1px solid var(--border)' }}>
          <div style={{ fontFamily:'var(--font)', fontSize:22, fontWeight:300 }}>Submit your pricing</div>
          <div style={{ fontSize:12, color:'var(--gray)', marginTop:4 }}>
            {filledCount} of {totalCount} items priced
            {unpriced > 0 && <span style={{ color:'var(--black)' }}> · {unpriced} still blank</span>}
          </div>
        </div>

        <div style={{ padding:'22px 26px' }}>
          <label style={{ fontSize:12, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--gray-light)', display:'block' }}>
            Email me a copy (optional)
            <input
              type="email"
              value={email}
              onChange={e => onEmailChange(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="you@company.com"
              autoFocus
              style={{ width:'100%', marginTop:6, padding:'9px 10px', fontFamily:'var(--font-body)', fontSize:14, border:`1px solid ${invalid && touched ? 'var(--danger)' : 'var(--border-dark)'}`, color:'var(--black)', outline:'none' }}
            />
          </label>
          <div style={{ fontSize:12, color:'var(--gray-light)', marginTop:8, lineHeight:1.6 }}>
            {invalid && touched
              ? <span style={{ color:'var(--danger)' }}>That doesn’t look like an email address.</span>
              : 'We’ll send a CSV of everything you entered, for your records. Leave blank to submit without a copy.'}
          </div>

          {error && (
            <div style={{ marginTop:14, padding:'9px 12px', background:'var(--danger-bg)', border:'1px solid var(--danger)', fontSize:12, color:'var(--danger)' }}>{error}</div>
          )}
        </div>

        <div style={{ padding:'16px 26px', borderTop:'1px solid var(--border)', display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button className="btn btn-outline btn-sm" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button className="btn btn-black btn-sm" disabled={submitting || invalid} onClick={() => onSubmit(looksValid ? trimmed : '')}>
            {submitting ? 'Submitting…' : trimmed ? 'Submit & email copy →' : 'Submit pricing →'}
          </button>
        </div>
      </div>
    </div>
  )
}

function fth(minWidth) {
  return { padding:'10px 12px', textAlign:'left', fontSize:12, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--gray-light)', background:'var(--g50)', borderBottom:'2px solid var(--black)', whiteSpace:'nowrap', minWidth }
}
function ftd() {
  return { padding:'8px 10px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' }
}
function inp(filled) {
  return { width:'100%', padding:'6px 8px', fontSize:13, fontWeight:filled?600:400, background:filled?'white':'transparent', border:'1px solid', borderColor:filled?'var(--black)':'var(--border)', color:'var(--black)', transition:'all 0.15s', fontFamily:'var(--font-body)', outline:'none' }
}
