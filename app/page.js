'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { allCategories, liveCategories, parseCSVForCategory } from '@/lib/categories'
import { formatRelativeTime, slugify } from '@/lib/utils'

// ═══════════════════════════════════════════════════════
// NAV CONFIG
// ═══════════════════════════════════════════════════════
const NAV_PRIMARY = [
  { id: 'home', label: 'Home', icon: 'ti-home' },
  { id: 'recent', label: 'Recent', icon: 'ti-clock' },
  { id: 'starred', label: 'Starred', icon: 'ti-star' },
  { id: 'archived', label: 'Archived', icon: 'ti-archive' },
]
const NAV_SECONDARY = [
  { id: 'all', label: 'All projects', icon: 'ti-building' },
  { id: 'vendors', label: 'Vendors', icon: 'ti-users', href: '/vendors' },
  { id: 'repository', label: 'Repository', icon: 'ti-package' },
]
const NAV_LABELS = Object.fromEntries([...NAV_PRIMARY, ...NAV_SECONDARY, { id: 'settings', label: 'Settings' }].map(n => [n.id, n.label]))

function categoryLabel(id) {
  return allCategories.find(c => c.id === id)?.label || id
}

export default function AdminHome() {
  const [projects, setProjects] = useState([])
  const [archivedProjects, setArchivedProjects] = useState([])
  const [scheduleItems, setScheduleItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingArchived, setLoadingArchived] = useState(true)

  const [nav, setNav] = useState('home')
  const [search, setSearch] = useState('')
  const [projectView, setProjectView] = useState('list')
  const [activeCategory, setActiveCategory] = useState(null)
  const [foldersOpen, setFoldersOpen] = useState(true)
  const [openMenuId, setOpenMenuId] = useState(null)

  const [showNewModal, setShowNewModal] = useState(false)
  const [updateTarget, setUpdateTarget] = useState(null)

  useEffect(() => { loadAll() }, [])

  // Close any open folder/row menu on outside click
  useEffect(() => {
    if (!openMenuId) return
    const close = () => setOpenMenuId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenuId])

  async function loadAll() {
    setLoading(true)
    setLoadingArchived(true)
    const [activeRes, archivedRes] = await Promise.all([
      fetch('/api/projects'),
      fetch('/api/projects?archived_only=true'),
    ])
    const active = activeRes.ok ? await activeRes.json() : []
    const archived = archivedRes.ok ? await archivedRes.json() : []
    setProjects(active)
    setArchivedProjects(archived)
    setLoading(false)
    setLoadingArchived(false)
    await loadScheduleCounts(active)
  }

  // We only need schedule rows to compute per-project and per-category
  // item counts — the individual line items live on each project dashboard.
  async function loadScheduleCounts(activeProjects) {
    if (!activeProjects || activeProjects.length === 0) { setScheduleItems([]); return }
    const ids = activeProjects.map(p => p.id)
    const { data } = await supabase.from('schedules').select('id, project_id, category, items').in('project_id', ids)
    const flat = []
    ;(data || []).forEach(sched => {
      ;(sched.items || []).forEach(() => {
        flat.push({ projectId: sched.project_id, category: sched.category })
      })
    })
    setScheduleItems(flat)
  }

  async function archiveProject(project) {
    if (!confirm(`Archive "${project.name}"? It will move to Archived and can be restored anytime.`)) return
    const res = await fetch(`/api/projects/delete?id=${project.id}`, { method: 'DELETE' })
    if (!res.ok) { alert('Failed to archive project. Please try again.'); return }
    setProjects(prev => prev.filter(p => p.id !== project.id))
    setScheduleItems(prev => prev.filter(it => it.projectId !== project.id))
    setArchivedProjects(prev => [{ ...project, deleted_at: new Date().toISOString() }, ...prev])
  }

  async function restoreProject(project) {
    const res = await fetch(`/api/projects/restore?id=${project.id}`, { method: 'POST' })
    if (!res.ok) { alert('Failed to restore project. Please try again.'); return }
    setArchivedProjects(prev => prev.filter(p => p.id !== project.id))
    const restored = { ...project, deleted_at: null }
    const nextActive = [restored, ...projects]
    setProjects(nextActive)
    loadScheduleCounts(nextActive)
  }

  function copyDashboardLink(project) {
    navigator.clipboard?.writeText(`${window.location.origin}/projects/${project.slug}/dashboard`)
    alert('Dashboard link copied')
  }
  function copyClientLink(project) {
    navigator.clipboard?.writeText(`${window.location.origin}/projects/${project.slug}/client`)
    alert('Client link copied — this one has no passcode, so only share it with the client directly.')
  }
  function openDashboard(project) {
    window.location.href = `/projects/${project.slug}/dashboard`
  }

  function itemCountFor(projectId) {
    return scheduleItems.filter(it => it.projectId === projectId).length
  }

  const q = search.trim().toLowerCase()

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (activeCategory && !(p.categories || []).includes(activeCategory)) return false
      if (!q) return true
      return p.name.toLowerCase().includes(q) || (p.client || '').toLowerCase().includes(q)
    })
  }, [projects, activeCategory, q])

  const filteredArchived = useMemo(() => {
    if (!q) return archivedProjects
    return archivedProjects.filter(p => p.name.toLowerCase().includes(q) || (p.client || '').toLowerCase().includes(q))
  }, [archivedProjects, q])

  const showHomeContent = nav === 'home' || nav === 'all'

  return (
    <div className="shell">
      {/* ── SIDEBAR ── */}
      <aside className="side">
        <button className="side-new" onClick={() => setShowNewModal(true)}>
          <i className="ti ti-plus" /> <span>New project</span>
        </button>

        <ul className="side-nav">
          {NAV_PRIMARY.map(n => (
            <li key={n.id} className={nav === n.id ? 'active' : ''} onClick={() => setNav(n.id)}>
              <i className={`ti ${n.icon}`} /> <span>{n.label}</span>
            </li>
          ))}
        </ul>

        <div className="side-sep" />
        <ul className="side-nav">
          {NAV_SECONDARY.map(n => (
            <li key={n.id} className={nav === n.id ? 'active' : ''} onClick={() => setNav(n.id)}>
              <i className={`ti ${n.icon}`} /> <span>{n.label}</span>
            </li>
          ))}
        </ul>

        <div className="side-sep" />
        <div className="sidebar-cat-label">Categories</div>
        <ul className="side-nav sidebar-cat">
          <li className={!activeCategory ? 'active' : ''} onClick={() => { setNav('home'); setActiveCategory(null) }}>
            <span className="cat-dot"><i className="ti ti-apps" /></span> <span>All categories</span>
          </li>
          {liveCategories.map(c => (
            <li key={c.id} className={activeCategory === c.id ? 'active' : ''} onClick={() => { setNav('home'); setActiveCategory(c.id) }}>
              <span className="cat-dot">{c.icon}</span> <span>{c.label}</span>
              <span className="cat-count">{scheduleItems.filter(it => it.category === c.id).length}</span>
            </li>
          ))}
        </ul>

        <div className="side-sep" />
        <ul className="side-nav">
          <li className={nav === 'settings' ? 'active' : ''} onClick={() => setNav('settings')}>
            <i className="ti ti-settings" /> <span>Settings</span>
          </li>
        </ul>

        <div className="side-storage">
          <span>{projects.length} active project{projects.length === 1 ? '' : 's'}</span>
          <div className="side-storage-bar"><div className="side-storage-fill" style={{ width: `${Math.min(100, projects.length * 8 || 4)}%` }} /></div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="main">
        <div className="topbar">
          <div className="topbar-logo">Relative <span>Estates</span></div>
          <div className="searchbar">
            <i className="ti ti-search" />
            <input
              type="text"
              placeholder="Search projects by name or client…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="topbar-right">
            <button className="topbar-icon"><i className="ti ti-bell" /></button>
            <button className="topbar-icon" onClick={() => setNav('settings')}><i className="ti ti-settings" /></button>
            <div className="avatar">E</div>
          </div>
        </div>

        <div className="content">
          {nav === 'archived' ? (
            <ArchivedView
              projects={filteredArchived}
              loading={loadingArchived}
              search={search}
              onRestore={restoreProject}
            />
          ) : showHomeContent ? (
            <>
              <div className="file-controls">
                <div className="file-section" onClick={() => setFoldersOpen(o => !o)}>
                  <i className="ti ti-chevron-down shev" style={{ transform: foldersOpen ? 'none' : 'rotate(-90deg)' }} />
                  {activeCategory ? `${categoryLabel(activeCategory)} projects` : 'Active projects'}
                </div>
                <div className="view-tog">
                  <button className={projectView === 'list' ? 'active' : ''} title="List view" onClick={() => setProjectView('list')}><i className="ti ti-list" /></button>
                  <button className={projectView === 'grid' ? 'active' : ''} title="Grid view" onClick={() => setProjectView('grid')}><i className="ti ti-layout-grid" /></button>
                </div>
              </div>
              {foldersOpen && (
                loading ? (
                  <div style={{ padding: '24px 0' }}><span className="spinner" /></div>
                ) : filteredProjects.length === 0 ? (
                  <div className="empty-state" style={{ padding: '32px 0 40px' }}>
                    <div className="empty-state-title">
                      {search ? `No projects match "${search}"`
                        : activeCategory ? `No projects with ${categoryLabel(activeCategory)}`
                        : 'No projects yet'}
                    </div>
                    <div className="empty-state-sub">
                      {search ? 'Try a different project name or client'
                        : activeCategory ? 'Pick another category, or add this category to a project.'
                        : 'Create your first project to get started'}
                    </div>
                    {!search && !activeCategory && <button className="btn btn-black" onClick={() => setShowNewModal(true)}>Create Project</button>}
                  </div>
                ) : projectView === 'grid' ? (
                  <div className="folders" style={{ flexWrap: 'wrap' }}>
                    {filteredProjects.map(p => (
                      <FolderCard
                        key={p.id}
                        project={p}
                        itemCount={itemCountFor(p.id)}
                        menuOpen={openMenuId === p.id}
                        onOpen={openDashboard}
                        onToggleMenu={() => setOpenMenuId(openMenuId === p.id ? null : p.id)}
                        onArchive={archiveProject}
                        onUpdateCSV={(project, category) => { setUpdateTarget({ project, category }); setOpenMenuId(null) }}
                        onCopyDashboard={copyDashboardLink}
                        onCopyClient={copyClientLink}
                      />
                    ))}
                  </div>
                ) : (
                  <table className="ftable">
                    <thead>
                      <tr>
                        <th style={{ width: '34%' }}>Name</th>
                        <th>Client</th>
                        <th>Categories</th>
                        <th style={{ textAlign: 'right' }}>Items</th>
                        <th>Updated</th>
                        <th style={{ width: 36 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProjects.map(p => (
                        <ProjectListRow
                          key={p.id}
                          project={p}
                          itemCount={itemCountFor(p.id)}
                          menuOpen={openMenuId === p.id}
                          onOpen={openDashboard}
                          onToggleMenu={() => setOpenMenuId(openMenuId === p.id ? null : p.id)}
                          onArchive={archiveProject}
                          onUpdateCSV={(project, category) => { setUpdateTarget({ project, category }); setOpenMenuId(null) }}
                          onCopyDashboard={copyDashboardLink}
                          onCopyClient={copyClientLink}
                        />
                      ))}
                    </tbody>
                  </table>
                )
              )}
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-state-title">{NAV_LABELS[nav] || 'Coming soon'}</div>
              <div className="empty-state-sub">This view is on the roadmap and isn't built yet.</div>
            </div>
          )}
        </div>
      </div>

      {showNewModal && (
        <NewProjectModal
          onClose={() => setShowNewModal(false)}
          onCreate={(p) => { setProjects([p, ...projects]); setShowNewModal(false) }}
        />
      )}

      {updateTarget && (
        <UpdateCSVModal
          project={updateTarget.project}
          category={updateTarget.category}
          onClose={() => setUpdateTarget(null)}
          onUpdated={() => { setUpdateTarget(null); alert('Schedule updated successfully.') }}
        />
      )}
    </div>
  )
}

