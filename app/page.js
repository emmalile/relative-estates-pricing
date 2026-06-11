'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { allCategories, parseCSVForCategory } from '@/lib/categories'
import { formatDate, slugify } from '@/lib/utils'

export default function AdminHome() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNewModal, setShowNewModal] = useState(false)
  const [updateTarget, setUpdateTarget] = useState(null) // { project, category }

  useEffect(() => {
    loadProjects()
  }, [])

  async function loadProjects() {
    const { data } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    setProjects(data || [])
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--off-white)' }}>
      {/* Top bar */}
      <div style={{
        background: 'var(--black)', padding: '0 48px', height: 64,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 300,
            color: '#f7f5f0', letterSpacing: '0.06em',
          }}>
            Relative <span style={{ color: 'var(--gold-light)' }}>Estates</span>
          </div>
          <div style={{
            fontSize: 9, fontWeight: 400, letterSpacing: '0.2em',
            textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)',
          }}>
            Material Pricing System
          </div>
        </div>
        <button className="btn btn-gold btn-sm" onClick={() => setShowNewModal(true)}>
          + New Project
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '48px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ marginBottom: 40 }}>
          <div className="page-eyebrow">Admin</div>
          <div className="page-title">
            All <em>Projects</em>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
            <div className="spinner" />
          </div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No projects yet</div>
            <div className="empty-state-sub">Create your first project to get started</div>
            <button className="btn btn-black" onClick={() => setShowNewModal(true)}>
              Create Project
            </button>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 16,
          }}>
            {projects.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                onUpdateCSV={(category) => setUpdateTarget({ project, category })}
              />
            ))}
          </div>
        )}
      </div>

      {showNewModal && (
        <NewProjectModal
          onClose={() => setShowNewModal(false)}
          onCreate={(p) => {
            setProjects([p, ...projects])
            setShowNewModal(false)
          }}
        />
      )}

      {updateTarget && (
        <UpdateCSVModal
          project={updateTarget.project}
          category={updateTarget.category}
          onClose={() => setUpdateTarget(null)}
          onUpdated={() => {
            setUpdateTarget(null)
            alert('Schedule updated successfully.')
          }}
        />
      )}
    </div>
  )
}

