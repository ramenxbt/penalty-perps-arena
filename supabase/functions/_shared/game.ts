export type Direction = "long" | "short";
export type MarketSymbol = "BTC" | "ETH" | "SOL";

export const RULES = {
  dailyRounds: 5,
  tradeWindowMs: 12000,
  basePointsPerGoal: 100,
  seedPrice: 162.42,
  tiers: [
    { minPnl: 0.08, shots: 3, openness: 0.9 },
    { minPnl: 0.035, shots: 2, openness: 0.7 },
    { minPnl: 0.008, shots: 1, openness: 0.5 },
    { minPnl: -0.035, shots: 1, openness: 0.15 },
  ] as const,
} as const;

const TIER_EPSILON = 1e-9;

export type RoundOutcome = {
  market: MarketSymbol;
  pnlPct: number;
  profit: boolean;
  shots: number;
  goals: number;
  openness: number;
  points: number;
  entryPrice: number;
  exitPrice: number;
  summary: string;
};

export type Shooter = {
  id: string;
  name: string;
  isYou: boolean;
  isAi: boolean;
  pnlPct: number;
  shots: number;
  goals: number;
  openness: number;
};

export function isDirection(value: unknown): value is Direction {
  return value === "long" || value === "short";
}

export function isMarketSymbol(value: unknown): value is MarketSymbol {
  return value === "BTC" || value === "ETH" || value === "SOL";
}

export function secureRandom(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] / 0x100000000;
}

export function randomMarketSymbol(): MarketSymbol {
  const markets: readonly MarketSymbol[] = ["BTC", "ETH", "SOL"];
  return markets[Math.floor(secureRandom() * markets.length)] ?? "SOL";
}

export function assignedMarketForAttempt(playerId: string, utcDay: string, usedAttempts: number): MarketSymbol {
  const markets: readonly MarketSymbol[] = ["BTC", "ETH", "SOL"];
  const seed = `${playerId}:${utcDay}:${Math.max(0, usedAttempts)}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return markets[(hash >>> 0) % markets.length] ?? "SOL";
}

export function computePnlPct(direction: Direction, entry: number, exit: number): number {
  if (entry <= 0) return 0;
  const move = (exit - entry) / entry;
  const dir = direction === "long" ? 1 : -1;
  return move * dir * 100;
}

export function resolveShots(pnlPct: number): { shots: number; openness: number } {
  for (const tier of RULES.tiers) {
    if (pnlPct + TIER_EPSILON >= tier.minPnl) return { shots: tier.shots, openness: tier.openness };
  }
  return { shots: 0, openness: 0 };
}

export function rollGoals(shots: number, openness: number, rng: () => number = secureRandom): number {
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

export function settlementCloseTimeMs(requestReceivedAtMs: number, closesAtMs: number): number {
  return Math.min(requestReceivedAtMs, closesAtMs);
}