// ── Folder Card (Active projects — grid view) ─────────────
function FolderCard({ project, itemCount, menuOpen, onOpen, onToggleMenu, onArchive, onUpdateCSV, onCopyDashboard, onCopyClient }) {
  return (
    <div className="folder" onClick={() => onOpen(project)}>
      <div className="folder-icon"><i className="ti ti-folder" /></div>
      <div className="folder-info">
        <div className="folder-name">{project.name}</div>
        <div className="folder-sub">{itemCount} item{itemCount === 1 ? '' : 's'} · Updated {formatRelativeTime(project.updated_at)}</div>
      </div>
      <button className="folder-menu" onClick={e => { e.stopPropagation(); onToggleMenu() }}>
        <i className="ti ti-dots-vertical" />
      </button>
      {menuOpen && (
        <div className="menu-dropdown" onClick={e => e.stopPropagation()}>
          <button onClick={() => onOpen(project)}>Open dashboard</button>
          <button onClick={() => onCopyDashboard(project)}>Copy dashboard link</button>
          <button onClick={() => onCopyClient(project)}>Copy client link</button>
          {(project.categories || []).length > 0 && <div className="menu-sep" />}
          {(project.categories || []).map(cat => (
            <button key={cat} onClick={() => onUpdateCSV(project, cat)}>Update {categoryLabel(cat)} CSV</button>
          ))}
          <div className="menu-sep" />
          <button className="menu-danger" onClick={() => onArchive(project)}>Archive project</button>
        </div>
      )}
    </div>
  )
}

