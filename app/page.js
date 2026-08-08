'use client'

import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase } from '@/lib/supabase'
import { allCategories, liveCategories, parseCSVForCategory } from '@/lib/categories'
import { formatCurrency, formatRelativeTime, slugify } from '@/lib/utils'

// ═══════════════════════════════════════════════════════
// NAV / STATUS CONFIG
// ═══════════════════════════════════════════════════════
const NAV_PRIMARY = [
  { id: 'home', label: 'Home', icon: 'ti-home' },
  { id: 'recent', label: 'Recent', icon: 'ti-clock' },
  { id: 'starred', label: 'Starred', icon: 'ti-star' },
  { id: 'archived', label: 'Archived', icon: 'ti-archive' },
]
const NAV_SECONDARY = [
  { id: 'all', label: 'All projects', icon: 'ti-building' },
  { id: 'vendors', label: 'Vendors', icon: 'ti-users' },
  { id: 'repository', label: 'Repository', icon: 'ti-package' },
]
const NAV_LABELS = Object.fromEntries([...NAV_PRIMARY, ...NAV_SECONDARY, { id: 'settings', label: 'Settings' }].map(n => [n.id, n.label]))

// Shipment status stages. NOTE: there is no live tracking data yet — the
// underlying `schedules.items` and `approvals` tables have no status/ETA/
// tracking columns. That arrives in Phase 3. Until then these are shown as
// deterministic PREVIEW values (see placeholderStatus below) so the layout
// can be reviewed with realistic-looking data, clearly labeled as preview.
const STATUS_STAGES = [
  { key: 'transit', label: 'In transit', icon: 'ti-plane', color: 'var(--s-transit)' },
  { key: 'ground', label: 'On ground', icon: 'ti-truck', color: 'var(--s-ground)' },
  { key: 'warehouse', label: 'At warehouse', icon: 'ti-building-warehouse', color: 'var(--s-warehouse)' },
  { key: 'production', label: 'In production', icon: 'ti-tools', color: 'var(--s-production)' },
  { key: 'pending', label: 'Pending approval', icon: 'ti-clock', color: 'var(--s-pending)' },
  { key: 'checkedin', label: 'Checked in', icon: 'ti-circle-check', color: 'var(--s-checkedin)' },
  { key: 'delayed', label: 'Delayed', icon: 'ti-alert-triangle', color: 'var(--s-delayed)' },
]

function placeholderStatus(seed) {
  let hash = 0
  const str = String(seed)
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0
  return STATUS_STAGES[hash % STATUS_STAGES.length]
}

function categoryLabel(id) {
  return allCategories.find(c => c.id === id)?.label || id
}

// Pull whatever real fields exist per category — never fabricate numbers.
function getItemFields(item, category) {
  if (category === 'doors') {
    const size = (item.widthInches && item.heightInches)
      ? `${item.widthInches} × ${item.heightInches} in`
      : (item.widthMm && item.heightMm ? `${item.widthMm} × ${item.heightMm} mm` : '—')
    return {
      name: item.description || item.location || (item.no ? `Door ${item.no}` : 'Untitled door'),
      location: item.location || '—',
      size,
      qty: item.qty || '—',
      price: item.totalPrice || item.amount || null,
    }
  }
  return {
    name: item.name || 'Untitled item',
    location: (item.locations && item.locations.length) ? item.locations.join(', ') : (item.room || item.area || '—'),
    size: [item.cut, item.finish].filter(Boolean).join(' · ') || '—',
    qty: null,
    price: null,
  }
}

