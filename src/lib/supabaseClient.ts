/**
 * Lazily-created Supabase browser client. Returns null when the project isn't
 * configured, which keeps the app fully functional in local mode.
 *
 * Only the anon (publishable) key lives here - it is safe in the browser because
 * Row Level Security, not key secrecy, is what protects the data. Never import a
 * service-role key into client code.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (client) return client;
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
  client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      // We authenticate users with Privy, not Supabase Auth, so don't try to
      // persist or auto-refresh a Supabase session here.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return client;
}
