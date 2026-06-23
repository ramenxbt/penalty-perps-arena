/**
 * Full-stage shell views that render in the center stage when the UI `view` is not "play".
 * These restructure navigation around the existing game; they never touch the phase machine,
 * the trade dock, the arena scene, or the round/results internals. Each view is fed only from
 * data already on `game` this session (no backend, no invented history).
 */
import { Activity, BadgeCheck, Bot, Flame, Goal, Lock, Trophy, Zap } from "lucide-react";
import type { MatchResult } from "../../game/match";
import { ordinal } from "../../lib/format";
import { seasonTier, SEASON_TIERS } from "../../lib/season";

type BoardRow = {
  id: string;
  rank: number;
  avatar: string;
  name: string;
  score: number;
  isAi: boolean;
  isHolder: boolean;
};

function ViewHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="result-head view-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2 className="view-title">{title}</h2>
      </div>
    </div>
  );
}

/** OPEN GAMES: Quick Cup (enters the existing lobby) + a locked Daily Challenge. */
export function OpenGamesView(props: {
  roundsMax: number;
  roundsLeft: number;
  outOfRounds: boolean;
  onPlay: () => void;
}) {
  const { roundsMax, roundsLeft, outOfRounds, onPlay } = props;
  const locked = outOfRounds;
  const roundsLabel =
    roundsLeft === 1 ? "Last round today" : `${Math.max(0, roundsLeft)} rounds left today`;

  return (
    <section className="results-panel view-panel">
      <ViewHead eyebrow="OPEN GAMES" title="Pick a game" />

      <div className="games-grid">
        <div className={locked ? "game-card locked" : "game-card"}>
          <div className="game-card-top">
            <span className="game-icon">
              <Goal size={20} />
            </span>
            <span className="rounds-chip">{roundsLabel}</span>
          </div>
          <h3>Quick Cup</h3>
          <p>{roundsMax} rounds against the field. Win trades to earn shots, bank the most points.</p>
          <button
            className="primary-action full"
            type="button"
            onClick={onPlay}
            disabled={locked}
          >
            {locked ? <Lock size={18} /> : <Zap size={18} />}
            {locked ? "Out of rounds today" : "Enter Quick Cup"}
          </button>
        </div>

        <div className="game-card locked">
          <div className="game-card-top">
            <span className="game-icon">
              <Trophy size={20} />
            </span>
            <span className="soon-chip">Coming soon</span>
          </div>
          <h3>Daily Challenge</h3>
          <p>A fixed market and a shared seed so every striker plays the same cup. Not live yet.</p>
          <button className="primary-action full" type="button" disabled>
            <Lock size={18} />
            Locked
          </button>
        </div>
      </div>

      <div className="disclosure-row">
        <Lock size={14} />
        Paper points. AI squads are simulated and not reward eligible.
      </div>
    </section>
  );
}

