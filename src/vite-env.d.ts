/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Privy app id. Public by design (safe in the browser bundle). */
  readonly VITE_PRIVY_APP_ID?: string;
  /** Supabase project URL, e.g. https://xxxx.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/publishable key. Public by design; RLS protects data. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Fail fast unless connected mode is fully configured. */
  readonly VITE_REQUIRE_BACKEND?: string;
  /** Pyth Hermes base URL. Defaults to the public mainnet endpoint. */
  readonly VITE_PYTH_HERMES_URL?: string;
  /** Pyth price-feed id for SOL/USD. */
  readonly VITE_PYTH_SOL_USD_ID?: string;
  /** Optional Pyth price-feed id override for BTC/USD. */
  readonly VITE_PYTH_BTC_USD_ID?: string;
  /** Optional Pyth price-feed id override for ETH/USD. */
  readonly VITE_PYTH_ETH_USD_ID?: string;
  /** SPL mint used for holder gating. Leave unset to keep the gate as a placeholder. */
  readonly VITE_TOKEN_MINT?: string;
  /** Display ticker for the project token. */
  readonly VITE_TOKEN_SYMBOL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  webkitAudioContext?: typeof AudioContext;
}
