import {
  Activity,
  BadgeCheck,
  Bot,
  CircleDollarSign,
  Goal,
  Lock,
  RefreshCcw,
  Shield,
  Trophy,
  UserRound,
  Wallet,
  Zap,
} from "lucide-react";
import { ArenaScene } from "./ArenaScene";
import { Direction, MarketPoint, ShotZone } from "./game";
import { useGameSimulation } from "./useGameSimulation";

function formatPrice(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function Sparkline({ points, direction }: { points: MarketPoint[]; direction: Direction | null }) {
  const width = 320;
  const height = 118;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.001, max - min);
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * width;
      const y = height - ((point.value - min) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const last = points[points.length - 1];
  const first = points[Math.max(0, points.length - 12)];
  const up = last.value >= first.value;

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Live SOL paper chart">
      <defs>
        <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={up ? "#B7FF4A" : "#FF5370"} stopOpacity="0.28" />
          <stop offset="100%" stopColor={up ? "#B7FF4A" : "#FF5370"} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L ${width} ${height} L 0 ${height} Z`} fill="url(#chartFill)" />
      <path
        d={path}
        fill="none"
        stroke={up ? "#B7FF4A" : "#FF5370"}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3.5"
      />
      <line x1="0" x2={width} y1={height / 2} y2={height / 2} className="sparkline-mid" />
      {direction && <circle cx={width - 4} cy={height - ((last.value - min) / range) * height} r="5" />}
    </svg>
  );
}

export function App() {
  const game = useGameSimulation();
  const goal = game.result ? game.result.goal : null;
  const entryText = game.entryPrice ? formatPrice(game.entryPrice) : "--";
  const directionLabel = game.direction ? game.direction.toUpperCase() : "NO POSITION";
  const momentumLabel =
    game.momentum >= 76 ? "full sprint" : game.momentum >= 48 ? "balanced run-up" : "heavy legs";

  return (
    <main className="app-shell">
      <section className="left-rail" aria-label="Club navigation">
        <div className="brand-mark">
          <div className="brand-ball">
            <Goal size={24} />
          </div>
          <div>
            <p>Global Penalty Circuit</p>
            <strong>Finals Arena</strong>
          </div>
        </div>

        <nav className="rail-nav" aria-label="Primary">
          <a className="active" href="#arena">
            <Zap size={20} />
            Arena
          </a>
          <a href="#standings">
            <Trophy size={20} />
            Standings
          </a>
          <a href="#markets">
            <Activity size={20} />
            Markets
          </a>
          <a href="#club">
            <UserRound size={20} />
            Club
          </a>
        </nav>

        <div className="rail-card">
          <span className="rail-card-label">Season zero</span>
          <strong>184 players + AI squads active</strong>
          <small>AI squads are simulated and not reward eligible.</small>
        </div>
      </section>

      <section className="center-stage" id="arena">
        <header className="topbar">
          <div>
            <span className="eyebrow">Meridian Cup / Day 12</span>
            <h1>Penalty Perps</h1>
          </div>
          <div className="profile-strip">
            <span className="token-chip">
              <CircleDollarSign size={16} />
              0 USDC
            </span>
            <span className="token-chip active">
              <BadgeCheck size={16} />
              Holder
            </span>
            <button className="wallet-button" type="button">
              <Wallet size={17} />
              Wallet
            </button>
          </div>
        </header>

        <div className="arena-card">
          <ArenaScene
            momentum={game.momentum}
            phase={game.phase}
            direction={game.direction}
            shotZone={game.shotZone}
            keeperZone={game.keeperZone}
            goal={goal}
          />

          <div className="arena-hud">
            <div className="hud-pill">
              <span>Kicks</span>
              <strong>{game.kicksLeft}/3</strong>
            </div>
            <div className="hud-pill">
              <span>Streak</span>
              <strong>{game.streak}</strong>
            </div>
            <div className="hud-pill">
              <span>Score</span>
              <strong>{game.score.toLocaleString()}</strong>
            </div>
          </div>

          <div className="momentum-panel">
            <div className="momentum-copy">
              <span>{directionLabel}</span>
              <strong>{momentumLabel}</strong>
            </div>
            <div className="momentum-track">
              <div style={{ width: `${game.momentum}%` }} />
            </div>
          </div>
        </div>

        <section className="kick-controls" aria-label="Penalty controls">
          <div className="shot-zone-group">
            {(["left", "center", "right"] as ShotZone[]).map((zone) => (
              <button
                className={game.shotZone === zone ? "selected" : ""}
                key={zone}
                type="button"
                onClick={() => game.setShotZone(zone)}
              >
                {zone}
              </button>
            ))}
          </div>
          <button
            className="primary-action"
            type="button"
            onClick={game.takeKick}
            disabled={game.phase === "kicking" || game.kicksLeft <= 0}
          >
            <Goal size={21} />
            {game.phase === "kicking" ? "Run-up locked" : "Take penalty"}
          </button>
          <button className="icon-action" type="button" onClick={game.resetRound} aria-label="Reset market call">
            <RefreshCcw size={20} />
          </button>
        </section>
      </section>

      <aside className="right-stack">
        <section className="market-slip" id="markets">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Paper SOL-PERP</span>
              <h2>Live tape</h2>
            </div>
            <span className={game.derived.priceDelta >= 0 ? "price up" : "price down"}>
              {game.derived.priceDelta >= 0 ? "+" : ""}
              {game.derived.priceDelta.toFixed(2)}
            </span>
          </div>

          <Sparkline points={game.market} direction={game.direction} />

          <div className="market-meta">
            <div>
              <span>Mark</span>
              <strong>${formatPrice(game.derived.price)}</strong>
            </div>
            <div>
              <span>Entry</span>
              <strong>${entryText}</strong>
            </div>
            <div>
              <span>Momentum</span>
              <strong>{Math.round(game.momentum)}</strong>
            </div>
          </div>

          <div className="direction-grid">
            <button
              className={game.direction === "long" ? "long selected" : "long"}
              type="button"
              onClick={() => game.lockDirection("long")}
            >
              Long
            </button>
            <button
              className={game.direction === "short" ? "short selected" : "short"}
              type="button"
              onClick={() => game.lockDirection("short")}
            >
              Short
            </button>
          </div>

          <div className="disclosure-row">
            <Lock size={14} />
            Paper points. No margin, custody, deposits, or real liquidation.
          </div>
        </section>

        <section className="result-ticket">
          <div className="ticket-top">
            <span>Kick ticket</span>
            <strong>{game.result ? (game.result.goal ? "GOAL" : "SAVED") : "OPEN"}</strong>
          </div>
          {game.result ? (
            <div className="result-body">
              <h2>{game.result.saveText}</h2>
              <dl>
                <div>
                  <dt>Shot</dt>
                  <dd>{game.result.shotPoints}</dd>
                </div>
                <div>
                  <dt>Market</dt>
                  <dd>{game.result.marketPoints}</dd>
                </div>
                <div>
                  <dt>Streak</dt>
                  <dd>{game.result.streakBonus}</dd>
                </div>
              </dl>
              <p>+{game.result.points} points</p>
            </div>
          ) : (
            <div className="empty-ticket">
              <Shield size={28} />
              <p>Lock a side, let the chart move, then send the kick.</p>
            </div>
          )}
        </section>

        <section className="leaderboard" id="standings">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Daily cup</span>
              <h2>Standings</h2>
            </div>
            <Trophy size={22} />
          </div>

          <div className="board-list">
            {game.rows.map((row) => (
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
        </section>
      </aside>
    </main>
  );
}