// ── Project Card ─────────────────────────────────────────
function ProjectCard({ project, onUpdateCSV }) {
  const categories = project.categories || []
  return (
    <div
      className="card"
      style={{ cursor: 'pointer', transition: 'border-color 0.2s' }}
      onClick={() => window.location.href = `/projects/${project.slug}/dashboard`}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--gold-light)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 300, color: 'var(--black)',
        }}>
          {project.name}
        </div>
        <span className={`badge badge-${project.status}`}>{project.status}</span>
      </div>

      <div style={{ fontSize: 12, fontWeight: 300, color: 'var(--gray)', marginBottom: 16 }}>
        {project.client && `${project.client} · `}{formatDate(project.created_at)}
      </div>

      {/* Category pills with update button */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {categories.map(cat => {
          const catDef = allCategories.find(c => c.id === cat)
          return (
            <div key={cat} style={{
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              background: 'var(--gold-pale)',
              border: '1px solid rgba(154,122,74,0.2)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, color: 'var(--gold)' }}>{catDef?.icon}</span>
                <span style={{
                  fontSize: 9, fontWeight: 400, letterSpacing: '0.12em',
                  textTransform: 'uppercase', color: 'var(--gold)',
                }}>
                  {cat}
                </span>
              </div>
              <button
                className="btn btn-outline btn-sm"
                style={{ fontSize: 8, padding: '4px 10px' }}
                onClick={e => {
                  e.stopPropagation()
                  onUpdateCSV(cat)
                }}
              >
                Update CSV
              </button>
            </div>
          )
        })}
      </div>

      {/* Links */}
      <div style={{
        display: 'flex', gap: 8, paddingTop: 16,
        borderTop: '1px solid var(--border)',
        flexWrap: 'wrap',
      }}>
        <button
          className="btn btn-outline btn-sm"
          onClick={e => {
            e.stopPropagation()
            navigator.clipboard?.writeText(
              `${window.location.origin}/projects/${project.slug}/dashboard`
            )
            alert('Dashboard link copied')
          }}
        >
          Copy Dashboard Link
        </button>
        <button
          className="btn btn-black btn-sm"
          onClick={e => {
            e.stopPropagation()
            window.location.href = `/projects/${project.slug}/dashboard`
          }}
        >
          Open Dashboard →
        </button>
      </div>
    </div>
  )
}

// ── Update CSV Modal ──────────────────────────────────────
function UpdateCSVModal({ project, category, onClose, onUpdated }) {
  const [items, setItems] = useState(null)
  const [itemCount, setItemCount] = useState(0)
  const [manufacturer, setManufacturer] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const catDef = allCategories.find(c => c.id === category)

  // Load current manufacturer name
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('schedules')
        .select('manufacturer, items')
        .eq('project_id', project.id)
        .eq('category', category)
        .single()
      if (data) {
        setManufacturer(data.manufacturer || '')
        setItemCount(data.items?.length || 0)
      }
    }
    load()
  }, [project.id, category])

  async function handleCSV(file) {
    const text = await file.text()
    const parsed = parseCSVForCategory(text, category)
    setItems(parsed)
    setItemCount(parsed.length)
  }

  async function save() {
    setSaving(true)
    setError('')

    const updates = { manufacturer }
    if (items) updates.items = items

    const res = await fetch('/api/schedules', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        category,
        ...updates,
      }),
    })

    setSaving(false)

    if (!res.ok) {
      const d = await res.json()
      setError(d.error || 'Update failed. Please try again.')
      return
    }

    onUpdated()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div>
            <div className="modal-title">
              Update {catDef?.label || category} Schedule
            </div>
            <div style={{ fontSize: 11, fontWeight: 300, color: 'var(--gray)', marginTop: 4 }}>
              {project.name}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{
              padding: '10px 14px', background: 'var(--danger-bg)',
              border: '1px solid var(--danger)', fontSize: 12,
              color: 'var(--danger)', marginBottom: 20,
            }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <label className="field-label">Manufacturer Name</label>
            <input
              className="field-input"
              value={manufacturer}
              onChange={e => setManufacturer(e.target.value)}
              placeholder="e.g. Stone Source International"
            />
          </div>

          <div>
            <label className="field-label">Replace CSV Schedule</label>
            <div style={{
              fontSize: 11, fontWeight: 300, color: 'var(--gray)',
              marginBottom: 10, lineHeight: 1.6,
            }}>
              Current schedule has <strong>{itemCount} items</strong>.
              Upload a new CSV to replace it. The old schedule will be overwritten.
            </div>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 16px',
              border: '1px dashed var(--border-dark)',
              cursor: 'pointer',
              background: items ? 'var(--success-bg)' : 'var(--cream)',
              transition: 'background 0.2s',
              fontSize: 12, fontWeight: 300,
              color: items ? 'var(--success)' : 'var(--gray)',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              {items
                ? `✓ New CSV ready — ${itemCount} items parsed`
                : 'Upload new CSV to replace current schedule'
              }
              <input
                type="file"
                accept=".csv,.txt"
                style={{ display: 'none' }}
                onChange={e => e.target.files[0] && handleCSV(e.target.files[0])}
              />
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-black btn-sm"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── New Project Modal ─────────────────────────────────────
function NewProjectModal({ onClose, onCreate }) {
  const [step, setStep] = useState(1) // 1: details, 2: categories, 3: upload CSVs
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [selectedCats, setSelectedCats] = useState([])
  const [catData, setCatData] = useState({}) // { stone: { manufacturer, items } }
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  function toggleCat(catId) {
    setSelectedCats(prev =>
      prev.includes(catId) ? prev.filter(c => c !== catId) : [...prev, catId]
    )
  }

  function updateCatData(catId, field, value) {
    setCatData(prev => ({
      ...prev,
      [catId]: { ...prev[catId], [field]: value }
    }))
  }

  async function handleCSV(catId, file) {
    const text = await file.text()
    const items = parseCSVForCategory(text, catId)
    updateCatData(catId, 'items', items)
    updateCatData(catId, 'itemCount', items.length)
  }

  async function create() {
    if (!name.trim()) { setError('Project name is required'); return }
    if (selectedCats.length === 0) { setError('Select at least one category'); return }

    setCreating(true)
    setError('')

    const schedules = selectedCats
      .filter(cat => catData[cat]?.items?.length > 0)
      .map(cat => ({
        category: cat,
        manufacturer: catData[cat]?.manufacturer || '',
        items: catData[cat]?.items || [],
      }))

    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        client: client.trim(),
        categories: selectedCats,
        schedules,
      }),
    })

    const data = await res.json()
    setCreating(false)

    if (!res.ok) {
      setError(data.error || 'Something went wrong')
      return
    }

    onCreate(data)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div>
            <div className="modal-title">New Project</div>
            <div style={{ fontSize: 11, fontWeight: 300, color: 'var(--gray)', marginTop: 4 }}>
              Step {step} of 3
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{
              padding: '10px 14px', background: 'var(--danger-bg)',
              border: '1px solid var(--danger)', fontSize: 12,
              color: 'var(--danger)', marginBottom: 20,
            }}>
              {error}
            </div>
          )}

          {/* Step 1 — Project Details */}
          {step === 1 && (
            <div>
              <div style={{ marginBottom: 20 }}>
                <label className="field-label">Project Name *</label>
                <input
                  className="field-input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Residence at Oak Hill"
                  autoFocus
                />
              </div>
              <div>
                <label className="field-label">Client / Location</label>
                <input
                  className="field-input"
                  value={client}
                  onChange={e => setClient(e.target.value)}
                  placeholder="e.g. Private Client · Kansas City, MO"
                />
              </div>
              {name && (
                <div style={{
                  marginTop: 16, padding: '10px 14px',
                  background: 'var(--cream)', fontSize: 11,
                  color: 'var(--gray)', fontWeight: 300,
                }}>
                  URL will be: <strong style={{ color: 'var(--gold)' }}>
                    /projects/{slugify(name)}/dashboard
                  </strong>
                </div>
              )}
            </div>
          )}

          {/* Step 2 — Select Categories */}
          {step === 2 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 300, color: 'var(--gray)', marginBottom: 20 }}>
                Select all material categories for this project.
                You can always add more later.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {allCategories.map(cat => {
                  const selected = selectedCats.includes(cat.id)
                  const isLive = cat.status === 'live'
                  return (
                    <div
                      key={cat.id}
                      onClick={() => isLive && toggleCat(cat.id)}
                      style={{
                        padding: '16px 20px',
                        border: `1px solid ${selected ? 'var(--black)' : 'var(--border)'}`,
                        background: selected ? 'var(--black)' : 'var(--white)',
                        cursor: isLive ? 'pointer' : 'not-allowed',
                        opacity: isLive ? 1 : 0.45,
                        transition: 'all 0.15s',
                        position: 'relative',
                      }}
                    >
                      <div style={{
                        fontSize: 18, marginBottom: 4,
                        color: selected ? 'var(--gold-light)' : 'var(--gray-light)',
                      }}>
                        {cat.icon}
                      </div>
                      <div style={{
                        fontSize: 13, fontWeight: 400,
                        color: selected ? 'var(--off-white)' : 'var(--black)',
                      }}>
                        {cat.label}
                      </div>
                      <div style={{
                        fontSize: 10, fontWeight: 300,
                        color: selected ? 'rgba(247,245,240,0.5)' : 'var(--gray-light)',
                        marginTop: 2,
                      }}>
                        {cat.description}
                      </div>
                      {!isLive && (
                        <div style={{
                          position: 'absolute', top: 8, right: 8,
                          fontSize: 7, letterSpacing: '0.14em', textTransform: 'uppercase',
                          color: 'var(--gray-light)',
                          padding: '2px 6px', border: '1px solid var(--border)',
                        }}>
                          Soon
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Step 3 — Upload CSVs per category */}
          {step === 3 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 300, color: 'var(--gray)', marginBottom: 24 }}>
                For each category, enter the manufacturer name and upload your CSV schedule.
              </div>
              {selectedCats.map(catId => {
                const cat = allCategories.find(c => c.id === catId)
                const data = catData[catId] || {}
                return (
                  <div key={catId} style={{
                    border: '1px solid var(--border)',
                    padding: '20px 24px',
                    marginBottom: 16,
                    background: 'var(--white)',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
                    }}>
                      <span style={{ fontSize: 16, color: 'var(--gold)' }}>{cat.icon}</span>
                      <div style={{
                        fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 300,
                      }}>
                        {cat.label}
                      </div>
                    </div>
                    <div style={{ marginBottom: 14 }}>
                      <label className="field-label">Manufacturer Name</label>
                      <input
                        className="field-input"
                        value={data.manufacturer || ''}
                        onChange={e => updateCatData(catId, 'manufacturer', e.target.value)}
                        placeholder="e.g. Stone Source International"
                      />
                    </div>
                    <div>
                      <label className="field-label">CSV Schedule</label>
                      <label style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 16px',
                        border: '1px dashed var(--border-dark)',
                        cursor: 'pointer',
                        background: data.itemCount ? 'var(--success-bg)' : 'var(--cream)',
                        transition: 'background 0.2s',
                        fontSize: 12, fontWeight: 300,
                        color: data.itemCount ? 'var(--success)' : 'var(--gray)',
                      }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                        </svg>
                        {data.itemCount
                          ? `✓ ${data.itemCount} items parsed`
                          : 'Upload CSV — columns: Name, Finish/Color, Cut, Room, Area'
                        }
                        <input
                          type="file"
                          accept=".csv,.txt"
                          style={{ display: 'none' }}
                          onChange={e => e.target.files[0] && handleCSV(catId, e.target.files[0])}
                        />
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step > 1 && (
            <button className="btn btn-outline btn-sm" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button className="btn btn-outline btn-sm" onClick={onClose}>
            Cancel
          </button>
          {step < 3 ? (
            <button
              className="btn btn-black btn-sm"
              onClick={() => {
                if (step === 1 && !name.trim()) { setError('Project name is required'); return }
                if (step === 2 && selectedCats.length === 0) { setError('Select at least one category'); return }
                setError('')
                setStep(step + 1)
              }}
            >
              Continue →
            </button>
          ) : (
            <button
              className="btn btn-black btn-sm"
              onClick={create}
              disabled={creating}
            >
              {creating ? 'Creating…' : 'Create Project'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
