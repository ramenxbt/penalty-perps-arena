/**
 * Centralized, typed access to build-time configuration and derived feature flags.
 *
 * SECURITY: Vite only exposes vars prefixed with `VITE_` to the client bundle, and
 * everything here ships to the browser. Never put secrets (Supabase service-role key,
 * Privy app secret, write-capable RPC keys) in a `VITE_` var. The only values that are
 * safe client-side are the Supabase anon key (guarded by Row Level Security) and the
 * Privy *app id* (a public identifier, not a secret).
 */

function readEnv(key: keyof ImportMetaEnv): string | undefined {
  const value = import.meta.env[key];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readBooleanEnv(key: keyof ImportMetaEnv): boolean {
  return readEnv(key)?.toLowerCase() === "true";
}

export const env = {
  privyAppId: readEnv("VITE_PRIVY_APP_ID"),
  supabaseUrl: readEnv("VITE_SUPABASE_URL"),
  supabaseAnonKey: readEnv("VITE_SUPABASE_ANON_KEY"),
  requireBackend: readBooleanEnv("VITE_REQUIRE_BACKEND"),
  pythHermesUrl: readEnv("VITE_PYTH_HERMES_URL") ?? "https://hermes.pyth.network",
  // Canonical Pyth mainnet price-feed ids for core crypto markets.
  solUsdPriceId:
    readEnv("VITE_PYTH_SOL_USD_ID") ??
    "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  btcUsdPriceId:
    readEnv("VITE_PYTH_BTC_USD_ID") ??
    "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ethUsdPriceId:
    readEnv("VITE_PYTH_ETH_USD_ID") ??
    "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  tokenMint: readEnv("VITE_TOKEN_MINT"),
  tokenSymbol: readEnv("VITE_TOKEN_SYMBOL") ?? "PERP",
} as const;

const backendEnvPresent = Boolean(env.privyAppId || env.supabaseUrl || env.supabaseAnonKey);
const backendEnvComplete = Boolean(env.privyAppId && env.supabaseUrl && env.supabaseAnonKey);
const backendRequired = env.requireBackend || (import.meta.env.PROD && backendEnvPresent);

export const configurationError = backendRequired && !backendEnvComplete
  ? "Connected mode is required but incomplete. Set VITE_PRIVY_APP_ID, VITE_SUPABASE_URL, and VITE_SUPABASE_ANON_KEY, or unset VITE_REQUIRE_BACKEND for local paper mode."
  : null;

export const features = {
  /** Auth is "real" (Privy) only when an app id is configured; otherwise guest mode. */
  privy: Boolean(env.privyAppId),
  /** Supabase is configured, but connected play also needs Privy bearer tokens. */
  backend: Boolean(env.supabaseUrl && env.supabaseAnonKey),
  /** The app talks to a real backend only when Supabase and Privy are both configured. */
  connected: !configurationError && backendEnvComplete,
  /** Holder gating is meaningful only when a mint is configured. */
  tokenGate: Boolean(env.tokenMint),
} as const;

/**
 * `local`     - fully client-side paper simulation (no server, no custody, demo-able offline).
 * `connected` - scoring and leaderboard are server-authoritative via Supabase edge functions.
 */
export const appMode: "local" | "connected" = features.connected ? "connected" : "local";
