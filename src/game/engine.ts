/**
 * Pure game logic for the trade-to-shoot loop. No React, no I/O.
 *
 * The skill is the trade: pick a side and leverage, then close while you are up.
 * Your realized PnL decides how many shots you earn and how open the net is. The
 * server (built by Codex) must replicate this exact formula and these constants so a
 * connected result matches a local one. See BACKEND_HANDOFF.md.
 */

import { Direction, MarketPoint, MarketSymbol, RoundOutcome } from "./types";

export const RULES = {
  /** Rounds allowed per player per UTC day. */
  dailyRounds: 5,
  /** Rounds in one match / cup run. A short three-round cup keeps a run punchy. */
  matchRounds: 3,
  /** How long an open position runs before it auto-closes (ms). */
  tradeWindowMs: 12000,
  basePointsPerGoal: 100,
  seedPrice: 162.42,
  /**
   * Realized PnL % (raw price move, no leverage) -> earned shots + net openness,
   * richest tier first. Calibrated to the lively arena feed (see GAME_VOL_PCT): a typical
   * favorable swing you can catch by closing on the right wiggle is ~0.1-0.25%, so three
   * shots is earned by good timing, not automatic. A small loss still earns one
   * near-hopeless shot; a real loss earns nothing. The server must mirror these thresholds.
   */
  tiers: [
    { minPnl: 40, shots: 3, openness: 0.9 },
    { minPnl: 15, shots: 2, openness: 0.7 },
    { minPnl: 4, shots: 1, openness: 0.5 },
    { minPnl: -15, shots: 1, openness: 0.15 },
  ] as const,
} as const;

/**
 * Per-tick volatility of the arena chart, as a fraction of price. The arena series is a wild,
 * memecoin-style random walk tethered loosely to the live market price: the live price seeds
 * and anchors it, but inside a trade window it swings tens (sometimes hundreds) of percent so
 * timing the close is dramatic. PnL is taken on this arena series, so the tiers above are in
 * whole-percent terms. See useMarketFeed and nextArenaPrice.
 */
export const GAME_VOL_PCT = 0.09;
/** How fast the arena price ticks (ms). */
export const ARENA_TICK_MS = 500;
/**
 * How strongly the arena price is pulled back toward the live market each tick (0-1). Kept
 * low so the walk can wander tens (sometimes hundreds) of percent from the anchor before the
 * mean reversion reels it back, instead of hugging the live price.
 */
export const ARENA_TETHER = 0.02;

const TIER_EPSILON = 1e-9;

/**
 * Shared PnL display scale, derived from RULES.tiers so the dial, the power meter, and the
 * shot thresholds all speak the same numbers (+4 / +15 / +40 today). Change a tier and every
 * surface follows. Keeping this here means the UI never hardcodes a full-scale or a min/max.
 */
const POSITIVE_TIERS = RULES.tiers.filter((tier) => tier.minPnl > 0);
const NEGATIVE_TIERS = RULES.tiers.filter((tier) => tier.minPnl < 0);

/** Top earning threshold (the richest tier, +40 today). Fills the gauge and ends the meter. */
export const TOP_TIER_PNL = Math.max(...POSITIVE_TIERS.map((tier) => tier.minPnl));
/** Deepest loss the tiers care about (the shallow-loss shot floor, -15 today). */
export const BOTTOM_TIER_PNL = NEGATIVE_TIERS.length
  ? Math.min(...NEGATIVE_TIERS.map((tier) => tier.minPnl))
  : 0;

/** PnL % that fills the semicircular gauge. A tiny wiggle no longer pins it to full. */
export const GAUGE_FULL_SCALE = TOP_TIER_PNL;

/** Power-meter bounds: loss floor on the left, top earning tier on the right. */
export const POWER_MIN = BOTTOM_TIER_PNL;
export const POWER_MAX = TOP_TIER_PNL;

