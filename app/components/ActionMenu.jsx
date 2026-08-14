'use client'

import { useState, useEffect } from 'react'

// ═══════════════════════════════════════════════════════
// ACTION MENU
// ═══════════════════════════════════════════════════════
// The one dropdown, on the app's .menu-dropdown styles. Keeping rarely
// used actions behind these is the point: the pages it serves had eleven
// controls competing for the same row.
//
// items: { label, icon, onClick, danger }
//        { sep: true }   — divider
//        { note: '…' }   — a line of context above the actions it describes
//
// trigger: 'button' (labelled, with a chevron)
//          'icon'   (a ⋮)
//          'avatar' (a circle with initials — the account menu)
// ═══════════════════════════════════════════════════════
export default function ActionMenu({ label, icon, items, trigger = 'button', initials, align = 'right' }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onEsc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const triggers = {
    icon: (
      <button onClick={() => setOpen(o => !o)} aria-label={label} aria-expanded={open} aria-haspopup="menu"
        className="folder-menu"
        style={{ width:32, height:32, display:'inline-flex', alignItems:'center', justifyContent:'center', color:'var(--gray)' }}>
        <i className="ti ti-dots-vertical" style={{ fontSize:18 }} />
      </button>
    ),
    avatar: (
      <button onClick={() => setOpen(o => !o)} aria-label={label} aria-expanded={open} aria-haspopup="menu"
        className="avatar" style={{ border:'none' }}>
        {initials}
      </button>
    ),
    button: (
      <button className="btn btn-outline btn-sm" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu">
        {icon && <i className={`ti ${icon}`} style={{ fontSize:16 }} />}
        {label}
        <i className="ti ti-chevron-down" style={{ fontSize:14, color:'var(--gray-light)' }} />
      </button>
    ),
  }

  return (
    <div style={{ position:'relative', flexShrink:0 }} onClick={e => e.stopPropagation()}>
      {triggers[trigger] || triggers.button}

      {open && (
        <div className="menu-dropdown" role="menu"
          style={align === 'left' ? { right:'auto', left:0 } : undefined}
          onClick={e => { if (e.target.closest('button')) setOpen(false) }}>
          {items.filter(Boolean).map((item, i) => {
            if (item.sep) return <div key={i} className="menu-sep" />
            if (item.note) return (
              <div key={i} style={{ padding:'6px 12px 8px', fontSize:12, lineHeight:1.5, color:'var(--gray)' }}>
                {item.note}
              </div>
            )
            return (
              <button key={i} role="menuitem" className={item.danger ? 'menu-danger' : ''} onClick={item.onClick}
                style={{ display:'flex', alignItems:'center', gap:10 }}>
                {item.icon && <i className={`ti ${item.icon}`} style={{ fontSize:17, flexShrink:0 }} />}
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