// ── Project List Row (Active projects — list view) ────────
function ProjectListRow({ project, itemCount, menuOpen, onOpen, onToggleMenu, onArchive, onUpdateCSV, onCopyDashboard, onCopyClient }) {
  const cats = project.categories || []
  return (
    <tr className="frow" onClick={() => onOpen(project)}>
      <td>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <i className="ti ti-folder" style={{ fontSize: 18, color: 'var(--g600)' }} />
          <span style={{ fontWeight: 500 }}>{project.name}</span>
        </span>
      </td>
      <td className="fcat">{project.client || '—'}</td>
      <td className="fcat">{cats.length ? cats.map(categoryLabel).join(', ') : '—'}</td>
      <td className="fprice" style={{ textAlign: 'right' }}>{itemCount}</td>
      <td className="fcat">{formatRelativeTime(project.updated_at)}</td>
      <td onClick={e => e.stopPropagation()}>
        <div style={{ position: 'relative' }}>
          <button className="folder-menu" onClick={e => { e.stopPropagation(); onToggleMenu() }}>
            <i className="ti ti-dots-vertical" />
          </button>
          {menuOpen && (
            <div className="menu-dropdown" onClick={e => e.stopPropagation()}>
              <button onClick={() => onOpen(project)}>Open dashboard</button>
              <button onClick={() => onCopyDashboard(project)}>Copy dashboard link</button>
              <button onClick={() => onCopyClient(project)}>Copy client link</button>
              {cats.length > 0 && <div className="menu-sep" />}
              {cats.map(cat => (
                <button key={cat} onClick={() => onUpdateCSV(project, cat)}>Update {categoryLabel(cat)} CSV</button>
              ))}
              <div className="menu-sep" />
              <button className="menu-danger" onClick={() => onArchive(project)}>Archive project</button>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Archived Projects View ────────────────────────────────
function ArchivedView({ projects, loading, search, onRestore }) {
  return (
    <>
      <div className="section-header"><i className="ti ti-archive" /> Archived projects</div>
      {loading ? (
        <div style={{ padding: '24px 0' }}><span className="spinner" /></div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">{search ? `No archived projects match "${search}"` : 'No archived projects'}</div>
          <div className="empty-state-sub">Projects you archive show up here and can be restored anytime.</div>
        </div>
      ) : (
        <div className="folders" style={{ flexWrap: 'wrap' }}>
          {projects.map(p => (
            <div key={p.id} className="folder" style={{ cursor: 'default' }}>
              <div className="folder-icon"><i className="ti ti-archive" /></div>
              <div className="folder-info">
                <div className="folder-name">{p.name}</div>
                <div className="folder-sub">Archived {formatRelativeTime(p.deleted_at)}</div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => onRestore(p)}>Restore</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ── Update CSV Modal ──────────────────────────────────────
// Unchanged from the previous design — logic left exactly as-is.
function UpdateCSVModal({ project, category, onClose, onUpdated }) {
  const [items, setItems] = useState(null)
  const [itemCount, setItemCount] = useState(0)
  const [manufacturer, setManufacturer] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const catDef = allCategories.find(c => c.id === category)

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
            <div style={{ fontSize: 12, color: 'var(--g600)', marginTop: 4 }}>
              {project.name}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{
              padding: '10px 14px', background: 'var(--danger-bg)',
              border: '1px solid var(--danger)', borderRadius: 8, fontSize: 13,
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
              fontSize: 13, color: 'var(--g600)',
              marginBottom: 10, lineHeight: 1.6,
            }}>
              Current schedule has <strong>{itemCount} items</strong>.
              Upload a new CSV to replace it. The old schedule will be overwritten.
            </div>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 16px',
              border: '1px dashed var(--g300)', borderRadius: 8,
              cursor: 'pointer',
              background: items ? 'var(--success-bg)' : 'var(--g50)',
              transition: 'background 0.2s',
              fontSize: 13,
              color: items ? 'var(--success)' : 'var(--g600)',
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
// Unchanged from the previous design — logic left exactly as-is.
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
            <div style={{ fontSize: 12, color: 'var(--g600)', marginTop: 4 }}>
              Step {step} of 3
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{
              padding: '10px 14px', background: 'var(--danger-bg)',
              border: '1px solid var(--danger)', borderRadius: 8, fontSize: 13,
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
                  marginTop: 16, padding: '10px 14px', borderRadius: 8,
                  background: 'var(--g50)', fontSize: 12,
                  color: 'var(--g600)',
                }}>
                  URL will be: <strong style={{ color: 'var(--black)' }}>
                    /projects/{slugify(name)}/dashboard
                  </strong>
                </div>
              )}
            </div>
          )}

          {/* Step 2 — Select Categories */}
          {step === 2 && (
            <div>
              <div style={{ fontSize: 13, color: 'var(--g600)', marginBottom: 20 }}>
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
                        padding: '16px 20px', borderRadius: 10,
                        border: `1px solid ${selected ? 'var(--black)' : 'var(--g200)'}`,
                        background: selected ? 'var(--black)' : 'var(--white)',
                        cursor: isLive ? 'pointer' : 'not-allowed',
                        opacity: isLive ? 1 : 0.45,
                        transition: 'all 0.15s',
                        position: 'relative',
                      }}
                    >
                      <div style={{
                        fontSize: 18, marginBottom: 4,
                        color: selected ? 'var(--white)' : 'var(--g500)',
                      }}>
                        {cat.icon}
                      </div>
                      <div style={{
                        fontSize: 14, fontWeight: 500,
                        color: selected ? 'var(--white)' : 'var(--black)',
                      }}>
                        {cat.label}
                      </div>
                      <div style={{
                        fontSize: 11,
                        color: selected ? 'rgba(255,255,255,0.6)' : 'var(--g500)',
                        marginTop: 2,
                      }}>
                        {cat.description}
                      </div>
                      {!isLive && (
                        <div style={{
                          position: 'absolute', top: 8, right: 8,
                          fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
                          color: 'var(--g500)', borderRadius: 10,
                          padding: '2px 8px', border: '1px solid var(--g200)',
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
              <div style={{ fontSize: 13, color: 'var(--g600)', marginBottom: 24 }}>
                For each category, enter the manufacturer name and upload your CSV schedule.
              </div>
              {selectedCats.map(catId => {
                const cat = allCategories.find(c => c.id === catId)
                const data = catData[catId] || {}
                return (
                  <div key={catId} style={{
                    border: '1px solid var(--g200)', borderRadius: 10,
                    padding: '20px 24px',
                    marginBottom: 16,
                    background: 'var(--white)',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
                    }}>
                      <span style={{ fontSize: 16, color: 'var(--g700)' }}>{cat.icon}</span>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>
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
                        border: '1px dashed var(--g300)', borderRadius: 8,
                        cursor: 'pointer',
                        background: data.itemCount ? 'var(--success-bg)' : 'var(--g50)',
                        transition: 'background 0.2s',
                        fontSize: 13,
                        color: data.itemCount ? 'var(--success)' : 'var(--g600)',
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
