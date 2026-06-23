/**
 * MatchResults
 * Post-match results panel for the Penalty Perps Arena center stage.
 * Shows finishing placement, run stats, season delta, the final standings
 * board, and a play-again CTA. Dark "trading terminal meets iOS arcade" look.
 */
import { useState } from "react";
import { Check, Share2, Trophy } from "lucide-react";
import { buildShareCard, copyCanvasToClipboard, downloadCanvas } from "../lib/shareCard";
import { avatarInitials, ordinal } from "../lib/format";

type StandingRow = {
  id: string;
  rank: number;
  name: string;
  goals: number;
  points: number;
  isYou: boolean;
  isAi: boolean;
};

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

  const [shared, setShared] = useState<"idle" | "copied" | "saved">("idle");

  const onShare = async () => {
    const canvas = buildShareCard({
      placement,
      fieldSize,
      ordinal: ordinal(placement),
      points: totals.points,
      goals: totals.goals,
    });
    const copied = await copyCanvasToClipboard(canvas);
    if (!copied) downloadCanvas(canvas, "penalty-perps-result.png");
    setShared(copied ? "copied" : "saved");
    window.setTimeout(() => setShared("idle"), 2600);
  };

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
          {outOfRounds ? "Out of rounds today" : "Play again"}
        </button>
        <button className="ghost-action full" type="button" onClick={onShare}>
          {shared === "idle" ? <Share2 size={16} /> : <Check size={16} />}
          {shared === "copied" ? "Copied to clipboard" : shared === "saved" ? "Image saved" : "Share result card"}
        </button>
        <span className="cta-note">
          {outOfRounds ? "New rounds unlock tomorrow." : "Fresh cup ready"}
        </span>
      </div>
    </section>
  );
}
