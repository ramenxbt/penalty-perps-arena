import { Shooter } from "./types";

// Slowed for a more readable, weightier volley: longer lead-in, more space between
// shots, and a slower ball flight so each kick lands clearly.
export const VOLLEY_LEAD_IN_MS = 520;
export const SHOT_BEAT_MS = 1050;
export const FLIGHT_MS = 820;

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

export function volleyDuration(shooters: Shooter[]): number {
  const attempts = visibleVolleyAttempts(arrangeShooters(shooters));
  return 900 + Math.max(1, attempts.length) * SHOT_BEAT_MS;
}
