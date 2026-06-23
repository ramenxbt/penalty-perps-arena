import { Shooter } from "./types";

// Slowed for a more readable, weightier volley: longer lead-in, more space between
// shots, and a slower ball flight so each kick lands clearly.
export const VOLLEY_LEAD_IN_MS = 520;
export const SHOT_BEAT_MS = 1050;
export const FLIGHT_MS = 820;
// Solo shootout: only the player kicks, taking their earned shots one at a time. A wider
// beat leaves room for the ball to land, settle, and re-rack between shots.
export const SOLO_BEAT_MS = 1500;

export type VisibleVolleyAttempt = {
  shooter: Shooter | undefined;
  attemptIndex: number;
  scored: boolean;
  noKick: boolean;
};

export function arrangeShooters(shooters: Shooter[]): Shooter[] {
  const others = shooters.filter((shooter) => !shooter.isYou);
  const you = shooters.find((shooter) => shooter.isYou);
  const arranged = [...others];
  if (you) arranged.splice(Math.floor(arranged.length / 2), 0, you);
  return arranged;
}

export function visibleVolleyAttempts(shooters: Shooter[]): VisibleVolleyAttempt[] {
  return shooters.flatMap<VisibleVolleyAttempt>((shooter) => {
    if (shooter.shots <= 0) {
      return shooter.isYou ? [{ shooter, attemptIndex: 0, scored: false, noKick: true }] : [];
    }
    return Array.from({ length: shooter.shots }, (_, attemptIndex) => ({
      shooter,
      attemptIndex,
      scored: attemptIndex < shooter.goals,
      noKick: false,
    }));
  });
}

/**
 * The player's own shots, in order. Only the player kicks in the solo shootout; AI rivals are
 * spectators whose results live on the scoreboard. A liquidated player (no shots) still gets a
 * single no-kick beat so the round reads.
 */
export function playerVolleyAttempts(shooters: Shooter[]): VisibleVolleyAttempt[] {
  const you = shooters.find((shooter) => shooter.isYou);
  if (!you) return [];
  if (you.shots <= 0) return [{ shooter: you, attemptIndex: 0, scored: false, noKick: true }];
  return Array.from({ length: you.shots }, (_, attemptIndex) => ({
    shooter: you,
    attemptIndex,
    scored: attemptIndex < you.goals,
    noKick: false,
  }));
}

export function volleyDuration(shooters: Shooter[]): number {
  const attempts = playerVolleyAttempts(shooters);
  return 900 + Math.max(1, attempts.length) * SOLO_BEAT_MS;
}
