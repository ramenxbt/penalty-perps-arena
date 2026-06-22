import { assertFreshPrivyUser, authenticateRequest } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/db.ts";
import {
  assignedMarketForAttempt,
  isDirection,
  RULES,
} from "../_shared/game.ts";
import {
  HttpError,
  jsonResponse,
  readJsonObject,
  withHttp,
} from "../_shared/http.ts";
import { ensurePlayer, expireStaleOpenRounds } from "../_shared/players.ts";
import { getLatestMarketPrice } from "../_shared/pyth.ts";
import { checkPreAuthRateLimit, checkRateLimit } from "../_shared/rateLimit.ts";

type OpenTradeRpcRow = {
  round_id: string;
  attempts_remaining: number;
  market: "BTC" | "ETH" | "SOL";
  direction: "long" | "short";
  entry_price: number;
  opened_at: string;
  closes_at: string;
};

type ExistingOpenRoundRow = {
  id: string;
  utc_day: string;
  market: "BTC" | "ETH" | "SOL";
  direction: "long" | "short";
  entry_price: number;
  opened_at: string;
  closes_at: string;
};

type DailyRoundRow = {
  used: number;
};

async function loadTodayUsedAttempts(
  admin: ReturnType<typeof getAdminClient>,
  playerId: string,
): Promise<{ today: string; used: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("daily_rounds")
    .select("used")
    .eq("player_id", playerId)
    .eq("utc_day", today)
    .maybeSingle();

  if (error) {
    throw new HttpError(
      500,
      "Could not load round reservation.",
      "daily_round_load_failed",
    );
  }
  const daily = data as DailyRoundRow | null;
  return { today, used: daily?.used ?? 0 };
}

function mapOpenError(message: string): never {
  if (message.includes("invalid_market")) {
    throw new HttpError(400, "Invalid market.", "invalid_market");
  }
  if (message.includes("market_assignment_mismatch")) {
    throw new HttpError(
      409,
      "Market draw changed. Please retry.",
      "market_assignment_changed",
    );
  }
  if (message.includes("invalid_direction")) {
    throw new HttpError(400, "Invalid direction.", "invalid_direction");
  }
  if (message.includes("daily_cap_exceeded")) {
    throw new HttpError(403, "No rounds left today.", "daily_cap_exceeded");
  }
  if (
    message.includes("open_round_exists") ||
    message.includes("trade_rounds_one_open_per_player")
  ) {
    throw new HttpError(
      409,
      "A position is already open.",
      "open_round_exists",
    );
  }
  throw new HttpError(500, "Could not open trade.", "open_trade_failed");
}

function openTradeResponse(row: OpenTradeRpcRow) {
  return {
    roundId: row.round_id,
    market: row.market,
    direction: row.direction,
    entryPrice: row.entry_price,
    openedAt: new Date(row.opened_at).getTime(),
    closesAt: new Date(row.closes_at).getTime(),
    attemptsRemaining: row.attempts_remaining,
  };
}

async function loadExistingOpenTrade(
  admin: ReturnType<typeof getAdminClient>,
  playerId: string,
): Promise<OpenTradeRpcRow | null> {
  const { data: round, error: roundError } = await admin
    .from("trade_rounds")
    .select("id,utc_day,market,direction,entry_price,opened_at,closes_at")
    .eq("player_id", playerId)
    .eq("settled", false)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (roundError) {
    throw new HttpError(
      500,
      "Could not load open trade.",
      "open_trade_load_failed",
    );
  }
  const openRound = round as ExistingOpenRoundRow | null;
  if (!openRound) return null;

  const { data: daily, error: dailyError } = await admin
    .from("daily_rounds")
    .select("used")
    .eq("player_id", playerId)
    .eq("utc_day", openRound.utc_day)
    .maybeSingle();

  if (dailyError) {
    throw new HttpError(
      500,
      "Could not load round reservation.",
      "daily_round_load_failed",
    );
  }
  const dailyRound = daily as DailyRoundRow | null;
  if (!dailyRound) {
    throw new HttpError(
      500,
      "Round reservation is missing.",
      "missing_daily_round_reservation",
    );
  }

  return {
    round_id: openRound.id,
    attempts_remaining: Math.max(0, RULES.dailyRounds - dailyRound.used),
    market: openRound.market,
    direction: openRound.direction,
    entry_price: openRound.entry_price,
    opened_at: openRound.opened_at,
    closes_at: openRound.closes_at,
  };
}

Deno.serve((req) =>
  withHttp(async (request) => {
    checkPreAuthRateLimit(request, "open-trade", { limit: 120 });
    const admin = getAdminClient();
    const caller = await authenticateRequest(request);
    await checkRateLimit(admin, request, "open-trade", caller.userId, 20);
    await assertFreshPrivyUser(caller);

    const body = await readJsonObject(request);
    if (!isDirection(body.direction)) {
      throw new HttpError(400, "Invalid direction.", "invalid_direction");
    }

    await ensurePlayer(admin, { id: caller.userId });
    await expireStaleOpenRounds(admin, caller.userId);

    const existingOpenTrade = await loadExistingOpenTrade(admin, caller.userId);
    if (existingOpenTrade) {
      return jsonResponse(openTradeResponse(existingOpenTrade));
    }

    const now = Date.now();
    const openedAt = new Date(now);
    const closesAt = new Date(now + RULES.tradeWindowMs);
    const { today, used } = await loadTodayUsedAttempts(admin, caller.userId);
    const market = assignedMarketForAttempt(caller.userId, today, used);
    const pyth = await getLatestMarketPrice(market);

    const { data, error } = await admin.rpc("open_trade_round", {
      p_player_id: caller.userId,
      p_market: market,
      p_direction: body.direction,
      p_entry_price: pyth.price,
      p_entry_pyth_publish_time: pyth.publishTime,
      p_opened_at: openedAt.toISOString(),
      p_closes_at: closesAt.toISOString(),
    });

    if (error) {
      mapOpenError(error.message);
    }

    const row = (data as OpenTradeRpcRow[] | null)?.[0];
    if (!row) {
      throw new HttpError(500, "Could not open trade.", "open_trade_failed");
    }

    return jsonResponse(openTradeResponse(row));
  }, req)
);
