# Penalty Perps Arena

A 3D game where you earn your shots by trading. Open a paper `Long` or `Short` on a live
BTC, ETH, or SOL chart, close while you are up (or let the timer auto-close), and your realized PnL
decides how many shots you get and how open the net is. Profit earns open shots; a loss
gets you saved or denied a kick. Inspired by the market-momentum loop of Roach Racing Club.

## What it does

- Renders a 3D arena with realistic soccer balls (procedurally shaded truncated
  icosahedra), one keeper, and a goal with real depth.
- Randomizes each arena round across live **BTC/USD**, **ETH/USD**, and **SOL/USD** Pyth feeds.
- Lets you open a basic paper `Long` or `Short` with a live PnL readout and a close timer.
- Converts your realized PnL into shots, then resolves a volley where you and simulated
  co-shooters take their kicks one at a time against the keeper.
- Tracks score, profit streaks, and daily rounds on a leaderboard.

## Guardrails

The perps mechanic is paper only. No deposits, no custody, no real margin, no real
liquidation, no real balances. AI squads are clearly labeled and are never reward eligible.

## Run modes

The app picks its mode automatically from the environment:

- **Local** (default, zero config): a fully client-side paper simulation. Scoring, the
  leaderboard, and AI opponents all run in the browser. Great for demos and offline use.
- **Connected**: when Supabase and Privy are both configured, scoring and the leaderboard become
  server-authoritative (the client only renders), auth uses Privy, and holder status is
  verified on-chain. See the backend notes below.

## Architecture

- `src/game/` - pure types and the scoring engine (single source of truth for the formula).
- `src/lib/pyth.ts` - live BTC/ETH/SOL price streams with a simulated fallback.
- `src/lib/api.ts` - the `GameApi` seam. The UI talks only to this; behind it sit a local
  paper backend (`localBackend.ts`) and a Supabase-backed one (`supabaseApi.ts`).
- `src/auth/` - unified auth (Privy when configured, guest otherwise), code-split.
- `src/hooks/` - the market feed and the game orchestrator.
- `src/components/` - arena scene, candles, PnL gauge, trade ticker.

Because the UI is written against the `GameApi` contract, the server can be built to match
it with no frontend changes.

## Configuration

Copy `.env.example` to `.env.local` and fill in what you need. Every value is public-safe
(it ships to the browser); secrets stay server-side.

| Variable | Purpose |
|---|---|
| `VITE_PRIVY_APP_ID` | Enables real wallet / email / X login. Guest mode without it. |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Enable server-authoritative connected mode when `VITE_PRIVY_APP_ID` is also set. |
| `VITE_PYTH_HERMES_URL` / `VITE_PYTH_BTC_USD_ID` / `VITE_PYTH_ETH_USD_ID` / `VITE_PYTH_SOL_USD_ID` | Optional Pyth overrides. |
| `VITE_TOKEN_MINT` / `VITE_TOKEN_SYMBOL` | Token holder badge and gate (placeholder until set). |

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Backend

Connected mode is served by Supabase edge functions that own all scoring and anti-cheat.
The database schema, RPCs, edge functions, and pgTAP checks live under `supabase/`.

Backend prerequisites:

- Supabase CLI
- Docker running locally for `supabase start`, `supabase db lint`, and `supabase test db`
- Deno for edge-function unit tests

Run the backend checks before deploying:

```bash
supabase start
supabase db reset --local
npm run supabase:doctor
```

`npm run supabase:doctor` runs database linting, Deno unit tests for the shared game
engine, and pgTAP tests for round reservation / settlement invariants.
`supabase db reset --local` keeps an already-running local database on the latest migration
before the pgTAP suite runs.

Deploy the backend before enabling connected mode in Netlify:

```bash
supabase login
supabase link --project-ref <staging-or-production-ref>
npm run supabase:deploy
```

Deploy to staging first, smoke-test connected open / close flows there, then repeat against
production. `npm run supabase:deploy` runs `npm run supabase:doctor`, then pushes
migrations to the linked project and deploys the `profile`, `leaderboard`, `open-trade`,
and `close-trade` edge functions.

Set backend secrets from `supabase/functions/.env.example` with `supabase secrets set`.
Required for connected production: `SUPABASE_URL`, either `SUPABASE_SERVICE_ROLE_KEY`
or `SUPABASE_SECRET_KEYS`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and
`PRIVY_VERIFICATION_KEY`. Also set `APP_ALLOWED_ORIGINS` to the comma-separated local,
staging, production, and custom-domain origins allowed to call Edge Functions. Required
for reward gating: `SOLANA_RPC_URL` and `TOKEN_MINT`. Optional overrides include Pyth
feed ids, `PYTH_HERMES_URL`, `HOLDER_MIN_BALANCE`, and the local/test-only
`HOLDER_PLACEHOLDER`. `APP_TRUST_EDGE_IP_HEADERS` is optional and should stay `false`
unless the deployed edge is verified to strip or overwrite caller-supplied IP headers;
when false, authenticated calls are throttled per user but skip the spoofable per-IP
database bucket. Never put
`SUPABASE_SERVICE_ROLE_KEY`, Privy secrets, or RPC credentials in browser env files.

Netlify production, deploy-preview, and branch-deploy contexts already set
`VITE_REQUIRE_BACKEND=true` in `netlify.toml`. Keep it enabled for hosted connected
deployments so partial Privy/Supabase configuration fails loudly instead of falling back
to browser-only scoring.

`npm run build` also runs a prebuild check. Local paper-mode builds pass with all
connected-mode variables empty; production or connected builds fail early unless
`VITE_PRIVY_APP_ID`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` are all set.
The same check fails if a `VITE_*` browser variable looks like a service-role key,
private key, password, secret, or RPC credential. Keep all write-capable backend
secrets in Supabase Edge Function secrets only.
