import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Bot,
  Coins,
  Flame,
  Goal,
  Lock,
  Trophy,
  UserRound,
  Volume2,
  VolumeX,
  Wallet,
  Zap,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Candles } from "./components/Candles";
import { PowerMeter } from "./components/PowerMeter";
import { LobbyPanel } from "./components/LobbyPanel";
import { MatchResults } from "./components/MatchResults";
import { PnlGauge } from "./components/PnlGauge";
import { RoundBreak } from "./components/RoundBreak";
import { TradeTicker } from "./components/TradeTicker";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { useAuth, truncateAddress } from "./auth/AuthContext";
import { configurationError, env, features } from "./config/env";
import { formatMarketPrice, getMarketAsset } from "./game/markets";
import { Direction } from "./game/types";
import { useArenaAudio } from "./hooks/useArenaAudio";
import { useSession } from "./hooks/useSession";
import { RULES } from "./game/engine";
import { ProfilePanel } from "./components/profile/ProfilePanel";

const ArenaScene = lazy(() => import("./ArenaScene").then((module) => ({ default: module.ArenaScene })));

function ConfigurationErrorScreen({ message }: { message: string }) {
  return (
    <main className="crash-screen" role="alert">
      <AlertTriangle size={34} />
      <h1>Backend setup needed</h1>
      <p>{message}</p>
    </main>
  );
}

function feedLabel(status: "connecting" | "live" | "simulated") {
  if (status === "live") return "LIVE";
  if (status === "simulated") return "SIM";
  return "SYNC";
}

function WalletButton() {
  const auth = useAuth();
  if (!auth.ready) {
    return (
      <button className="wallet-button" type="button" disabled aria-busy="true">
        <Wallet size={17} />
        Loading
      </button>
    );
  }
  if (auth.isAuthenticated && auth.user) {
    const label = auth.user.walletAddress
      ? truncateAddress(auth.user.walletAddress)
      : auth.user.displayName;
    return (
      <button className="wallet-button active" type="button" onClick={auth.logout} title="Disconnect">
        <Wallet size={17} />
        {label}
      </button>
    );
  }
  return (
    <button className="wallet-button" type="button" onClick={auth.login}>
      <Wallet size={17} />
      Connect
    </button>
  );
}

