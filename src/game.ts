export type Direction = "long" | "short";
export type ShotZone = "left" | "center" | "right";
export type GamePhase = "idle" | "tracking" | "kicking" | "settled";

export type MarketPoint = {
  value: number;
  time: number;
};

export type KickResult = {
  goal: boolean;
  saveText: string;
  points: number;
  marketPoints: number;
  shotPoints: number;
  streakBonus: number;
};

export type BoardRow = {
  id: string;
  rank: number;
  name: string;
  avatar: string;
  score: number;
  streak: number;
  today: string;
  isAi: boolean;
  isHolder: boolean;
  movement: number;
};

export const initialRows: BoardRow[] = [
  {
    id: "u-1",
    rank: 1,
    name: "topbins.sol",
    avatar: "TB",
    score: 1840,
    streak: 8,
    today: "3/3",
    isAi: false,
    isHolder: true,
    movement: 2,
  },
  {
    id: "ai-1",
    rank: 2,
    name: "AI Squad: Meridian XI",
    avatar: "MX",
    score: 1775,
    streak: 11,
    today: "3/3",
    isAi: true,
    isHolder: false,
    movement: 1,
  },
  {
    id: "u-2",
    rank: 3,
    name: "curvemerchant",
    avatar: "CM",
    score: 1610,
    streak: 5,
    today: "2/3",
    isAi: false,
    isHolder: false,
    movement: -1,
  },
  {
    id: "ai-2",
    rank: 4,
    name: "AI Keeper: Atlas Wall",
    avatar: "AW",
    score: 1515,
    streak: 9,
    today: "2/3",
    isAi: true,
    isHolder: false,
    movement: 0,
  },
  {
    id: "u-3",
    rank: 5,
    name: "finalsweek",
    avatar: "FW",
    score: 1480,
    streak: 4,
    today: "2/3",
    isAi: false,
    isHolder: true,
    movement: 4,
  },
  {
    id: "ai-3",
    rank: 6,
    name: "AI Squad: Chrome Coast",
    avatar: "CC",
    score: 1395,
    streak: 6,
    today: "2/3",
    isAi: true,
    isHolder: false,
    movement: -2,
  },
];

export function createInitialMarket(): MarketPoint[] {
  const seed = 162.42;
  return Array.from({ length: 34 }, (_, index) => ({
    value: seed + Math.sin(index * 0.45) * 0.9 + index * 0.018,
    time: Date.now() - (33 - index) * 1000,
  }));
}

export function nextPrice(points: MarketPoint[], volatility = 0.72): MarketPoint[] {
  const last = points[points.length - 1]?.value ?? 162.42;
  const trend = Math.sin(Date.now() / 4300) * 0.19;
  const shock = (Math.random() - 0.48) * volatility;
  const next = Math.max(120, last + trend + shock);
  return [...points.slice(-47), { value: next, time: Date.now() }];
}

export function calculateMomentum(
  previous: number,
  direction: Direction | null,
  before: number,
  after: number,
): number {
  if (!direction) return previous;
  const delta = after - before;
  const correct = direction === "long" ? delta >= 0 : delta <= 0;
  const magnitude = Math.min(14, Math.abs(delta) * 7.5 + 2.5);
  return Math.max(8, Math.min(100, previous + (correct ? magnitude : -magnitude)));
}

export function settleKick(params: {
  momentum: number;
  direction: Direction | null;
  entryPrice: number | null;
  exitPrice: number;
  shotZone: ShotZone;
  keeperZone: ShotZone;
  streak: number;
}): KickResult {
  const { momentum, direction, entryPrice, exitPrice, shotZone, keeperZone, streak } = params;
  const marketMove = entryPrice ? exitPrice - entryPrice : 0;
  const marketCorrect =
    direction === null ? false : direction === "long" ? marketMove >= 0 : marketMove <= 0;
  const beatKeeper = shotZone !== keeperZone;
  const composure = momentum >= 44;
  const goal = beatKeeper && composure;
  const shotPoints = goal ? 120 + Math.round(momentum * 1.2) : Math.round(momentum * 0.55);
  const marketPoints = direction ? (marketCorrect ? 85 : -45) : 0;
  const streakBonus = goal ? Math.min(60, streak * 10) : 0;
  const points = Math.max(0, shotPoints + marketPoints + streakBonus);

  return {
    goal,
    shotPoints,
    marketPoints,
    streakBonus,
    points,
    saveText: goal
      ? "Net ripped. Market read held."
      : keeperZone === shotZone
        ? "Keeper read the tape."
        : "Momentum faded before contact.",
  };
}

export function keeperPick(momentum: number, shotZone: ShotZone): ShotZone {
  const zones: ShotZone[] = ["left", "center", "right"];
  if (momentum < 36 && Math.random() > 0.36) return shotZone;
  return zones[Math.floor(Math.random() * zones.length)];
}
