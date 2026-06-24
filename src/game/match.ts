/**
 * Match / session domain: a "cup run" wraps the existing round mechanic into a fixed
 * set of rounds played against an AI field, with live in-match standings and a final
 * placement. Pure data + helpers (no React, no I/O); the season leaderboard stays the
 * persistent standing and is updated by the existing round loop.
 */

import { roundPoints, RULES } from "./engine";
import { BoardRow, Shooter } from "./types";

/** Stable id for the player's own row across the local backend and the derived ladder. */
export const ME_ID = "me";

export type SessionPhase =
  | "welcome"
  | "lobby"
  | "countdown"
  | "in_match"
  | "round_break"
  | "match_results";

/** A competitor in a match: you, or a simulated AI squad. */
export type MatchParticipant = {
  id: string;
  name: string;
  avatar: string;
  isYou: boolean;
  isAi: boolean;
  isHolder: boolean;
  /** For AI rivals: their trading-personality tag (shown in the lobby). */
  tendency?: string;
  /** Points accrued THIS match only. */
  matchPoints: number;
  matchGoals: number;
  /** Live rank within the field, 1-based. */
  standing: number;
};

/** Final placement + stats, computed once at match end. */
export type MatchResult = {
  placement: number;
  fieldSize: number;
  summary: string;
  totals: { points: number; goals: number };
  bestRound: { round: number; goals: number };
  seasonDelta: { rankDelta: number; seasonPoints: number };
};

export const MATCH_FIELD_AI = 4;

/** Initials avatar from a (possibly AI-prefixed) name. */
export function initials(name: string): string {
  const cleaned = name.replace(/^AI (Squad|Keeper): /, "").replace(/[^a-zA-Z ]/g, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (cleaned.slice(0, 2) || "AI").toUpperCase();
}

/** Sort by match points (then goals) and assign 1-based standings. */
export function rankParticipants(participants: MatchParticipant[]): MatchParticipant[] {
  return [...participants]
    .sort((a, b) => b.matchPoints - a.matchPoints || b.matchGoals - a.matchGoals)
    .map((p, index) => ({ ...p, standing: index + 1 }));
}

/** Build the field: you plus up to MATCH_FIELD_AI AI squads from the leaderboard. */
export function buildField(
  rows: BoardRow[],
  you: { id: string; name: string; isHolder: boolean },
): MatchParticipant[] {
  const ai = rows
    .filter((row) => row.isAi)
    .slice(0, MATCH_FIELD_AI)
    .map<MatchParticipant>((row) => ({
      id: row.id,
      name: row.name,
      avatar: row.avatar,
      isYou: false,
      isAi: true,
      isHolder: false,
      tendency: row.tendency,
      matchPoints: 0,
      matchGoals: 0,
      standing: 0,
    }));
  const me: MatchParticipant = {
    id: you.id,
    name: you.name,
    avatar: "YO",
    isYou: true,
    isAi: false,
    isHolder: you.isHolder,
    matchPoints: 0,
    matchGoals: 0,
    standing: 0,
  };
  return rankParticipants([me, ...ai]);
}

/** Per-round points for an AI co-shooter, mirroring the engine scoring (streak-free). */
export function shooterRoundPoints(shooter: Shooter): number {
  return roundPoints(shooter.goals, shooter.pnlPct, 0);
}

/** The player's own identity + live progression, as the ladder needs it. */
export type LadderSelf = {
  /** The player's row id (ME_ID in local mode, the user id in connected mode). */
  id: string;
  name: string;
  avatar: string;
  score: number;
  streak: number;
  isHolder: boolean;
  /** Rounds already played today, for the "today" column. */
  playedToday: number;
};

/**
 * The single ranked season ladder shown across the UI (right-stack widget, Standings,
 * Season). It guarantees the player's row is present: if the backend snapshot already
 * carries it (connected mode, or local after the first trade) that row is refreshed in
 * place; otherwise a synthetic row is injected (local pre-trade). Everyone is then sorted
 * by score and given a fresh 1-based rank, so the displayed rank is always derived here.
 */
export function buildLadder(rows: BoardRow[], self: LadderSelf): BoardRow[] {
  const me: BoardRow = {
    id: self.id,
    rank: 1,
    name: self.name,
    avatar: self.avatar,
    score: self.score,
    streak: self.streak,
    today: `${self.playedToday}/${RULES.dailyRounds}`,
    isAi: false,
    isHolder: self.isHolder,
    movement: self.streak > 0 ? 7 : -1,
  };
  const others = rows.filter((row) => row.id !== self.id);
  return [me, ...others]
    .sort((a, b) => b.score - a.score)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function matchSummary(placement: number, leaderName: string, yourGoals: number): string {
  const leader = leaderName.replace(/^AI (Squad|Keeper): /, "");
  if (placement === 1) return `You topped the field with ${yourGoals} ${yourGoals === 1 ? "goal" : "goals"}.`;
  if (placement === 2) return `So close. ${leader} edged the cup by a hair.`;
  if (placement === 3) return `On the podium. ${leader} took the top spot.`;
  return `${leader} ran the table this cup. Regroup and run it back.`;
}
