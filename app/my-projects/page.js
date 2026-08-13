import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { isInternal } from '@/lib/auth'
import SignOutButton from '@/app/components/SignOutButton'

// Where a client lands after signing in. Internal roles get bounced to the
// admin portal instead — this page only exists so clients have somewhere to
// go that isn't the cost-and-margin dashboard.
export const dynamic = 'force-dynamic'

export default async function MyProjects() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!user.profile) redirect('/login?error=no_access')
  if (isInternal(user.role)) redirect('/')

  // RLS limits this to the projects this person is a member of, so no
  // filtering is needed here — the database has already done it.
  const supabase = createClient()
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, client, slug')
    .order('name')

  const list = projects || []

  return (
    <div style={{ minHeight:'100vh', background:'var(--off-white)' }}>
      <div className="app-header" style={{ height:64, borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', padding:'0 40px', background:'var(--white)' }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:300, letterSpacing:'0.06em', flex:1 }}>
          Relative <span style={{ color:'var(--gold)' }}>Estates</span>
        </div>
        <span style={{ fontSize:12, color:'var(--gray)', marginRight:16 }}>{user.email}</span>
        <SignOutButton />
      </div>

      <div className="page-body" style={{ padding:'48px 56px' }}>
        <div className="page-eyebrow">Your Projects</div>
        <div className="page-title" style={{ marginBottom:32 }}>
          Material <em>Selections</em>
        </div>

        {list.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No projects yet</div>
            <div className="empty-state-sub">Once your team adds you to a project, it will show up here.</div>
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:16, maxWidth:1000 }}>
            {list.map(p => (
              <Link key={p.id} href={`/projects/${p.slug}/client`} style={{ textDecoration:'none' }}>
                <div style={{ border:'1px solid var(--border)', background:'var(--white)', padding:'20px 22px', transition:'border-color 0.15s' }}>
                  <div style={{ fontSize:15, fontWeight:600, color:'var(--black)', marginBottom:4 }}>{p.name}</div>
                  {p.client && <div style={{ fontSize:12, color:'var(--gray-light)' }}>{p.client}</div>}
                  <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--gold)', marginTop:14 }}>
                    View selections →
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
