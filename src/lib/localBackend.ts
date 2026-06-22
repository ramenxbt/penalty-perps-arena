/**
 * LocalGameApi - the fully client-side paper backend.
 *
 * Mirrors how the real server behaves: opens a position, realizes PnL on close,
 * converts PnL into shots, resolves the volley (you plus simulated co-shooters), tracks
 * daily rounds and streaks, and pushes leaderboard snapshots. No persistence. This is
 * the demo/offline mode and the reference the Supabase backend must match.
 */

import {
  RULES,
  resolveRound,
  resolveShots,
  rollGoals,
  roundPoints,
} from "../game/engine";
import { seedRows } from "../game/seed";
import {
  BoardRow,
  LeaderboardSnapshot,
  PlayerProfile,
  Shooter,
  TradeRound,
} from "../game/types";
import { randomMarketAsset } from "../game/markets";
import { AuthBridge, CloseTradeInput, GameApi, OpenTradeInput, RoundResult } from "./api";

const ME_ID = "me";
const MAX_CO_SHOOTERS = 4;

export class LocalGameApi implements GameApi {
  readonly mode = "local" as const;

  private profile: PlayerProfile;
  private rows: BoardRow[];
  private openRound: (TradeRound & { streakAtOpen: number }) | null = null;
  private subscribers = new Set<(snapshot: LeaderboardSnapshot) => void>();
  private aiTimer: number | null = null;

  constructor(private readonly auth: AuthBridge) {
    this.profile = {
      id: ME_ID,
      name: auth.getDisplayName() ?? "@you",
      avatar: "YO",
      score: 1220,
      streak: 3,
      attemptsRemaining: RULES.dailyRounds,
      isHolder: false,
      walletAddress: auth.getWalletAddress(),
      activeRound: null,
      nextMarket: randomMarketAsset().symbol,
    };
    this.rows = seedRows.map((row) => ({ ...row }));
  }

  async loadProfile(): Promise<PlayerProfile> {
    this.profile.name = this.auth.getDisplayName() ?? this.profile.name;
    this.profile.walletAddress = this.auth.getWalletAddress();
    return { ...this.profile };
  }

  async loadLeaderboard(): Promise<LeaderboardSnapshot> {
    return this.snapshot();
  }

  async resetForMatch(): Promise<PlayerProfile> {
    // Local paper mode: refill the round allotment so the player can run another cup.
    this.openRound = null;
    this.profile = { ...this.profile, attemptsRemaining: RULES.matchRounds };
    return { ...this.profile };
  }

  subscribeLeaderboard(onSnapshot: (snapshot: LeaderboardSnapshot) => void, _onError?: (error: unknown) => void): () => void {
    this.subscribers.add(onSnapshot);
    onSnapshot(this.snapshot());
    if (this.aiTimer === null) {
      this.aiTimer = window.setInterval(() => this.driftAi(), 1400);
    }
    return () => {
      this.subscribers.delete(onSnapshot);
      if (this.subscribers.size === 0 && this.aiTimer !== null) {
        window.clearInterval(this.aiTimer);
        this.aiTimer = null;
      }
    };
  }

  async openTrade(input: OpenTradeInput): Promise<TradeRound> {
    if (this.profile.attemptsRemaining <= 0) {
      throw new Error("No rounds left today.");
    }
    if (this.openRound) {
      throw new Error("A position is already open.");
    }
    const now = Date.now();
    const market = this.profile.nextMarket ?? input.market;
    const round: TradeRound = {
      roundId: crypto.randomUUID(),
      market,
      direction: input.direction,
      entryPrice: input.referencePrice,
      openedAt: now,
      closesAt: now + RULES.tradeWindowMs,
      attemptsRemaining: Math.max(0, this.profile.attemptsRemaining - 1),
    };
    this.openRound = { ...round, streakAtOpen: this.profile.streak };
    this.profile = {
      ...this.profile,
      attemptsRemaining: round.attemptsRemaining,
      activeRound: round,
      nextMarket: round.market,
    };
    this.upsertMe();
    this.emit();
    return round;
  }

  async closeTrade(input: CloseTradeInput): Promise<RoundResult> {
    const round = this.openRound;
    if (!round || round.roundId !== input.roundId) {
      throw new Error("No open position to close.");
    }
    this.openRound = null;

    const outcome = resolveRound({
      direction: round.direction,
      market: round.market,
      entryPrice: round.entryPrice,
      exitPrice: input.clientExitPrice,
      streak: round.streakAtOpen,
    });

    this.profile = {
      ...this.profile,
      score: this.profile.score + outcome.points,
      streak: outcome.profit ? this.profile.streak + 1 : 0,
      activeRound: null,
      nextMarket: this.profile.attemptsRemaining > 0 ? randomMarketAsset(round.market).symbol : null,
    };

    const you: Shooter = {
      id: ME_ID,
      name: this.profile.name,
      isYou: true,
      isAi: false,
      pnlPct: outcome.pnlPct,
      shots: outcome.shots,
      goals: outcome.goals,
      openness: outcome.openness,
    };
    const coShooters = this.simulateCoShooters();
    const shooters = [you, ...coShooters];

    this.upsertMe();
    this.emit();

    return { outcome, shooters, profile: { ...this.profile } };
  }

  // --- internals ---------------------------------------------------------

  /** Other (simulated) players in this round, each with their own trade result. */
  private simulateCoShooters(): Shooter[] {
    const aiRows = this.rows.filter((row) => row.isAi).slice(0, MAX_CO_SHOOTERS);
    return aiRows.map((row) => {
      const pnlPct = Math.random() * 0.16 - 0.06; // roughly -0.06% .. +0.10%
      const { shots, openness } = resolveShots(pnlPct);
      const goals = rollGoals(shots, openness);
      row.score += roundPoints(goals, pnlPct, row.streak);
      return {
        id: row.id,
        name: row.name,
        isYou: false,
        isAi: true,
        pnlPct,
        shots,
        goals,
        openness,
      };
    });
  }

  private upsertMe() {
    const playedToday = RULES.dailyRounds - this.profile.attemptsRemaining;
    const me: BoardRow = {
      id: ME_ID,
      rank: 1,
      name: this.profile.name,
      avatar: this.profile.avatar,
      score: this.profile.score,
      streak: this.profile.streak,
      today: `${playedToday}/${RULES.dailyRounds}`,
      isAi: false,
      isHolder: this.profile.isHolder,
      movement: this.profile.streak > 0 ? 7 : -1,
    };
    this.rows = [me, ...this.rows.filter((row) => row.id !== ME_ID)];
  }

  private driftAi() {
    this.rows = this.rows.map((row) =>
      row.isAi
        ? { ...row, score: row.score + Math.round(Math.random() * 10) }
        : row,
    );
    this.emit();
  }

  private snapshot(): LeaderboardSnapshot {
    const rows = [...this.rows]
      .sort((a, b) => b.score - a.score)
      .map((row, index) => ({ ...row, rank: index + 1 }));
    return { rows };
  }

  private emit() {
    const snapshot = this.snapshot();
    this.subscribers.forEach((fn) => fn(snapshot));
  }
}
