// Browser Supabase client — re-exported for backwards compatibility.
//
// This used to be a plain createClient() shared by both browser code and
// API routes. It is now the session-aware BROWSER client only:
//
//   • Client components:  import { supabase } from '@/lib/supabase'
//   • Route handlers:     import { createClient } from '@/lib/supabase/server'
//   • Service role:       import { createAdminClient } from '@/lib/supabase/admin'
//
// A route handler that imports this file will not carry the caller's
// session, so its queries will be rejected by RLS. Use the server client.
export { supabase, createClient } from './supabase/client'
