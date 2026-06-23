/**
 * RoundBreak: a low overlay band shown over the 3D arena between rounds.
 * Displays the current "this match" standings strip after a round settles,
 * with a single action to advance to the next round (or see final results).
 * Glanceable by design: rank, name, goals, points, and one button.
 */

type BreakRow = {
  id: string;
  rank: number;
  name: string;
  goals: number;
  points: number;
  isYou: boolean;
  isAi: boolean;
};

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
        {standings.map((row) => (
          <div
            key={row.id}
            className={"break-row" + (row.isYou ? " you" : "")}
          >
            <span className="break-rank">{row.rank}</span>
            <span className="break-name">
              {row.isYou
                ? row.name + " (you)"
                : row.name.replace(/^AI (Squad|Keeper): /, "")}
            </span>
            <span className="break-goals">{row.goals} G</span>
            <span className="break-points">{row.points.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
