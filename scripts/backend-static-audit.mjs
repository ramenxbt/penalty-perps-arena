import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function compact(sqlOrCode) {
  return sqlOrCode.replace(/\s+/g, " ").toLowerCase();
}

const migrationPath = "supabase/migrations/20260619210557_penalty_perps_backend.sql";
const migration = read(migrationPath);
const sql = compact(migration);
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function expectSql(fragment, message) {
  expect(sql.includes(fragment.toLowerCase()), `${migrationPath}: ${message}`);
}

function expectCode(path, pattern, message) {
  const source = read(path);
  const ok = typeof pattern === "string" ? source.includes(pattern) : pattern.test(source);
  expect(ok, `${path}: ${message}`);
}

function expectNoCode(path, pattern, message) {
  const source = read(path);
  const ok = typeof pattern === "string" ? !source.includes(pattern) : !pattern.test(source);
  expect(ok, `${path}: ${message}`);
}

const protectedTables = [
  "players",
  "player_stats",
  "daily_rounds",
  "trade_rounds",
  "rounds_settled",
  "leaderboard",
  "rate_limits",
];

for (const table of protectedTables) {
  expectSql(`create table public.${table}`, `missing public.${table} table`);
  expectSql(`alter table public.${table} enable row level security`, `public.${table} must have RLS enabled`);
  expectSql(`grant all on public.${table} to service_role`, `public.${table} must be service-role writable only`);
}

expectSql(
  "grant select on public.leaderboard to anon, authenticated",
  "leaderboard must be explicitly exposed as read-only for the browser Data API",
);
expect(
  !/grant\s+(all|insert|update|delete)\s+on\s+public\.\w+\s+to\s+(anon|authenticated)/i.test(migration),
  `${migrationPath}: anon/authenticated must not receive write grants on public tables`,
);
expect(
  !/security\s+definer/i.test(migration),
  `${migrationPath}: public functions should not use SECURITY DEFINER`,
);
expectSql(
  "create unique index trade_rounds_one_open_per_player",
  "one unsettled round per player invariant is missing",
);
expectSql(
  "where settled = false",
  "one-open-round index must only cover unsettled rounds",
);
expectSql(
  "constraint trade_rounds_window_bounded check (closes_at <= opened_at + interval '12 seconds')",
  "trade window must be bounded to the game rule",
);
expectSql(
  "create or replace function public.assigned_market_for_attempt",
  "deterministic market assignment function is missing",
);
expectSql(
  "if p_market <> v_assigned_market then raise exception 'market_assignment_mismatch'",
  "open_trade_round must reject caller-selected markets that do not match the locked assignment",
);
expectSql(
  "insert into public.daily_rounds (player_id, utc_day, used)",
  "open_trade_round must reserve daily attempts",
);
expectSql(
  "where player_id = p_player_id and utc_day = v_day for update",
  "daily attempt reservation must lock the daily row",
);
expectSql(
  "if v_round.settled then raise exception 'round_already_settled'",
  "settle_trade_round must reject replayed settlements",
);
expectSql(
  "if p_exit_pyth_publish_time < v_round.entry_pyth_publish_time then raise exception 'exit_price_before_entry'",
  "settle_trade_round must reject exit prices older than entry",
);
expectSql(
  "if p_exit_pyth_publish_time > v_max_exit_publish_time then raise exception 'exit_publish_time_after_window'",
  "settle_trade_round must reject exit prices after the trade window",
);
expectSql(
  "alter publication supabase_realtime add table public.leaderboard",
  "leaderboard must be added to realtime publication",
);

const rpcFunctions = [
  "check_rate_limit(text, text, integer, integer)",
  "assigned_market_for_attempt(text, date, integer)",
  "open_trade_round(text, text, text, double precision, bigint, timestamptz, timestamptz)",
  "settle_trade_round(uuid, text, double precision, bigint)",
  "expire_stale_trade_rounds(text, integer)",
  "record_co_shooter_volley(uuid, text, jsonb)",
  "bump_ai_leaderboard(text, integer, boolean)",
];

for (const fn of rpcFunctions) {
  expectSql(`revoke execute on function public.${fn} from public, anon, authenticated`, `${fn} execute must be revoked from public clients`);
  expectSql(`grant execute on function public.${fn} to service_role`, `${fn} execute must be service-role only`);
}

const edgeFunctions = ["profile", "leaderboard", "open-trade", "close-trade"];
for (const name of edgeFunctions) {
  const path = `supabase/functions/${name}/index.ts`;
  const source = read(path);
  expectCode(path, `checkPreAuthRateLimit(request, "${name}"`, "missing pre-auth rate limit");
  expectCode(path, `checkRateLimit(admin, request, "${name}"`, "missing authenticated user rate limit");
  expectCode(path, "authenticateRequest(request)", "missing Privy bearer authentication");
  expect(
    source.includes("assertFreshPrivyUser(caller)") ||
      source.includes("fetchPrivyUser(caller.userId)"),
    `${path}: missing live Privy freshness check`,
  );
}

expectCode("supabase/functions/open-trade/index.ts", "assignedMarketForAttempt", "open-trade must derive the locked market server-side");
expectCode("supabase/functions/open-trade/index.ts", "getLatestMarketPrice(market)", "open-trade must pin the server-side entry price");
expectCode("supabase/functions/close-trade/index.ts", "const requestReceivedAtMs = Date.now()", "close-trade must pin manual closes to server receipt time");
expectCode("supabase/functions/close-trade/index.ts", "settlementCloseTimeMs(requestReceivedAtMs, closesAtMs)", "close-trade must clamp late exits to the trade window");
expectCode("supabase/functions/close-trade/index.ts", "getMarketPriceAt(market, targetMs / 1000)", "close-trade must settle from historical Pyth at the pinned close time");
expectNoCode("supabase/functions/close-trade/index.ts", "body.clientExitPrice", "close-trade must ignore advisory client exit price");
expectCode("supabase/functions/_shared/pyth.ts", "BTC_USD_FEED_ID", "BTC Pyth feed is missing");
expectCode("supabase/functions/_shared/pyth.ts", "ETH_USD_FEED_ID", "ETH Pyth feed is missing");
expectCode("supabase/functions/_shared/pyth.ts", "SOL_USD_FEED_ID", "SOL Pyth feed is missing");
expectCode("supabase/functions/_shared/rateLimit.ts", "APP_TRUST_EDGE_IP_HEADERS", "rate limiter must keep proxy IP trust explicit");

if (failures.length) {
  console.error("Backend static audit failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Backend static audit passed.");
