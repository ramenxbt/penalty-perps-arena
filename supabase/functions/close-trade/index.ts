import { assertFreshPrivyUser, authenticateRequest } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/db.ts";
import {
  MarketSymbol,
  resolveShots,
  rollGoals,
  roundSummary,
  settlementCloseTimeMs,
  Shooter,
} from "../_shared/game.ts";
import {
  HttpError,
  jsonResponse,
  readJsonObject,
  withHttp,
} from "../_shared/http.ts";
import { loadAiLeaderboardRows } from "../_shared/leaderboard.ts";
import { ensurePlayer, getProfile, PlayerProfile } from "../_shared/players.ts";
import { getMarketPriceAt } from "../_shared/pyth.ts";
import { checkPreAuthRateLimit, checkRateLimit } from "../_shared/rateLimit.ts";

const MAX_CO_SHOOTERS = 4;
const CO_SHOOTER_PNL_SPREAD = 0.16;
const CO_SHOOTER_PNL_OFFSET = 0.06;

type TradeRoundRow = {
  id: string;
  player_id: string;
  utc_day: string;
  market: MarketSymbol;
  direction: "long" | "short";
  entry_price: number;
  opened_at: string;
  closes_at: string;
  settled: boolean;
};

type SettledRpcRow = {
  score: number;
  streak: number;
  attempts_remaining: number;
  pnl_pct: number;
  shots: number;
  goals: number;
  openness: number;
  points: number;
};

type StoredSettlementRow =
  & Pick<SettledRpcRow, "pnl_pct" | "shots" | "goals" | "openness" | "points">
  & {
    exit_price: number;
    co_shooters: unknown;
  };

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "Invalid round id.", code);
  }
  return value.trim();
}

function mapSettleError(message: string): never {
  if (message.includes("round_not_found")) {
    throw new HttpError(404, "No open position to close.", "round_not_found");
  }
  if (message.includes("daily_cap_exceeded")) {
    throw new HttpError(403, "No rounds left today.", "daily_cap_exceeded");
  }
  if (message.includes("missing_daily_round_reservation")) {
    throw new HttpError(
      500,
      "Round reservation is missing.",
      "missing_daily_round_reservation",
    );
  }
  throw new HttpError(500, "Could not settle trade.", "settle_failed");
}

async function loadRound(
  admin: ReturnType<typeof getAdminClient>,
  roundId: string,
  playerId: string,
): Promise<TradeRoundRow> {
  const { data, error } = await admin
    .from("trade_rounds")
    .select(
      "id,player_id,utc_day,market,direction,entry_price,opened_at,closes_at,settled",
    )
    .eq("id", roundId)
    .eq("player_id", playerId)
    .maybeSingle();

  const row = data as TradeRoundRow | null;
  if (error) {
    throw new HttpError(500, "Could not load round.", "round_load_failed");
  }
  if (!row) {
    throw new HttpError(404, "No open position to close.", "round_not_found");
  }
  return row;
}

async function loadStoredSettlement(
  admin: ReturnType<typeof getAdminClient>,
  roundId: string,
  playerId: string,
): Promise<StoredSettlementRow> {
  const { data, error } = await admin
    .from("rounds_settled")
    .select("exit_price,pnl_pct,shots,goals,openness,points,co_shooters")
    .eq("round_id", roundId)
    .eq("player_id", playerId)
    .maybeSingle();

  const row = data as StoredSettlementRow | null;
  if (error) {
    throw new HttpError(
      500,
      "Could not load settled round.",
      "settlement_load_failed",
    );
  }
  if (!row) {
    throw new HttpError(409, "Round already settled.", "round_already_settled");
  }
  return row;
}

function storedCoShooters(value: unknown): Shooter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): Shooter[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const shooter = candidate as Partial<Shooter>;
    if (
      typeof shooter.id !== "string" ||
      typeof shooter.name !== "string" ||
      typeof shooter.pnlPct !== "number" ||
      typeof shooter.shots !== "number" ||
      typeof shooter.goals !== "number" ||
      typeof shooter.openness !== "number"
    ) {
      return [];
    }

    return [{
      id: shooter.id,
      name: shooter.name,
      isYou: false,
      isAi: true,
      pnlPct: shooter.pnlPct,
      shots: shooter.shots,
      goals: shooter.goals,
      openness: shooter.openness,
    }];
  });
}

function seededRandom(seed: string): () => number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += hash << 13;
    hash ^= hash >>> 7;
    hash += hash << 3;
    hash ^= hash >>> 17;
    hash += hash << 5;
    return (hash >>> 0) / 0x100000000;
  };
}

async function settlePrice(
  market: MarketSymbol,
  closesAt: string,
  requestReceivedAtMs: number,
) {
  const closesAtMs = new Date(closesAt).getTime();
  const targetMs = settlementCloseTimeMs(requestReceivedAtMs, closesAtMs);
  return await getMarketPriceAt(market, targetMs / 1000);
}

