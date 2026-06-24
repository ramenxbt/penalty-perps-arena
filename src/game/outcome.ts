/**
 * One shared classifier for a settled round, so the arena flash, the result ticket,
 * the status line, and the toast all read the same verdict from the same place. This
 * collapses three near-identical "GOAL / BLOCKED / NO SHOT" re-implementations into one.
 *
 * Pure: no React, no I/O. It only reads an already-settled outcome (or the player's own
 * volley shooter) and never recomputes settlement math.
 */

import { RoundOutcome, Shooter } from "./types";

/** Coarse verdict for a settled round. */
export type RoundVerdict = "goal" | "save" | "no-kick" | "conceded";

export type RoundResult = {
  verdict: RoundVerdict;
  goals: number;
  shots: number;
  conceded: number;
  points: number;
  pnlPct: number;
  /** Short all-caps label for the arena flash and the result ticket badge. */
  label: string;
  /** Full sentence summary (settlement-authored). */
  summary: string;
  /** Whether this round was a net-positive moment (drives gold vs red cues). */
  positive: boolean;
};

/** Shape the classifier accepts: the settled outcome or the player's own volley shooter. */
type ResultSource = {
  goals: number;
  shots: number;
  conceded?: number;
  points?: number;
  pnlPct: number;
  summary?: string;
};

/**
 * Classify any settled source (RoundOutcome or the player Shooter) into one verdict.
 * Conceded is checked first because a blowout loss is the dominant story of the round.
 */
export function resolveRoundResult(source: ResultSource): RoundResult {
  const goals = source.goals;
  const shots = source.shots;
  const conceded = source.conceded ?? 0;
  const points = source.points ?? 0;
  const pnlPct = source.pnlPct;

  let verdict: RoundVerdict;
  let label: string;
  if (conceded > 0) {
    verdict = "conceded";
    label = conceded > 1 ? `${conceded} CONCEDED` : "CONCEDED";
  } else if (shots <= 0) {
    verdict = "no-kick";
    label = "NO SHOT";
  } else if (goals > 0) {
    verdict = "goal";
    label = goals > 1 ? `${goals} GOALS` : "GOAL";
  } else {
    verdict = "save";
    label = "BLOCKED";
  }

  return {
    verdict,
    goals,
    shots,
    conceded,
    points,
    pnlPct,
    label,
    summary: source.summary ?? "",
    positive: verdict === "goal",
  };
}

export function resolveOutcomeResult(outcome: RoundOutcome): RoundResult {
  return resolveRoundResult(outcome);
}

/** Classify from the player's own volley shooter (used by the arena flash). */
export function resolveShooterResult(shooter: Shooter): RoundResult {
  return resolveRoundResult(shooter);
}

/** Toast headline for a banked round: "+N points, banked X shots". */
export function roundToastTitle(result: RoundResult): string {
  const pts = result.points >= 0 ? `+${result.points}` : `${result.points}`;
  const shotWord = result.shots === 1 ? "shot" : "shots";
  return `${pts} points, banked ${result.shots} ${shotWord}`;
}