/** Positive shot thresholds (ascending), for tick marks and next-tier copy. */
export const SHOT_TIERS = [...POSITIVE_TIERS]
  .map((tier) => ({ shots: tier.shots, minPnl: tier.minPnl }))
  .sort((a, b) => a.minPnl - b.minPnl);

/** Whether a small loss still earns one near-hopeless shot (the shallow-loss tier). */
export const LOSS_EARNS_SHOT = NEGATIVE_TIERS.length > 0;

/**
 * One plain-language sentence teaching the core rule, built straight from RULES.tiers so the
 * onboarding copy can never drift from the settlement math. Reads like "+4% = 1, +15% = 2,
 * +40% = 3" using the live tier thresholds.
 */
export const PROFIT_TO_SHOTS_LINE = SHOT_TIERS.map(
  (tier) => `+${tier.minPnl}% = ${tier.shots}`,
).join(", ");

/**
 * The downside teaching line, derived from concededFor's thresholds. Names the loss that first
 * lets the keeper score on you so the warning matches the math.
 */
const FIRST_CONCEDE_PNL = 10;
export const CONCEDE_WARNING_LINE = `A big loss (past -${FIRST_CONCEDE_PNL}%) lets the keeper score on you and costs points.`;

/** Position 0-1 of a PnL value on the power-meter scale. */
export function powerRatioFor(pnlPct: number): number {
  if (POWER_MAX === POWER_MIN) return 0;
  return Math.max(0, Math.min(1, (pnlPct - POWER_MIN) / (POWER_MAX - POWER_MIN)));
}

export function createInitialMarket(
  seed: number = RULES.seedPrice,
  volatility = 0.72,
  endTime = Date.now(),
): MarketPoint[] {
  const amplitude = Math.max(0.001, volatility * 1.25);
  return Array.from({ length: 34 }, (_, index) => ({
    value: Math.max(0.01, seed + Math.sin(index * 0.45) * amplitude + index * volatility * 0.025),
    time: endTime - (33 - index) * 1000,
  }));
}

/** Fallback price generator used only when the live Pyth feed is unavailable. */
export function nextPrice(points: MarketPoint[], volatility = 0.72): MarketPoint[] {
  const last = points[points.length - 1]?.value ?? RULES.seedPrice;
  const trend = Math.sin(Date.now() / 4300) * 0.19;
  const shock = (Math.random() - 0.48) * volatility;
  const next = Math.max(0.01, last + trend + shock);
  return [...points.slice(-71), { value: next, time: Date.now() }];
}

/**
 * Build a pre-rolled arena series around a seed price so the chart opens lively, not flat.
 */
export function createArenaSeed(seed: number = RULES.seedPrice, endTime = Date.now()): MarketPoint[] {
  let value = seed;
  const points: MarketPoint[] = [];
  for (let i = 0; i < 34; i += 1) {
    points.push({ value: Math.max(0.01, value), time: endTime - (33 - i) * ARENA_TICK_MS });
    value = nextArenaPrice(value, seed);
  }
  return points;
}

/**
 * Next arena price: a wild random walk tethered to the live market `anchor`. The tether
 * mean-reverts toward the real price so the walk never runs to zero or infinity; the large
 * per-tick shock makes the chart swing tens (sometimes hundreds) of percent inside a trade
 * window. Bounded to a wide band around the anchor as a hard safety net.
 */
export function nextArenaPrice(prev: number, anchor: number, volPct = GAME_VOL_PCT): number {
  const base = Math.max(0.01, anchor);
  const pull = (base - prev) * ARENA_TETHER;
  const shock = (Math.random() - 0.5) * Math.max(prev, base) * volPct * 2;
  const next = prev + pull + shock;
  return Math.min(base * 15, Math.max(base * 0.05, next));
}

/** Realized PnL %, signed by direction (no leverage). */
export function computePnlPct(direction: Direction, entry: number, exit: number): number {
  if (entry <= 0) return 0;
  const move = (exit - entry) / entry;
  const dir = direction === "long" ? 1 : -1;
  return move * dir * 100;
}

