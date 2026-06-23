/** Shared domain types for the trade-to-shoot loop. */

export type Direction = "long" | "short";

export type MarketSymbol = "BTC" | "ETH" | "SOL";

/** Trade lifecycle: open a position, hold it, resolve the volley, see the result. */
export type RoundPhase = "idle" | "opening" | "trading" | "settling" | "closeFailed" | "resolving" | "settled";

export type MarketPoint = {
  value: number;
  time: number;
};

/** An open position. Entry price is pinned; the round auto-closes at `closesAt`. */
export type TradeRound = {
  roundId: string;
  market: MarketSymbol;
  direction: Direction;
  entryPrice: number;
  openedAt: number;
  closesAt: number;
  attemptsRemaining: number;
};

/**
 * One participant in a volley (you or a simulated co-shooter). The trade result
 * determines how many shots they earned and how open their net is.
 */
export type Shooter = {
  id: string;
  name: string;
  isYou: boolean;
  isAi: boolean;
  /** Realized PnL % after leverage. */
  pnlPct: number;
  /** Earned shots (0 if they took a real loss). */
  shots: number;
  /** Goals scored from those shots. */
  goals: number;
  /** Net openness 0..1; low means the keeper almost certainly saves. */
  openness: number;
};

/** The settled result of your round. */
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

export type PlayerProfile = {
  id: string;
  name: string;
  avatar: string;
  score: number;
  /** Consecutive profitable rounds. */
  streak: number;
  /** Rounds left today. */
  attemptsRemaining: number;
  isHolder: boolean;
  walletAddress: string | null;
  activeRound: TradeRound | null;
  nextMarket: MarketSymbol | null;
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
  /** For recurring AI rivals: a short trading-personality tag shown in the lobby. */
  tendency?: string;
};

export type LeaderboardSnapshot = {
  rows: BoardRow[];
};
