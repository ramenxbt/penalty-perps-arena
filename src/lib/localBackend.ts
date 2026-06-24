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
  CupHistoryEntry,
  LeaderboardSnapshot,
  PlayerProfile,
  PlayerProgression,
  Shooter,
  TradeRound,
} from "../game/types";
import { randomMarketAsset } from "../game/markets";
import {
  AuthBridge,
  CloseTradeInput,
  GameApi,
  OpenTradeInput,
  RecordCupInput,
  RoundResult,
} from "./api";
import { readJson, writeJson } from "./storage";
import { ME_ID } from "../game/match";

const MAX_CO_SHOOTERS = 4;
const STORAGE_KEY = "ppa:progression:v1";
const MAX_HISTORY = 50;

const EMPTY_PROGRESSION: PlayerProgression = {
  score: 0,
  streak: 0,
  honorIds: [],
  history: [],
};

export class LocalGameApi implements GameApi {
  readonly mode = "local" as const;

  private profile: PlayerProfile;
  private rows: BoardRow[];
  private openRound: (TradeRound & { streakAtOpen: number }) | null = null;
  private subscribers = new Set<(snapshot: LeaderboardSnapshot) => void>();
  private aiTimer: number | null = null;
  // The player's own persistent progression (honors + cup history). Score and streak
  // are mirrored from the profile and re-synced into this on every mutation.
  private honorIds: string[];
  private history: CupHistoryEntry[];

  constructor(private readonly auth: AuthBridge) {
    const saved = this.restore();
    this.honorIds = saved.honorIds;
    this.history = saved.history;
    this.profile = {
      id: ME_ID,
      name: auth.getDisplayName() ?? "@you",
      avatar: "YO",
      score: saved.score,
      streak: saved.streak,
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
      score: Math.max(0, this.profile.score + outcome.points),
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
    this.persist();
    this.emit();

    return { outcome, shooters, profile: { ...this.profile } };
  }

  async getProgression(): Promise<PlayerProgression> {
    return this.progression();
  }

  async recordCupResult(input: RecordCupInput): Promise<PlayerProgression> {
    const entry: CupHistoryEntry = {
      placement: input.placement,
      fieldSize: input.fieldSize,
      points: input.points,
      goals: input.goals,
      playedAt: Date.now(),
    };
    this.history = [entry, ...this.history].slice(0, MAX_HISTORY);
    // Honor ids are sticky: once earned in any cup they stay earned.
    this.honorIds = Array.from(new Set([...this.honorIds, ...input.honorIds]));
    // The cup just changed the player's persisted score, so their ladder row moves.
    // Nudge a couple of rival rows on finish so the standings around them visibly
    // reshuffle instead of the player sliding through a frozen field.
    this.nudgeRivals();
    this.upsertMe();
    this.persist();
    this.emit();
    return this.progression();
  }

  // --- internals ---------------------------------------------------------

  /** Other (simulated) players in this round, each with their own trade result. */
  private simulateCoShooters(): Shooter[] {
    const aiRows = this.rows.filter((row) => row.isAi).slice(0, MAX_CO_SHOOTERS);
    return aiRows.map((row) => {
      // Match the lively arena scale (tens of percent), so AI earn shots and concede too.
      const pnlPct = Math.random() * 70 - 26; // roughly -26% .. +44%
      const { shots, openness } = resolveShots(pnlPct);
      const goals = rollGoals(shots, openness);
      row.score = Math.max(0, row.score + roundPoints(goals, pnlPct, row.streak));
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

  /** Bump two non-player rows by a chunky amount so finish-time standings reshuffle. */
  private nudgeRivals() {
    const rivals = this.rows.filter((row) => row.id !== ME_ID);
    if (rivals.length === 0) return;
    const picks = new Set<string>();
    while (picks.size < Math.min(2, rivals.length)) {
      picks.add(rivals[Math.floor(Math.random() * rivals.length)].id);
    }
    this.rows = this.rows.map((row) =>
      picks.has(row.id)
        ? { ...row, score: Math.max(0, row.score + Math.round(Math.random() * 120 - 30)) }
        : row,
    );
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

  /** Current persistent progression, with score/streak synced from the live profile. */
  private progression(): PlayerProgression {
    return {
      score: this.profile.score,
      streak: this.profile.streak,
      honorIds: [...this.honorIds],
      history: this.history.map((entry) => ({ ...entry })),
    };
  }

  /** Restore progression from localStorage, sanitizing each field to a safe shape. */
  private restore(): PlayerProgression {
    const saved = readJson<Partial<PlayerProgression>>(STORAGE_KEY, EMPTY_PROGRESSION);
    return {
      score: typeof saved.score === "number" && saved.score >= 0 ? saved.score : 0,
      streak: typeof saved.streak === "number" && saved.streak >= 0 ? saved.streak : 0,
      honorIds: Array.isArray(saved.honorIds)
        ? saved.honorIds.filter((id): id is string => typeof id === "string")
        : [],
      history: Array.isArray(saved.history)
        ? saved.history
            .filter((entry): entry is CupHistoryEntry =>
              Boolean(entry) &&
              typeof entry.placement === "number" &&
              typeof entry.fieldSize === "number" &&
              typeof entry.points === "number" &&
              typeof entry.goals === "number" &&
              typeof entry.playedAt === "number",
            )
            .slice(0, MAX_HISTORY)
        : [],
    };
  }

  private persist() {
    writeJson(STORAGE_KEY, this.progression());
  }
}
