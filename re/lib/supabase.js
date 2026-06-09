import { createClient } from '@supabase/supabase-js'

// This file creates a single Supabase client that every
// part of the app uses to read and write data.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Check your .env.local file has NEXT_PUBLIC_SUPABASE_URL ' +
    'and NEXT_PUBLIC_SUPABASE_ANON_KEY set correctly.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
