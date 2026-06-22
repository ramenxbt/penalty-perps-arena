import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";
import { fetchWithTimeout } from "./fetch.ts";

const CACHE_MS = 10 * 60 * 1000;

type PlayerHolderRow = {
  wallet_address: string | null;
  is_holder: boolean;
  holder_checked_at: string | null;
};

function isLocalEnvironment(): boolean {
  const value = (
    Deno.env.get("APP_ENV") ??
    Deno.env.get("DENO_ENV") ??
    Deno.env.get("ENVIRONMENT") ??
    ""
  ).trim().toLowerCase();
  return value === "local" || value === "dev" || value === "development" || value === "test";
}

function placeholderHolder(): boolean {
  const enabled = Deno.env.get("HOLDER_PLACEHOLDER")?.trim().toLowerCase() === "true";
  if (!enabled) return false;
  if (isLocalEnvironment()) return true;
  console.warn("Ignoring HOLDER_PLACEHOLDER outside local/dev/test environments.");
  return false;
}

function tokenMint(): string | null {
  const mint = Deno.env.get("TOKEN_MINT")?.trim();
  if (!mint || mint.startsWith("VITE_") || mint === "YOUR_TOKEN_MINT") return null;
  return mint;
}

function minBalance(): number {
  const parsed = Number(Deno.env.get("HOLDER_MIN_BALANCE") ?? "1");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function cacheIsFresh(row: PlayerHolderRow): boolean {
  if (!row.holder_checked_at) return false;
  return Date.now() - new Date(row.holder_checked_at).getTime() < CACHE_MS;
}

async function hasSplBalance(walletAddress: string, mint: string): Promise<boolean> {
  const rpcUrl = Deno.env.get("SOLANA_RPC_URL")?.trim();
  if (!rpcUrl) return false;

  const response = await fetchWithTimeout(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "penalty-perps-holder",
      method: "getTokenAccountsByOwner",
      params: [
        walletAddress,
        { mint },
        { encoding: "jsonParsed" },
      ],
    }),
  });

  if (!response.ok) return false;
  const payload = await response.json() as {
    result?: {
      value?: Array<{
        account?: {
          data?: {
            parsed?: {
              info?: {
                tokenAmount?: {
                  uiAmountString?: string;
                };
              };
            };
          };
        };
      }>;
    };
  };

  const balance = payload.result?.value?.reduce((sum, item) => {
    const amount = Number(item.account?.data?.parsed?.info?.tokenAmount?.uiAmountString ?? "0");
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0) ?? 0;

  return balance >= minBalance();
}

export async function refreshHolderStatus(
  admin: SupabaseClient,
  playerId: string,
  walletAddress: string | null,
): Promise<boolean> {
  const { data } = await admin
    .from("players")
    .select("wallet_address,is_holder,holder_checked_at")
    .eq("id", playerId)
    .maybeSingle();

  const row = data as PlayerHolderRow | null;
  if (row?.wallet_address === walletAddress && cacheIsFresh(row)) return row.is_holder;

  const mint = tokenMint();
  const isHolder = mint && walletAddress ? await hasSplBalance(walletAddress, mint) : placeholderHolder();

  await admin
    .from("players")
    .update({ is_holder: isHolder, holder_checked_at: new Date().toISOString() })
    .eq("id", playerId);

  return isHolder;
}