export default function AdminHome() {
  const [projects, setProjects] = useState([])
  const [archivedProjects, setArchivedProjects] = useState([])
  const [scheduleItems, setScheduleItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingArchived, setLoadingArchived] = useState(true)

  const [nav, setNav] = useState('home')
  const [search, setSearch] = useState('')
  const [view, setView] = useState('list')
  const [projectView, setProjectView] = useState('grid')
  const [activeCategory, setActiveCategory] = useState(null)
  const [foldersOpen, setFoldersOpen] = useState(true)
  const [openRows, setOpenRows] = useState(new Set())
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
    await loadRecentItems(active)
  }

  async function loadRecentItems(activeProjects) {
    if (!activeProjects || activeProjects.length === 0) { setScheduleItems([]); return }
    const ids = activeProjects.map(p => p.id)
    const { data } = await supabase.from('schedules').select('*').in('project_id', ids)
    const projectMap = Object.fromEntries(activeProjects.map(p => [p.id, p]))
    const flat = []
    ;(data || []).forEach(sched => {
      const project = projectMap[sched.project_id]
      if (!project) return
      ;(sched.items || []).forEach((item, idx) => {
        flat.push({
          ...item,
          uid: `${sched.id}::${item.key || idx}`,
          category: sched.category,
          manufacturer: sched.manufacturer,
          project,
        })
      })
    })
    setScheduleItems(flat)
  }

  async function archiveProject(project) {
    if (!confirm(`Archive "${project.name}"? It will move to Archived and can be restored anytime.`)) return
    const res = await fetch(`/api/projects/delete?id=${project.id}`, { method: 'DELETE' })
    if (!res.ok) { alert('Failed to archive project. Please try again.'); return }
    setProjects(prev => prev.filter(p => p.id !== project.id))
    setScheduleItems(prev => prev.filter(it => it.project.id !== project.id))
    setArchivedProjects(prev => [{ ...project, deleted_at: new Date().toISOString() }, ...prev])
  }

  async function restoreProject(project) {
    const res = await fetch(`/api/projects/restore?id=${project.id}`, { method: 'POST' })
    if (!res.ok) { alert('Failed to restore project. Please try again.'); return }
    setArchivedProjects(prev => prev.filter(p => p.id !== project.id))
    const restored = { ...project, deleted_at: null }
    setProjects(prev => [restored, ...prev])
    loadRecentItems([restored, ...projects])
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

  function toggleRow(uid) {
    setOpenRows(prev => {
      const next = new Set(prev)
      next.has(uid) ? next.delete(uid) : next.add(uid)
      return next
    })
  }

  function itemCountFor(projectId) {
    return scheduleItems.filter(it => it.project.id === projectId).length
  }

  const q = search.trim().toLowerCase()
  const filteredProjects = useMemo(() => {
    if (!q) return projects
    return projects.filter(p => p.name.toLowerCase().includes(q) || (p.client || '').toLowerCase().includes(q))
  }, [projects, q])

  const filteredArchived = useMemo(() => {
    if (!q) return archivedProjects
    return archivedProjects.filter(p => p.name.toLowerCase().includes(q) || (p.client || '').toLowerCase().includes(q))
  }, [archivedProjects, q])

  const filteredItems = useMemo(() => {
    return scheduleItems.filter(it => {
      if (activeCategory && it.category !== activeCategory) return false
      if (!q) return true
      const fields = getItemFields(it, it.category)
      return fields.name.toLowerCase().includes(q) || it.project.name.toLowerCase().includes(q)
    })
  }, [scheduleItems, activeCategory, q])

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
              placeholder="Search projects, items, vendors, pricing…"
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
                  Active projects
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
                    <div className="empty-state-title">{search ? `No projects match "${search}"` : 'No projects yet'}</div>
                    <div className="empty-state-sub">{search ? 'Try a different project name or client' : 'Create your first project to get started'}</div>
                    {!search && <button className="btn btn-black" onClick={() => setShowNewModal(true)}>Create Project</button>}
                  </div>
                ) : projectView === 'grid' ? (
                  <div className="folders">
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
                  <table className="ftable" style={{ marginBottom: 24 }}>
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

              <RecentItemsSection
                items={filteredItems}
                loading={loading}
                view={view}
                setView={setView}
                openRows={openRows}
                toggleRow={toggleRow}
                search={search}
              />
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

// ── Recent Items (expandable table / grid) ────────────────
function RecentItemsSection({ items, loading, view, setView, openRows, toggleRow, search }) {
  return (
    <>
      <div className="file-controls">
        <div className="file-section">
          <i className="ti ti-chevron-down" /> Recent items
          <span className="preview-badge" title="Status, tracking and ETA are preview data — live shipment tracking arrives in Phase 3.">Preview</span>
        </div>
        <div className="view-tog">
          <button className={view === 'list' ? 'active' : ''} title="List view" onClick={() => setView('list')}><i className="ti ti-list" /></button>
          <button className={view === 'grid' ? 'active' : ''} title="Grid view" onClick={() => setView('grid')}><i className="ti ti-layout-grid" /></button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '40px 0' }}><span className="spinner" /></div>
      ) : items.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 0 40px' }}>
          <div className="empty-state-title">{search ? `No items match "${search}"` : 'No items yet'}</div>
          <div className="empty-state-sub">Items appear here once a schedule is uploaded to a project.</div>
        </div>
      ) : view === 'list' ? (
        <table className="ftable">
          <thead>
            <tr>
              <th style={{ width: '32%' }}>Name</th>
              <th>Project</th>
              <th>Category</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Client price</th>
              <th style={{ width: 28 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => {
              const fields = getItemFields(it, it.category)
              const status = placeholderStatus(it.uid)
              const open = openRows.has(it.uid)
              return (
                <Fragment key={it.uid}>
                  <tr className={`frow${open ? ' open' : ''}`} onClick={() => toggleRow(it.uid)}>
                    <td className="fname">{fields.name}</td>
                    <td className="fcat">{it.project.name}</td>
                    <td className="fcat">{categoryLabel(it.category)}</td>
                    <td><span className="fstatus"><i className={`ti ${status.icon}`} style={{ color: status.color }} /> {status.label}</span></td>
                    <td className="fprice" style={{ textAlign: 'right' }}>{fields.price ? formatCurrency(fields.price) : '—'}</td>
                    <td><i className="ti ti-chevron-down fchev" /></td>
                  </tr>
                  {open && (
                    <tr className="fdetail"><td colSpan={6}>
                      <div className="fd-inner">
                        <div className="fd-grid">
                          <div><div className="fd-label">Location</div><div className="fd-value">{fields.location}</div></div>
                          <div><div className="fd-label">Size</div><div className="fd-value">{fields.size}</div></div>
                          <div><div className="fd-label">Vendor</div><div className="fd-value">{it.manufacturer || '—'}</div></div>
                          <div><div className="fd-label">Qty</div><div className="fd-value">{fields.qty || '—'}</div></div>
                        </div>
                        <div className="fd-note"><i className="ti ti-info-circle" /><span>Shipment tracking, cost and margin detail will appear here once Phase 3 tracking is connected.</span></div>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      ) : (
        <div className="grid-files">
          {items.map(it => {
            const fields = getItemFields(it, it.category)
            const status = placeholderStatus(it.uid)
            return (
              <div key={it.uid} className="gcard" onClick={() => toggleRow(it.uid)}>
                <div className="gcard-img"><i className={`ti ${categoryIconTabler(it.category)}`} /></div>
                <div className="gcard-body">
                  <div className="gcard-name">{fields.name}</div>
                  <div className="gcard-meta">{it.project.name} · {categoryLabel(it.category)}</div>
                  <div className="gcard-bottom">
                    <span className="gcard-price">{fields.price ? formatCurrency(fields.price) : '—'}</span>
                    <span className="gcard-status"><i className={`ti ${status.icon}`} style={{ color: status.color }} /></span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function categoryIconTabler(category) {
  if (category === 'doors') return 'ti-door'
  return 'ti-diamond'
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