async function buildCoShooterVolley(
  admin: ReturnType<typeof getAdminClient>,
  roundId: string,
): Promise<Shooter[]> {
  const rows = await loadAiLeaderboardRows(admin, MAX_CO_SHOOTERS);
  const shooters: Shooter[] = [];
  for (const row of rows) {
    const rng = seededRandom(`${roundId}:${row.id}`);
    const pnlPct = rng() * CO_SHOOTER_PNL_SPREAD - CO_SHOOTER_PNL_OFFSET;
    const { shots, openness } = resolveShots(pnlPct);
    const goals = rollGoals(shots, openness, rng);

    shooters.push({
      id: row.id,
      name: row.name,
      isYou: false,
      isAi: true,
      pnlPct,
      shots,
      goals,
      openness,
    });
  }

  return shooters;
}

async function recordCoShooterVolley(
  admin: ReturnType<typeof getAdminClient>,
  roundId: string,
  playerId: string,
  coShooters: Shooter[],
): Promise<Shooter[]> {
  const { data, error } = await admin.rpc("record_co_shooter_volley", {
    p_round_id: roundId,
    p_player_id: playerId,
    p_co_shooters: coShooters,
  });

  if (error) {
    if (error.message.includes("settlement_not_found")) {
      throw new HttpError(
        500,
        "Round settlement is missing.",
        "settlement_not_found",
      );
    }
    if (error.message.includes("invalid_co_shooters")) {
      throw new HttpError(
        500,
        "Invalid co-shooter volley.",
        "invalid_co_shooters",
      );
    }
    if (error.message.includes("ai_row_not_found")) {
      throw new HttpError(
        500,
        "AI co-shooter row is missing.",
        "ai_row_not_found",
      );
    }
    throw new HttpError(
      500,
      "Could not record co-shooter volley.",
      "co_shooter_record_failed",
    );
  }

  return storedCoShooters(data);
}

async function ensureCoShooterVolley(
  admin: ReturnType<typeof getAdminClient>,
  roundId: string,
  playerId: string,
  existing: unknown,
): Promise<Shooter[]> {
  const stored = storedCoShooters(existing);
  if (stored.length > 0) return stored;
  const generated = await buildCoShooterVolley(admin, roundId);
  return await recordCoShooterVolley(admin, roundId, playerId, generated);
}

function roundPayload(
  round: TradeRoundRow,
  settled: StoredSettlementRow,
  profile: PlayerProfile,
  coShooters: Shooter[],
) {
  const outcome = {
    market: round.market,
    pnlPct: settled.pnl_pct,
    profit: settled.pnl_pct > 0,
    shots: settled.shots,
    goals: settled.goals,
    openness: settled.openness,
    points: settled.points,
    entryPrice: round.entry_price,
    exitPrice: settled.exit_price,
    summary: roundSummary(settled.pnl_pct, settled.shots, settled.goals),
  };
  const you: Shooter = {
    id: profile.id,
    name: profile.name,
    isYou: true,
    isAi: false,
    pnlPct: outcome.pnlPct,
    shots: outcome.shots,
    goals: outcome.goals,
    openness: outcome.openness,
  };

  return { outcome, shooters: [you, ...coShooters], profile };
}

Deno.serve((req) => {
  const requestReceivedAtMs = Date.now();
  return withHttp(async (request) => {
    checkPreAuthRateLimit(request, "close-trade", { limit: 120 });
    const admin = getAdminClient();
    const caller = await authenticateRequest(request);
    await checkRateLimit(admin, request, "close-trade", caller.userId, 30);
    await assertFreshPrivyUser(caller);

    const body = await readJsonObject(request);
    const roundId = requiredString(body.roundId, "invalid_round_id");

    await ensurePlayer(admin, { id: caller.userId });

    const round = await loadRound(admin, roundId, caller.userId);
    if (round.settled) {
      const [settled, profile] = await Promise.all([
        loadStoredSettlement(admin, round.id, caller.userId),
        getProfile(admin, caller.userId),
      ]);
      const coShooters = await ensureCoShooterVolley(
        admin,
        round.id,
        caller.userId,
        settled.co_shooters,
      );
      return jsonResponse(roundPayload(round, settled, profile, coShooters));
    }

    const pyth = await settlePrice(round.market, round.closes_at, requestReceivedAtMs);

    const { data, error } = await admin.rpc("settle_trade_round", {
      p_round_id: round.id,
      p_player_id: caller.userId,
      p_exit_price: pyth.price,
      p_exit_pyth_publish_time: pyth.publishTime,
    });

    if (error?.message.includes("round_already_settled")) {
      const [settled, profile] = await Promise.all([
        loadStoredSettlement(admin, round.id, caller.userId),
        getProfile(admin, caller.userId),
      ]);
      const coShooters = await ensureCoShooterVolley(
        admin,
        round.id,
        caller.userId,
        settled.co_shooters,
      );
      return jsonResponse(roundPayload(round, settled, profile, coShooters));
    }
    if (error) mapSettleError(error.message);
    const settled = (data as SettledRpcRow[] | null)?.[0];
    if (!settled) {
      throw new HttpError(500, "Could not settle trade.", "settle_failed");
    }

    const [profile, generatedCoShooters] = await Promise.all([
      getProfile(admin, caller.userId),
      buildCoShooterVolley(admin, round.id),
    ]);
    const coShooters = await recordCoShooterVolley(
      admin,
      round.id,
      caller.userId,
      generatedCoShooters,
    );
    return jsonResponse(
      roundPayload(
        round,
        { ...settled, exit_price: pyth.price, co_shooters: coShooters },
        profile,
        coShooters,
      ),
    );
  }, req);
});
