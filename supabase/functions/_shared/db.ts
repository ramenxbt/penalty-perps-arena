import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";

type SupabaseAdmin = SupabaseClient<any, "public", any>;

let admin: SupabaseAdmin | null = null;

function readSecretKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacy) return legacy;

  const raw = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const key = parsed.default ?? Object.values(parsed)[0];
    if (key) return key;
  }

  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEYS.");
}

export function getAdminClient(): SupabaseAdmin {
  if (admin) return admin;

  const url = Deno.env.get("SUPABASE_URL")?.trim();
  if (!url) throw new Error("Missing SUPABASE_URL.");

  admin = createClient<any, "public", any>(url, readSecretKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return admin;
}
