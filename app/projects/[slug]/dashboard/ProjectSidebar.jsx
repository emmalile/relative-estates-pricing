'use client'

import { useState, useEffect } from 'react'

// ═══════════════════════════════════════════════════════
// PROJECT SIDEBAR
// ═══════════════════════════════════════════════════════
// The same shape as the portal's sidebar, for the same reason: everything
// you can do to a project belongs in one place you can see, rather than
// spread across a Share menu and an overflow menu that between them hid
// the manufacturer links well enough that nobody found them.
//
// Sticky under the header rather than inside its own scroll container, so
// the page keeps one scrollbar and the sticky category tabs keep working
// against the same offset they always have.
//
// Collapses to icons, and remembers that — a wide screen wants the labels,
// a laptop next to a spreadsheet often does not.
// ═══════════════════════════════════════════════════════

const STORAGE_KEY = 're-project-sidebar-collapsed'

export default function ProjectSidebar({ slug, projectName, canExport, categoryLabel, onClientLink, onManufacturerLinks, onExportCSV, onExportPDF }) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try { setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1') } catch {}
  }, [])

  function toggle() {
    setCollapsed(c => {
      const next = !c
      try { window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch {}
      return next
    })
  }

  const groups = [
    {
      label: 'Project',
      items: [
        { icon: 'ti-list', label: 'Schedule', active: true },
        { icon: 'ti-folder', label: 'Files', href: `/projects/${slug}/files` },
        { icon: 'ti-message-circle', label: 'Ask', href: `/projects/${slug}/chat` },
      ],
    },
    {
      label: 'Share',
      items: [
        { icon: 'ti-users', label: 'Client link', onClick: onClientLink },
        { icon: 'ti-file', label: 'Manufacturer links', onClick: onManufacturerLinks,
          hint: categoryLabel ? `for ${categoryLabel.toLowerCase()}` : null },
      ],
    },
    canExport && {
      label: 'Export',
      items: [
        { icon: 'ti-table-export', label: 'Export CSV', onClick: onExportCSV },
        { icon: 'ti-file-type-pdf', label: 'Export PDF', onClick: onExportPDF },
      ],
    },
    {
      label: null,
      items: [
        { icon: 'ti-brand-dropbox', label: 'Dropbox', href: '/settings/dropbox' },
      ],
    },
  ].filter(Boolean)

  return (
    <aside className="project-side" style={{ width: collapsed ? 60 : 210 }}>
      <button
        onClick={toggle}
        className="project-side-toggle"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <i className={`ti ${collapsed ? 'ti-chevron-right' : 'ti-chevron-left'}`} style={{ fontSize:18 }} />
        {!collapsed && <span style={{ fontSize:'var(--t-xs)', color:'var(--gray)' }}>Collapse</span>}
      </button>

      {groups.map((g, gi) => (
        <div key={gi} style={{ marginBottom:'var(--s-4)' }}>
          {g.label && !collapsed && (
            <div className="project-side-label">{g.label}</div>
          )}
          {g.label && collapsed && gi > 0 && <div className="side-sep" />}
          <ul className="side-nav">
            {g.items.map(item => (
              <li
                key={item.label}
                className={item.active ? 'active' : ''}
                title={collapsed ? item.label : (item.hint || undefined)}
                onClick={() => {
                  if (item.href) window.location.href = item.href
                  else item.onClick?.()
                }}
                style={collapsed ? { justifyContent:'center', padding:'var(--s-2) 0' } : undefined}
              >
                <i className={`ti ${item.icon}`} />
                {!collapsed && <span>{item.label}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </aside>
  )
}
