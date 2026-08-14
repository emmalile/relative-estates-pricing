'use client'

// ═══════════════════════════════════════════════════════
// WORDMARK
// ═══════════════════════════════════════════════════════
// The same two words sat inline in fourteen files, each with its own copy
// of the styling and none of them clickable. Every app puts its name in the
// top-left and every app takes you home when you click it; this one asked
// you to find the back arrow instead.
//
// `href` decides what "home" means for the page you are on:
//   • inside a project — that project's dashboard
//   • inside the client view — that client's own project page
//   • everywhere else — the project list
//   • the login screen and the vendor form pass nothing, because neither
//     has a home to go to and a dead link is worse than plain text
//
// Rendered as a real <a> rather than a click handler so it middle-clicks,
// right-clicks and previews on hover like any other link.
// ═══════════════════════════════════════════════════════

export default function Wordmark({ href, style, title }) {
  const words = (
    <>Relative <span style={{ color: 'var(--g600)', fontWeight: 400 }}>Estate</span></>
  )

  const base = {
    fontSize: 'var(--t-lg)',
    fontWeight: 500,
    letterSpacing: '-0.01em',
    color: 'var(--black)',
    ...style,
  }

  if (!href) return <div style={base}>{words}</div>

  return (
    <a
      href={href}
      title={title || 'Back to the project'}
      style={{ ...base, textDecoration: 'none', transition: 'opacity 0.2s' }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '0.6' }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
    >
      {words}
    </a>
  )
}
