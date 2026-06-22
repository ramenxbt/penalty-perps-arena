import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";
import { assignedMarketForAttempt, Direction, MarketSymbol, RULES } from "./game.ts";
import { HttpError } from "./http.ts";

export type ActiveTradeRound = {
  roundId: string;
  market: MarketSymbol;
  direction: Direction;
  entryPrice: number;
  openedAt: number;
  closesAt: number;
  attemptsRemaining: number;
};

export type PlayerProfile = {
  id: string;
  name: string;
  avatar: string;
  score: number;
  streak: number;
  attemptsRemaining: number;
  isHolder: boolean;
  walletAddress: string | null;
  activeRound: ActiveTradeRound | null;
  nextMarket: MarketSymbol | null;
};

type PlayerRow = {
  id: string;
  display_name: string;
  avatar: string;
  wallet_address: string | null;
  is_holder: boolean;
};

type StatsRow = {
  score: number;
  streak: number;
};

type DailyRow = {
  used: number;
};

type ActiveRoundRow = {
  id: string;
  market: MarketSymbol;
  direction: Direction;
  entry_price: number;
  opened_at: string;
  closes_at: string;
};

export async function expireStaleOpenRounds(admin: SupabaseClient, playerId: string): Promise<number> {
  const { data, error } = await admin.rpc("expire_stale_trade_rounds", {
    p_player_id: playerId,
    p_grace_seconds: 30,
  });

  if (error) {
    throw new HttpError(500, "Could not recover expired round.", "expired_round_recovery_failed");
  }

  return typeof data === "number" ? data : 0;
}

export async function ensurePlayer(
  admin: SupabaseClient,
  params: {
    id: string;
    name?: string;
    avatar?: string;
    walletAddress?: string | null;
  },
): Promise<void> {
  const name = params.name ?? `player-${params.id.slice(-6)}`;
  const avatar = params.avatar ?? "PP";

  const playerPayload = {
    id: params.id,
    display_name: name,
    avatar,
    wallet_address: params.walletAddress ?? null,
  };

  const { error: playerError } = params.name || params.avatar || params.walletAddress !== undefined
    ? await admin.from("players").upsert(playerPayload, { onConflict: "id" })
    : await admin.from("players").insert(playerPayload);

  if (playerError && playerError.code !== "23505") {
    throw new HttpError(500, "Could not upsert player.", "player_upsert_failed");
  }

  const { error: statsError } = await admin
    .from("player_stats")
    .upsert({ player_id: params.id }, { onConflict: "player_id", ignoreDuplicates: true });

  if (statsError) throw new HttpError(500, "Could not upsert player stats.", "stats_upsert_failed");
}

export async function getProfile(admin: SupabaseClient, playerId: string): Promise<PlayerProfile> {
  const today = new Date().toISOString().slice(0, 10);
  await expireStaleOpenRounds(admin, playerId);

  const [{ data: player, error: playerError }, { data: stats }, { data: daily }] = await Promise.all([
    admin.from("players").select("id,display_name,avatar,wallet_address,is_holder").eq("id", playerId).maybeSingle(),
    admin.from("player_stats").select("score,streak").eq("player_id", playerId).maybeSingle(),
    admin.from("daily_rounds").select("used").eq("player_id", playerId).eq("utc_day", today).maybeSingle(),
  ]);

  const playerRow = player as PlayerRow | null;
  const statsRow = stats as StatsRow | null;
  const dailyRow = daily as DailyRow | null;

  if (playerError || !playerRow) {
    throw new HttpError(404, "Player not found.", "player_not_found");
  }

  const used = dailyRow?.used ?? 0;
  const attemptsRemaining = Math.max(0, RULES.dailyRounds - used);
  const { data: activeRound, error: activeRoundError } = await admin
    .from("trade_rounds")
    .select("id,market,direction,entry_price,opened_at,closes_at")
    .eq("player_id", playerId)
    .eq("settled", false)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeRoundError) {
    throw new HttpError(500, "Could not load active round.", "active_round_load_failed");
  }

  const activeRoundRow = activeRound as ActiveRoundRow | null;

  return {
    id: playerRow.id,
    name: playerRow.display_name,
    avatar: playerRow.avatar,
    score: statsRow?.score ?? 0,
    streak: statsRow?.streak ?? 0,
    attemptsRemaining,
    isHolder: playerRow.is_holder,
    walletAddress: playerRow.wallet_address,
    activeRound: activeRoundRow
      ? {
        roundId: activeRoundRow.id,
        market: activeRoundRow.market,
        direction: activeRoundRow.direction,
        entryPrice: activeRoundRow.entry_price,
        openedAt: new Date(activeRoundRow.opened_at).getTime(),
        closesAt: new Date(activeRoundRow.closes_at).getTime(),
        attemptsRemaining,
      }
      : null,
    nextMarket: activeRoundRow
      ? activeRoundRow.market
      : attemptsRemaining > 0
        ? assignedMarketForAttempt(playerId, today, used)
        : null,
  };
}

export async function refreshLeaderboardIdentity(admin: SupabaseClient, profile: PlayerProfile): Promise<void> {
  const playedToday = RULES.dailyRounds - profile.attemptsRemaining;
  const { error } = await admin.from("leaderboard").upsert({
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    score: profile.score,
    streak: profile.streak,
    today: `${playedToday}/${RULES.dailyRounds}`,
    is_ai: false,
    is_holder: profile.isHolder,
    movement: profile.streak > 0 ? 7 : -1,
  }, { onConflict: "id", ignoreDuplicates: true });

  if (error) {
    throw new HttpError(500, "Could not refresh leaderboard identity.", "leaderboard_refresh_failed");
  }

  const { error: updateError } = await admin
    .from("leaderboard")
    .update({
      name: profile.name,
      avatar: profile.avatar,
      today: `${playedToday}/${RULES.dailyRounds}`,
      is_holder: profile.isHolder,
    })
    .eq("id", profile.id)
    .eq("is_ai", false);

  if (updateError) {
    throw new HttpError(500, "Could not refresh leaderboard identity.", "leaderboard_refresh_failed");
  }
}