/** Map PnL to earned shots and net openness. */
export function resolveShots(pnlPct: number): { shots: number; openness: number } {
  for (const tier of RULES.tiers) {
    if (pnlPct + TIER_EPSILON >= tier.minPnl) return { shots: tier.shots, openness: tier.openness };
  }
  return { shots: 0, openness: 0 };
}

/**
 * The downside mirror of resolveShots: the worse the loss, the more goals the keeper puts
 * past you. A profit or shallow loss concedes nothing; deep losses concede 1-3, costing
 * points and dropping you on the ladder. Tunable; the server must mirror these thresholds.
 */
export function concededFor(pnlPct: number): number {
  if (pnlPct < -45) return 3; // blowout
  if (pnlPct < -25) return 2;
  if (pnlPct < -10) return 1;
  return 0;
}

/**
 * Roll the earned shots against the keeper. Each shot scores with probability
 * `openness`, nudged up slightly per shot so a clean trade rarely whiffs entirely.
 * `rng` is injectable so the server can use its own trusted randomness.
 */
export function rollGoals(shots: number, openness: number, rng: () => number = Math.random): number {
  let goals = 0;
  for (let i = 0; i < shots; i += 1) {
    const chance = Math.min(0.97, openness + i * 0.05);
    if (rng() < chance) goals += 1;
  }
  return goals;
}

export function roundPoints(goals: number, pnlPct: number, streak: number): number {
  const goalPoints = goals * RULES.basePointsPerGoal;
  // pnlPct is now whole-percent (tens of %), so a smaller multiplier keeps the profit bonus
  // in the same ballpark as goal points instead of dwarfing them.
  const profitBonus = Math.max(0, Math.round(pnlPct * 5));
  // Conceding costs you: each goal against subtracts a goal's worth of points, so a bad
  // cup can go negative and drop you on the ladder. Not floored at 0 here on purpose;
  // cumulative score is floored where it is applied.
  const concededPenalty = concededFor(pnlPct) * RULES.basePointsPerGoal;
  const streakBonus = goals > 0 ? Math.min(60, streak * 10) : 0;
  return goalPoints + profitBonus + streakBonus - concededPenalty;
}

export function roundSummary(pnlPct: number, shots: number, goals: number, conceded: number): string {
  if (conceded >= 3) return "Blown out. Keeper put three past you.";
  if (conceded === 2) return "Rough loss. Two conceded.";
  if (conceded === 1) return "Loss punished. One conceded.";
  if (shots === 0) return "Liquidated before the whistle. No kick.";
  if (goals === 0) return "Keeper read the tape. Blocked.";
  if (goals >= shots && shots >= 2) return "Clean sweep. Net ripped.";
  if (pnlPct <= 0) return "Scrappy finish off a losing trade.";
  return goals === 1 ? "Buried it. Market read held." : "Brace. Two on the board.";
}

/** Full settle of your round, given pinned entry and the close price. */
export function resolveRound(params: {
  market?: MarketSymbol;
  direction: Direction;
  entryPrice: number;
  exitPrice: number;
  streak: number;
  rng?: () => number;
}): RoundOutcome {
  const { market = "SOL", direction, entryPrice, exitPrice, streak, rng } = params;
  const pnlPct = computePnlPct(direction, entryPrice, exitPrice);
  const { shots, openness } = resolveShots(pnlPct);
  const goals = rollGoals(shots, openness, rng);
  const conceded = concededFor(pnlPct);
  const points = roundPoints(goals, pnlPct, streak);
  return {
    market,
    pnlPct,
    profit: pnlPct > 0,
    shots,
    goals,
    conceded,
    openness,
    points,
    entryPrice,
    exitPrice,
    summary: roundSummary(pnlPct, shots, goals, conceded),
  };
}
