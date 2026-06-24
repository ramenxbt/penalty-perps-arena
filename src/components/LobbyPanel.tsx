/**
 * LobbyPanel renders the pre-match lobby inside the arena card slot.
 * It shows the cup-run summary, the field of squads, format facts, and the
 * Enter arena CTA before a Penalty Perps match begins.
 */
import { BadgeCheck, Bot, Goal, Lock } from "lucide-react";
import { CONCEDE_WARNING_LINE, PROFIT_TO_SHOTS_LINE } from "../game/engine";

type LobbyField = {
  id: string;
  name: string;
  avatar: string;
  isYou: boolean;
  isAi: boolean;
  isHolder: boolean;
  tendency?: string;
};

export function LobbyPanel(props: {
  field: LobbyField[];
  roundsLeft: number;
  roundsMax: number;
  market: string;
  seed: { rank: number; points: number };
  ready: boolean;
  outOfRounds: boolean;
  onEnter: () => void;
}) {
  const {
    field,
    roundsLeft,
    roundsMax,
    market,
    seed,
    ready,
    outOfRounds,
    onEnter,
  } = props;

  const roundsLabel =
    roundsLeft <= 0
      ? "No rounds left today"
      : roundsLeft === 1
        ? "Last round today"
        : roundsLeft <= roundsMax
          ? `${roundsLeft} of ${roundsMax} rounds left`
          : `${roundsLeft} rounds left today`;

  const ctaLabel = outOfRounds
    ? "Out of rounds today"
    : ready
      ? "Start match"
      : "Syncing market";

  return (
    <section className="lobby-panel">
      <div className="lobby-head">
        <div>
          <span className="eyebrow">CUP RUN</span>
          <h2 className="lobby-title">{roundsMax} rounds vs the field</h2>
        </div>
        <span className="rounds-chip">{roundsLabel}</span>
      </div>

      <div className="field-card">
        <div className="section-heading">
          <div>
            <h2>The field</h2>
          </div>
          <span>{field.length} squads</span>
        </div>

        <div className="field-list">
          {field.map((entry, index) => (
            <div
              className={
                "field-row board-row" +
                (entry.isYou ? " you" : entry.isAi ? " ai-row" : "")
              }
              key={entry.id}
            >
              <span className="rank">{index + 1}</span>
              <span className="avatar">{entry.avatar}</span>
              <div className="board-name">
                <strong>{entry.name}</strong>
                <span>
                  {entry.isYou ? (
                    "you"
                  ) : entry.isAi ? (
                    <>
                      <Bot size={13} /> {entry.tendency ?? "AI rival"}
                    </>
                  ) : entry.isHolder ? (
                    <>
                      <BadgeCheck size={13} /> holder
                    </>
                  ) : (
                    "player"
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="lobby-facts">
        <div className="fact-cell rule-cell">
          <span>THE RULE</span>
          <strong>Profit becomes shots ({PROFIT_TO_SHOTS_LINE})</strong>
          <small>Bury them for goals. Goals become points and rank. {CONCEDE_WARNING_LINE}</small>
        </div>
        <div className="fact-cell">
          <span>FORMAT</span>
          <strong>Best points over {roundsMax}</strong>
        </div>
        <div className="fact-cell">
          <span>MARKET</span>
          <strong>{market}</strong>
          <small>paper</small>
        </div>
        <div className="fact-cell">
          <span>YOUR RANK</span>
          <strong>Rank {seed.rank}</strong>
          <small>{seed.points.toLocaleString()} pts</small>
        </div>
      </div>

      <button
        className="primary-action full"
        type="button"
        onClick={onEnter}
        disabled={!ready || outOfRounds}
      >
        <Goal size={18} />
        {ctaLabel}
      </button>

      <div className="disclosure-row">
        <Lock size={14} />
        {outOfRounds
          ? "You have used all your rounds. Come back tomorrow for a fresh cup run."
          : "Win trades to earn shots. AI squads are simulated and not reward eligible."}
      </div>
    </section>
  );
}
