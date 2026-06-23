/**
 * Season tier math, single-sourced so the profile (and any future results banner) agree on
 * what tier a point total lands in and how far the next one is. Pure, no I/O.
 */

export type SeasonTier = {
  name: string;
  nextName: string | null;
  ptsToNext: number | null;
  progressPct: number; // 0..1 within the current tier
};

const TIERS = [
  { name: "BRONZE", min: 0 },
  { name: "CONTENDER", min: 1200 },
  { name: "QUALIFIER", min: 3000 },
  { name: "FINALIST", min: 6000 },
] as const;

export const SEASON_TIERS = TIERS.map((t) => t.name);

export function seasonTier(points: number): SeasonTier {
  let index = 0;
  for (let k = 0; k < TIERS.length; k += 1) {
    if (points >= TIERS[k].min) index = k;
  }
  const current = TIERS[index];
  const next = TIERS[index + 1] ?? null;
  if (!next) {
    return { name: current.name, nextName: null, ptsToNext: null, progressPct: 1 };
  }
  const span = Math.max(1, next.min - current.min);
  const into = points - current.min;
  return {
    name: current.name,
    nextName: next.name,
    ptsToNext: Math.max(0, next.min - points),
    progressPct: Math.max(0, Math.min(1, into / span)),
  };
}
