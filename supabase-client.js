// Initializes the Supabase client used by the rest of the app.
// The anon public key is safe to embed in client-side code; row-level security
// policies on the database are what actually gate access to data.

const SUPABASE_URL = 'https://adhbvmbtuuuhzrfeolkb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkaGJ2bWJ0dXV1aHpyZmVvbGtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NzI4OTksImV4cCI6MjA5NjE0ODg5OX0.SeuPMObQaTpJiE6ju5Y6AfJ-oIkPwC2oH0x4cRojT60';

if (!window.supabase || typeof window.supabase.createClient !== 'function') {
  console.error('Supabase JS SDK did not load before supabase-client.js');
} else {
  window.puntDb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  console.log('[punt-tracker] supabase client ready');
}
