import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase env vars missing — auth disabled')
}

export const supabase = supabaseUrl
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

export async function getAuthToken() {
  if (!supabase) return 'dev'
  try {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? 'dev'
  } catch (_) {
    return 'dev'
  }
}