/** STANDINGS: full-stage season leaderboard using the existing board-row language. */
export function StandingsView({ rows }: { rows: BoardRow[] }) {
  return (
    <section className="results-panel view-panel">
      <ViewHead eyebrow="SEASON LADDER" title="Standings" />
      <div className="field-card">
        <div className="board-list">
          {rows.map((row) => (
            <div className={row.isAi ? "board-row ai-row" : "board-row"} key={row.id}>
              <span className="rank">{row.rank}</span>
              <span className="avatar">{row.avatar}</span>
              <div className="board-name">
                <strong>{row.name}</strong>
                <span>
                  {row.isAi ? (
                    <>
                      <Bot size={13} /> AI squad
                    </>
                  ) : row.isHolder ? (
                    <>
                      <BadgeCheck size={13} /> holder
                    </>
                  ) : (
                    "player"
                  )}
                </span>
              </div>
              <span className="board-score">{row.score.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="disclosure-row">
        <Lock size={14} />
        Paper points. AI squads are simulated and not reward eligible.
      </div>
    </section>
  );
}

/** SEASON: current cup, your rank + points, and the tier ladder. */
export function SeasonView(props: {
  cupName: string;
  rank: number;
  fieldSize: number;
  seasonPoints: number;
}) {
  const { cupName, rank, fieldSize, seasonPoints } = props;
  const tier = seasonTier(seasonPoints);

  return (
    <section className="results-panel view-panel">
      <ViewHead eyebrow="THIS SEASON" title={cupName} />

      <div className="result-stats">
        <div className="stat-cell">
          <span>RANK</span>
          <strong>#{rank}</strong>
          <small>of {fieldSize}</small>
        </div>
        <div className="stat-cell">
          <span>SEASON POINTS</span>
          <strong>{seasonPoints.toLocaleString()}</strong>
        </div>
        <div className="stat-cell">
          <span>TIER</span>
          <strong>{tier.name}</strong>
        </div>
        <div className="stat-cell">
          <span>NEXT TIER</span>
          <strong>{tier.nextName ?? "Top"}</strong>
          <small>{tier.ptsToNext != null ? `${tier.ptsToNext.toLocaleString()} pts` : "reached"}</small>
        </div>
      </div>

      <div className="section-heading">
        <h2>Season progress</h2>
        <span>
          {tier.nextName ? `${tier.ptsToNext?.toLocaleString()} pts to ${tier.nextName}` : "Top tier reached"}
        </span>
      </div>
      <div className="tier-block">
        <div className="tier-name">Tier: {tier.name}</div>
        <div className="tier-bar">
          <span className="tier-fill" style={{ width: `${Math.round(tier.progressPct * 100)}%` }} />
        </div>
        <div className="tier-ticks">
          {SEASON_TIERS.map((name) => (
            <span key={name} className={name === tier.name ? "lit" : ""}>
              {name}
            </span>
          ))}
        </div>
      </div>

      <div className="disclosure-row">
        <Lock size={14} />
        Standing is this session only. Persistent season history needs the backend.
      </div>
    </section>
  );
}

/** HISTORY: last cup as one board row, with an honest empty state. */
export function HistoryView({ lastMatch }: { lastMatch: MatchResult | null }) {
  return (
    <section className="results-panel view-panel">
      <ViewHead eyebrow="YOUR RECORD" title="History" />

      {lastMatch ? (
        <div className="field-card">
          <div className="board-list">
            <div className="standing-row board-row you">
              <span className="rank">{ordinal(lastMatch.placement)}</span>
              <div className="board-name">
                <strong>Quick Cup</strong>
                <span>
                  of {lastMatch.fieldSize} - {lastMatch.bestRound.goals} goals best round
                </span>
              </div>
              <span className="standing-goals">{lastMatch.totals.goals} G</span>
              <span className="board-score">{lastMatch.totals.points.toLocaleString()}</span>
            </div>
          </div>
          <span className="history-caption">
            Showing this session only. Full cup history needs the backend.
          </span>
        </div>
      ) : (
        <div className="view-empty">
          <Trophy size={26} />
          <p>No cups yet. Enter the arena to start your record.</p>
        </div>
      )}
    </section>
  );
}

/** HOW TO PLAY: quiet rules explainer reached from the rail footer. */
export function HowToView() {
  const steps = [
    { icon: Goal, title: "Enter a cup", body: "Each cup is three rounds against an AI field. Pick Open Games to start." },
    { icon: Zap, title: "Trade the chart", body: "Open Long or Short at kickoff, ride the move, then close while you are up." },
    { icon: Flame, title: "Profit earns shots", body: "A winning trade earns penalty shots. Lose it and the keeper wins the round." },
    { icon: Trophy, title: "Climb the ladder", body: "Banked points feed your season standing. AI squads are not reward eligible." },
  ];
  return (
    <section className="results-panel view-panel">
      <ViewHead eyebrow="THE BASICS" title="How to play" />
      <div className="howto-list">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <div className="howto-row" key={step.title}>
              <span className="game-icon">
                <Icon size={18} />
              </span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.body}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="disclosure-row">
        <Activity size={14} />
        Paper points only. No margin, custody, deposits, or real liquidation.
      </div>
    </section>
  );
}
