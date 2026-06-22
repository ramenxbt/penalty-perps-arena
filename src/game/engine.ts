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
  /** How long an open position runs before it auto-closes (ms). */
  tradeWindowMs: 12000,
  basePointsPerGoal: 100,
  seedPrice: 162.42,
  /**
   * Realized PnL % (raw price move, no leverage) -> earned shots + net openness,
   * richest tier first. Calibrated to the small moves you can catch by closing on a
   * favorable wiggle within the trade window. A small loss still earns one near-hopeless
   * shot; a real loss earns nothing. Tunable; the server must mirror these thresholds.
   */
  tiers: [
    { minPnl: 0.08, shots: 3, openness: 0.9 },
    { minPnl: 0.035, shots: 2, openness: 0.7 },
    { minPnl: 0.008, shots: 1, openness: 0.5 },
    { minPnl: -0.035, shots: 1, openness: 0.15 },
  ] as const,
} as const;

const TIER_EPSILON = 1e-9;

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
  const profitBonus = Math.max(0, Math.round(pnlPct * 500));
  const streakBonus = goals > 0 ? Math.min(60, streak * 10) : 0;
  return Math.max(0, goalPoints + profitBonus + streakBonus);
}

export function roundSummary(pnlPct: number, shots: number, goals: number): string {
  if (shots === 0) return "Liquidated before the whistle. No kick.";
  if (goals === 0) return "Keeper read the tape. Saved.";
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
  const points = roundPoints(goals, pnlPct, streak);
  return {
    market,
    pnlPct,
    profit: pnlPct > 0,
    shots,
    goals,
    openness,
    points,
    entryPrice,
    exitPrice,
    summary: roundSummary(pnlPct, shots, goals),
  };
}