export function App() {
  if (configurationError) {
    return <ConfigurationErrorScreen message={configurationError} />;
  }

  const game = useSession();
  const auth = useAuth();
  const audio = useArenaAudio(game.phase, game.outcome, game.shooters);
  const [profileOpen, setProfileOpen] = useState(false);

  // Bright blip when a live trade crosses into a higher shot tier.
  const prevShotsRef = useRef(0);
  useEffect(() => {
    const trading = game.phase === "trading";
    if (trading && game.shotsNow > prevShotsRef.current) audio.playTick();
    prevShotsRef.current = trading ? game.shotsNow : 0;
  }, [game.shotsNow, game.phase, audio.playTick]);

  const needsConnect = features.privy && !auth.isAuthenticated;
  if (game.sessionPhase === "welcome") {
    return (
      <WelcomeScreen
        ctaLabel={needsConnect ? "Connect to play" : "Enter arena"}
        note={
          needsConnect
            ? "Connect a wallet, email, or X to compete on the season ladder. No deposits, paper only."
            : auth.isAuthenticated
              ? `Signed in as ${auth.user?.displayName ?? "player"}. Cup run: ${game.matchRounds} rounds against the field.`
              : `Jump in as a guest. Cup run: ${game.matchRounds} rounds against the field, paper only.`
        }
        onCta={needsConnect ? auth.login : game.enterLobby}
      />
    );
  }

  const inLobby = game.sessionPhase === "lobby";
  const inCountdown = game.sessionPhase === "countdown";
  const inMatch = game.sessionPhase === "in_match";
  const inBreak = game.sessionPhase === "round_break";
  const inResults = game.sessionPhase === "match_results";
  const showArena = inCountdown || inMatch || inBreak;

  const idle = game.phase === "idle" || game.phase === "settled";
  const opening = game.phase === "opening";
  const trading = game.phase === "trading";
  const settling = game.phase === "settling";
  const closeFailed = game.phase === "closeFailed";
  const resolving = game.phase === "resolving";
  const noRounds = game.roundsLeft <= 0;
  const canOpen =
    game.ready && game.marketReady && !noRounds && inMatch && !game.requiresAuth && !game.busy;

  const standRows = game.participants.map((p) => ({
    id: p.id,
    rank: p.standing,
    name: p.name,
    goals: p.matchGoals,
    points: p.matchPoints,
    isYou: p.isYou,
    isAi: p.isAi,
  }));
  const pinnedAsset = game.round
    ? getMarketAsset(game.round.market)
    : game.marketAsset;
  const entryText = game.entryPrice ? formatMarketPrice(game.entryPrice, pinnedAsset) : "--";
  const aiNames = game.rows.filter((row) => row.isAi).map((row) => row.name);
  const seconds = (game.timeLeftMs / 1000).toFixed(1);
  const shotClockPct = Math.max(3, Math.round(game.tradeProgress * 100));
  const netRead = game.pnlPct >= 0 ? "open" : "covered";
  const pnlActive = trading || closeFailed;
  const priceDeltaPrefix = game.derived.priceDelta >= 0 ? "+" : "-";
  const showOutcome = game.phase === "settled" && Boolean(game.outcome);

  const statusText = game.requiresAuth
    ? "Sign in to open a position."
    : game.backendError && idle
      ? `Connected backend unavailable: ${game.backendError}`
      : noRounds && idle
        ? "You are out of rounds today. Come back tomorrow."
      : !game.marketReady && idle
        ? game.mode === "connected"
          ? `Waiting for live ${game.marketAsset.displayPair} before kickoff.`
          : `Syncing ${game.marketAsset.displayPair} before kickoff.`
      : opening
        ? "Locking in your entry."
        : trading && !game.canCloseNow
          ? "Waiting for the live price before you can close."
        : trading
          ? "Close while you are up to bank your shots."
          : settling
            ? "Settling your trade."
          : closeFailed
            ? "Close failed. Keep the round and retry settlement."
            : resolving
              ? "Shots away."
              : game.outcome && game.phase === "settled"
                ? game.outcome.summary
                : "Pick Long or Short to open a position.";

  const volley = game.phase === "settled"
    ? [...game.shooters].sort((a, b) => b.goals - a.goals || b.pnlPct - a.pnlPct)
    : [];
  const openWithSound = (nextDirection: Direction) => {
    audio.unlock();
    audio.playWhistle();
    game.openTrade(nextDirection);
  };
  const closeWithSound = () => {
    audio.unlock();
    audio.playClose();
    game.closeNow();
  };

  return (
    <main className="app-shell">
      <section className="left-rail" aria-label="Game navigation">
        <div className="brand-mark">
          <div className="brand-ball" aria-hidden="true">PP</div>
          <div>
            <p>Global Penalty Circuit</p>
            <strong>Finals Arena</strong>
          </div>
        </div>

        <nav className="rail-nav" aria-label="Primary">
          <a className="active" href="#arena" aria-label="Arena">
            <Zap size={20} />
            <span>Arena</span>
          </a>
          <a href="#standings" aria-label="Standings">
            <Trophy size={20} />
            <span>Standings</span>
          </a>
        </nav>

        <div className="rail-card">
          <span className="rail-card-label">How it works</span>
          <strong>Trade the chart. Profit earns your shots.</strong>
          <small>Win the trade to earn open shots. Lose it and the keeper wins. AI squads are simulated and not reward eligible.</small>
        </div>
      </section>

      <section className="center-stage" id="arena">
        <header className="topbar">
          <div>
            <span className="eyebrow">Meridian Cup / Day 12</span>
            <h1>Penalty Perps</h1>
          </div>
          <div className="profile-strip">
            <span className="token-chip" title="Paper settlement only, no custody">
              <Coins size={16} />
              Paper
            </span>
            {features.tokenGate && game.isHolder && (
              <span className="token-chip active">
                <BadgeCheck size={16} />
                {env.tokenSymbol} holder
              </span>
            )}
            <button
              className={audio.enabled ? "sound-button active" : "sound-button"}
              type="button"
              onClick={() => audio.setEnabled(!audio.enabled)}
              aria-label={audio.enabled ? "Mute match audio" : "Unmute match audio"}
              title={audio.enabled ? "Mute match audio" : "Unmute match audio"}
            >
              {audio.enabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
            </button>
            <button
              className={profileOpen ? "sound-button active" : "sound-button"}
              type="button"
              onClick={() => setProfileOpen((open) => !open)}
              aria-label="Your profile"
              title="Your profile"
            >
              <UserRound size={17} />
            </button>
            <WalletButton />
          </div>
        </header>

        {game.error && (
          <div className="alert-banner" role="alert">
            <AlertTriangle size={16} />
            <span>{game.error}</span>
          </div>
        )}

        {profileOpen ? (
          <ProfilePanel
            playerId={auth.user?.id ?? "me"}
            handle={auth.user?.displayName ?? "@you"}
            walletAddress={game.walletAddress}
            isHolder={game.isHolder}
            tokenSymbol={env.tokenSymbol}
            rank={game.seed.rank}
            fieldSize={Math.max(game.rows.length, game.seed.rank)}
            seasonPoints={game.score}
            streak={game.streak}
            roundsLeft={game.roundsLeft}
            dailyCap={RULES.dailyRounds}
            lastMatch={game.matchResult}
            onBack={() => setProfileOpen(false)}
          />
        ) : inLobby ? (
          <LobbyPanel
            field={game.lobbyField.map((p) => ({
              id: p.id,
              name: p.name,
              avatar: p.avatar,
              isYou: p.isYou,
              isAi: p.isAi,
              isHolder: p.isHolder,
              tendency: p.tendency,
            }))}
            roundsLeft={game.roundsLeft}
            roundsMax={game.matchRounds}
            market={game.marketAsset.displayPair}
            seed={game.seed}
            ready={game.ready && game.marketReady}
            outOfRounds={game.outOfRounds}
            onEnter={game.startMatch}
          />
        ) : inResults && game.matchResult ? (
          <MatchResults
            placement={game.matchResult.placement}
            fieldSize={game.matchResult.fieldSize}
            summary={game.matchResult.summary}
            totals={game.matchResult.totals}
            bestRound={game.matchResult.bestRound}
            seasonDelta={game.matchResult.seasonDelta}
            standings={standRows}
            roundsLeft={game.roundsLeft}
            outOfRounds={game.outOfRounds}
            onPlayAgain={game.findNewMatch}
          />
        ) : (
          <div className="arena-card">
            <Suspense fallback={<div className="arena-scene arena-loading" aria-label="Loading 3D penalty arena" />}>
              <ArenaScene
                phase={game.phase}
                shooters={game.shooters}
                hud={{
                  score: game.score,
                  rounds: game.roundNumber,
                  roundsMax: game.matchRounds,
                  streak: game.streak,
                  market: game.marketAsset.displayPair,
                }}
              />
            </Suspense>

            <div className="arena-hud">
              <div className="hud-pill">
                <span>Round</span>
                <strong>{game.roundNumber}/{game.matchRounds}</strong>
              </div>
              <div
                className={
                  "hud-pill streak-pill" +
                  (game.streak >= 2 ? " on-fire" : "") +
                  (game.streak >= 4 ? " blaze" : "")
                }
              >
                <span>{game.streak >= 4 ? "On fire" : "Streak"}</span>
                <strong>
                  {game.streak >= 2 && <Flame size={13} aria-hidden="true" />}
                  {game.streak}
                </strong>
              </div>
              <div className="hud-pill">
                <span>Score</span>
                <strong>{game.score.toLocaleString()}</strong>
              </div>
            </div>

            <TradeTicker
              price={game.derived.price}
              asset={game.marketAsset}
              aiNames={aiNames}
              active={game.marketReady}
            />

            {inCountdown && (
              <div className="countdown-overlay" aria-hidden="true">
                <span>Round {game.roundNumber} of {game.matchRounds}</span>
                <strong>{game.countin}</strong>
              </div>
            )}

            {inBreak && (
              <RoundBreak
                round={game.roundNumber}
                totalRounds={game.matchRounds}
                standings={standRows}
                isFinal={game.isFinalRound}
                secondsLeft={game.breakSecondsLeft}
                onNext={game.advanceRound}
              />
            )}
          </div>
        )}

        {showArena && (
          <div className={trading ? "round-bar live" : "round-bar"} aria-live="polite">
            <Activity size={15} />
            <span>
              {inCountdown ? `Round ${game.roundNumber} of ${game.matchRounds}. Get ready.` : statusText}
            </span>
          </div>
        )}
      </section>

      <aside className="right-stack">
        {showArena && (
          <>
        <section className="market-slip" id="markets">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Paper trading</span>
              <h2>{game.marketAsset.displayPair}</h2>
            </div>
            <span className={game.derived.priceDelta >= 0 ? "price up" : "price down"}>
              {priceDeltaPrefix}
              {formatMarketPrice(Math.abs(game.derived.priceDelta), game.marketAsset)}
            </span>
          </div>

          <Candles
            points={game.market}
            entryPrice={game.entryPrice}
            asset={game.marketAsset}
            pnlPct={pnlActive ? game.pnlPct : null}
          />

          <div className="market-meta">
            <div>
              <span>Now</span>
              <strong>${formatMarketPrice(game.derived.price, game.marketAsset)}</strong>
            </div>
            <div>
              <span>Your price</span>
              <strong>${entryText}</strong>
            </div>
            <div>
              <span>Profit</span>
              <strong className={pnlActive ? (game.pnlPct >= 0 ? "pnl up" : "pnl down") : ""}>
                {pnlActive ? `${game.pnlPct >= 0 ? "+" : ""}${game.pnlPct.toFixed(2)}%` : "--"}
              </strong>
            </div>
          </div>

          <PnlGauge
            pnlPct={game.pnlPct}
            active={pnlActive}
            subLabel={pnlActive ? (game.direction ? game.direction.toUpperCase() : "POSITION") : "FLAT"}
          />

          {trading && (
            <PowerMeter
              shots={game.shotsNow}
              openness={game.opennessNow}
              powerRatio={game.powerRatio}
            />
          )}

          {trading && (
            <div
              className={game.pnlPct >= 0 ? "pressure-strip up" : "pressure-strip down"}
              role="group"
              aria-label={`Shot clock ${seconds} seconds remaining`}
            >
              <div className="pressure-copy">
                <span>Close in</span>
                <strong>{seconds}s</strong>
              </div>
              <div
                className="pressure-track"
                role="progressbar"
                aria-label="Time left to close"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={shotClockPct}
              >
                <span style={{ width: `${shotClockPct}%` }} />
              </div>
            </div>
          )}

          {game.requiresAuth ? (
            <button className="primary-action full" type="button" onClick={auth.login}>
              <Wallet size={18} />
              Sign in to play
            </button>
          ) : opening ? (
            <button className="primary-action full" type="button" disabled aria-busy="true">
              Locking in entry
            </button>
          ) : trading ? (
            <button
              className={game.pnlPct >= 0 ? "close-action up" : "close-action down"}
              type="button"
              onClick={closeWithSound}
              disabled={!game.canCloseNow}
            >
              {!game.canCloseNow
                ? "Waiting for live price"
                : game.shotsNow > 0
                  ? `Bank ${game.shotsNow} ${game.shotsNow === 1 ? "shot" : "shots"}`
                  : "Close (no shots yet)"}
            </button>
          ) : settling ? (
            <button className="primary-action full" type="button" disabled aria-busy="true">
              Settling trade
            </button>
          ) : closeFailed ? (
            <button className="close-action down" type="button" onClick={closeWithSound}>
              Retry close
            </button>
          ) : resolving ? (
            <button className="primary-action full" type="button" disabled aria-busy="true">
              Shots away
            </button>
          ) : inMatch ? (
            <div className="direction-grid" role="group" aria-label="Open a position">
              <button
                className="long"
                type="button"
                disabled={!canOpen}
                onClick={() => openWithSound("long")}
              >
                Long
              </button>
              <button
                className="short"
                type="button"
                disabled={!canOpen}
                onClick={() => openWithSound("short")}
              >
                Short
              </button>
            </div>
          ) : (
            <button className="primary-action full" type="button" disabled>
              Trading opens at kickoff
            </button>
          )}

          <div className="disclosure-row">
            <Lock size={14} />
            Paper points. No margin, custody, deposits, or real liquidation.
          </div>
        </section>

        <section className="result-ticket">
          <div className="ticket-top">
            <span>This round</span>
            <strong>
              {showOutcome && game.outcome
                ? game.outcome.shots <= 0
                  ? "NO SHOT"
                  : game.outcome.goals > 0
                    ? "GOAL"
                    : "BLOCKED"
                : trading
                  ? "TRADING"
                  : settling
                    ? "SETTLING"
                    : resolving
                    ? "SHOOTING"
                  : "OPEN"}
            </strong>
          </div>
          {showOutcome && game.outcome ? (
            <div className="result-body">
              <h2>{game.outcome.summary}</h2>
              <dl>
                <div>
                  <dt>PnL</dt>
                  <dd className={game.outcome.pnlPct >= 0 ? "pnl up" : "pnl down"}>
                    {game.outcome.pnlPct >= 0 ? "+" : ""}
                    {game.outcome.pnlPct.toFixed(2)}%
                  </dd>
                </div>
                <div>
                  <dt>Shots</dt>
                  <dd>{game.outcome.shots}</dd>
                </div>
                <div>
                  <dt>Goals</dt>
                  <dd>{game.outcome.goals}</dd>
                </div>
              </dl>
              <p>+{game.outcome.points} points</p>
              {volley.length > 1 && (
                <div className="volley-list">
                  {volley.map((s) => (
                    <div className={s.isYou ? "volley-row you" : "volley-row"} key={s.id}>
                      <span className="volley-name">
                        {s.isYou ? "You" : s.name.replace(/^AI (Squad|Keeper): /, "")}
                      </span>
                      <span className="volley-goals">{s.goals} G</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="empty-ticket">
              <Goal size={26} />
              <p>
                {game.requiresAuth
                  ? "Sign in, open a position, then close while you are up."
                  : settling
                    ? "Settlement is being checked. The volley starts next."
                  : resolving
                    ? "Watch the keeper. Shots are resolving."
                  : "Open a position, ride the chart, then close while you are up."}
              </p>
            </div>
          )}
        </section>

          </>
        )}

        <section className="leaderboard" id="standings">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Season ladder</span>
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
