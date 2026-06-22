/**
 * MatchResults
 * Post-match results panel for the Penalty Perps Arena center stage.
 * Shows finishing placement, run stats, season delta, the final standings
 * board, and a play-again CTA. Dark "trading terminal meets iOS arcade" look.
 */
import { Trophy } from "lucide-react";

type StandingRow = {
  id: string;
  rank: number;
  name: string;
  goals: number;
  points: number;
  isYou: boolean;
  isAi: boolean;
};

function ordinal(n: number): string {
  const abs = Math.abs(n);
  const tens = abs % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (abs % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function avatarInitials(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, "");
  return letters.slice(0, 2).toUpperCase() || "??";
}

export function MatchResults(props: {
  placement: number;
  fieldSize: number;
  summary: string;
  totals: { points: number; goals: number };
  bestRound: { round: number; goals: number };
  seasonDelta: { rankDelta: number; seasonPoints: number };
  standings: StandingRow[];
  roundsLeft: number;
  outOfRounds: boolean;
  onPlayAgain: () => void;
}) {
  const {
    placement,
    fieldSize,
    summary,
    totals,
    bestRound,
    seasonDelta,
    standings,
    roundsLeft,
    outOfRounds,
    onPlayAgain,
  } = props;

  const heroClass =
    "placement-hero" +
    (placement === 1 ? " is-first" : placement <= 3 ? " is-podium" : "");

  const seasonClass =
    seasonDelta.rankDelta > 0 ? "good" : seasonDelta.rankDelta < 0 ? "bad" : "";

  const seasonLabel =
    seasonDelta.rankDelta > 0
      ? "+" + seasonDelta.rankDelta + " ranks"
      : seasonDelta.rankDelta < 0
        ? seasonDelta.rankDelta + " ranks"
        : "Holds";

  return (
    <section className="results-panel">
      <div className="result-head">
        <span className="eyebrow">CUP COMPLETE</span>
      </div>

      <div className={heroClass}>
        <Trophy size={22} />
        <span className="rank">{ordinal(placement)}</span>
        <span className="of">of {fieldSize}</span>
      </div>

      <p className="result-sub">{summary}</p>

      <div className="result-stats">
        <div className="stat-cell">
          <span>POINTS</span>
          <strong>{totals.points.toLocaleString()}</strong>
        </div>
        <div className="stat-cell">
          <span>GOALS</span>
          <strong>{totals.goals}</strong>
        </div>
        <div className="stat-cell">
          <span>BEST RND</span>
          <strong>Round {bestRound.round}</strong>
          <small>{bestRound.goals} goals</small>
        </div>
        <div className="stat-cell">
          <span>SEASON</span>
          <strong className={seasonClass}>{seasonLabel}</strong>
          <small>{seasonDelta.seasonPoints.toLocaleString()} pts</small>
        </div>
      </div>

      <div className="final-standings">
        <div className="section-heading">
          <h2>Final standings</h2>
        </div>
        {standings.map((row) => (
          <div
            key={row.id}
            className={
              "standing-row board-row" +
              (row.isYou ? " you" : row.isAi ? " ai-row" : "")
            }
          >
            <span className="rank">{row.rank}</span>
            <span className="avatar">{avatarInitials(row.name)}</span>
            <div className="board-name">
              <strong>
                {row.isYou
                  ? "You"
                  : row.name.replace(/^AI (Squad|Keeper): /, "")}
              </strong>
            </div>
            <span className="standing-goals">{row.goals} G</span>
            <span className="board-score">{row.points.toLocaleString()}</span>
          </div>
        ))}
      </div>

      <div className="result-cta">
        <button
          className="primary-action full"
          type="button"
          onClick={onPlayAgain}
          disabled={outOfRounds}
        >
          {outOfRounds ? "Out of rounds today" : "Find new match"}
        </button>
        <span className="cta-note">
          {outOfRounds
            ? "New rounds unlock tomorrow."
            : roundsLeft + " of rounds ready"}
        </span>
      </div>
    </section>
  );
}
