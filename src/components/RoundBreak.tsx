/**
 * RoundBreak: a low overlay band shown over the 3D arena between rounds.
 * Displays the current "this match" standings strip after a round settles,
 * with a single action to advance to the next round (or see final results).
 * Glanceable by design: rank, name, goals, points, and one button.
 *
 * Ceremony touches: rows slide in on rank changes, a small rank-delta badge shows
 * climbs/drops since the last round, and points count up. Reduced-motion safe.
 */

import { useRef } from "react";
import { useCountUp } from "../hooks/useCountUp";

type BreakRow = {
  id: string;
  rank: number;
  name: string;
  goals: number;
  points: number;
  isYou: boolean;
  isAi: boolean;
};

function CountPoints({ points }: { points: number }) {
  const shown = useCountUp(points, 800);
  return <span className="break-points">{shown.toLocaleString()}</span>;
}

function RankBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="break-delta hold">hold</span>;
  const climbed = delta > 0;
  return (
    <span className={"break-delta " + (climbed ? "up" : "down")}>
      {climbed ? "+" : ""}
      {delta}
    </span>
  );
}

export function RoundBreak(props: {
  round: number; // 1-based current round number just completed
  totalRounds: number;
  standings: BreakRow[]; // already sorted by rank ascending
  isFinal: boolean;
  secondsLeft: number | null; // auto-advance countdown, null on the final round
  onNext: () => void;
}) {
  const { round, totalRounds, standings, isFinal, secondsLeft, onNext } = props;
  const nextLabel = isFinal
    ? "See results"
    : secondsLeft != null
      ? `Next round (${secondsLeft}s)`
      : "Next round";

  // Remember each row's prior rank so we can show the climb/drop since last round.
  // Lower rank number is better, so a positive delta means the row moved up.
  const prevRanksRef = useRef<Record<string, number>>({});
  const deltas = standings.map((row) => {
    const prior = prevRanksRef.current[row.id];
    return prior == null ? 0 : prior - row.rank;
  });
  prevRanksRef.current = Object.fromEntries(standings.map((row) => [row.id, row.rank]));

  return (
    <div className="round-break" role="group" aria-label="Round standings">
      <div className="break-head">
        <strong>
          ROUND {round} OF {totalRounds}
        </strong>
        <span className="eyebrow">this match</span>
        <button className="break-next" onClick={onNext}>
          {nextLabel}
        </button>
      </div>
      <div className="break-list">
        {standings.map((row, i) => (
          <div
            key={row.id}
            className={"break-row" + (row.isYou ? " you" : "")}
            style={{ "--break-i": i } as React.CSSProperties}
          >
            <span className="break-rank">{row.rank}</span>
            <RankBadge delta={deltas[i]} />
            <span className="break-name">
              {row.isYou
                ? row.name + " (you)"
                : row.name.replace(/^AI (Squad|Keeper): /, "")}
            </span>
            <span className="break-goals">{row.goals} G</span>
            <CountPoints points={row.points} />
          </div>
        ))}
      </div>
    </div>
  );
}
